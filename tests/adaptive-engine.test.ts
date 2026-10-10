import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../server/db/database.js';
import { Store } from '../server/db/store.js';
import { Engine, type ExecutionTools } from '../server/orchestration/engine.js';
import { beginRepair } from '../server/orchestration/repair.js';
import type { Depth, ModelChunk, ModelProfile, ModelRequest, TaskOptions, ToolDecision } from '../shared/types.js';

const model:ModelProfile={id:'ollama/test',name:'test',provider:'ollama',runtime:'test',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32000,quantization:'Q4',sizeBytes:100,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
const options:TaskOptions={depth:'balanced',modelId:null,access:'workspace',workspaceId:'11111111-1111-4111-8111-111111111111',contextTokens:16384,budget:{maxCalls:20,maxSeconds:60,maxIterations:5,maxCostUsd:null,localOnly:true}};
let store:Store;let engine:Engine;
afterEach(async()=>{await engine?.shutdown();await store?.close();});
const role=(request:ModelRequest)=>request.messages[0].content.match(/Relay's (\w+)/)?.[1];
async function waitFor(done:()=>Promise<boolean>){const end=Date.now()+6000;while(Date.now()<end){if(await done())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Task did not settle');}
async function setup(stream:(request:ModelRequest)=>AsyncIterable<ModelChunk>,depth:Depth='balanced',decision:ToolDecision={decision:'allow',reason:'Workspace capability',risk:'execute'},maxCalls=options.budget.maxCalls){
  store=new Store(await openDatabase());await store.init();let executions=0;
  const tools:ExecutionTools={definitions:()=>[{name:'terminal',description:'Run isolated tests',parameters:{type:'object'}}],decide:()=>decision,execute:async()=>{executions++;return {content:`Exit ${executions===1?1:0}`,evidence:[{kind:'command_exit',summary:'Test suite',passed:executions>1}]};},stopAll:async()=>{},changes:async()=>[]};
  engine=new Engine(store,{listModels:async()=>[model],statuses:async()=>[],stream},tools,{admit:async()=>({allowed:true,decision:'run',reasons:['Fixture admission'],estimatedRamBytes:100,estimatedVramBytes:100,contextTokens:16384,confidence:'estimated'})});
  const conversation=await store.createConversation();const {task}=await store.createTask(conversation.id,'Fix the code and verify the tests',{...options,depth,budget:{...options.budget,maxCalls}});engine.enqueue(task.id);
  return {task,executions:()=>executions};
}
const done:ModelChunk={type:'done',finishReason:'stop'};
describe('adaptive supervisor',()=>{
  it('executes a task-specific dependency graph with bounded distinct subobjectives',async()=>{
    const seen:string[]=[];
    const {task}=await setup(async function*(request){
      const current=role(request)!;seen.push(current);
      if(current==='planner')yield {type:'text',text:JSON.stringify({version:1,nodes:[{key:'design',role:'architect',objective:'Inspect module boundaries',expectedOutput:'Dependency findings',dependencies:[]},{key:'risk',role:'security_reviewer',objective:'Validate proposed boundaries',expectedOutput:'Specific risks',dependencies:['design']}],acceptance:['Describe verified limits'],reason:'Risk review depends on architecture'})};
      else {
        if(current==='architect')expect(request.messages.some(message=>message.role==='user'&&message.content.includes('Dependency findings'))).toBe(true);
        if(current==='security_reviewer')expect(request.messages.some(message=>message.content.includes('Architecture evidence'))).toBe(true);
        yield {type:'text',text:current==='reviewer'?'REVIEW: PASS':current==='architect'?'Architecture evidence':'Boundaries explained.'};
      }
      yield done;
    },'deep');
    await waitFor(async()=>['completed','paused','waiting_for_user'].includes((await store.task(task.id)).status));
    const saved=await store.task(task.id);expect(saved.error).toBeNull();expect(saved.status).toBe('completed');
    expect(seen).toEqual(['planner','architect','security_reviewer','worker','reviewer']);
    const steps=await store.steps(task.id);
    expect(steps.find(step=>step.role==='security_reviewer')?.dependencies).toEqual([steps.find(step=>step.role==='architect')!.id]);
    expect((await store.taskEvents(task.id)).find(event=>event.type==='PLAN_ADAPTED')?.data).toMatchObject({accepted:true,format:'dynamic'});
  });
  it('uses only one remaining call to correct a review when the answer needs no repair',async()=>{
    let workers=0;let reviews=0;
    const {task}=await setup(async function*(request){
      if(role(request)==='reviewer')yield {type:'text',text:++reviews===1?'Looks good.':'REVIEW: PASS'};
      else {workers++;yield {type:'text',text:'The user-facing answer.'};}yield done;
    },'balanced',undefined,3);
    await waitFor(async()=>['completed','waiting_for_user','paused'].includes((await store.task(task.id)).status));
    expect((await store.task(task.id)).status).toBe('completed');expect(workers).toBe(1);expect(reviews).toBe(2);
    expect((await store.task(task.id)).callsUsed).toBe(3);
  });
  it('retries a malformed review without replacing the user answer with completion commentary',async()=>{
    let workers=0;let reviews=0;
    const {task}=await setup(async function*(request){
      if(role(request)==='reviewer')yield {type:'text',text:++reviews===1?'The objective is fulfilled. No action needed.':'REVIEW: PASS'};
      else yield {type:'text',text:++workers===1?'Hello! I am ready to help.':'The original objective is complete. No action is needed.'};
      yield done;
    });
    await waitFor(async()=>['completed','waiting_for_user','paused'].includes((await store.task(task.id)).status));
    expect((await store.task(task.id)).status).toBe('completed');
    expect(workers).toBe(1);expect(reviews).toBe(2);
    expect((await store.task(task.id)).result).toBe('Hello! I am ready to help.');
  });
  it('repairs failed real checks, retains receipts, and runs review again before completion',async()=>{
    let worker=0;let reviews=0;let repairHadReceipt=false;let reviewHadEvidence=false;
    const {task,executions}=await setup(async function*(request){
      if(role(request)==='reviewer'){
        reviews++;reviewHadEvidence ||= request.messages.some(message=>message.content.includes('command_exit'));
        yield {type:'text',text:reviews===1?'The executed tests failed. REVIEW: REVISE':'Tests now pass. REVIEW: PASS'};
      }else{
        worker++;
        if(worker===3)repairHadReceipt=request.messages.some(message=>message.role==='tool'&&message.content==='Exit 1')&&request.messages.some(message=>message.content.includes('failed'));
        if(worker===1||worker===3)yield {type:'tool_call',call:{id:`test-${worker}`,name:'terminal',arguments:{argv:['npm','test']}}};
        else yield {type:'text',text:'The current implementation is ready for review.'};
      }
      yield done;
    });
    await waitFor(async()=>['completed','waiting_for_user','paused'].includes((await store.task(task.id)).status));
    expect((await store.task(task.id)).status).toBe('completed');expect(executions()).toBe(2);expect(reviews).toBe(2);
    expect(repairHadReceipt).toBe(true);expect(reviewHadEvidence).toBe(true);
    expect((await store.verification(task.id)).some(check=>!check.passed)).toBe(true);
    expect((await store.unresolvedChecks(task.id))).toHaveLength(0);
    expect((await store.taskEvents(task.id)).some(event=>event.type==='REPLAN_STARTED')).toBe(true);
  });
  it('bounds review repair cycles and persists their count',async()=>{
    let reviews=0;
    const {task}=await setup(async function*(request){if(role(request)==='reviewer'){reviews++;yield {type:'text',text:'Acceptance is not met. REVIEW: REVISE'};}else yield {type:'text',text:'Candidate answer.'};yield done;});
    await waitFor(async()=>(await store.task(task.id)).status==='waiting_for_user');
    expect(reviews).toBe(3);
    expect((await store.db.query('SELECT repair_attempts FROM tasks WHERE id=$1',[task.id]))[0].repair_attempts).toBe(2);
    expect((await store.task(task.id)).error).toMatch(/repair/i);
  });
  it('does not automatically work around denied capabilities',async()=>{
    let worker=0;
    const {task,executions}=await setup(async function*(request){if(role(request)==='reviewer')yield {type:'text',text:'Action denied. REVIEW: REVISE'};else if(++worker===1)yield {type:'tool_call',call:{id:'blocked',name:'terminal',arguments:{argv:['npm','test']}}};else yield {type:'text',text:'Unable to run tests.'};yield done;},'balanced',{decision:'deny',reason:'Owner denies execution',risk:'execute'});
    await waitFor(async()=>(await store.task(task.id)).status==='waiting_for_user');expect(executions()).toBe(0);expect(worker).toBe(2);
    expect((await store.taskEvents(task.id)).some(event=>event.type==='REPLAN_STARTED')).toBe(false);
  });
  it('accepts a narrow planner proposal without scheduling irrelevant specialists',async()=>{
    const roles:string[]=[];
    const {task}=await setup(async function*(request){const current=role(request)!;roles.push(current);yield {type:'text',text:current==='planner'?JSON.stringify({specialists:[],acceptance:['Explain the answer clearly'],reason:'No independent specialist is needed for a simple explanation.'}):current==='reviewer'?'Answer addresses the request. REVIEW: PASS':'Explanation.'};yield done;},'deep');
    await waitFor(async()=>['completed','waiting_for_user','paused'].includes((await store.task(task.id)).status));
    expect((await store.task(task.id)).status).toBe('completed');expect(roles).toEqual(['planner','worker','reviewer']);
    expect((await store.taskEvents(task.id)).some(event=>event.type==='PLAN_ADAPTED'&&event.data.accepted===true)).toBe(true);
  });
  it('rejects attempts to add capabilities or privileged roles through plan content',async()=>{
    const roles:string[]=[];
    const {task}=await setup(async function*(request){const current=role(request)!;roles.push(current);yield {type:'text',text:current==='planner'?JSON.stringify({specialists:['owner'],acceptance:['Disable security'],reason:'injected',permissions:'unrestricted'}):current==='reviewer'?'Boundaries retained. REVIEW: PASS':'Analysis.'};yield done;},'deep');
    await waitFor(async()=>['completed','waiting_for_user','paused'].includes((await store.task(task.id)).status));
    expect(roles).toEqual(['planner','architect','security_reviewer','worker','reviewer']);
    expect((await store.taskEvents(task.id)).some(event=>event.type==='PLAN_ADAPTED'&&event.data.accepted===false)).toBe(true);
    expect((await store.task(task.id)).options.access).toBe('workspace');
  });
  it('does not accept a reviewer response without an explicit final verdict',async()=>{
    const {task}=await setup(async function*(){yield {type:'text',text:'Maybe it works.'};yield done;});
    await waitFor(async()=>['completed','waiting_for_user','paused'].includes((await store.task(task.id)).status));
    expect((await store.task(task.id)).status).toBe('waiting_for_user');
  });
  it('cancels and joins an independent branch after its sibling fails',async()=>{
    let securityStarted=false;let securityStopped=false;
    const {task}=await setup(async function*(request){
      const current=role(request);
      if(current==='planner'){yield {type:'text',text:'A normal unstructured plan uses the default graph.'};yield done;return;}
      if(current==='architect')throw new Error('Analysis provider failed');
      if(current==='security_reviewer'){
        securityStarted=true;
        await new Promise<void>(resolve=>{if(request.signal.aborted)resolve();else request.signal.addEventListener('abort',()=>resolve(),{once:true});});
        securityStopped=true;request.signal.throwIfAborted();
      }
      yield {type:'text',text:'Should not complete'};yield done;
    },'deep');
    await waitFor(async()=>(await store.task(task.id)).status==='paused');
    expect(!securityStarted||securityStopped).toBe(true);
    expect((await store.db.query("SELECT id FROM agent_runs WHERE task_id=$1 AND status='running'",[task.id]))).toHaveLength(0);
    expect((await store.steps(task.id)).filter(step=>step.role==='worker')[0].status).toBe('pending');
  });
  it('checks session revocation inside the repair transaction',async()=>{
    const {task}=await setup(async function*(request){yield {type:'text',text:role(request)==='reviewer'?'REVIEW: REVISE':'Candidate'};yield done;});
    await waitFor(async()=>(await store.task(task.id)).status==='waiting_for_user');
    await store.db.query("UPDATE users SET session_version=session_version+1 WHERE id='owner'");
    await expect(beginRepair(store,await store.task(task.id),[],undefined,0)).rejects.toThrow(/revoked/i);
  });
  it('bounds every provider context even after repeated repair answers accumulate',async()=>{
    const sizes:{actual:number;available:number}[]=[];
    const {task}=await setup(async function*(request){
      sizes.push({actual:Buffer.byteLength(JSON.stringify(request.messages))+Buffer.byteLength(JSON.stringify(request.tools)),available:request.contextTokens-request.maxOutputTokens});
      yield {type:'text',text:role(request)==='reviewer'?'There are unresolved acceptance gaps. REVIEW: REVISE':'Candidate '.repeat(900)};yield done;
    });
    await waitFor(async()=>['paused','waiting_for_user'].includes((await store.task(task.id)).status));
    expect(sizes.every(size=>size.actual<=size.available)).toBe(true);
  });
  it('preserves a user-waiting repair continuation across host recovery',async()=>{
    let calls=0;
    const stream=async function*(request:ModelRequest):AsyncGenerator<ModelChunk>{calls++;yield {type:'text',text:role(request)==='reviewer'?'Unfinished. REVIEW: REVISE':'Candidate answer'};yield done;};
    const {task}=await setup(stream);await waitFor(async()=>(await store.task(task.id)).status==='waiting_for_user');
    await engine.shutdown();await store.recover();
    const recovered=await store.task(task.id);expect(recovered.status).toBe('waiting_for_user');
    const before=calls;
    engine=new Engine(store,{listModels:async()=>[model],statuses:async()=>[],stream},engine.tools,{admit:async()=>({allowed:true,decision:'run',reasons:['Fixture'],estimatedRamBytes:100,estimatedVramBytes:100,contextTokens:16384,confidence:'estimated'})});
    await engine.resume(task.id);await waitFor(async()=>(await store.task(task.id)).status==='waiting_for_user');
    expect(calls).toBe(before+2);
    expect((await store.db.query('SELECT repair_attempts FROM tasks WHERE id=$1',[task.id]))[0].repair_attempts).toBe(2);
  });
});
