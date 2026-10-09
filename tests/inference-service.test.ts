import { afterEach, beforeEach, expect, it } from 'vitest';
import { openDatabase } from '../server/db/database';
import { Store } from '../server/db/store';
import { chatPermissions } from '../server/auth/policy';
import { InferenceService } from '../server/inference/service';
import { LocalLease } from '../server/orchestration/lease';
import { parseInferenceRequest } from '../server/inference/protocols';
import type { ModelProfile, ProviderGateway } from '../shared/types';
import {AppError} from '../server/core/errors';

let store:Store;let service:InferenceService;let stopped=false;let calls=0;
const model:ModelProfile={id:'ollama/test',provider:'ollama',name:'Test',runtime:'ollama',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32768,quantization:null,sizeBytes:100,tokensPerSecond:null,state:'ready',details:{},inputPricePerMillion:null,outputPricePerMillion:null};
const gateway:ProviderGateway={listModels:async()=>[model,{...model,id:'openai/private',provider:'openai',local:false}],statuses:async()=>[],async *stream(){calls++;yield {type:'text',text:'private-response'};yield {type:'usage',inputTokens:12,outputTokens:3};yield {type:'done',finishReason:'stop'};}};
beforeEach(async()=>{store=new Store(await openDatabase());await store.init();stopped=false;calls=0;await store.db.query('INSERT INTO users(id,name,role,permissions) VALUES ($1,$1,$2,$3)',['alice','chat',JSON.stringify({...chatPermissions,externalModelAccess:true})]);await store.db.query('INSERT INTO users(id,name,role,permissions) VALUES ($1,$1,$2,$3)',['bob','chat',JSON.stringify(chatPermissions)]);service=new InferenceService(store,gateway,new LocalLease(),()=>stopped,async()=>({allowed:true,decision:'run',reasons:[],estimatedRamBytes:1,estimatedVramBytes:1,contextTokens:2048,confidence:'measured'}));});
afterEach(async()=>{service.stopAll();await store.close();});
const request=()=>parseInferenceRequest('chat-completions',{model:model.id,messages:[{role:'user',content:'private-prompt'}],max_tokens:256});
async function identity(){const issued=await service.tokens.issue('alice',{label:'Laptop',expiresInDays:7},0);return {issued,identity:await service.tokens.authenticate(issued.token)};}
it('cancels external local generation under live pressure and releases its shared lease',async()=>{
  const lease=new LocalLease();let monitorStopped=false;
  service=new InferenceService(store,{...gateway,async *stream(input){calls++;yield {type:'text',text:'partial'};await new Promise<void>((_,reject)=>{input.signal.addEventListener('abort',()=>reject(input.signal.reason),{once:true});});}},lease,()=>false,async()=>({allowed:true,decision:'run',reasons:[],estimatedRamBytes:1,estimatedVramBytes:1,contextTokens:2048,confidence:'estimated'}),parent=>{
    const controller=new AbortController();let error:AppError|undefined;const timer=setTimeout(()=>{error=new AppError('RESOURCE_PRESSURE','Live RAM pressure');controller.abort(error);},10);
    return {signal:AbortSignal.any([parent,controller.signal]),error:()=>error,stop:()=>{clearTimeout(timer);monitorStopped=true;}};
  });
  const {identity:who}=await identity();
  await expect((async()=>{for await(const _chunk of service.stream(who,request(),new AbortController().signal)){/* consume */}})()).rejects.toMatchObject({code:'RESOURCE_PRESSURE'});
  await service.shutdown();expect(calls).toBe(1);expect(monitorStopped).toBe(true);
  const release=await lease.acquire(AbortSignal.timeout(1000));release();
  expect((await store.db.query('SELECT status FROM inference_requests'))[0].status).toBe('failed');expect(await store.db.query('SELECT id FROM conversations')).toEqual([]);
});
it('requires an owner grant, hashes tokens, hides other users tokens and revokes access',async()=>{
  await expect(service.tokens.issue('bob',{label:'Denied',expiresInDays:7},0)).rejects.toMatchObject({code:'INFERENCE_DENIED'});
  const {issued,identity:who}=await identity();expect(JSON.stringify(await store.db.query('SELECT * FROM inference_tokens'))).not.toContain(issued.token);
  expect(await service.tokens.list('bob')).toEqual([]);expect((await service.models(who)).map(m=>m.id)).toEqual(['ollama/test']);
  await service.tokens.revoke('bob',issued.id);expect(await service.tokens.live(who)).toBe(true);
  await service.tokens.revoke('alice',issued.id);expect(await service.tokens.live(who)).toBe(false);
});
it('persists only usage metadata without any conversation or tool execution',async()=>{
  const {identity:who}=await identity();const chunks=[];for await(const chunk of service.stream(who,request(),new AbortController().signal))chunks.push(chunk);
  expect(calls).toBe(1);expect(chunks[0]).toMatchObject({text:'private-response'});
  const records=await store.db.query('SELECT * FROM inference_requests');expect(records[0]).toMatchObject({status:'completed',input_tokens:12,output_tokens:3});
  for(const table of ['inference_requests','audit_events','messages','conversations','tasks','tool_calls']){const rows=await store.db.query(`SELECT * FROM ${table}`);expect(JSON.stringify(rows)).not.toMatch(/private-prompt|private-response/);if(['messages','conversations','tasks','tool_calls'].includes(table))expect(rows).toEqual([]);}
});
it('rejects cloud selection, emergency stop, expired grants and oversized context before inference',async()=>{
  const {identity:who}=await identity();const collect=async(r=request())=>{for await(const _chunk of service.stream(who,r,new AbortController().signal)){/* drain */}};
  await expect(collect({...request(),modelId:'openai/private'})).rejects.toMatchObject({code:'MODEL_NOT_FOUND'});
  await expect(collect({...request(),messages:[{role:'user',content:'x'.repeat(33000)}]})).rejects.toMatchObject({code:'CONTEXT_LIMIT'});
  stopped=true;await expect(collect()).rejects.toMatchObject({code:'STOPPED'});stopped=false;
  await store.db.query("UPDATE users SET session_version=session_version+1 WHERE id='alice'");await expect(collect()).rejects.toMatchObject({code:'INFERENCE_DENIED'});expect(calls).toBe(0);
});
it('rechecks authorization after waiting for the shared host lease',async()=>{
  const lease=new LocalLease(),release=await lease.acquire(new AbortController().signal);service=new InferenceService(store,gateway,lease,()=>stopped);
  const {identity:who,issued}=await identity();const result=(async()=>{for await(const _chunk of service.stream(who,request(),new AbortController().signal)){/* drain */}})();
  await new Promise(resolve=>setTimeout(resolve,60));await service.tokens.revoke('alice',issued.id);release();await expect(result).rejects.toThrow();expect(calls).toBe(0);
});
