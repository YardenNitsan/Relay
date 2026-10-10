import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Store} from '../server/db/store.js';
import {openDatabase} from '../server/db/database.js';
import {Engine,type ExecutionTools} from '../server/orchestration/engine.js';
import {buildGraph} from '../server/orchestration/lifecycle.js';
import {LocalLease} from '../server/orchestration/lease.js';
import type {ModelChunk,ModelProfile,ModelRequest,TaskOptions} from '../shared/types.js';

const options:TaskOptions={depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:8192,budget:{maxCalls:8,maxSeconds:30,maxIterations:3,maxCostUsd:0,localOnly:true,maxElapsedSeconds:30}};
const model:ModelProfile={id:'ollama/deadline-fixture',name:'Deadline fixture',provider:'ollama',runtime:'fixture',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32000,quantization:null,sizeBytes:100,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
let store:Store,engine:Engine|undefined;
beforeEach(async()=>{store=new Store(await openDatabase());await store.init();});
afterEach(async()=>{vi.restoreAllMocks();await engine?.shutdown();engine=undefined;await store.close();});
async function create(overrides:Partial<TaskOptions>={}){return (await store.createTask((await store.createConversation()).id,'Bound the whole objective',{...options,...overrides})).task;}
async function overdue(id:string){await store.db.query("UPDATE tasks SET created_at=now()-interval '31 seconds' WHERE id=$1",[id]);}
async function until(check:()=>Promise<boolean>){const end=Date.now()+6000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Deadline state was not reached');}
function gate(signal:AbortSignal){return new Promise<void>(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',()=>resolve(),{once:true});});}
function start(stream:(request:ModelRequest)=>AsyncIterable<ModelChunk>,tools?:Partial<ExecutionTools>,lease?:LocalLease){
  engine=new Engine(store,{listModels:async()=>[model],statuses:async()=>[],stream},{definitions:()=>[],decide:()=>({decision:'deny',reason:'Unavailable',risk:'read'}),execute:async()=>{throw new Error('No tools');},stopAll:async()=>{},changes:async()=>[],...tools},{lease,admit:async()=>({allowed:true,decision:'run',reasons:['Fixture'],estimatedRamBytes:100,estimatedVramBytes:100,contextTokens:8192,confidence:'estimated'})});
  return engine;
}

describe('durable overall task deadlines',()=>{
  it('joins an in-flight scheduler read before shutdown lets storage close',async()=>{
    const runner=start(async function*(){yield {type:'done',finishReason:'stop'};});
    const task=await create();let release!:()=>void,entered!:()=>void;
    const pending=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
    const original=store.control.bind(store);
    vi.spyOn(store,'control').mockImplementationOnce(async()=>{entered();await pending;return original();});
    runner.enqueue(task.id);await started;let closed=false;
    const shutdown=runner.shutdown().then(()=>{closed=true;});
    try{await new Promise(resolve=>setTimeout(resolve,20));expect(closed).toBe(false);}finally{release();await shutdown;}
  });
  it('uses the same host clock for discovery and enforcement when database time differs',async()=>{
    await create();
    // An independent PostgreSQL server can have a different clock. Shadow only
    // the SQL observation here; the Node clock and admission time stay real.
    await store.db.exec("CREATE SCHEMA deadline_clock; CREATE FUNCTION deadline_clock.clock_timestamp() RETURNS timestamptz LANGUAGE sql AS $$ SELECT now()+interval '1 hour' $$; SET search_path=deadline_clock,public,pg_catalog");
    expect(await store.overdueTasks()).toEqual([]);
  });
  it('keeps discovering deadlines while an earlier provider cancellation is still cleaning up',async()=>{
    let active=false,aborted=false,release!:()=>void;
    const cleanup=new Promise<void>(resolve=>{release=resolve;});
    const runner=start(async function*(request){active=true;await gate(request.signal);aborted=true;await cleanup;yield {type:'done',finishReason:'stop'};});
    const first=await create();runner.enqueue(first.id);await until(async()=>active);
    const second=await create();runner.enqueue(second.id);
    try{
      await overdue(first.id);await until(async()=>aborted);await overdue(second.id);
      await until(async()=>(await store.task(second.id)).status==='failed');
      expect((await store.task(first.id)).status).toBe('executing');
    }finally{release();}
  });
  it('assigns a bounded overall duration to new objectives and validates internal admission',async()=>{
    const {maxElapsedSeconds:_,...legacyBudget}=options.budget;
    expect((await create({budget:legacyBudget})).options.budget.maxElapsedSeconds).toBe(86400);
    for(const value of [0,-1,29,604801,Infinity,NaN])await expect(create({budget:{...options.budget,maxElapsedSeconds:value}})).rejects.toThrow(/deadline|elapsed/i);
  });
  it('does not renew elapsed time when resuming or approve an expired request',async()=>{
    const task=await create();await store.db.query("UPDATE tasks SET status='waiting_for_approval' WHERE id=$1",[task.id]);
    const approval=await store.createApproval(task.id,'deadline-call','file_write',{path:'result.txt'},'Exact write approval');
    await overdue(task.id);
    await expect(store.decideApproval(approval.id,'allow_once')).rejects.toThrow(/deadline/i);
    await store.transition(task.id,'paused');
    await expect(store.resumeTask(task.id)).rejects.toThrow(/deadline/i);
    expect((await store.approvals(task.id))[0].status).toBe('pending');
  });
  it('blocks model reservations and final answers after expiry',async()=>{
    const task=await create(),steps=buildGraph(task.id,'fast');await store.saveGraph(steps);
    await store.db.query("UPDATE tasks SET status='executing' WHERE id=$1",[task.id]);
    const agent=await store.startAgent(steps[0],model.id);await overdue(task.id);
    await expect(store.startCall(task.id,agent,model.id,[])).rejects.toThrow(/deadline/i);
    await store.transition(task.id,'verifying');await expect(store.complete(task.id,'Too late')).rejects.toThrow(/deadline/i);
    expect((await store.conversation(task.conversationId)).messages.filter(message=>message.role==='assistant')).toHaveLength(0);
    expect((await store.task(task.id)).callsUsed).toBe(0);
  });
  it('preserves historical tasks without an overall deadline',async()=>{
    const task=await create();await store.db.query("UPDATE tasks SET options=options #- '{budget,maxElapsedSeconds}',created_at=now()-interval '30 days',status='paused' WHERE id=$1",[task.id]);
    await store.recover();const resumed=await store.resumeTask(task.id);
    expect(resumed.options.budget.maxElapsedSeconds).toBeUndefined();expect(resumed.status).toBe('analyzing');
  });
  it('expires restarted work while retaining uncertain tool effects',async()=>{
    const task=await create(),steps=buildGraph(task.id,'fast');await store.saveGraph(steps);
    const agent=await store.startAgent(steps[0],model.id);
    await store.db.query("UPDATE tasks SET status='executing' WHERE id=$1",[task.id]);
    await store.db.query("INSERT INTO tool_calls(id,task_id,agent_id,name,arguments,status) VALUES ('interrupted-write',$1,$2,'file_write','{}','running')",[task.id,agent]);
    await overdue(task.id);await store.recover();
    expect((await store.task(task.id)).status).toBe('failed');
    expect((await store.db.query("SELECT status FROM tool_calls WHERE id='interrupted-write'"))[0].status).toBe('uncertain');
    expect((await store.taskEvents(task.id)).some(event=>event.type==='TASK_DEADLINE_EXCEEDED')).toBe(true);
  });
  it('aborts an active provider and does not publish its late answer',async()=>{
    let active=false,aborted=false;
    const runner=start(async function*(request){active=true;await gate(request.signal);aborted=request.signal.aborted;yield {type:'text',text:'Late response'};yield {type:'done',finishReason:'stop'};});
    const task=await create();runner.enqueue(task.id);await until(async()=>active);await overdue(task.id);
    await until(async()=>(await store.task(task.id)).status==='failed');
    expect(aborted).toBe(true);expect((await store.task(task.id)).error).toMatch(/deadline/i);
    expect((await store.conversation(task.conversationId)).messages.filter(message=>message.role==='assistant')).toHaveLength(0);
  });
  it('expires queued work without cancelling independent active objectives',async()=>{
    const active:string[]=[];
    const runner=start(async function*(request){active.push(request.messages.at(-1)!.content);await gate(request.signal);yield {type:'done',finishReason:'stop'};});
    const holders=[];for(let index=0;index<3;index++){const task=await create();holders.push(task);runner.enqueue(task.id);}
    // One local provider holds the model lease; the other two occupy execution
    // slots while awaiting that lease. The fourth objective stays in the queue.
    await until(async()=>(await store.db.query("SELECT id FROM tasks WHERE execution_wait_kind='resource'")).length===2);
    const queued=await create();runner.enqueue(queued.id);await overdue(queued.id);
    await until(async()=>(await store.task(queued.id)).status==='failed');
    expect(active).toHaveLength(1);expect((await Promise.all(holders.map(task=>store.task(task.id)))).every(task=>task.status==='executing')).toBe(true);
  });
  it('denies pending approvals when elapsed time expires during a suspended wait',async()=>{
    let executions=0;
    const runner=start(async function*(){yield {type:'tool_call',call:{id:'write',name:'file_write',arguments:{path:'result.txt',content:'x',expectedHash:null}}};yield {type:'done',finishReason:'stop'};},{definitions:()=>[{name:'file_write',description:'Write',parameters:{type:'object'}}],decide:()=>({decision:'approval',reason:'Exact write',risk:'write'}),execute:async()=>{executions++;return {content:'Written',evidence:[]};}});
    const task=await create({access:'supervised'});runner.enqueue(task.id);
    await until(async()=>(await store.task(task.id)).status==='waiting_for_approval');await overdue(task.id);
    await until(async()=>(await store.task(task.id)).status==='failed');
    expect(executions).toBe(0);expect((await store.approvals(task.id))[0].status).toBe('denied');
  });
  it('expires resource waits without dispatching inference',async()=>{
    const lease=new LocalLease(),release=await lease.acquire(new AbortController().signal);
    let calls=0;const runner=start(async function*(){calls++;yield {type:'done',finishReason:'stop'};},undefined,lease);
    const task=await create();runner.enqueue(task.id);await until(async()=>(await store.db.query('SELECT execution_wait_kind FROM tasks WHERE id=$1',[task.id]))[0].execution_wait_kind==='resource');
    try{await overdue(task.id);await until(async()=>(await store.task(task.id)).status==='failed');expect(calls).toBe(0);}finally{release();}
  });
});
