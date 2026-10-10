import {afterEach,expect,it,vi} from 'vitest';
import {openDatabase} from '../server/db/database.js';
import {row,Store} from '../server/db/store.js';
import {Engine} from '../server/orchestration/engine.js';
import {startModelEvaluation} from '../server/models/evaluation-start.js';
import * as hardwareModule from '../server/hardware/index.js';
import type {HardwareSnapshot,ModelProfile} from '../shared/types.js';
import type {User} from '../server/auth/policy.js';
let store:Store,engine:Engine;
afterEach(async()=>{await engine?.shutdown();await store?.close();vi.restoreAllMocks();});
it('runs a real Engine evaluation path without dispatching proposed tools or ordinary agent prompts',async()=>{
  const hardware:HardwareSnapshot={sampledAt:new Date().toISOString(),platform:'win32',architecture:'x64',memoryArchitecture:'discrete',cpu:{name:'Fixture CPU',physicalCores:8,logicalCores:16,utilization:0},memory:{totalBytes:32e9,availableBytes:20e9,swapTotalBytes:0,swapUsedBytes:0},gpus:[{vendor:'nvidia',name:'Fixture GPU',totalBytes:12e9,usedBytes:1e9,utilization:0,temperature:40,driver:'1'}],storage:null,warnings:[]};
  vi.spyOn(hardwareModule,'getHardware').mockResolvedValue(hardware);
  const model:ModelProfile={id:'ollama/fixture',name:'Fixture',provider:'ollama',runtime:'ollama',local:true,state:'available',contextWindow:32768,sizeBytes:100,quantization:'Q4',details:{digest:'fixture-digest',runtimeVersion:'1'},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null,capabilities:{tools:true,reasoning:false,structured:true,vision:false}};
  store=new Store(await openDatabase());await store.init();let calls=0;
  const gateway={listModels:async()=>[model],statuses:async()=>[],stream:async function*(request:import('../shared/types.js').ModelRequest){calls++;expect(request.messages[0].content).toContain('Synthetic Relay evaluation');yield {type:'text' as const,text:'{}'};yield {type:'done' as const,finishReason:'stop'};}};
  const admit=async()=>({allowed:true,decision:'run' as const,reasons:['Fixture'],contextTokens:8192,estimatedRamBytes:100,estimatedVramBytes:0,confidence:'estimated' as const,execution:{numGpu:0}});
  const execute=vi.fn(async()=>{throw new Error('Evaluation must never execute tools');});
  engine=new Engine(store,gateway,{definitions:()=>[],decide:()=>({decision:'deny',reason:'No tools',risk:'read'}),execute,stopAll:async()=>{},changes:async()=>[]},{admit,watchMemory:signal=>({signal,stop:()=>{},error:()=>undefined})});await engine.initialize();
  const user=row<User>((await store.db.query("SELECT * FROM users WHERE id='owner'"))[0]);
  const created=await startModelEvaluation(store,engine,gateway,{user,remote:false,sessionId:'fixture'},{modelId:model.id},{admit,hardware:async()=>hardware});
  const end=Date.now()+8000;let task=await store.task(created.taskId);
  while(!['completed','paused','failed','cancelled'].includes(task.status)&&Date.now()<end){await new Promise(resolve=>setTimeout(resolve,10));task=await store.task(created.taskId);}
  expect(task.error).toBeNull();expect(task.status).toBe('completed');expect(task.callsUsed).toBe(9);expect(calls).toBe(9);expect(execute).not.toHaveBeenCalled();
  expect(task.result).toContain('0 passed, 9 failed');
  expect((await store.db.query('SELECT status FROM model_evaluations WHERE task_id=$1',[task.id]))[0].status).toBe('completed');
});
