import {afterEach,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/db/store.js';
import {openDatabase} from '../server/db/database.js';
import {Engine} from '../server/orchestration/engine.js';
import {LocalLease} from '../server/orchestration/lease.js';
import {chatPermissions} from '../server/auth/policy.js';
import type {ModelChunk,ModelProfile,ModelRequest,TaskOptions,TaskRecord,ToolContext} from '../shared/types.js';

const cloud:ModelProfile={id:'openai:fixture',name:'Fixture',provider:'openai',runtime:'fixture',local:false,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32000,quantization:null,sizeBytes:null,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:0,outputPricePerMillion:0};
const options:TaskOptions={depth:'fast',modelId:cloud.id,modelSelection:'required',access:'read_only',workspaceId:null,cloudPolicy:'allow',contextTokens:8192,budget:{maxCalls:8,maxSeconds:30,maxIterations:3,maxCostUsd:1,localOnly:false}};
const allowed={allowed:true,decision:'run' as const,reasons:['Fixture'],estimatedRamBytes:100,estimatedVramBytes:100,contextTokens:8192,confidence:'estimated' as const};
let store:Store,engine:Engine;
afterEach(async()=>{await engine?.shutdown();await store?.close();});
async function until(check:()=>Promise<boolean>){const end=Date.now()+6000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Scheduler condition not reached: '+JSON.stringify(await store.db.query('SELECT objective,status,error FROM tasks')));}
function gate(signal:AbortSignal){return new Promise<void>(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',()=>resolve(),{once:true});});}
async function setup(stream:(request:ModelRequest)=>AsyncIterable<ModelChunk>,model=cloud,lease?:LocalLease){
  store=new Store(await openDatabase());await store.init();
  engine=new Engine(store,{listModels:async()=>[model],statuses:async()=>[],stream},{definitions:()=>[],decide:()=>({decision:'deny',reason:'Unavailable',risk:'read'}),execute:async()=>{throw new Error('No tools');},stopAll:async()=>{},changes:async()=>[]},{admit:async()=>allowed,lease});
}
async function user(id:string,limit:number){await store.db.query('INSERT INTO users(id,name,role,permissions) VALUES ($1,$1,$2,$3)',[id,'trusted',JSON.stringify({...chatPermissions,providers:['openai','ollama'],maxConcurrentTasks:limit,dailyCloudBudgetUsd:10})]);}
async function task(objective:string,userId='owner',overrides:Partial<TaskOptions>={}){const conversation=await store.createConversation(objective,userId);const record=(await store.createTask(conversation.id,objective,{...options,...overrides},userId)).task;engine.enqueue(record.id);return record;}
async function approve(id:string){const approval=(await store.approvals(id))[0];await store.decideApproval(approval.id,'allow_once');engine.approvalChanged(approval.id);}

describe('integrated task admission and suspended approvals',()=>{
  it('honors a remote account grant of two while preserving its in-flight quota',async()=>{
    let active=0;
    await setup(async function*(request){active++;try{await gate(request.signal);yield {type:'done',finishReason:'stop'};}finally{active--;}});
    await user('remote',2);const first=await task('First','remote'),second=await task('Second','remote');
    await until(async()=>active===2);
    await expect(task('Over quota','remote')).rejects.toThrow(/limit/i);
    await engine.cancel(first.id);await engine.cancel(second.id);expect(active).toBe(0);
  });
  it('reuses approval slots and reacquires capacity before sending approved cloud context',async()=>{
    let active=0,peak=0;const dispatched:string[]=[];
    await setup(async function*(request){
      const objective=request.messages.find(message=>message.role==='user')!.content.replace(/^Current objective:\n/,'');dispatched.push(objective);active++;peak=Math.max(peak,active);
      try{if(objective.startsWith('Hold'))await gate(request.signal);yield {type:'text',text:'Verified fixture response'};yield {type:'done',finishReason:'stop'};}finally{active--;}
    });
    const waiting:TaskRecord[]=[];for(let i=0;i<3;i++)waiting.push(await task(`Approval ${i}`,'owner',{cloudPolicy:'ask'}));
    await until(async()=>(await Promise.all(waiting.map(item=>store.task(item.id)))).every(item=>item.status==='waiting_for_approval'));
    const unrelated=await task('Unrelated');await until(async()=>(await store.task(unrelated.id)).status==='completed');
    expect(dispatched).toEqual(['Unrelated']);
    await user('remote',3);const holders=[];for(let i=0;i<3;i++)holders.push(await task(`Hold ${i}`,'remote'));
    await until(async()=>active===3);
    for(const item of waiting)await approve(item.id);
    await until(async()=>(await store.db.query("SELECT id FROM tasks WHERE execution_wait_kind='resource'")).length===3);
    expect(dispatched.filter(item=>item.startsWith('Approval'))).toEqual([]);
    await engine.cancel(holders[0].id);
    await until(async()=>(await Promise.all(waiting.map(item=>store.task(item.id)))).every(item=>item.status==='completed'));
    expect(peak).toBe(3);expect(dispatched.filter(item=>item.startsWith('Approval'))).toHaveLength(3);
  });
  it('detects durable revocation during a parked approval without dispatching',async()=>{
    let calls=0;await setup(async function*(){calls++;yield {type:'done',finishReason:'stop'};});
    await user('remote',1);const waiting=await task('Private context','remote',{cloudPolicy:'ask'});
    await until(async()=>(await store.task(waiting.id)).status==='waiting_for_approval');
    await store.db.query("UPDATE users SET session_version=session_version+1 WHERE id='remote'");
    await until(async()=>(await store.task(waiting.id)).status==='paused');
    expect(calls).toBe(0);await expect(approve(waiting.id)).rejects.toThrow();
  });
  it('fails revoked parked work promptly even when every execution slot is busy',async()=>{
    let active=0;await setup(async function*(request){active++;try{await gate(request.signal);yield {type:'done',finishReason:'stop'};}finally{active--;}});
    await user('remote',1);const waiting=await task('Private context','remote',{cloudPolicy:'ask'});
    await until(async()=>(await store.task(waiting.id)).status==='waiting_for_approval');
    for(let i=0;i<3;i++)await task(`Busy ${i}`);
    await until(async()=>active===3);
    await store.db.query("UPDATE users SET session_version=session_version+1 WHERE id='remote'");
    await until(async()=>(await store.task(waiting.id)).status==='paused');
    expect(active).toBe(3);
  });
  it.each(['shutdown','stop','cancel'] as const)('does not dispatch after %s during a scheduler authorization read',async action=>{
    let calls=0;await setup(async function*(){calls++;yield {type:'text',text:'Must not dispatch'};yield {type:'done',finishReason:'stop'};});
    let entered!:()=>void,release!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;}),blocked=new Promise<void>(resolve=>{release=resolve;});
    const original=store.db.query.bind(store.db);
    store.db.query=async<T extends Record<string,unknown>>(sql:string,parameters?:unknown[])=>{
      const result=await original<T>(sql,parameters);
      if(sql==='SELECT permissions FROM users WHERE id=$1'){entered();await blocked;}
      return result;
    };
    const record=await task('Queued task');await started;
    if(action==='shutdown')await engine.shutdown();else if(action==='stop')await engine.stopAll();else await engine.cancel(record.id);
    release();await new Promise(resolve=>setTimeout(resolve,100));
    expect(calls).toBe(0);expect((await store.task(record.id)).status).toBe(action==='shutdown'?'paused':'cancelled');
  });
  it('suspends active time for a shared local lease and releases it on cancellation',async()=>{
    const lease=new LocalLease(),release=await lease.acquire(new AbortController().signal);let calls=0;
    const local={...cloud,id:'ollama:fixture',provider:'ollama' as const,local:true,sizeBytes:100,quantization:'Q4'};
    await setup(async function*(){calls++;yield {type:'text',text:'Local fixture response'};yield {type:'done',finishReason:'stop'};},local,lease);
    try{
      const waiting=await task('Wait locally','owner',{modelId:local.id,cloudPolicy:'local_only',budget:{...options.budget,localOnly:true}});
      await until(async()=>(await store.db.query('SELECT execution_wait_kind FROM tasks WHERE id=$1',[waiting.id]))[0].execution_wait_kind==='resource');
      expect(calls).toBe(0);await engine.cancel(waiting.id);release();
      const next=await task('Next local task','owner',{modelId:local.id,cloudPolicy:'local_only',budget:{...options.budget,localOnly:true}});
      await until(async()=>(await store.task(next.id)).status==='completed');expect(calls).toBe(1);
    }finally{release();}
  });
  it('keeps a parallel sibling authorized and charges time until all branches wait',async()=>{
    let releaseSibling!:()=>void,executed=0;const sibling=new Promise<void>(resolve=>{releaseSibling=resolve;});
    await setup(async function*(){yield {type:'done',finishReason:'stop'};});await engine.shutdown();
    // Cloud fixture permits genuine branch overlap; no real provider is used.
    engine=new Engine(store,{listModels:async()=>[cloud],statuses:async()=>[],stream:async function*(request){
      if(request.messages[0].content.includes("Relay's architect")){await Promise.race([sibling,gate(request.signal)]);yield {type:'text',text:'Architecture finding'};}
      else if(request.messages.some(message=>message.role==='tool'))yield {type:'text',text:'Finished'};
      else yield {type:'tool_call',call:{id:'write',name:'file_write',arguments:{path:'a.txt',content:'a',expectedHash:null}}};
      yield {type:'done',finishReason:'stop'};
    }},{definitions:()=>[{name:'file_write',description:'Write',parameters:{type:'object'}}],decide:(context:ToolContext)=>({decision:context.approved?'allow':'approval',risk:'write',reason:'Confirm write'}),execute:async context=>{expect((await store.task(context.taskId)).status).toBe('executing');executed++;return {content:'Written',evidence:[{kind:'file_hash',summary:'Fixture read-back verified',passed:true}]};},stopAll:async()=>{},changes:async()=>[]},{admit:async()=>allowed});
    const conversation=await store.createConversation();const record=(await store.createTask(conversation.id,'Parallel review',{...options,workspaceId:randomUUID(),access:'supervised'})).task;
    await store.saveGraph(['worker','architect'].map(role=>({id:randomUUID(),taskId:record.id,role:role as 'worker'|'architect',title:role,dependencies:[],status:'pending',modelId:null,output:null})));
    await store.transition(record.id,'analyzing');await store.transition(record.id,'planning');await store.transition(record.id,'executing');engine.enqueue(record.id);
    await until(async()=>(await store.approvals(record.id)).length===1);
    expect((await store.task(record.id)).status).toBe('executing');
    expect((await store.db.query('SELECT execution_wait_kind FROM tasks WHERE id=$1',[record.id]))[0].execution_wait_kind).toBeNull();
    releaseSibling();await until(async()=>(await store.task(record.id)).status==='waiting_for_approval');
    await approve(record.id);await until(async()=>(await store.task(record.id)).status==='completed');expect(executed).toBe(1);
  });
});
