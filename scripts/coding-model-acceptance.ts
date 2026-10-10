import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createApp} from '../server/api/app.js';
import {LocalPairing} from '../server/auth/pairing.js';
import {openDatabase} from '../server/db/database.js';
import {Store} from '../server/db/store.js';
import {getResourcePolicy} from '../server/hardware/config.js';
import {getHardware} from '../server/hardware/index.js';
import {watchLocalMemory} from '../server/hardware/watchdog.js';
import {privateDirectory} from '../server/host/private-storage.js';
import {MeasuredProviders} from '../server/models/measured-providers.js';
import {Engine} from '../server/orchestration/engine.js';
import {SecretManager} from '../server/providers/secrets.js';
import {ToolBroker} from '../server/tools/index.js';
import {copySnapshot,snapshot} from '../server/tools/files.js';
import {ToolStore} from '../server/tools/store.js';
import type {ModelProfile,ProviderId,TaskDetail,Workspace} from '../shared/types.js';
import type {Publication} from '../shared/publication.js';
import {independentlyGradeTree,targetPaths,visibleTestPath} from './coding-fixture.js';

const testArgv=['node','--test','--test-reporter=tap',visibleTestPath];
export async function codingModelAcceptance(root:string,seeded:Map<string,string>,modelId:string|null,verify:(files:Map<string,string>,label:string)=>Promise<unknown>,contextTokens=16384):Promise<Record<string,unknown>>{
  const data=join(root,'host');
  let store:Store|undefined,engine:Engine|undefined,app:Awaited<ReturnType<typeof createApp>>|undefined;
  const port=4323,origin=`http://127.0.0.1:${port}`;
  let cookie='',csrf='',taskId:string|undefined;
  const report:Record<string,unknown>={state:'starting',cloud:'disabled',secrets:'No inherited environment/vault credentials',contextTokens,approvals:[]};
  async function api<T>(path:string,body?:unknown):Promise<T>{
    const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie,'x-relay-csrf':csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90_000)});
    if(path==='/api/session/pair'&&response.ok)cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    if(!response.ok){const error=await response.json() as {error?:{message?:string}|string};throw new Error(`Acceptance API ${path}: HTTP ${response.status}: ${JSON.stringify(error)}`);}
    return response.json() as Promise<T>;
  }
  try{
    await privateDirectory(data);store=new Store(await openDatabase(join(data,'postgres')));await store.init();
    const activeStore=store;
    const providers=new MeasuredProviders(store,{secrets:new SecretManager({env:{},keyring:null}),resourcePolicy:()=>getResourcePolicy(activeStore)});
    for(const id of ['openai','anthropic','gemini','xai','deepseek'] as ProviderId[])providers.setEnabled(id,false);
    const broker=new ToolBroker(data,()=>engine?.isStopped()??true,undefined,store);
    engine=new Engine(store,providers,broker,{admit:(model,context)=>providers.admitModel(model,context),watchMemory:(signal,execution)=>watchLocalMemory(signal,async()=>({hardware:await getHardware(),policy:await getResourcePolicy(activeStore)}),execution)});
    await engine.initialize();
    const pairing=new LocalPairing(data);await pairing.initialize();
    app=await createApp({store,providers,broker,engine,pairing},{port,logging:false});
    await app.listen({host:'127.0.0.1',port});
    const code=await pairing.issue();csrf=(await api<{csrfToken:string}>('/api/session/pair',{token:code.token})).csrfToken;
    const discovered=await api<{models:ModelProfile[]}>('/api/models?refreshLocal=1');
    report.models=discovered.models.map(({id,name,state,local,capabilities,contextWindow})=>({id,name,state,local,capabilities,contextWindow}));
    report.resourcePolicy=await getResourcePolicy(store);
    if(!modelId){report.state='discovery_only';return report;}
    const model=discovered.models.find(item=>item.id===modelId);
    assert.ok(model?.local,'Explicit model must be installed and local');assert.ok(model.capabilities.tools,'Model must support tools');
    report.selectedModel={id:model.id,provider:model.provider,name:model.name};
    const admission=await providers.admitModel(model,contextTokens);report.admission=admission;
    if(!admission.allowed){report.state='blocked_admission';return report;}
    // An owned sibling can exercise publication without weakening installation
    // path protections. It contains only the public fixed-commit fixture.
    const source=await mkdtemp(join(resolve('..'),'relay-coding-acceptance-'));await privateDirectory(source);
    await copySnapshot(source,seeded,()=>{});report.sourcePath=source;
    const workspace=await api<Workspace>('/api/workspaces',{name:'Versioned Relay two-file repair',sourcePath:source});
    assert.equal(workspace.fileCount,seeded.size);report.workspaceId=workspace.id;
    const objective=`Repair two failing behaviors in this versioned Relay application source fixture. Overall deadlines are wrong and activity from another task can appear in the selected task. Inspect shared/task-deadline.ts, web/task-progress.ts and ${visibleTestPath}. Run the visible tests in the isolated node profile, correct both source files, rerun tests and review git_diff. Only modify shared/task-deadline.ts and web/task-progress.ts. Do not modify tests or other files, install packages, use network, or publish. The exact authorized terminal argv is ${JSON.stringify(testArgv)}, profile node, timeoutSeconds 30. Use file_read and its returned hash before file_write. Preserve all other behavior. Finish with a short explanation of the actual changes and actual test outcome. This task runs in a managed fixture, not the live Relay repository.`;
    const created=await api<{task:{id:string}}>('/api/conversations/start',{requestId:randomUUID(),content:objective,options:{assistantId:'coding',depth:'fast',modelId,modelSelection:'required',access:'supervised',workspaceId:workspace.id,contextTokens,cloudPolicy:'local_only',budget:{maxCalls:24,maxSeconds:1200,maxElapsedSeconds:1500,maxIterations:16,maxCostUsd:0,localOnly:true,maxOutputTokens:4096}}});
    taskId=created.task.id;report.taskId=taskId;report.state='running';
    const started=Date.now(),decided=new Set<string>();let detail:TaskDetail;
    do{
      detail=await api<TaskDetail>(`/api/tasks/${taskId}`);
      for(const approval of detail.approvals){
        if(approval.status!=='pending'||decided.has(approval.id))continue;
        const allowed=approval.tool==='file_write'&&(targetPaths as readonly string[]).includes(String(approval.arguments.path))||approval.tool==='terminal'&&JSON.stringify(approval.arguments.argv)===JSON.stringify(testArgv)&&approval.arguments.profile==='node'&&(approval.arguments.timeoutSeconds===undefined||approval.arguments.timeoutSeconds===30);
        const decision=allowed?'allow_once':'denied';await api(`/api/approvals/${approval.id}`,{decision});decided.add(approval.id);
        (report.approvals as unknown[]).push({id:approval.id,tool:approval.tool,decision,arguments:approval.arguments});
      }
      await writeFile(join(root,'model-live.json'),JSON.stringify({...report,task:detail.task,elapsedMs:Date.now()-started},null,2)+'\n');
      if(['completed','failed','paused','cancelled','waiting_for_user'].includes(detail.task.status))break;
      if(Date.now()-started>1250_000){await api(`/api/tasks/${taskId}/cancel`,{});throw new Error('Acceptance overall wait elapsed');}
      await delay(1500);
    }while(true);
    report.durationMs=Date.now()-started;report.detail=detail;
    report.toolReceipts=await store.db.query('SELECT id,name,arguments,status,result,started_at,finished_at FROM tool_calls WHERE task_id=$1 ORDER BY started_at',[taskId]);
    if(detail.task.status!=='completed'){report.state=`task_${detail.task.status}`;return report;}
    const after=await snapshot(await new ToolStore(data).workspaceRoot(workspace.id),true);
    independentlyGradeTree(seeded,after);
    const receipts=report.toolReceipts as {name:string;arguments:Record<string,unknown>;status:string;result:string}[];
    assert.ok(receipts.some(item=>item.name==='terminal'&&item.status==='completed'&&JSON.stringify(item.arguments.argv)===JSON.stringify(testArgv)&&JSON.parse(item.result).exitCode===0),'A real successful test tool receipt is required');
    report.independent=await verify(after,'independent-model');
    const review=await api<Publication>(`/api/workspaces/${workspace.id}/publications/preview`,{});
    assert.deepEqual(review.entries.map(entry=>entry.path).sort(),[...targetPaths].sort());
    for(const entry of review.entries){assert.equal(entry.before,seeded.get(entry.path));assert.equal(entry.after,after.get(entry.path));}
    const published=await api<Publication>(`/api/publications/${review.id}/apply`,{digest:review.digest,confirmed:true});assert.equal(published.status,'completed');
    const sourceAfter=await snapshot(source,true);assert.deepEqual(sourceAfter,after);
    report.publishedIndependent=await verify(sourceAfter,'independent-published');
    const rollback=await api<Publication>(`/api/publications/${review.id}/rollback-preview`,{});
    const restored=await api<Publication>(`/api/publications/${rollback.id}/apply`,{digest:rollback.digest,confirmed:true});assert.equal(restored.status,'completed');assert.deepEqual(await snapshot(source,true),seeded);
    report.publication={id:review.id,rollbackId:rollback.id,restored:true};report.state='passed';
    return report;
  }catch(error){report.state='failed';report.error=error instanceof Error?error.message:String(error);return report;}
  finally{
    if(taskId)await api(`/api/tasks/${taskId}/cancel`,{}).catch(()=>{});
    if(cookie)await api('/api/session/logout',{}).catch(()=>{});
    // Do not lose execution evidence if a cleanup step fails. Shutdown failure
    // retains the database for recovery; never close it beneath running work.
    let stopped=!engine;
    try{await engine?.shutdown();stopped=true;}catch(error){report.shutdownError=String(error);report.state='cleanup_failed';}
    try{await app?.close();}catch(error){report.listenerCloseError=String(error);report.state='cleanup_failed';}
    if(stopped)try{await store?.close();}catch(error){report.databaseCloseError=String(error);report.state='cleanup_failed';}
    await writeFile(join(root,'model-report.json'),JSON.stringify(report,null,2)+'\n');
  }
}

