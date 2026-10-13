import ts from "typescript";
import { resolve, relative } from "node:path";
import { posix } from "node:path";
import type { CompiledContextItem, PersistedContextRelationship } from "@continuum/shared";

export interface IndexedCompiledItem { compiled: CompiledContextItem; contextItemId: string }

function stem(path: string): string {
  return path.replaceAll("\\", "/").replace(/\.(tsx?|jsx?|mjs|cjs|mts|cts)$/i, "").replace(/\/index$/i, "");
}

export function inferContextRelationships(entries: IndexedCompiledItem[], repositoryRoot?: string): PersistedContextRelationship[] {
  const relationships: PersistedContextRelationship[] = [];
  const add = (source: IndexedCompiledItem, target: IndexedCompiledItem, kind: PersistedContextRelationship["kind"], confidence: PersistedContextRelationship["confidence"], description: string): void => {
    if (source.contextItemId === target.contextItemId) return;
    relationships.push({ id: crypto.randomUUID(), sourceContextItemId: source.contextItemId, targetContextItemId: target.contextItemId, kind, confidence, evidence: { sourcePath: source.compiled.sourcePath, sourceStartLine: source.compiled.sourceStartLine, sourceEndLine: source.compiled.sourceEndLine, description } });
  };
  const program = repositoryRoot ? ts.createProgram([...new Set(entries.filter(entry=>entry.compiled.language==="typescript").map(entry=>resolve(repositoryRoot,entry.compiled.sourcePath)))],{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,skipLibCheck:true}) : undefined;
  const checker=program?.getTypeChecker();
  const bindings=new Map<string,Map<string,IndexedCompiledItem[]>>();
  if(program&&checker&&repositoryRoot)for(const source of program.getSourceFiles()){
    const path=relative(repositoryRoot,source.fileName).replaceAll("\\","/");
    const byName=new Map<string,IndexedCompiledItem[]>();
    for(const statement of source.statements){
      if(!ts.isImportDeclaration(statement)||!statement.importClause)continue;
      const clause=statement.importClause;
      const names=[...(clause.name?[clause.name]:[]),...(clause.namedBindings&&ts.isNamedImports(clause.namedBindings)?clause.namedBindings.elements.map(x=>x.name):[])];
      for(const name of names){
        const alias=checker.getSymbolAtLocation(name);if(!alias)continue;
        const target=checker.getAliasedSymbol(alias);
        const declarations=target.declarations??[];
        const matches=entries.filter(entry=>declarations.some(declaration=>resolve(repositoryRoot,entry.compiled.sourcePath)===resolve(declaration.getSourceFile().fileName))&&entry.compiled.symbolName===target.name);
        if(matches.length)byName.set(name.text,matches);
      }
    }
    bindings.set(path,byName);
  }
  const byLogicalKey = new Map(entries.map((entry) => [entry.compiled.logicalKey, entry]));
  for (const entry of entries) {
    if (entry.compiled.parentSymbol) {
      const parent = byLogicalKey.get(`${entry.compiled.sourcePath}:${entry.compiled.parentSymbol}`);
      if (parent) add(parent, entry, "contains", "high", `${entry.compiled.parentSymbol} syntactically contains ${entry.compiled.symbolName}.`);
    }
    const referenced = new Set((entry.compiled.metadata["referencedIdentifiers"] as string[]|undefined)??[]);
    for(const [name,targets] of bindings.get(entry.compiled.sourcePath)??[]){
      if(!referenced.has(name))continue;
      for(const target of targets)add(entry,target,entry.compiled.kind==="test"?"tests":"depends_on",targets.length===1?"high":"medium",`TypeScript binding ${name} resolves to ${target.compiled.sourcePath}#${target.compiled.symbolName}.`);
    }
    // Offline compiler fixtures lack a Program: keep only unambiguous named imports.
    if(!program&&entry.compiled.kind==="import"){
      const moduleName=entry.compiled.content.match(/from\s+["']([^"']+)["']/)?.[1];
      if(moduleName?.startsWith(".")){
        const expected=stem(posix.normalize(posix.join(posix.dirname(entry.compiled.sourcePath),moduleName)));
        const names=(entry.compiled.content.match(/\{([^}]+)\}/)?.[1]??"").split(",").map(x=>x.trim().split(/\s+as\s+/)[0]);
        for(const name of names){const matches=entries.filter(candidate=>stem(candidate.compiled.sourcePath)===expected&&candidate.compiled.symbolName===name);if(matches.length===1)add(entry,matches[0]!,"imports","medium","Unambiguous named import without semantic binding verification.");}
      }
    }
    if (entry.compiled.kind === "configuration" && /(^|\/)(package\.json|tsconfig[^/]*\.json|[^/]+\.ya?ml)$/i.test(entry.compiled.sourcePath)) {
      const directory = posix.dirname(entry.compiled.sourcePath.replaceAll("\\", "/"));
      const prefix = directory === "." ? "" : `${directory}/`;
      for (const target of entries.filter((candidate) => candidate.compiled.sourcePath.startsWith(prefix) && ["class", "function", "interface"].includes(candidate.compiled.kind)).slice(0, 10)) {
        add(entry, target, "configures", "medium", `${entry.compiled.sourcePath} is a package or build configuration candidate for ${target.compiled.sourcePath}.`);
      }
    }
  }
  return relationships;
}
