import {StdioCodexAppServerClient} from '../../packages/codex-app-server/dist/index.js';
import {assertEffective} from '../recovery-safety.mjs';
/** Pure Codex control: no Continuum tools or input, using the existing client. */
export async function runNativeTurn({processOptions,cwd,configuration,threadId,task,timeoutMs}) {
 const client=new StdioCodexAppServerClient();let resolveCompletion,rejectCompletion,turnId,timer,resolvedThread;
 const completion=new Promise((resolve,reject)=>{resolveCompletion=resolve;rejectCompletion=reject;});void completion.catch(()=>{});
 try {
  await client.start({...processOptions,cwd,onFatalError:rejectCompletion,onServerRequest:()=>({decision:'decline'}),onNotification:async(method,params)=>{if(method==='turn/completed')resolveCompletion(params.turn);if(method==='process/exited'&&!params.expected)rejectCompletion(new Error('Native process exited'));}});
  await client.initialize({experimentalApi:true});const account=await client.readAccount();if(!account.authenticated&&account.requiresOpenaiAuth)throw new Error('Authentication required');
  const options={cwd,model:configuration.model,reasoningEffort:'low',approvalPolicy:'never',sandbox:'workspace-write',configOverrides:configuration.configOverrides};
  const thread=threadId?await client.resumeThread(threadId,options):await client.startThread(options);assertEffective(thread,threadId);resolvedThread=thread.id;
  const started=Date.now();const turn=await client.startTurn({threadId:thread.id,task,model:configuration.model,reasoningEffort:'low'});turnId=turn.id;
  const result=await Promise.race([completion,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Turn timeout')),Math.max(1,timeoutMs-(Date.now()-started)));})]);
  if(result.status!=='completed')throw new Error('Native turn '+result.status);
  return {status:result.status,threadId:thread.id,turnId};
 }catch(error){if(turnId)await client.interruptTurn(resolvedThread,turnId).catch(()=>{});throw error;}
 finally{clearTimeout(timer);await client.close();}
}
