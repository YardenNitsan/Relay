// Explicit real-runtime acceptance. Never used by the application or ordinary tests.
import { mkdir, writeFile } from 'node:fs/promises';
import { pairLocalSession } from './local-session.mjs';
import { createHash } from 'node:crypto';
const base=process.env.RELAY_ACCEPTANCE_URL??'http://127.0.0.1:4317';
const {cookie,csrfToken}=await pairLocalSession(base);
async function api(path,body) {
  const response=await fetch(`${base}/api${path}`,{method:body===undefined?'GET':'POST',headers:{cookie,...(body===undefined?{}:{'content-type':'application/json','x-relay-csrf':csrfToken})},body:body===undefined?undefined:JSON.stringify(body)});
  const json=await response.json();if(!response.ok)throw new Error(`${path}: ${json.error}`);return json;
}
const discovery=await api('/models');
const model=discovery.models.find(model=>model.id==='ollama/qwen3:4b-instruct');
if(!model)throw new Error('Install the explicit acceptance model qwen3:4b-instruct first');
const fit=await api('/models/assess',{modelId:model.id,contextTokens:8192});
console.log(JSON.stringify({step:'hardware_admission',...fit}));
if(!fit.allowed)throw new Error('Acceptance model does not safely fit current hardware');
const workspace=await api('/workspaces',{name:'Relay acceptance workspace'});
const conversation=await api('/conversations',{title:'Local execution acceptance'});
const options={depth:'fast',modelId:model.id,access:'supervised',workspaceId:workspace.id,contextTokens:8192,cloudPolicy:'local_only',verification:{requiredReads:[{path:'greeting.txt',expectedSha256:createHash('sha256').update('Hello from Relay\n').digest('hex')}]},budget:{maxCalls:8,maxSeconds:240,maxIterations:8,maxCostUsd:0,localOnly:true}};
const created=await api(`/conversations/${conversation.id}/messages`,{content:'Create a new file named greeting.txt containing exactly Hello from Relay followed by one newline. Use file_write with expectedHash null, then file_read to check the actual file. Report the verified result. This is an isolated acceptance workspace; do not create or modify any other file.',options});
const started=Date.now();let detail;
for(let count=0;count<300;count++) {
  detail=await api(`/tasks/${created.task.id}`);
  for(const approval of detail.approvals.filter(a=>a.status==='pending')) {
    const permitted=approval.tool==='file_write'&&approval.arguments.path==='greeting.txt'&&approval.arguments.content==='Hello from Relay\n'&&approval.arguments.expectedHash===null;
    await api(`/approvals/${approval.id}`,{decision:permitted?'allow_once':'denied'});
    console.log(JSON.stringify({step:'approval',tool:approval.tool,decision:permitted?'allow_once':'denied'}));
  }
  if(['completed','failed','cancelled','paused','waiting_for_user'].includes(detail.task.status))break;
  await new Promise(resolve=>setTimeout(resolve,1000));
}
const saved=await api(`/conversations/${conversation.id}`);
const changed=detail.changes.find(change=>change.path==='greeting.txt');
const passed=detail.task.status==='completed'&&changed?.after==='Hello from Relay\n'&&saved.messages.some(message=>message.role==='assistant')&&detail.events.some(event=>event.type==='TOOL_COMPLETED'&&event.data.tool==='file_read');
const report={testedAt:new Date().toISOString(),passed,elapsedMs:Date.now()-started,model:model.id,conversationId:conversation.id,taskId:created.task.id,workspaceId:workspace.id,admission:fit,status:detail.task.status,error:detail.task.error,callsUsed:detail.task.callsUsed,verification:detail.verification,approvals:detail.approvals.map(a=>({tool:a.tool,status:a.status})),changedFiles:detail.changes.map(c=>({path:c.path,content:c.after})),result:detail.task.result};
await mkdir('output',{recursive:true});await writeFile('output/local-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(!passed)process.exitCode=1;
