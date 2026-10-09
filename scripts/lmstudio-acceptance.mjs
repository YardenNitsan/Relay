// Explicit opt-in real-runtime acceptance. Never runs in the ordinary test suite.
import {pairLocalSession} from './local-session.mjs';
import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:4317',session=await pairLocalSession(base);
async function api(path,body){const r=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{cookie:session.cookie,'x-relay-csrf':session.csrfToken,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw new Error(JSON.stringify(value));return value;}
try{
 const discovery=await api('/models?refreshLocal=1');const candidates=discovery.models.filter(m=>m.provider==='lmstudio').sort((a,b)=>a.sizeBytes-b.sizeBytes);
 if(!candidates.length)throw new Error('LM Studio has no reachable downloaded chat models. Check its background service first.');
 let model,admission;
 for(const candidate of candidates){const result=await api('/models/assess',{modelId:candidate.id,contextTokens:4096});console.log(JSON.stringify({model:candidate.id,allowed:result.allowed,execution:result.execution}));if(result.allowed){model=candidate;admission=result;break;}}
 if(!model)throw new Error('No LM Studio model safely fits current host pressure');
 const conversation=await api('/conversations',{title:'LM Studio generation acceptance'});
 const created=await api(`/conversations/${conversation.id}/messages`,{content:'Hello! Reply with one short friendly greeting. Do not use tools.',options:{depth:'fast',modelId:model.id,modelSelection:'required',access:'read_only',workspaceId:null,contextTokens:4096,cloudPolicy:'local_only',budget:{maxCalls:2,maxSeconds:180,maxIterations:2,maxCostUsd:0,localOnly:true}}});
 console.log(JSON.stringify({taskId:created.task.id,model:model.id}));let detail;
 for(let i=0;i<200;i++){detail=await api('/tasks/'+created.task.id);if(['completed','failed','cancelled','paused','waiting_for_user'].includes(detail.task.status))break;await new Promise(r=>setTimeout(r,1000));}
 const saved=await api('/conversations/'+conversation.id);
 const inventory=await fetch('http://127.0.0.1:1234/api/v1/models').then(r=>r.json());
 const remainingRelayInstances=inventory.models.flatMap(m=>m.loaded_instances??[]).filter(i=>i.id?.startsWith('relay-'));
 const report={testedAt:new Date().toISOString(),passed:detail.task.status==='completed'&&saved.messages.some(m=>m.role==='assistant'&&m.content?.trim())&&remainingRelayInstances.length===0,model:model.id,taskId:created.task.id,conversationId:conversation.id,admission,status:detail.task.status,error:detail.task.error,result:detail.task.result,modelEvents:detail.events.filter(e=>/MODEL_SELECTED|MODEL_CALL/.test(e.type)).map(e=>({type:e.type,data:e.data})),remainingRelayInstances};
 await writeFile('output/lmstudio-generation-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}finally{await session.close();}
