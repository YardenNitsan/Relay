// Explicit acceptance against the running production host. No cloud requests.
import { pairLocalSession } from './local-session.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const base=process.env.RELAY_ACCEPTANCE_URL??'http://127.0.0.1:4317';
const {cookie,csrfToken,close}=await pairLocalSession(base);
try {
async function api(path,body,method=body===undefined?'GET':'POST'){
  const response=await fetch(`${base}/api${path}`,{method,headers:{cookie,'x-relay-csrf':csrfToken,...body===undefined?{}:{'content-type':'application/json'}},body:body===undefined?undefined:JSON.stringify(body)});
  const json=await response.json();if(!response.ok)throw new Error(`Host operation failed: ${json.code}`);return json;
}
const before=await api('/conversations');const issued=await api('/inference/tokens',{label:'Local inference acceptance',expiresInDays:1});
const inference='http://127.0.0.1:4315/v1';const headers={authorization:`Bearer ${issued.token}`,'content-type':'application/json'};
let report;
try{
  const models=await (await fetch(`${inference}/models`,{headers})).json();
  const model=models.data.find(item=>item.id==='ollama/qwen3:4b-instruct')??models.data[0];
  if(!model)throw new Error('No local model available for acceptance');
  const response=await fetch(`${inference}/responses`,{method:'POST',headers,body:JSON.stringify({model:model.id,input:'Reply with a brief friendly greeting. Do not use tools.',store:false,max_output_tokens:128}),signal:AbortSignal.timeout(310000)});
  const result=await response.json();const after=await api('/conversations');
  report={testedAt:new Date().toISOString(),passed:response.ok&&result.status==='completed'&&JSON.stringify(before)===JSON.stringify(after),status:response.status,model:model.id,conversationHistoryUnchanged:JSON.stringify(before)===JSON.stringify(after),error:result.error??null,usage:result.usage??null,outputReceived:Array.isArray(result.output)&&result.output.some(item=>item.type==='message'&&item.content?.some(part=>part.text?.trim()))};
}finally{await api(`/inference/tokens/${issued.id}`,undefined,'DELETE');}
await mkdir('output',{recursive:true});await writeFile('output/inference-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
} finally { await close(); }
