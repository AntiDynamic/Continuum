import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyBehavior} from './phase6-behavior.mjs';
import {prepareTaskBaseline} from './phase6-task-setup.mjs';
test('authentication validators reject baseline and counterfeit fixes but ignore unrelated cache failure',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'continuum-auth-scope-'));
 try{
 await cp('packages/context-engine/benchmarks/v1/repositories/small-ts',dir,{recursive:true});await prepareTaskBaseline(dir,'small-security-token');
 for(const hidden of [false,true])assert.equal((await verifyBehavior({repository:dir,taskId:'small-security-token',hidden})).status,'failed');
 const implementation='export interface TokenClaims { subject: string; expiresAt: number; } export class AuthService { validateToken(token: string): TokenClaims { if (!token || token === "expired") throw new Error("invalid"); return {subject:token,expiresAt:Date.now()+1000}; } refreshToken(token:string):string { return this.validateToken(token).subject+"-refreshed"; }}';
 await writeFile(join(dir,'src/auth-service.ts'),implementation);
 for(const hidden of [false,true])assert.equal((await verifyBehavior({repository:dir,taskId:'small-security-token',hidden})).status,'passed');
 await writeFile(join(dir,'src/auth-service.ts'),implementation.replace('subject:token','subject:"u1"'));
 assert.equal((await verifyBehavior({repository:dir,taskId:'small-security-token',hidden:true})).status,'failed');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('independent authentication validator rejects expired claims for valid input',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'continuum-auth-expiry-'));try{await cp('packages/context-engine/benchmarks/v1/repositories/small-ts',dir,{recursive:true});await writeFile(join(dir,'src/auth-service.ts'),'export class AuthService {validateToken(token:string) {if(!token||token==="expired")throw new Error("invalid");return {subject:token,expiresAt:1};}refreshToken(token:string){return this.validateToken(token).subject+"-refreshed";}}');assert.equal((await verifyBehavior({repository:dir,taskId:'small-security-token',hidden:true})).status,'failed');}finally{await rm(dir,{recursive:true,force:true});}
});
