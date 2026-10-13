import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,rm,readFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
import {RepositoryContextSessionService} from '../packages/context-engine/dist/index.js';
import {CodexAssistExecutionService,contextDeliveryStrategy,minimalContextManifest} from '../packages/codex-app-server/dist/index.js';
import {openDatabase} from '../packages/database/dist/index.js';
const cli=join(process.cwd(),'apps/cli/dist/main.js'),fake=join(process.cwd(),'packages/codex-app-server/tests/fixtures/fake-app-server.mjs');let root;
before(async()=>{root=await mkdtemp(join(tmpdir(),'continuum-strategies-'));});after(async()=>{await rm(root,{recursive:true,force:true});});
for(const strategy of ['initial_packet','minimal_manifest','on_demand'])test(strategy+' preserves evidence, allows retrieval and injects recovery into same thread across fresh service instances',async()=>{
 const cwd=join(root,strategy);await cp('packages/context-engine/benchmarks/v1/repositories/small-ts',cwd,{recursive:true});
 execFileSync('git',['init'],{cwd,stdio:'ignore'});for(const args of [['config','user.name','Test'],['config','user.email','test@example.test'],['add','.'],['commit','-m','baseline']])execFileSync('git',args,{cwd,stdio:'ignore'});
 for(const args of [['init','--non-interactive'],['index']])execFileSync(process.execPath,[cli,...args],{cwd,stdio:'pipe',timeout:30000});
 const task='Never accept literal expired tokens; preserve refresh signatures.';const receipts=[];const options={cwd,task,model:'gpt-5.6-luna',reasoningEffort:'low',durableMemory:true,contextStrategy:strategy,timeoutMs:5000,onContextDelivery:r=>receipts.push(r),process:{executable:process.execPath,executableArgs:[fake],env:{...process.env,FAKE_CODEX_THREAD_ID:'strategy-'+strategy}}};
 const first=await new CodexAssistExecutionService().runAssist(options);
 if(process.env.CONTINUUM_STRATEGY_EVIDENCE_DIR)await writeFile(join(process.env.CONTINUUM_STRATEGY_EVIDENCE_DIR,strategy+"-receipts.json"),JSON.stringify({mode:"offline fake protocol; no inference",receipts},null,2));
 assert.equal(receipts[1].status,'acknowledged');if(strategy==='on_demand')assert.equal(receipts[0].serializedBytes,0);else assert.ok(receipts[0].serializedBytes>0);
 if(strategy!=='initial_packet')assert.equal(receipts[0].sources.length,0);
 const service=await RepositoryContextSessionService.open(cwd);try{
 assert.equal(service.memory.state(first.sessionId).evidence.some(e=>e.text===task),true);
 const retrieval=await service.request(first.sessionId,{query:'AuthService'});assert.ok(retrieval.newItems.length+retrieval.activeReferences.length+retrieval.restoredItems.length>0);
 assert.equal((await service.memory.retrieve(first.sessionId,'not-present-unique')).found,false);
 const recovered=await service.memory.recover(first.sessionId);assert.ok(recovered.renderedContent.includes(task));assert.equal(recovered.incomplete,false);
 assert.throws(()=>minimalContextManifest(task,service.memory.state(first.sessionId),recovered.snapshot,1),/Incomplete/);
 }finally{service.close();}
 const second=await new CodexAssistExecutionService().runAssist({...options,task:'Continue now.',resumeSessionId:first.sessionId});assert.equal(first.sessionId,second.sessionId);
 const db=openDatabase(join(cwd,'.continuum/continuum.db'));try{const raw=db.prepare("SELECT raw_json FROM codex_raw_events WHERE execution_id=? AND method='turn/start'").get(second.executionId);assert.ok(raw.raw_json.includes(task));const initial=db.prepare("SELECT raw_json FROM codex_raw_events WHERE execution_id=? AND method='turn/start'").get(first.executionId);const data=JSON.parse(initial.raw_json);if(strategy==='on_demand')assert.equal(data.params.input.length,1);if(strategy==='minimal_manifest'){assert.ok(data.params.input[1].text.includes('MANIFEST'));assert.ok(!data.params.input[1].text.includes(task));}assert.equal(new Set(db.prepare('SELECT codex_thread_id FROM codex_executions').all().map(r=>r.codex_thread_id)).size,1);}finally{db.close();}
 });
test('configuration defaults remain baseline; invalid strategy fails',async()=>{const dir=join(root,'config');await cp(join(root,'on_demand'),dir,{recursive:true});assert.equal(contextDeliveryStrategy(dir),'initial_packet');const path=join(dir,'.continuum/config.json'),config=JSON.parse(await readFile(path,'utf8'));config.contextDelivery={strategy:'minimal_manifest'};await writeFile(path,JSON.stringify(config));assert.equal(contextDeliveryStrategy(dir),'minimal_manifest');assert.throws(()=>contextDeliveryStrategy(dir,'invalid'),/Invalid/);config.contextDelivery={strategy:'invalid'};await writeFile(path,JSON.stringify(config));assert.throws(()=>contextDeliveryStrategy(dir));});
test('complete controlled compaction replay has ordered recovery receipt and same-thread continuation',async()=>{
 const {SmokeSafety}=await import('./recovery-safety.mjs');const {StdioCodexAppServerClient}=await import('../packages/codex-app-server/dist/index.js');const cwd=join(root,'on_demand');
 const guard=new SmokeSafety(()=>{},{reportedTokens:85000});const task='Preserve original late constraint: reject expired credentials.';
 const raw=[];const observe=m=>{raw.push(m);guard.observeRaw(m,task);};
 const proc={executable:process.execPath,executableArgs:[fake],env:{...process.env,FAKE_CODEX_THREAD_ID:'replay-thread'}};
 const opts={cwd,task,contextStrategy:'on_demand',model:'gpt-5.6-luna',reasoningEffort:'low',durableMemory:true,persistentSession:true,timeoutMs:5000,process:{...proc,onRawMessage:observe}};
 const first=await new CodexAssistExecutionService().runAssist(opts);assert.equal(guard.turns,1);
 const client=new StdioCodexAppServerClient();try{await client.start({...proc,onRawMessage:observe,env:{...proc.env,FAKE_CODEX_SCENARIO:'modern-compaction',FAKE_CODEX_COMPACTION_USAGE_TOTAL:'200'}});await client.initialize();await client.resumeThread('replay-thread',{cwd,model:opts.model,reasoningEffort:'low'});await client.compactThread('replay-thread');}finally{await client.close();}
 assert.equal(guard.compactionComplete,true);
 const second=await new CodexAssistExecutionService().runAssist({...opts,task:'Implement now.',resumeSessionId:first.sessionId,process:{...proc,onRawMessage:observe,env:{...proc.env,FAKE_CODEX_USAGE_TOTAL:'250'}}});assert.equal(first.sessionId,second.sessionId);assert.equal(guard.turns,2);assert.equal(guard.compactions,1);
 const requests=raw.filter(m=>m.direction==='client_to_server'&&['turn/start','thread/compact/start'].includes(m.method));assert.deepEqual(requests.map(m=>m.method),['turn/start','thread/compact/start','turn/start']);assert.ok(requests[2].parsed.params.input.some(x=>x.text.includes(task)));assert.throws(()=>guard.begin('turn'),/Additional/);
 const fresh=JSON.parse(execFileSync(process.execPath,[cli,'session','memory',first.sessionId,'--recover'],{cwd,stdio:'pipe',timeout:20000}).toString());assert.ok(JSON.stringify(fresh).includes(task));
});
test('manifest preserves additional critical constraints, excludes superseded entries and marks stale evidence',()=>{
 const snap={snapshot_kind:'commit',base_commit_hash:'new',worktree_hash:null,dirty:false};const entries=[{id:'a',kind:'objective',text:'task',critical:true,supersededBy:null,evidenceId:'e1',authority:'user'},{id:'b',kind:'constraint',text:'Keep schema',critical:true,supersededBy:null,evidenceId:'e2',authority:'observed'},{id:'c',kind:'constraint',text:'OLD RULE',critical:true,supersededBy:'b',evidenceId:'e3',authority:'user'}];
 const text=minimalContextManifest('task',{sessionId:'s',version:3,entries,evidence:[{id:'e2',snapshot:{...snap,base_commit_hash:'old'}}]},snap);assert.ok(text.includes('Keep schema'));assert.ok(text.includes('historical'));assert.ok(!text.includes('OLD RULE'));assert.ok(!text.includes('OBJECTIVE [user] task'));
});
test('manifest never advertises an unavailable durable tool',()=>{const state={sessionId:'s',version:1,entries:[],evidence:[]};const snap={snapshot_kind:'commit',base_commit_hash:'x',worktree_hash:null,dirty:false};assert.ok(!minimalContextManifest('task',state,snap,500,false).includes('continuum_retrieve_task_evidence'));});
test('invalid shadow CLI strategy and disabled retrieval tools fail before inference',async()=>{assert.throws(()=>execFileSync(process.execPath,[cli,'codex','run','task','--mode','shadow','--context-strategy','on_demand'],{cwd:join(root,'on_demand'),stdio:'pipe',timeout:10000}),/Command failed/);await assert.rejects(new CodexAssistExecutionService().runAssist({cwd:join(root,'on_demand'),task:'task',contextStrategy:'on_demand',contextEnabled:false,process:{executable:process.execPath,executableArgs:[fake]}}),/require context tools/);});
