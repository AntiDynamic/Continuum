import {mkdir,writeFile,copyFile,chmod,access,realpath,mkdtemp,rm,readFile,stat} from "node:fs/promises";
import {constants} from "node:fs";
import {tmpdir} from "node:os";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {dirname,join,resolve} from "node:path";
import {smokeFeatureOverrides} from "./recovery-safety.mjs";
import {runHelperOperation,waitForProcessGroupGone} from "./recovery-helper-preflight.mjs";
const exec=promisify(execFile);

/** Existing local bubblewrap; no external service. Credentials never enter report artifacts. */
export async function isolateCodex({cwd,projectRoot,codexHome,copyCredentials=false,runtimeExecutable}) {
  if(process.platform!=="linux")throw new Error("Evaluator read isolation is currently supported only on Linux with bubblewrap.");
  await access("/usr/bin/bwrap");
  const hostHome=join(cwd,".continuum/codex-host");await mkdir(hostHome,{recursive:true,mode:0o700});
  await writeFile(join(hostHome,"config.toml"),'model = "gpt-5.6-luna"\nmodel_provider = "openai"\nmodel_reasoning_effort = "low"\n[features]\n'+Object.keys(smokeFeatureOverrides).map(key=>key.slice("features.".length)+" = false\n").join(""),{mode:0o600});
  const masks=[resolve(process.env.HOME),resolve(projectRoot),...(codexHome?[resolve(codexHome)]:[])];
  if(masks.some(path=>cwd===path||cwd.startsWith(path+"/")))throw new Error("Agent workspace must be outside masked evaluator and host-memory roots.");
  const base=["--die-with-parent","--ro-bind","/","/","--unshare-user","--unshare-pid","--proc","/proc","--dev","/dev","--tmpfs","/tmp",...masks.flatMap(path=>["--tmpfs",path]),"--dir",dirname(cwd),"--bind",cwd,cwd,"--tmpfs",join(cwd,".continuum"),"--bind",hostHome,hostHome,"--chdir",cwd,"--setenv","CODEX_HOME",hostHome,"--setenv","HOME",hostHome,"--setenv","SHELL","/bin/bash"];
  const probe=await exec("/usr/bin/bwrap",[...base,"--","/usr/bin/test","!","-e",join(projectRoot,"scripts/phase6-behavior.mjs")],{timeout:5000});
  if(probe.stderr)throw new Error("Isolation probe failed: "+probe.stderr);
  await exec("/usr/bin/bwrap",[...base,"--","/usr/bin/test","!","-e",join(cwd,".continuum/continuum.db")],{timeout:5000});
  const privateDirectory=await mkdtemp(join(tmpdir(),"continuum-private-evaluator-"));
  try {const marker=join(privateDirectory,"answer.txt");await writeFile(marker,"evaluator-only probe");await exec("/usr/bin/bwrap",[...base,"--","/usr/bin/test","!","-e",marker],{timeout:5000});}
  finally {await rm(privateDirectory,{recursive:true,force:true});}
  const recorderMarker=join(cwd,".continuum","preflight-recorder-private");await writeFile(recorderMarker,"recorder-only proof");
  try{await exec("/usr/bin/bwrap",[...base,"--","/usr/bin/test","!","-e",recorderMarker],{timeout:5000});await exec("/usr/bin/bwrap",[...base,"--","/usr/bin/test","!","-e",join(process.env.HOME,".codex/sessions")],{timeout:5000});}
  finally{await rm(recorderMarker,{force:true});}
  const binary=await realpath(runtimeExecutable??(await exec("which",["codex"],{timeout:5000})).stdout.trim()),packageRoot=dirname(dirname(binary));
  const manifest=JSON.parse(await readFile(join(packageRoot,"codex-package.json"),"utf8"));
  if(manifest.version!=="0.162.1"||manifest.layoutVersion!==1||manifest.entrypoint!=="bin/codex"||manifest.resourcesDir!=="codex-resources"||manifest.pathDir!=="codex-path")throw new Error("Unreviewed Codex runtime package layout; preflight refused.");
  const resourceHelper=join(packageRoot,"codex-resources/codex-code-mode-host"),binHelper=join(packageRoot,"bin/codex-code-mode-host");
  let helper=resourceHelper;try{await access(helper);}catch(error){if(error.code!=="ENOENT")throw error;helper=binHelper;}
  const required=[binary,helper,join(packageRoot,"codex-path/rg"),join(packageRoot,"codex-resources/bwrap"),join(packageRoot,"codex-resources/zsh/bin/zsh"),process.execPath];
  for(const file of required){if(!(await stat(file)).isFile())throw new Error("Required runtime asset is not a file: "+file);await access(file,constants.X_OK);}
  const guestRoot=join(hostHome,"runtime"),guestBinary=join(guestRoot,"bin/codex"),guestHelper=join(guestRoot,helper.slice(packageRoot.length+1));
  await mkdir(join(guestRoot,"tools"),{recursive:true});await writeFile(join(guestRoot,"tools/node"),"");
  const isolated=[...base,...["bin","codex-resources","codex-path","codex-package.json"].flatMap(name=>["--ro-bind",join(packageRoot,name),join(guestRoot,name)]),"--ro-bind",process.execPath,join(guestRoot,"tools/node"),"--setenv","PATH",[join(guestRoot,"tools"),join(guestRoot,"codex-path"),"/usr/local/bin","/usr/bin","/bin"].join(":")];
  const env={PATH:"/usr/local/bin:/usr/bin:/bin",HOME:hostHome,CODEX_HOME:hostHome,SHELL:"/bin/bash",LANG:"C.UTF-8",TERM:"dumb"};
  // Keep provider networking configuration, without inheriting unrelated credentials/history settings.
  for(const key of ["HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","NO_PROXY","http_proxy","https_proxy","all_proxy","no_proxy","SSL_CERT_FILE","SSL_CERT_DIR"])if(process.env[key])env[key]=process.env[key];
  const probeOptions={timeout:5000,env};
  const version=await exec("/usr/bin/bwrap",[...isolated,"--unshare-net","--",guestBinary,"--version"],probeOptions);
  if(version.stdout.trim()!=="codex-cli 0.162.1")throw new Error("Runtime binary does not match package version.");
  const runtimeChecks=[];
  for(const [program,args] of [[join(guestRoot,"codex-path/rg"),["--version"]],[join(guestRoot,"codex-resources/bwrap"),["--version"]],[join(guestRoot,"codex-resources/zsh/bin/zsh"),["--version"]],[join(guestRoot,"tools/node"),["--version"]]]){const result=await exec("/usr/bin/bwrap",[...isolated,"--unshare-net","--",program,...args],probeOptions);runtimeChecks.push({program,output:result.stdout.trim()});}
  const environment=await exec("/usr/bin/bwrap",[...isolated,"--unshare-net","--","/usr/bin/python3","-c","import os,json; print(json.dumps({k:os.environ[k] for k in ['HOME','CODEX_HOME','SHELL','PATH']}))"],probeOptions);
  const available=JSON.parse(environment.stdout);if(available.CODEX_HOME!==hostHome||available.HOME!==hostHome||available.SHELL!=="/bin/bash"||!available.PATH.startsWith(join(guestRoot,"tools")))throw new Error("Isolated runtime environment drifted.");
  const result={executable:"/usr/bin/bwrap",cwd,env,commandPrefix:isolated,executableArgs:[...isolated,"--",guestBinary,"app-server","--listen","stdio://"],codexVersion:"0.162.1",runtime:{binary:guestBinary,helper:guestHelper,packageRoot,required},isolation:{mode:"bubblewrap",evaluatorRootHidden:true,hostTmpHidden:true,recorderDatabaseHidden:true,hostCodexHistoryHidden:true,otherUserAgentHistoriesHidden:true,credentialsCopied:false}};
  const helperOperation=await runHelperOperation(result);
  if(helperOperation.output!=="continuum-helper-ok:42")throw new Error("Representative helper operation returned an unexpected result.");
  result.preflight={passed:true,inferenceRequests:0,environment:available,runtimeChecks,helperOperation,networkDisabledDuringPreflight:true};
  const {StdioCodexAppServerClient}=await import("../packages/codex-app-server/dist/index.js");
  const client=new StdioCodexAppServerClient();let appServerPid;
  try {
    await client.start({...result,executableArgs:[...isolated,"--unshare-net","--",guestBinary,"app-server","--listen","stdio://"],terminateProcessGroup:true,requestTimeoutMs:5000,shutdownTimeoutMs:500,onRawMessage:message=>{if(message.direction==="client_to_server"&&message.method&&!["initialize","initialized","config/read","command/exec"].includes(message.method))throw new Error("Inference is forbidden in runtime preflight.");}});
    appServerPid=client.processId;
    const server=await client.initialize({experimentalApi:true});const response=await client.readConfiguration();const config=response.config;
    if(server.codexHome!==hostHome||config.model!=="gpt-5.6-luna"||config.model_provider!=="openai"||config.model_reasoning_effort!=="low"||Object.keys(smokeFeatureOverrides).some(key=>config.features?.[key.slice(9)]!==false))throw new Error("Real isolated App Server configuration differs from safeguards.");
    result.preflight.configuration={model:config.model,provider:config.model_provider,reasoning:config.model_reasoning_effort,features:Object.fromEntries(Object.keys(smokeFeatureOverrides).map(key=>[key.slice(9),config.features[key.slice(9)]]))};
    const command=await client.executePreflightCommand([join(guestRoot,"tools/node"),"-e","console.log('continuum-command-ok:'+(6*7))"],cwd);
    if(command.exitCode!==0||command.stdout.trim()!=="continuum-command-ok:42")throw new Error("Native sandbox command preflight failed: "+JSON.stringify(command));
    result.preflight.sandboxCommand=command;
  }finally{await client.close();if(appServerPid&&!await waitForProcessGroupGone(appServerPid,1000))throw new Error("Preflight App Server process group remained after cleanup.");}
  result.preflight.appServerCleanup={pid:appServerPid,groupGone:true};
  // Credentials are copied only after every offline runtime check has passed.
  if(copyCredentials){await copyFile(join(codexHome,"auth.json"),join(hostHome,"auth.json"));await chmod(join(hostHome,"auth.json"),0o600);result.isolation.credentialsCopied=true;}
  return result;
}
