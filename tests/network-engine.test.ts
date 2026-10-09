import {afterEach,expect,it} from 'vitest';
import {openDatabase} from '../server/db/database.js';
import {Store} from '../server/db/store.js';
import {Engine} from '../server/orchestration/engine.js';
import {decide,definitions} from '../server/tools/policy.js';
import type {ModelChunk,ModelProfile,ModelRequest,TaskOptions,ToolRequest} from '../shared/types.js';

let store:Store;let engine:Engine;
afterEach(async()=>{await engine?.shutdown();await store?.close();});
const model:ModelProfile={id:'ollama/test',name:'test',provider:'ollama',runtime:'test',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32000,quantization:null,sizeBytes:100,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
async function until(check:()=>Promise<boolean>){const deadline=Date.now()+6000;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Timed out');}
async function setup(url:string){
  store=new Store(await openDatabase());await store.init();const conversation=await store.createConversation();const executed:ToolRequest[]=[];
  engine=new Engine(store,{listModels:async()=>[model],statuses:async()=>[],stream:async function*(request:ModelRequest):AsyncGenerator<ModelChunk>{
    expect(request.tools.map(tool=>tool.name)).toEqual(['http_get']);
    if(request.messages.some(message=>message.role==='tool'))yield {type:'text',text:'Research receipt reviewed.'};
    else {yield {type:'tool_call',call:{id:'request',name:'http_get',arguments:{url}}};yield {type:'continuation',providerData:{provider:'ollama',data:{private:url}}};}
    yield {type:'done',finishReason:'stop'};
  }},{definitions,decide:(context,request)=>decide(context,request,false),execute:async(context,request)=>{expect(context.network?.allowedOrigins).toEqual(['https://example.com']);executed.push(request);return {content:'Explicit fixture response',evidence:[{kind:'http_response',summary:'Fixture response',passed:true}]};},stopAll:async()=>{},changes:async()=>[]},{admit:async()=>({allowed:true,decision:'run',reasons:['Fixture'],estimatedRamBytes:100,estimatedVramBytes:0,contextTokens:8192,confidence:'estimated'})});
  const options:TaskOptions={depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:8192,network:{mode:'ask',allowedOrigins:['https://example.com']},budget:{maxCalls:3,maxSeconds:30,maxIterations:3,maxCostUsd:0,localOnly:true}};
  const {task}=await store.createTask(conversation.id,'Read the authorized web source',options);engine.enqueue(task.id);return {task,executed};
}
it('requires explicit network approval without a workspace and then records the actual tool receipt',async()=>{
  const {task,executed}=await setup('https://example.com/docs');await until(async()=>(await store.approvals(task.id)).length===1);expect(executed).toEqual([]);
  const approval=(await store.approvals(task.id))[0];await store.decideApproval(approval.id,'allow_once');engine.approvalChanged(approval.id);
  await until(async()=>(await store.task(task.id)).status==='completed');expect(executed).toHaveLength(1);expect((await store.verification(task.id)).some(check=>check.kind==='http_response'&&check.passed)).toBe(true);
});
it('redacts a credential-bearing proposal and opaque continuation before durable context or activity',async()=>{
  const credential='sensitive-example-never-log';const {task,executed}=await setup(`https://example.com/docs?token=${credential}`);
  await until(async()=>['paused','failed','completed','waiting_for_user'].includes((await store.task(task.id)).status));expect(executed).toEqual([]);expect(await store.approvals(task.id)).toEqual([]);
  const contexts=await store.db.query('SELECT context FROM task_steps WHERE task_id=$1',[task.id]);
  const durable=JSON.stringify([contexts,await store.taskEvents(task.id),await store.verification(task.id)]);expect(durable).not.toContain(credential);expect(durable).toContain('[redacted: blocked research URL]');
});
