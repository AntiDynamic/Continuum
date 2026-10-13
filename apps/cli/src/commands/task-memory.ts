import { RepositoryContextSessionService } from "@continuum/context-engine";
import type { TaskMemoryKind } from "@continuum/shared";

export async function runTaskMemory(id:string,options:{cwd:string;repo?:string;kind?:TaskMemoryKind;text?:string;supersedes?:string;query?:string;budget?:string;checkpoint?:string;recover?:boolean}) {
  const service=await RepositoryContextSessionService.open(options.cwd,options.repo);
  try {
    const budget=options.budget===undefined?1500:Number(options.budget);
    let result:unknown;
    if(options.text){if(!options.kind)throw new Error("--text requires --kind.");service.memory.initialize(id);result=service.memory.write(id,{kind:options.kind,text:options.text,authority:"user",critical:["requirement","constraint","objective"].includes(options.kind),supersedes:options.supersedes});}
    else if(options.checkpoint)result=await service.memory.checkpoint(id,options.checkpoint,budget);
    else if(options.recover)result=await service.memory.recover(id,budget);
    else if(options.query)result=await service.memory.retrieve(id,options.query,budget);
    else result=service.memory.state(id);
    console.log(JSON.stringify(result,null,2));
  } finally {service.close();}
}
