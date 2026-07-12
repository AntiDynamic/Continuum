import ts from "typescript";
import type { Extractor, ExtractedSymbol } from "./types.js";

export class TypeScriptExtractor implements Extractor {
  extract(absolutePath: string, content: string): ExtractedSymbol[] {
    const sourceFile = ts.createSourceFile(
      absolutePath,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    const symbols: ExtractedSymbol[] = [];

    const addSymbol = (node: ts.Node, name: string, kind: string) => {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      
      symbols.push({
        name,
        kind,
        content: node.getText(sourceFile),
        startLine: start.line + 1,
        endLine: end.line + 1,
      });
    };

    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        addSymbol(node, node.name.text, "function");
      } else if (ts.isClassDeclaration(node) && node.name) {
        addSymbol(node, node.name.text, "class");
        // Also extract methods
        node.members.forEach(member => {
          if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
            addSymbol(member, `${node.name!.text}.${member.name.text}`, "method");
          }
        });
      } else if (ts.isInterfaceDeclaration(node) && node.name) {
        addSymbol(node, node.name.text, "interface");
      } else if (ts.isTypeAliasDeclaration(node) && node.name) {
        addSymbol(node, node.name.text, "type");
      } else if (ts.isVariableStatement(node)) {
        // Extract constants/variables
        const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
        node.declarationList.declarations.forEach(decl => {
          if (ts.isIdentifier(decl.name)) {
            addSymbol(node, decl.name.text, isConst ? "constant" : "variable");
          }
        });
      } else if (ts.isImportDeclaration(node)) {
        let name = "import";
        if (node.importClause) {
          if (node.importClause.name) {
            name = `import ${node.importClause.name.text}`;
          } else if (node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
            name = `import { ${node.importClause.namedBindings.elements.map(e => e.name.text).join(', ')} }`;
          }
        }
        addSymbol(node, name, "import");
      } else if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
        addSymbol(node, "export", "export");
      } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        // Test declarations
        const fnName = node.expression.text;
        if (["it", "test", "describe"].includes(fnName)) {
          const firstArg = node.arguments[0];
          if (firstArg && ts.isStringLiteral(firstArg)) {
            addSymbol(node, firstArg.text, "test");
          } else {
            addSymbol(node, fnName, "test");
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return symbols;
  }
}
