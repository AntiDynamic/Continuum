import ts from "typescript";
import { parseDocument, isMap } from "yaml";
import type { ExtractedSymbol, Extractor } from "./types.js";
const lineAt=(content:string,offset:number)=>content.slice(0,offset).split(/\r?\n/).length;
export class JsonConfigurationExtractor implements Extractor {
  extract(path:string,content:string):ExtractedSymbol[] {
    const source=ts.parseJsonText(path,content),results:ExtractedSymbol[]=[];
    const visit=(node:ts.Node,prefix:string[]=[])=>{
      if(ts.isObjectLiteralExpression(node))for(const property of node.properties){
        if(!ts.isPropertyAssignment(property))continue;
        const key=property.name.getText(source).replace(/^"|"$/g,""),names=[...prefix,key],start=property.getStart(source),end=property.getEnd();
        results.push({name:names.join("."),kind:"json_key",content:content.slice(start,end),startLine:lineAt(content,start),endLine:lineAt(content,end),metadata:{configurationPath:names,sourceRepresentation:"exact",parseConfidence:"high"}});
        visit(property.initializer,names);
      }
    };
    for(const statement of source.statements) if(ts.isExpressionStatement(statement))visit(statement.expression);
    return results;
  }
}
export class YamlConfigurationExtractor implements Extractor {
  extract(_path:string,content:string):ExtractedSymbol[]{
    const document=parseDocument(content),results:ExtractedSymbol[]=[];
    if(document.errors.length)return [];
    const visit=(node:unknown,prefix:string[]=[])=>{
      if(!isMap(node))return;
      for(const pair of node.items){
        const key=pair.key as {value?:unknown;range?:number[]},value=pair.value as {range?:number[]}|null;
        if(!key?.range)continue;
        const names=[...prefix,String(key.value)],start=key.range[0]!,end=value?.range?.[1]??key.range[1]!;
        results.push({name:names.join("."),kind:"yaml_key",content:content.slice(start,end).trimEnd(),startLine:lineAt(content,start),endLine:lineAt(content,Math.max(start,end-1)),metadata:{configurationPath:names,sourceRepresentation:"exact",parseConfidence:"high"}});
        visit(pair.value,names);
      }
    };
    visit(document.contents);return results;
  }
}
