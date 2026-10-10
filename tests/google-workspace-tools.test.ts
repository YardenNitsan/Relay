import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db/database.js';
import {Store} from '../server/db/store.js';
import {ToolBroker} from '../server/tools/index.js';
import {GoogleWorkspace} from '../server/integrations/google-workspace.js';
import {Engine} from '../server/orchestration/engine.js';
import type {ModelProfile,ModelRequest} from '../shared/types.js';
import {assertWorkspaceConversation,assertWorkspaceOptions} from '../server/integrations/workspace-policy.js';
import type {TaskOptions,ToolContext,ToolRequest} from '../shared/types.js';

let store:Store,broker:ToolBroker,root:string,google:GoogleWorkspace;
let engine:Engine|undefined;
let requests:string[],respond:(url:string)=>Promise<Response>;
const options:TaskOptions={depth:'fast',modelId:null,workspaceId:null,access:'read_only',contextTokens:4096,cloudPolicy:'local_only',googleWorkspace:{mail:true,calendar:true},budget:{localOnly:true,maxCalls:4,maxSeconds:60,maxIterations:3,maxCostUsd:0}};
const request:ToolRequest={id:'mail-call',name:'gmail_read',arguments:{id:'mail1'}};
beforeEach(async()=>{
 store=new Store(await openDatabase());await store.init();root=await mkdtemp(join(tmpdir(),'relay-workspace-tools-'));requests=[];
 const revision=randomUUID(),epoch=randomUUID(),key=`user.${createHash('sha256').update('owner').digest('hex')}`;
 await store.db.query('INSERT INTO settings(key,value) VALUES ($1,$2),($3,$4)',['google-workspace',JSON.stringify({revision,clientId:'222.apps.googleusercontent.com',separateProjectAccepted:true}),`google-workspace.${key}`,JSON.stringify({connected:true,revision,epoch,sessionVersion:0})]);
 const secrets=new Map([[`app.${revision}`,'app-secret'],[`${key}.${epoch}`,JSON.stringify({refreshToken:'private-refresh',subject:'subject'})]]);
 respond=async url=>url.endsWith('/token')?Response.json({access_token:'private-token',token_type:'Bearer',expires_in:3600}):Response.json({id:'mail1',payload:{mimeType:'text/plain',body:{data:Buffer.from('Private mail fixture').toString('base64url')}}});
 google=new GoogleWorkspace(store,{allowedOrigins:async()=>[],vault:{get:async key=>secrets.get(key)??null,set:async(key,value)=>{secrets.set(key,value);},remove:async key=>{secrets.delete(key);}},fetch:async url=>{requests.push(String(url));return respond(String(url));}});
 broker=new ToolBroker(root,()=>false,undefined,store,google);
});
afterEach(async()=>{await engine?.shutdown();engine=undefined;vi.restoreAllMocks();await store.close();await rm(root,{recursive:true,force:true});});
const model:ModelProfile={id:'ollama:fixture',name:'fixture',provider:'ollama',runtime:'fixture',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32000,quantization:null,sizeBytes:1,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
const admission={allowed:true,decision:'run' as const,reasons:['fixture'],estimatedRamBytes:1,estimatedVramBytes:1,contextTokens:4096,confidence:'estimated' as const};
async function settled(id:string){const until=Date.now()+5000;while(Date.now()<until){const task=await store.task(id);if(['completed','paused','failed','cancelled','waiting_for_user'].includes(task.status))return task;await new Promise(r=>setTimeout(r,10));}throw new Error('Engine did not settle');}
async function scope(input:TaskOptions=options){const conversation=await store.createConversation();const {task}=await store.createTask(conversation.id,'Read my mail',input);await store.db.query("UPDATE tasks SET status='executing' WHERE id=$1",[task.id]);const context:ToolContext={taskId:task.id,userId:'owner',sessionVersion:0,agentId:'worker',workspaceId:null,access:'read_only',googleWorkspace:input.googleWorkspace,allowedTools:['gmail_read','gmail_search','calendar_events','calendar_freebusy'],signal:new AbortController().signal,approved:false};return {context,task};}
describe('explicit account-private Workspace agent reads',()=>{
 it('returns a genuine bounded read receipt without a browser session or token disclosure',async()=>{const {context}=await scope();const result=await broker.execute(context,request);expect(result.content).toContain('Private mail fixture');expect(result.content).not.toMatch(/private-token|private-refresh/);expect(result.evidence[0]).toMatchObject({passed:true,kind:'google_workspace_read'});});
 it('rejects absent task opt-in and widened request identities without fetching',async()=>{const {context}=await scope({...options,googleWorkspace:undefined});await expect(broker.execute({...context,googleWorkspace:options.googleWorkspace},request)).rejects.toThrow();await expect(broker.execute({...context,userId:'another'},request)).rejects.toThrow();expect(requests).toEqual([]);});
 it('keeps mail and calendar capabilities independent and rejects sends',async()=>{const {context}=await scope({...options,googleWorkspace:{mail:false,calendar:true}});await expect(broker.execute(context,request)).rejects.toThrow();await expect(broker.execute(context,{...request,name:'gmail_send'})).rejects.toThrow();expect(requests).toEqual([]);});
 it('refuses disconnected consent before token refresh',async()=>{const {context}=await scope();await store.db.query("UPDATE settings SET value=jsonb_set(value,'{connected}','false') WHERE key LIKE 'google-workspace.user.%'");await expect(broker.execute(context,request)).rejects.toThrow(/connect/i);expect(requests).toEqual([]);});
 it('rechecks queued tool use and discards in-flight results after account revocation',async()=>{const {context}=await scope();let release!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>{entered=r;}),waiting=new Promise<void>(r=>{release=r;});const original=respond;respond=async url=>{if(!url.endsWith('/token')){entered();await waiting;}return original(url);};const first=broker.execute(context,request);const firstDenied=expect(first).rejects.toThrow();await started;const second=broker.execute(context,request);const secondDenied=expect(second).rejects.toThrow();await store.db.query("UPDATE users SET session_version=1 WHERE id='owner'");release();await firstDenied;await secondDenied;expect(requests.filter(url=>url.includes('/messages/'))).toHaveLength(1);});
 it('rejects unsafe egress options and cannot clear a conversation restriction in descendants',async()=>{expect(()=>assertWorkspaceOptions({...options,cloudPolicy:'allow',budget:{...options.budget,localOnly:false}})).toThrow(/local/i);expect(()=>assertWorkspaceOptions({...options,network:{mode:'allow',allowedOrigins:['https://example.com']}})).toThrow();const {task}=await scope();await store.db.query("UPDATE tasks SET status='completed' WHERE id=$1",[task.id]);await expect(assertWorkspaceConversation(store.db,task.conversationId,{...options,googleWorkspace:undefined,cloudPolicy:'allow',budget:{...options.budget,localOnly:false}})).rejects.toThrow(/local/i);await expect(assertWorkspaceConversation(store.db,task.conversationId,{...options,googleWorkspace:undefined})).resolves.toBeUndefined();});
 it('rejects cloud descendants atomically at admission and after soft deletion',async()=>{const {task}=await scope();await store.db.query("UPDATE tasks SET status='completed' WHERE id=$1",[task.id]);await expect(store.createTask(task.conversationId,'Cloud follow-up',{...options,googleWorkspace:undefined,cloudPolicy:'allow',budget:{...options.budget,localOnly:false}})).rejects.toMatchObject({code:'WORKSPACE_LOCAL_ONLY'});await store.deleteConversation(task.conversationId,'owner');await expect(assertWorkspaceConversation(store.db,task.conversationId,{...options,cloudPolicy:'ask'})).rejects.toMatchObject({code:'WORKSPACE_LOCAL_ONLY'});});
 it('runs the real broker through Engine with opted-in Email tools and preserves a private read receipt',async()=>{
  const seen:ModelRequest[]=[];engine=new Engine(store,{listModels:async()=>[model],statuses:async()=>[],stream:async function*(input){seen.push(input);if(input.messages.some(m=>m.role==='tool')){yield {type:'text',text:'The explicitly requested mail was read.'};yield {type:'done',finishReason:'stop'};}else {expect(input.tools?.map(t=>t.name)).toEqual(['gmail_search','gmail_read']);yield {type:'tool_call',call:request};yield {type:'done',finishReason:'tool_calls'};}}},broker,{admit:async()=>admission});
  const conversation=await store.createConversation();const {task}=await store.createTask(conversation.id,'Read my selected message',{...options,contextTokens:8192,assistantId:'email'});engine.enqueue(task.id);expect((await settled(task.id)).status,JSON.stringify(await store.taskEvents(task.id))).toBe('completed');expect(seen).toHaveLength(2);expect(seen[1].messages.some(m=>m.role==='tool'&&m.content.includes('Private mail fixture'))).toBe(true);expect((await store.db.query('SELECT name,status FROM tool_calls WHERE task_id=$1',[task.id]))[0]).toMatchObject({name:'gmail_read',status:'completed'});
 });
 it('rechecks durable history at the actual cloud dispatch even when privacy changes after initial selection',async()=>{
  const conversation=await store.createConversation(),plain={...options,googleWorkspace:undefined};const old=(await store.createTask(conversation.id,'Old history',plain)).task;await store.db.query("UPDATE tasks SET status='completed' WHERE id=$1",[old.id]);let calls=0;
  const cloud={...model,id:'openai:gpt-4.1-mini',name:'gpt-4.1-mini',provider:'openai' as const,local:false,inputPricePerMillion:0.4,outputPricePerMillion:1.6};
  engine=new Engine(store,{statuses:async()=>[],listModels:async()=>{await store.db.query("UPDATE tasks SET options=jsonb_set(options,'{googleWorkspace}',$2) WHERE id=$1",[old.id,JSON.stringify({mail:true,calendar:false})]);return [cloud];},stream:async function*(){calls++;yield {type:'text',text:'must not dispatch'};yield {type:'done',finishReason:'stop'};}},broker,{admit:async()=>admission});
  const {task}=await store.createTask(conversation.id,'Cloud request',{...plain,cloudPolicy:'allow',budget:{...plain.budget,localOnly:false,maxCostUsd:1}});engine.enqueue(task.id);const result=await settled(task.id);expect(result.status).toBe('paused');expect(calls).toBe(0);expect((await store.taskEvents(task.id)).some(event=>JSON.stringify(event.data).includes('cannot be sent to a cloud model')),JSON.stringify(await store.taskEvents(task.id))).toBe(true);
 });
 it.each(['approval','saved-context'] as const)('blocks newly private conversation history after %s awaits',async boundary=>{
  const conversation=await store.createConversation(),plain={...options,googleWorkspace:undefined};const old=(await store.createTask(conversation.id,'Earlier history',plain)).task;await store.db.query("UPDATE tasks SET status='completed' WHERE id=$1",[old.id]);let calls=0;
  const taint=()=>store.db.query("UPDATE tasks SET options=jsonb_set(options,'{googleWorkspace}',$2) WHERE id=$1",[old.id,JSON.stringify({mail:true,calendar:false})]);
  const cloud={...model,id:'openai:gpt-4.1-mini',name:'gpt-4.1-mini',provider:'openai' as const,local:false,inputPricePerMillion:0.4,outputPricePerMillion:1.6};
  engine=new Engine(store,{statuses:async()=>[],listModels:async()=>[cloud],stream:async function*(){calls++;yield {type:'text',text:'must not dispatch'};yield {type:'done',finishReason:'stop'};}},broker,{admit:async()=>admission});
  const {task}=await store.createTask(conversation.id,'Cloud request',{...plain,cloudPolicy:boundary==='approval'?'ask':'allow',budget:{...plain.budget,localOnly:false,maxCostUsd:1}});
  if(boundary==='saved-context'){const save=store.saveContext.bind(store);vi.spyOn(store,'saveContext').mockImplementation(async(...args)=>{await save(...args);if((await store.task(task.id)).callsUsed>0)await taint();});}
  engine.enqueue(task.id);
  if(boundary==='approval'){const until=Date.now()+5000;while(!(await store.approvals(task.id)).length&&Date.now()<until)await new Promise(r=>setTimeout(r,10));const approval=(await store.approvals(task.id))[0];expect(approval).toBeDefined();await taint();await store.decideApproval(approval.id,'allow_once');engine.approvalChanged(approval.id);}
  expect((await settled(task.id)).status).toBe('paused');expect(calls).toBe(0);
 });
});
