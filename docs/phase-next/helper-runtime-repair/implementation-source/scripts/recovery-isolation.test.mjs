import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,symlink} from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {tmpdir} from "node:os";
import {join,resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {isolateCodex} from "./recovery-isolation.mjs";
import {runHelperOperation,processGroupExists} from "./recovery-helper-preflight.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),exec=promisify(execFile);
let cwd,isolated;
before(async()=>{cwd=await mkdtemp(join(tmpdir(),"continuum-runtime-tests-"));await mkdir(join(cwd,".continuum"));await writeFile(join(cwd,".continuum/continuum.db"),"private recorder");await writeFile(join(cwd,"fixture.txt"),"public fixture");isolated=await isolateCodex({cwd,projectRoot:root,codexHome:join(process.env.HOME,".codex")});});
after(async()=>{await rm(cwd,{recursive:true,force:true});});

test("real helper executes V1 JavaScript inside the actual isolated filesystem with no inference",()=>{
  assert.equal(isolated.preflight.helperOperation.output,"continuum-helper-ok:42");
  assert.equal(isolated.preflight.helperOperation.cleanup.groupGone,true);
  assert.equal(isolated.preflight.inferenceRequests,0);assert.equal(isolated.preflight.networkDisabledDuringPreflight,true);
  assert.match(isolated.runtime.binary,/runtime\/bin\/codex$/);assert.match(isolated.runtime.helper,/runtime\/(bin|codex-resources)\/codex-code-mode-host$/);
});
test("real metadata-only host preflight verifies environment, exact configuration and dependencies",()=>{
  assert.equal(isolated.preflight.environment.CODEX_HOME,join(cwd,".continuum/codex-host"));
  assert.equal(isolated.preflight.configuration.model,"gpt-5.6-luna");assert.equal(isolated.preflight.configuration.provider,"openai");assert.equal(isolated.preflight.configuration.reasoning,"low");
  assert.equal(isolated.preflight.runtimeChecks.length,4);assert.equal(isolated.preflight.appServerCleanup.groupGone,true);
  assert.equal(isolated.preflight.sandboxCommand.exitCode,0);assert.equal(isolated.preflight.sandboxCommand.stdout.trim(),"continuum-command-ok:42");
  assert.equal(isolated.env.OPENAI_API_KEY,undefined);assert.equal(isolated.env.GITHUB_TOKEN,undefined);
});
test("hidden validators, previous reports, recorder data and other user histories remain inaccessible",async()=>{
  for(const path of [join(root,"scripts/phase6-behavior.mjs"),join(root,"docs/phase-next/first-real-smoke-2026-10-13/report.json"),join(cwd,".continuum/continuum.db"),join(process.env.HOME,".codex/sessions"),join(process.env.HOME,".codex/auth.json"),join(process.env.HOME,".claude"),join(process.env.HOME,".gemini")])await exec(isolated.executable,[...isolated.commandPrefix,"--unshare-net","--","/usr/bin/test","!","-e",path],{env:isolated.env,timeout:5000});
  const visible=await exec(isolated.executable,[...isolated.commandPrefix,"--unshare-net","--","/bin/cat",join(cwd,"fixture.txt")],{env:isolated.env,timeout:5000});assert.equal(visible.stdout,"public fixture");
  await exec(isolated.executable,[...isolated.commandPrefix,"--unshare-net","--","/usr/bin/test","!","-w",isolated.runtime.binary],{env:isolated.env,timeout:5000});
});
test("real helper tool failure leaves no running process group",async()=>{
  let pid;await assert.rejects(runHelperOperation(isolated,{source:"throw new Error('offline intentional failure');",onSpawn:value=>{pid=value;}}),/offline intentional failure/);assert.equal(processGroupExists(pid),false);
});
test("real stalled helper is cancelled and terminated without leaving processes",async()=>{
  let pid;const start=Date.now();await assert.rejects(runHelperOperation(isolated,{source:"while(true){}",timeoutMs:1500,onSpawn:value=>{pid=value;}}));assert.ok(Date.now()-start<7000);assert.equal(processGroupExists(pid),false);
});

async function badPackage(kind) {
  const path=await mkdtemp(join(tmpdir(),"continuum-bad-runtime-"));
  const pkg=join(path,"package");await mkdir(join(pkg,"bin"),{recursive:true});
  await writeFile(join(pkg,"codex-package.json"),JSON.stringify({layoutVersion:1,version:"0.162.1",entrypoint:"bin/codex",resourcesDir:"codex-resources",pathDir:"codex-path"}));
  const main=join(pkg,"bin/codex");await writeFile(main,"#!/bin/sh\necho 'codex-cli 0.162.1'\n");await chmod(main,0o755);
  if(kind!=="missing"){const helper=join(pkg,"bin/codex-code-mode-host");await writeFile(helper,kind==="loader"?"#!/nonexistent/continuum-loader\n":"fixture");await chmod(helper,kind==="loader"?0o755:0o644);}
  if(kind==="loader")for(const directory of ["codex-path","codex-resources"]){await symlink(join(isolated.runtime.packageRoot,directory),join(pkg,directory));}
  const workspace=join(path,"workspace");await mkdir(workspace);
  try{await assert.rejects(isolateCodex({cwd:workspace,projectRoot:root,codexHome:join(process.env.HOME,".codex"),copyCredentials:true,runtimeExecutable:main}));await assert.rejects(readFile(join(workspace,".continuum/codex-host/auth.json")),{code:"ENOENT"});}
  finally{await rm(path,{recursive:true,force:true});}
}
test("missing helper rejects preflight before credentials or inference",async()=>{await badPackage("missing");});
test("non-executable helper rejects preflight before credentials or inference",async()=>{await badPackage("permissions");});
test("an executable with a missing interpreter fails the real operation preflight",async()=>{await badPackage("loader");});
