import {afterEach,expect,it} from 'vitest';
import {Store} from '../server/db/store.js';
import {openDatabase} from '../server/db/database.js';
import {startCalibration,calibrationHistory} from '../server/models/calibration.js';
import {selectModel} from '../server/orchestration/router.js';
import {Engine} from '../server/orchestration/engine.js';
import type {ModelProfile} from '../shared/types.js';
let store:Store;let engine:Engine|undefined;
afterEach(async()=>{await engine?.shutdown();engine=undefined;await store?.close();});
const local:ModelProfile={id:'ollama/test',name:'test',provider:'ollama',runtime:'ollama',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:8192,quantization:'Q4',sizeBytes:100,state:'available',details:{digest:'test',runtimeVersion:'test'},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
const admission={allowed:true,decision:'run' as const,reasons:['Test'],estimatedRamBytes:100,estimatedVramBytes:0,contextTokens:4096,confidence:'estimated' as const};
it('runs calibration through the ordinary task engine without tools, cloud, or fallback and persists actual usage',async()=>{
  store=new Store(await openDatabase());await store.init();let calls=0;
  const gateway={listModels:async()=>[local],statuses:async()=>[],stream:async function*(request:Parameters<Engine['gateway']['stream']>[0]){calls++;expect(request.tools).toEqual([]);expect(request.model.id).toBe(local.id);yield {type:'text' as const,text:'A bounded calibration response.'};yield {type:'usage' as const,inputTokens:70,outputTokens:25,durationMs:1500,loadDurationMs:200,generationTokensPerSecond:25,promptTokensPerSecond:140};yield {type:'done' as const,finishReason:'stop'};}};
  engine=new Engine(store,gateway,{definitions:()=>[],decide:()=>({decision:'deny',reason:'No tools',risk:'read'}),execute:async()=>{throw new Error('Forbidden');},changes:async()=>[],stopAll:async()=>{}},{admit:async()=>admission});
  const result=await startCalibration(store,engine,gateway,local.id,4096);
  const deadline=Date.now()+6000;while((await store.task(result.taskId)).status!=='completed'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  const task=await store.task(result.taskId);expect(task.status).toBe('completed');expect(calls).toBe(1);expect(task.options.modelSelection).toBe('required');expect(task.options.budget.localOnly).toBe(true);expect(task.options.workspaceId).toBeNull();
  const [history]=await calibrationHistory(store);expect(history.measurement).toMatchObject({inputTokens:70,outputTokens:25,loadDurationMs:200,generationTokensPerSecond:25});expect(history.modelId).toBe(local.id);
});
it('never substitutes a different model when a calibration model is unavailable',async()=>{
  store=new Store(await openDatabase());await store.init();const stub={enqueue:()=>{}};
  await expect(startCalibration(store,stub,{listModels:async()=>[{...local,local:false}],statuses:async()=>[],stream:async function*(){}},local.id,4096)).rejects.toThrow(/local/i);
  const created=await startCalibration(store,stub,{listModels:async()=>[local],statuses:async()=>[],stream:async function*(){}},local.id,4096);
  const task=await store.task(created.taskId);const {row}=await import('../server/db/store.js');const user=row<import('../server/auth/policy.js').User>((await store.db.query('SELECT * FROM users WHERE id=$1',['owner']))[0]);
  await expect(selectModel({listModels:async()=>[{...local,id:'ollama/other'}],statuses:async()=>[],stream:async function*(){}},task,user,'worker',async()=>admission,new Set())).rejects.toThrow(/model/i);
});
