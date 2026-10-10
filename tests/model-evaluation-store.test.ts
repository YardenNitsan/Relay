import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {openDatabase} from '../server/db/database.js';
import {Store} from '../server/db/store.js';
import {EvaluationStore} from '../server/models/evaluation-store.js';
import {evaluationCases,type EvaluationIdentity,type EvaluationExecutor} from '../server/models/evaluation.js';
import type {TaskOptions} from '../shared/types.js';

let store:Store,records:EvaluationStore;
const actor={userId:'owner',sessionVersion:0};
const identity:EvaluationIdentity={modelId:'ollama/synthetic',provider:'ollama',digest:'sha256:fixture',runtime:'ollama',runtimeVersion:'1',quantization:'Q4',contextTokens:8192,gpuOffload:20,executionSettings:{temperature:0,seed:1,reasoning:'none',maxOutputTokens:512},hardwareFingerprint:'a'.repeat(64)};
const options:TaskOptions={depth:'fast',modelId:identity.modelId,modelSelection:'required',access:'read_only',workspaceId:null,contextTokens:8192,cloudPolicy:'local_only',network:{mode:'deny',allowedOrigins:[]},budget:{maxCalls:12,maxIterations:12,maxSeconds:120,maxOutputTokens:512,maxCostUsd:0,localOnly:true}};
const execution={signal:new AbortController().signal,maxCalls:9,timeoutMs:1000};
const executor:EvaluationExecutor=async()=>({identity,completed:true,text:'{}',toolCalls:[],measurement:{inputTokens:20,outputTokens:2}});
beforeEach(async()=>{store=new Store(await openDatabase());await store.init();records=new EvaluationStore(store);});
afterEach(async()=>{await store.close();});
async function task(){const conversation=await store.createConversation('Evaluation');const {task}=await store.createTask(conversation.id,'Synthetic benchmark',structuredClone(options));await store.db.query("UPDATE tasks SET status='executing' WHERE id=$1",[task.id]);return {...actor,taskId:task.id};}

describe('trusted evaluation persistence',()=>{
  it('stores bounded host-run reports and returns only same-account evidence',async()=>{
    const scope=await task();const saved=await records.runAndRecord(scope,identity,executor,execution);
    expect(saved.report.samples).toHaveLength(evaluationCases().length);
    expect((await records.history(actor))[0]).toMatchObject({id:saved.id,taskId:scope.taskId,status:'completed'});
    expect(await records.evidence(actor,identity)).toMatchObject({total:9});
    expect(await records.evidence(actor,{...identity,gpuOffload:0})).toBeNull();
    await store.db.query("INSERT INTO users(id,name,role,permissions) SELECT 'other','Other','trusted',permissions FROM users WHERE id='owner'");
    expect(await records.history({userId:'other',sessionVersion:0})).toEqual([]);
    await expect(records.report({userId:'other',sessionVersion:0},saved.id)).rejects.toMatchObject({code:'NOT_FOUND'});
  });
  it('claims a task before inference and prevents a second runner from dispatching',async()=>{
    const scope=await task();let release!:()=>void,started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve;});const wait=new Promise<void>(resolve=>{release=resolve;});
    let calls=0;const held:EvaluationExecutor=async()=>{calls++;if(calls===1){started();await wait;}return executor(evaluationCases()[0],{identity,signal:execution.signal,maxOutputTokens:512});};
    const pending=records.runAndRecord(scope,identity,held,execution);await entered;
    try{await expect(new EvaluationStore(store).runAndRecord(scope,identity,executor,execution)).rejects.toMatchObject({code:'EVALUATION_EXISTS'});expect(calls).toBe(1);}finally{release();}
    await pending;
    await expect(records.runAndRecord(scope,identity,executor,execution)).rejects.toMatchObject({code:'EVALUATION_EXISTS'});
  });
  it('rechecks revocation between samples and keeps failures ineligible',async()=>{
    const scope=await task();let calls=0;
    await expect(records.runAndRecord(scope,identity,async()=>{calls++;await store.db.query("UPDATE users SET session_version=1 WHERE id='owner'");return {identity,completed:true,text:'{}',toolCalls:[]};},execution)).rejects.toMatchObject({code:'REVOKED'});
    expect(calls).toBe(1);
    expect((await records.history({...actor,sessionVersion:1}))[0]).toMatchObject({status:'failed',result:null});
    expect(await records.evidence({...actor,sessionVersion:1},identity)).toBeNull();
    await expect(records.history(actor)).rejects.toMatchObject({code:'REVOKED'});
  });
  it('rejects wrong task ownership, widened tool scope and mismatched output settings before dispatch',async()=>{
    const scope=await task();let calls=0;const counting:EvaluationExecutor=async(...args)=>{calls++;return executor(...args);};
    await expect(records.runAndRecord({...scope,userId:'other'},identity,counting,execution)).rejects.toThrow();
    await store.db.query("UPDATE tasks SET options=jsonb_set(options,'{access}','\"workspace\"') WHERE id=$1",[scope.taskId]);
    await expect(records.runAndRecord(scope,identity,counting,execution)).rejects.toMatchObject({code:'EVALUATION_SCOPE'});
    await store.db.query('UPDATE tasks SET options=$1 WHERE id=$2',[JSON.stringify(options),scope.taskId]);
    await expect(records.runAndRecord(scope,{...identity,executionSettings:{...identity.executionSettings,maxOutputTokens:1024}},counting,execution)).rejects.toMatchObject({code:'EVALUATION_SCOPE'});
    expect(calls).toBe(0);
  });
  it('marks abandoned claims interrupted without replay or routing evidence',async()=>{
    const scope=await task();let release!:()=>void,started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve;});const wait=new Promise<void>(resolve=>{release=resolve;});
    const pending=records.runAndRecord(scope,identity,async()=>{started();await wait;throw new Error('fixture interruption');},execution);const rejected=expect(pending).rejects.toThrow('fixture interruption');await entered;
    await records.recoverInterrupted();release();await rejected;
    expect((await records.history(actor))[0]).toMatchObject({status:'interrupted',result:null});
    expect(await records.evidence(actor,identity)).toBeNull();
  });
  it('rejects invalid history limits and malformed persisted reports',async()=>{
    const saved=await records.runAndRecord(await task(),identity,executor,execution);
    await expect(records.history(actor,41)).rejects.toThrow(/limit/i);
    await store.db.query("UPDATE model_evaluations SET report=jsonb_set(report,'{source}','\"fixture\"') WHERE id=$1",[saved.id]);
    expect(await records.evidence(actor,identity)).toBeNull();
    await expect(records.report(actor,saved.id)).rejects.toMatchObject({code:'EVALUATION_REPORT'});
  });
  it('refuses full history without deleting reports or dispatching another model call',async()=>{
    const scope=await task();
    await store.db.query("INSERT INTO tasks(id,conversation_id,objective,status,options,stop_generation,user_id) SELECT 'capacity-task-'||n,t.conversation_id,'retained fixture','completed',t.options,t.stop_generation,t.user_id FROM tasks t CROSS JOIN generate_series(1,200) n WHERE t.id=$1",[scope.taskId]);
    await store.db.query("INSERT INTO model_evaluations(id,user_id,task_id,protocol,identity,status,finished_at) SELECT 'capacity-eval-'||n,$1,'capacity-task-'||n,$2,$3,'failed',now() FROM generate_series(1,200) n",[actor.userId,'relay-capability-eval-v2',JSON.stringify(identity)]);
    let calls=0;await expect(records.runAndRecord(scope,identity,async(...args)=>{calls++;return executor(...args);},execution)).rejects.toMatchObject({code:'EVALUATION_CAPACITY'});
    expect(calls).toBe(0);expect(Number((await store.db.query('SELECT count(*) AS count FROM model_evaluations'))[0].count)).toBe(200);
  });
});
