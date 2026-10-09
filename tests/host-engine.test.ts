import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Engine } from '../server/orchestration/engine.js';
import { Store } from '../server/db/store.js';
import { openDatabase } from '../server/db/database.js';
import { ToolBroker } from '../server/tools/index.js';
import type { ModelProfile, ProviderGateway, TaskOptions } from '../shared/types.js';

let store: Store | undefined, engine: Engine | undefined, directory: string | undefined;
afterEach(async()=>{await engine?.shutdown();await store?.close();if(directory)await rm(directory,{recursive:true,force:true});});
it.each([false,true])('executes real host operations and refuses stale completion (external change: %s)',async(tamper)=>{
  directory=await mkdtemp(join(resolve('..'),'relay-host-engine-'));
  const path=join(directory,'greeting.txt');
  store=new Store(await openDatabase());await store.init();
  const broker=new ToolBroker(join(directory,'private-data'),()=>engine?.isStopped()??false);
  const model: ModelProfile={id:'ollama:fixture',name:'Fixture',provider:'ollama',runtime:'fixture',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32000,quantization:null,sizeBytes:100,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
  const gateway: ProviderGateway={listModels:async()=>[model],statuses:async()=>[],stream:async function*(request){
    expect(request.tools?.some(tool=>tool.name==='host_write')).toBe(true);
    const receipts=request.messages.filter(message=>message.role==='tool');
    if(!receipts.length)yield {type:'tool_call',call:{id:'write',name:'host_write',arguments:{path,content:'Hello from host access\n',expectedHash:null}}};
    else if(receipts.length===1)yield {type:'tool_call',call:{id:'read',name:'host_read',arguments:{path}}};
    else {if(tamper)await writeFile(path,'External change after the read receipt');yield {type:'text',text:'Created the real host file and read it back.'};}
    yield {type:'done',finishReason:'stop'};
  }};
  engine=new Engine(store,gateway,broker,{admit:async()=>({allowed:true,decision:'run',reasons:['Deterministic test model'],estimatedRamBytes:100,estimatedVramBytes:100,contextTokens:16384,confidence:'estimated'})});
  const options: TaskOptions={depth:'fast',modelId:null,access:'unrestricted',hostAccessConfirmed:true,workspaceId:null,contextTokens:16384,budget:{maxCalls:5,maxSeconds:60,maxIterations:4,maxCostUsd:null,localOnly:true}};
  const conversation=await store.createConversation();const {task}=await store.createTask(conversation.id,`Create and verify ${path}`,options);engine.enqueue(task.id);
  if(tamper){
    await expect.poll(async()=>['waiting_for_user','paused','failed','completed'].includes((await store!.task(task.id)).status),{timeout:12000}).toBe(true);
    expect((await store.task(task.id)).status).not.toBe('completed');
    expect((await store.verification(task.id)).some(check=>check.kind==='host_file_state'&&!check.passed)).toBe(true);
    return;
  }
  await expect.poll(async()=> (await store!.task(task.id)).status,{timeout:12000}).toBe('completed');
  expect(await readFile(path,'utf8')).toBe('Hello from host access\n');
  expect(await store.approvals(task.id)).toEqual([]);
  expect((await store.db.query('SELECT name,status FROM tool_calls WHERE task_id=$1 ORDER BY started_at',[task.id])).map(row=>[row.name,row.status])).toEqual([['host_write','completed'],['host_read','completed']]);
  expect((await store.db.query('SELECT * FROM audit_events WHERE task_id=$1 AND operation=$2',[task.id,'TOOL_POLICY'])).length).toBe(2);
  expect((await store.verification(task.id)).every(check=>check.passed)).toBe(true);
  expect((await store.verification(task.id)).some(check=>check.kind==='host_file_state')).toBe(true);
});
