import {mkdir,writeFile,copyFile,chmod,access,realpath,mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {dirname,join,resolve} from "node:path";
import {smokeFeatureOverrides} from "./recovery-safety.mjs";
const exec=promisify(execFile);

/** Existing local bubblewrap; no external service. Credentials never enter report artifacts. */
export async function isolateCodex({cwd,projectRoot,codexHome,copyCredentials=false}) {
  if(process.platform!=="linux")throw new Error("Evaluator read isolation is currently supported only on Linux with bubblewrap.");
  await access("/usr/bin/bwrap");
  const hostHome=join(cwd,".continuum/codex-host");await mkdir(hostHome,{recursive:true,mode:0o700});
  await writeFile(join(hostHome,"config.toml"),'model = "gpt-5.6-luna"\nmodel_provider = "openai"\nmodel_reasoning_effort = "low"\n[features]\n'+Object.keys(smokeFeatureOverrides).map(key=>key.slice("features.".length)+" = false\n").join(""),{mode:0o600});
  if(copyCredentials){await copyFile(join(codexHome,"auth.json"),join(hostHome,"auth.json"));await chmod(join(hostHome,"auth.json"),0o600);}
  const masks=[resolve(projectRoot),...(codexHome?[resolve(codexHome)]:[])];
  if(masks.some(path=>cwd===path||cwd.startsWith(path+"/")))throw new Error("Agent workspace must be outside masked evaluator and host-memory roots.");
  const base=["--die-with-parent","--ro-bind","/","/","--unshare-user","--unshare-pid","--proc","/proc","--dev","/dev","--tmpfs","/tmp",...masks.flatMap(path=>["--tmpfs",path]),"--dir",dirname(cwd),"--bind",cwd,cwd,"--tmpfs",join(cwd,".continuum"),"--bind",hostHome,hostHome,"--chdir",cwd,"--setenv","CODEX_HOME",hostHome];
  const probe=await exec("/usr/bin/bwrap",[...base,"--","/usr/bin/test","!","-e",join(projectRoot,"scripts/phase6-behavior.mjs")],{timeout:5000});
  if(probe.stderr)throw new Error("Isolation probe failed: "+probe.stderr);
  await exec("/usr/bin/bwrap",[...base,"--","/usr/bin/test","!","-e",join(cwd,".continuum/continuum.db")],{timeout:5000});
  const privateDirectory=await mkdtemp(join(tmpdir(),"continuum-private-evaluator-"));
  try {const marker=join(privateDirectory,"answer.txt");await writeFile(marker,"evaluator-only probe");await exec("/usr/bin/bwrap",[...base,"--","/usr/bin/test","!","-e",marker],{timeout:5000});}
  finally {await rm(privateDirectory,{recursive:true,force:true});}
  const binary=await realpath((await exec("which",["codex"],{timeout:5000})).stdout.trim()),guestBinary=join(hostHome,"codex-runtime");
  await writeFile(guestBinary,"");
  const isolated=[...base,"--ro-bind",binary,guestBinary];
  const version=await exec("/usr/bin/bwrap",[...isolated,"--",guestBinary,"--version"],{timeout:5000});
  return{executable:"/usr/bin/bwrap",executableArgs:[...isolated,"--",guestBinary,"app-server","--listen","stdio://"],codexVersion:version.stdout.match(/\d+\.\d+\.\d+/)?.[0]??null,isolation:{mode:"bubblewrap",evaluatorRootHidden:true,hostTmpHidden:true,recorderDatabaseHidden:true,hostCodexHistoryHidden:!!codexHome,credentialsCopied:copyCredentials}};
}
