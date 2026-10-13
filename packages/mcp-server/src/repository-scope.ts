import {realpath} from 'node:fs/promises';
import {basename,dirname,isAbsolute,relative,resolve,sep} from 'node:path';
async function physicalPath(path:string):Promise<string>{
 try{return await realpath(path);}catch(error){
  if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
  const parent=dirname(path);if(parent===path)throw error;
  return resolve(await physicalPath(parent),basename(path));
 }
}
/** Resolve filesystem aliases (including Windows short names) before containment. */
export async function assertRepositoryScope(repositoryRoot:string,cwd:string,requestedPath="."):Promise<void>{
 const [root,current]=await Promise.all([realpath(repositoryRoot),realpath(cwd)]);
 const target=await physicalPath(resolve(current,requestedPath)),fromRoot=relative(root,target);
 if(isAbsolute(fromRoot)||fromRoot===".."||fromRoot.startsWith(".."+sep))throw new Error("Requested path is outside the configured repository root.");
}
