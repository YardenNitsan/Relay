import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {Store} from '../server/db/store.js';
import {openDatabase} from '../server/db/database.js';
import {Engine} from '../server/orchestration/engine.js';
import {handoffSchema,type AgentHandoff} from '../server/orchestration/handoff.js';
import {ToolBroker} from '../server/tools/index.js';
import {ToolStore} from '../server/tools/store.js';
import {sha256} from '../server/tools/files.js';
import type {ModelChunk,ModelProfile,ModelRequest,TaskOptions,Workspace} from '../shared/types.js';

// Scripted provider proposals exercise real Engine, durable records and filesystem
// tools. They are not live model findings or evidence of specialist task quality.
const analysisRoles=['architect','security_reviewer','researcher'] as const;
type AnalysisRole=typeof analysisRoles[number];
const contents='export const boundary = "managed analysis fixture";\n';
const path='boundary.ts';
const model:ModelProfile={id:'ollama/agent-evidence-fixture',name:'Protocol fixture',provider:'ollama',runtime:'fixture',local:true,
  capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32768,quantization:null,sizeBytes:1,
  state:'ready',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
const roleOf=(request:ModelRequest)=>request.messages[0].content.match(/Relay's (\w+)\./)?.[1];
const done:ModelChunk={type:'done',finishReason:'stop'};
let store:Store,broker:ToolBroker,engine:Engine|undefined,directory:string,workspace:Workspace,file:string;
beforeEach(async()=>{
  directory=await mkdtemp(join(tmpdir(),'relay-agent-evidence-'));
  store=new Store(await openDatabase());await store.init();
  broker=new ToolBroker(directory,()=>engine?.isStopped()??false,undefined,store);
  workspace=await broker.createWorkspace('Analysis evidence',undefined,'owner');await store.saveWorkspace(workspace);
  await broker.upload(workspace.id,path,contents);
  file=join(await new ToolStore(directory).workspaceRoot(workspace.id),path);
});
afterEach(async()=>{
  await engine?.shutdown();engine=undefined;await broker.stopAll();await store.close();
  if(dirname(resolve(directory))!==resolve(tmpdir())||!basename(directory).startsWith('relay-agent-evidence-'))throw new Error('Unexpected disposable fixture path');
  await rm(directory,{recursive:true,force:true});
});
async function start(stream:(request:ModelRequest)=>AsyncIterable<ModelChunk>){
  engine=new Engine(store,{listModels:async()=>[model],statuses:async()=>[],stream},broker,{admit:async()=>({
    allowed:true,decision:'run',reasons:['No inference: scripted protocol fixture'],estimatedRamBytes:1,estimatedVramBytes:0,contextTokens:32768,confidence:'estimated',
  })});
  const options:TaskOptions={assistantId:'coding',depth:'maximum',access:'workspace',workspaceId:workspace.id,modelId:model.id,
    modelSelection:'required',contextTokens:32768,budget:{maxCalls:12,maxSeconds:60,maxIterations:4,maxCostUsd:0,localOnly:true,maxOutputTokens:1024}};
  const conversation=await store.createConversation();
  const {task}=await store.createTask(conversation.id,'Inspect the existing managed boundary file; preserve its contents.',options);
  engine.enqueue(task.id);return task;
}
function plan(role:AnalysisRole):ModelChunk{return {type:'text',text:JSON.stringify({version:1,nodes:[{
  key:'inspect',role,objective:'Read boundary.ts',expectedOutput:'Observed file digest',dependencies:[],
}],acceptance:['Preserve the existing file'],reason:'Exercise attributable analysis evidence'})};}
async function settled(id:string){
  await expect.poll(async()=>['completed','waiting_for_user','paused','failed','cancelled'].includes((await store.task(id)).status),{timeout:6000}).toBe(true);
  return store.task(id);
}

describe('analysis agents with real managed-file evidence',()=>{
  it.each(analysisRoles)('%s reads a real file and hands attributable evidence to its worker',async role=>{
    let handoff:AgentHandoff|undefined,analysisReceipt:string|undefined;
    const task=await start(async function*(request){
      const current=roleOf(request);
      if(current==='planner')yield plan(role);
      else if(current===role){
        const tools=request.tools.map(tool=>tool.name);
        expect(tools).toContain('file_read');
        expect(tools).not.toContain('file_write');expect(tools).not.toContain('file_delete');expect(tools).not.toContain('terminal');
        const receipt=request.messages.find(message=>message.role==='tool');
        if(!receipt)yield {type:'tool_call',call:{id:'analysis-read',name:'file_read',arguments:{path}}};
        else{
          analysisReceipt=receipt.content;
          expect(JSON.parse(receipt.content)).toMatchObject({path,content:contents,sha256:sha256(contents),truncated:false});
          yield {type:'text',text:`Observed file digest: ${JSON.parse(receipt.content).sha256}`};
        }
      }else if(current==='worker'){
        expect(request.tools.map(tool=>tool.name)).toContain('file_write');
        const message=request.messages.find(message=>message.content.startsWith('Structured agent handoff'))!;
        expect(message.role).toBe('user');handoff=handoffSchema.parse(JSON.parse(message.content.slice(message.content.indexOf('\n')+1)));
        yield {type:'text',text:'The analysis read the managed file without changing it.'};
      }else yield {type:'text',text:'REVIEW: PASS'};
      yield done;
    });
    expect(await settled(task.id)).toMatchObject({status:'completed',error:null});
    expect(analysisReceipt).toBeDefined();expect(handoff).toBeDefined();
    const steps=await store.steps(task.id),source=steps.find(step=>step.role===role)!;
    expect(handoff!.approvedPlan.grantsPermissions).toBe(false);
    expect(handoff!.untrustedFindings).toEqual(expect.arrayContaining([expect.objectContaining({role,stepId:source.id,text:`Observed file digest: ${sha256(contents)}`})]));
    const receipts=await store.db.query('SELECT id,agent_id,name,status,result FROM tool_calls WHERE task_id=$1',[task.id]);
    expect(receipts).toHaveLength(1);expect(receipts[0]).toMatchObject({name:'file_read',status:'completed',result:analysisReceipt});
    expect(handoff!.receipts).toEqual(expect.arrayContaining([expect.objectContaining({id:receipts[0].id,agentId:receipts[0].agent_id,stepId:source.id,name:'file_read',status:'completed'})]));
    expect(handoff!.verifiedFindings.some(check=>check.passed&&check.kind==='tool_outcome')).toBe(true);
    expect((await store.verification(task.id)).some(check=>check.kind==='file_read'&&check.passed&&check.details.sha256===sha256(contents))).toBe(true);
    expect(await readFile(file,'utf8')).toBe(contents);expect(await broker.changes(task.id)).toEqual([]);
  });

  it.each(analysisRoles)('%s cannot write even when the task and selected Coding specialist permit workspace writes',async role=>{
    let denialReceived=false;
    const task=await start(async function*(request){
      const current=roleOf(request);
      if(current==='planner')yield plan(role);
      else if(current===role){
        const receipt=request.messages.find(message=>message.role==='tool');
        if(!receipt)yield {type:'tool_call',call:{id:'forged-analysis-write',name:'file_write',arguments:{path,content:'Unauthorized replacement',expectedHash:sha256(contents)}}};
        else{denialReceived=receipt.content.includes('Agent has no capability');yield {type:'text',text:'The attempted write was denied.'};}
      }else yield {type:'text',text:current==='reviewer'?'REVIEW: PASS':'No file change was authorized for the analysis role.'};
      yield done;
    });
    expect((await settled(task.id)).status).toBe('waiting_for_user');expect(denialReceived).toBe(true);
    expect(await readFile(file,'utf8')).toBe(contents);expect(await broker.changes(task.id)).toEqual([]);
    expect(await store.db.query('SELECT id FROM tool_calls WHERE task_id=$1',[task.id])).toEqual([]);
    expect(await store.approvals(task.id)).toEqual([]);
    expect((await store.verification(task.id)).some(check=>check.kind==='tool_denied'&&!check.passed&&check.details.tool==='file_write')).toBe(true);
    expect(await store.db.query('SELECT decision,reason FROM permission_decisions WHERE task_id=$1',[task.id])).toEqual([
      expect.objectContaining({decision:'deny',reason:'Agent has no capability for this tool'}),
    ]);
  });

  it.each(['cancel','revoke'] as const)('%s between analysis read and continuation prevents further tools and dependent work',async action=>{
    let reached!:()=>void,release!:()=>void;
    const atContinuation=new Promise<void>(resolve=>{reached=resolve;});
    const roles:string[]=[];
    const task=await start(async function*(request){
      const current=roleOf(request)!;roles.push(current);
      if(current==='planner')yield plan('architect');
      else if(current==='architect'&&!request.messages.some(message=>message.role==='tool'))yield {type:'tool_call',call:{id:'first-read',name:'file_read',arguments:{path}}};
      else if(current==='architect'){
        await new Promise<void>(resolve=>{release=resolve;request.signal.addEventListener('abort',()=>resolve(),{once:true});reached();});
        request.signal.throwIfAborted();
        yield {type:'tool_call',call:{id:'after-revocation',name:'file_read',arguments:{path}}};
      }else yield {type:'text',text:'Unexpected dependent execution'};
      yield done;
    });
    try{
      await atContinuation;
      if(action==='cancel')await engine!.cancel(task.id);
      else{await store.db.query("UPDATE users SET session_version=session_version+1 WHERE id='owner'");release();}
      expect(['paused','cancelled']).toContain((await settled(task.id)).status);
      expect(roles).not.toContain('worker');expect(roles).not.toContain('reviewer');
      const receipts=await store.db.query('SELECT name,status FROM tool_calls WHERE task_id=$1',[task.id]);
      expect(receipts).toEqual([{name:'file_read',status:'completed'}]);
      expect(await readFile(file,'utf8')).toBe(contents);
    }finally{release?.();}
  });
});
