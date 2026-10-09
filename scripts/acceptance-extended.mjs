// Actual-runtime acceptance; never imported by the application or deterministic tests.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function extendedAcceptance(api,model,workspace) {
  const calibration=await api('/models/calibrations',{modelId:model.id,contextTokens:4096});
  let calibrated;
  for(let attempt=0;attempt<150;attempt++){
    calibrated=await api(`/tasks/${calibration.taskId}`);
    if(['completed','paused','failed','cancelled','waiting_for_user'].includes(calibrated.task.status))break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert.equal(calibrated.task.status,'completed',`Calibration did not complete: ${calibrated.task.error}`);
  const sample=(await api('/models/calibrations')).find(item=>item.taskId===calibration.taskId);
  assert.ok(sample?.measurement?.outputTokens>0,'Actual runtime token counters are required for acceptance');
  assert.ok(sample.measurement.generationTokensPerSecond>0,'This Ollama acceptance expects actual generation timing');
  assert.equal(sample.modelId,model.id);
  const conversation=await api('/conversations',{title:'Real Git and HTTPS research acceptance'});
  const options={depth:'fast',modelId:model.id,modelSelection:'required',access:'read_only',workspaceId:workspace.id,contextTokens:8192,cloudPolicy:'local_only',network:{mode:'ask',allowedOrigins:['https://example.com']},budget:{maxCalls:8,maxSeconds:180,maxIterations:8,maxCostUsd:0,localOnly:true}};
  const created=await api(`/conversations/${conversation.id}/messages`,{content:'Perform three actual inspection tools: git_status with no arguments, git_diff for greeting.txt, and http_get for exactly https://example.com/ . Then briefly report which managed file changed and the observed HTTP status. Do not modify any files or claim tools that did not execute.',options});
  let detail;
  for(let attempt=0;attempt<200;attempt++){
    detail=await api(`/tasks/${created.task.id}`);
    for(const approval of detail.approvals.filter(item=>item.status==='pending'))await api(`/approvals/${approval.id}`,{decision:approval.tool==='http_get'&&approval.arguments.url==='https://example.com/'?'allow_once':'denied'});
    if(['completed','paused','failed','cancelled','waiting_for_user'].includes(detail.task.status))break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  const completed=detail.events.filter(event=>event.type==='TOOL_COMPLETED').map(event=>({tool:event.data.tool,output:JSON.parse(event.data.output)}));
  const report={testedAt:new Date().toISOString(),calibration:sample,taskId:created.task.id,conversationId:conversation.id,status:detail.task.status,error:detail.task.error,tools:completed.map(({tool,output})=>({tool,scope:output.scope,status:output.status,url:output.url,total:output.total,baseline:output.baseline,receivedBytes:output.receivedBytes,sha256:output.sha256})),passed:detail.task.status==='completed'&&['git_status','git_diff','http_get'].every(name=>completed.some(item=>item.tool===name))};
  await writeFile('output/extended-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  assert.ok(report.passed,'Extended acceptance requires real receipts for all three requested tools');
}
