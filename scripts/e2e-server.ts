// Deterministic browser test service. Not imported by or reachable from production.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/api/app.js';
import { openDatabase } from '../server/db/database.js';
import { Store } from '../server/db/store.js';
import { Engine } from '../server/orchestration/engine.js';
import { Providers } from '../server/providers/index.js';
import { SecretManager } from '../server/providers/secrets.js';
import { ToolBroker } from '../server/tools/index.js';
import type { ModelChunk, ModelProfile, ModelRequest, ProviderStatus } from '../shared/types.js';
const fixture:ModelProfile={id:'ollama/e2e-fixture',name:'Deterministic test model',provider:'ollama',runtime:'test fixture',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32000,quantization:null,sizeBytes:null,state:'available',details:{testFixture:true},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
class TestProviders extends Providers {
  constructor(){super({secrets:new SecretManager({env:{}})});}
  override async listModels(){return [fixture];}
  override async statuses():Promise<ProviderStatus[]>{return [{id:'ollama',name:'Deterministic test runtime',configured:true,connected:true,error:null,state:'ready'}];}
  override async *stream(request:ModelRequest):AsyncGenerator<ModelChunk> {
    const tools=request.messages.filter(m=>m.role==='tool');
    const objective=request.messages.findLast(m=>m.role==='user')?.content??'';
    if(request.messages[0].content.includes("Relay's reviewer"))yield {type:'text',text:'The recorded result matches the request. REVIEW: PASS'};
    else if(request.tools.length&&objective.includes('Create')&&!tools.length)yield {type:'tool_call',call:{id:'write-fixture',name:'file_write',arguments:{path:'notes.txt',content:'Verified fixture content\n',expectedHash:null}}};
    else {
      const text=tools.length?'Created notes.txt and verified the stored content.':'A deterministic response for browser testing.\n\nThe conversation, task, and execution record are persisted by the real local service.\n\n```typescript\nconst result = await verify(objective);\n```';
      for(const word of text.split(' ')){request.signal.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,objective.includes('slow')?600:20));yield {type:'text',text:word+' '};}
    }
    yield {type:'usage',inputTokens:120,outputTokens:60};yield {type:'done',finishReason:'stop'};
  }
}
const dir=await mkdtemp(join(tmpdir(),'relay-e2e-'));const store=new Store(await openDatabase());await store.init();const providers=new TestProviders();
let engine:Engine;const broker=new ToolBroker(dir,()=>engine?.isStopped()??false);
engine=new Engine(store,providers,broker,{admit:async()=>({allowed:true,decision:'run',reasons:['Explicit automated test fixture'],estimatedRamBytes:null,estimatedVramBytes:null,contextTokens:8192,confidence:'unknown'})});
const app=await createApp({store,providers,broker,engine},{port:4319});await app.listen({host:'127.0.0.1',port:4319});
async function close(){await engine.shutdown();await app.close();await store.close();await rm(dir,{recursive:true,force:true});process.exit(0);}process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
