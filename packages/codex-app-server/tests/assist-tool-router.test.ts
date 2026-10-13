import {describe,it,expect} from 'vitest';
import {AssistToolRouter} from '../src/assist-tool-router.js';
describe('retrieval argument compatibility after real pilot C',()=>{
 it('delivers canonical and observed single-wrapper queries exactly once',async()=>{
  const calls:string[]=[];const router=new AssistToolRouter(async query=>{calls.push(query);return 'evidence';});
  for(const args of [{query:' src/service.ts '},{args:{query:' src/service.ts '}}])expect(await router.handleRequest({id:1,method:'item/tool/call',params:{tool:'continuum_request_context',arguments:args}})).toEqual({success:true,contentItems:[{type:'inputText',text:'evidence'}]});
  expect(calls).toEqual(['src/service.ts','src/service.ts']);
 });
 it('rejects missing, invalid, deep or conflicting shapes without retrieval or throwing',async()=>{
  let calls=0;const router=new AssistToolRouter(async()=>{calls++;return 'evidence';});
  for(const args of [null,[],{}, {query:1},{query:{}},{query:''},{args:{args:{query:'x'}}},{query:'x',args:{query:'y'}},{query:false,args:{query:'x'}}])expect((await router.handleRequest({id:1,method:'item/tool/call',params:{tool:'continuum_request_context',arguments:args}}))?.success).toBe(false);
  expect(calls).toBe(0);
 });
 it('does not handle unrelated tools and preserves actual retrieval failure',async()=>{
  const router=new AssistToolRouter(async()=>{throw new Error('source unavailable');});
  expect(await router.handleRequest({id:1,method:'other',params:{}})).toBeNull();
  expect(await router.handleRequest({id:1,method:'item/tool/call',params:{tool:'other'}})).toBeNull();
  expect(await router.handleRequest({id:1,method:'item/tool/call',params:{tool:'continuum_request_context',arguments:{query:'x'}}})).toEqual({success:false,contentItems:[{type:'inputText',text:'Error: source unavailable'}]});
 });
});
