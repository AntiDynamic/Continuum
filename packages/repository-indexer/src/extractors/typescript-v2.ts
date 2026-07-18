import ts from "typescript";
import type { PurposeEvidence, TypeScriptContextMetadata } from "@continuum/shared";
import type { ExtractedSymbol, Extractor } from "./types.js";

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind));
}

function purpose(node: ts.Node, sourceFile: ts.SourceFile): PurposeEvidence | undefined {
  const leading = sourceFile.text.slice(node.getFullStart(), node.getStart(sourceFile));
  const jsdoc = leading.match(/\/\*\*([\s\S]*?)\*\//)?.[1]?.split("\n").map((line) => line.replace(/^\s*\*\s?/, "").trim()).filter(Boolean).join(" ");
  if (jsdoc) return { text: jsdoc, source: "jsdoc" };
  const comment = leading.match(/\/\/\s*([^\r\n]+)\s*$/)?.[1]?.trim();
  return comment ? { text: comment, source: "leading_comment" } : undefined;
}

function referencedIdentifiers(node: ts.Node): string[] {
  const values = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child)) values.add(child.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return [...values].sort().slice(0, 100);
}

function propertyName(node: ts.PropertyName | undefined, sourceFile: ts.SourceFile): string | undefined {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return node.getText(sourceFile);
}

export class TypeScriptCompilerApiExtractor implements Extractor {
  extract(absolutePath: string, content: string): ExtractedSymbol[] {
    const scriptKind = /\.tsx$/i.test(absolutePath) ? ts.ScriptKind.TSX : /\.jsx$/i.test(absolutePath) ? ts.ScriptKind.JSX : /\.[cm]?js$/i.test(absolutePath) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(absolutePath, content, ts.ScriptTarget.Latest, true, scriptKind);
    const importedModules = sourceFile.statements.filter(ts.isImportDeclaration).map((statement) => ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : statement.moduleSpecifier.getText(sourceFile)).sort();
    const symbols: ExtractedSymbol[] = [];

    const add = (node: ts.Node, name: string, kind: string, parentSymbol?: string, extra: Partial<TypeScriptContextMetadata> = {}): void => {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      const metadata: TypeScriptContextMetadata = {
        declarationKind: extra.declarationKind ?? kind,
        exported: hasModifier(node, ts.SyntaxKind.ExportKeyword),
        defaultExport: hasModifier(node, ts.SyntaxKind.DefaultKeyword),
        async: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
        static: hasModifier(node, ts.SyntaxKind.StaticKeyword),
        parentSymbol,
        parameters: extra.parameters,
        returnType: extra.returnType,
        importedModules,
        referencedIdentifiers: referencedIdentifiers(node),
      };
      symbols.push({ name, kind, content: node.getText(sourceFile), startLine: start.line + 1, endLine: end.line + 1, parentSymbol, purpose: purpose(node, sourceFile), metadata: { typescript: metadata, ...metadata } });
    };

    const visit = (node: ts.Node, parentSymbol?: string): void => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        add(node, node.name.text, "function", parentSymbol, { parameters: node.parameters.map((parameter) => parameter.getText(sourceFile)), returnType: node.type?.getText(sourceFile) });
      } else if (ts.isClassDeclaration(node) && node.name) {
        add(node, node.name.text, "class", parentSymbol);
        node.members.forEach((member) => visit(member, node.name?.text));
        return;
      } else if (ts.isConstructorDeclaration(node)) {
        add(node, `${parentSymbol ?? "anonymous"}.constructor`, "constructor", parentSymbol, { parameters: node.parameters.map((parameter) => parameter.getText(sourceFile)) });
      } else if (ts.isMethodDeclaration(node)) {
        const name = propertyName(node.name, sourceFile);
        if (name) add(node, `${parentSymbol ? `${parentSymbol}.` : ""}${name}`, "method", parentSymbol, { parameters: node.parameters.map((parameter) => parameter.getText(sourceFile)), returnType: node.type?.getText(sourceFile) });
      } else if (ts.isInterfaceDeclaration(node)) {
        add(node, node.name.text, "interface", parentSymbol);
      } else if (ts.isTypeAliasDeclaration(node)) {
        add(node, node.name.text, "type", parentSymbol);
      } else if (ts.isEnumDeclaration(node)) {
        add(node, node.name.text, "enum", parentSymbol);
      } else if (ts.isVariableStatement(node)) {
        const constant = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
        for (const declaration of node.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) continue;
          const initializer = declaration.initializer;
          const kind = initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) ? "function" : initializer && ts.isCallExpression(initializer) && /(^|\.)z\./.test(initializer.expression.getText(sourceFile)) ? "configuration" : constant ? "constant" : "variable";
          const parameters = initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) ? initializer.parameters.map((parameter) => parameter.getText(sourceFile)) : undefined;
          add(node, declaration.name.text, kind, parentSymbol, { declarationKind: kind === "configuration" ? "zod_schema" : kind === "function" ? "arrow_function" : kind, parameters });
        }
      } else if (ts.isImportDeclaration(node)) {
        const moduleName = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : node.moduleSpecifier.getText(sourceFile);
        add(node, `import ${moduleName}`, "import", parentSymbol, { declarationKind: "import" });
      } else if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
        add(node, `export ${node.getStart(sourceFile)}`, "export", parentSymbol, { declarationKind: ts.isExportAssignment(node) ? "export_assignment" : "export_declaration" });
      } else if (ts.isCallExpression(node)) {
        const expression = node.expression.getText(sourceFile);
        const first = node.arguments[0];
        if (/^(it|test|describe)(\.|$)/.test(expression)) {
          const label = first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) ? first.text : expression;
          add(node, label, "test", parentSymbol, { declarationKind: expression.split(".")[0] ?? "test" });
        } else if (/\.command$/.test(expression) && first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
          add(node, first.text, "configuration", parentSymbol, { declarationKind: "cli_command" });
        }
      }
      ts.forEachChild(node, (child) => visit(child, parentSymbol));
    };
    visit(sourceFile);
    return symbols;
  }
}
