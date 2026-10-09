import type { Admission, AgentRole, ModelProfile, ProviderGateway, TaskRecord } from '../../shared/types.js';
import { AppError } from '../core/errors.js';
import { assessModel, getHardware } from '../hardware/index.js';
import type { User } from '../auth/policy.js';
import {taskCategory,taskFitEvidence} from '../models/task-fit.js';
import {object} from '../providers/transport.js';
export type Admit=(model:ModelProfile,contextTokens:number)=>Promise<Admission>;
export const hardwareAdmission:Admit=async(model,context)=>assessModel(model,await getHardware(),context);
// Diversity may trade at most one ready-model bonus, never override material suitability.
const MAX_REVIEW_SCORE_GAP=10;
function comparableSpeed(model:ModelProfile,admission:Admission,context:number):number {
  const performance=object(model.details.performance);
  if(Object.keys(performance).length&&(performance.contextTokens!==context||JSON.stringify(performance.execution??null)!==JSON.stringify(admission.execution??null)))return 0;
  return typeof model.tokensPerSecond==='number'&&Number.isFinite(model.tokensPerSecond)?Math.max(0,Math.min(model.tokensPerSecond,20)):0;
}
const codingHint=(model:ModelProfile)=>/(?:coder|codestral|starcoder)/i.test(`${model.id} ${model.name}`);
export async function selectModel(gateway:ProviderGateway,task:TaskRecord,user:User,role:AgentRole,admit:Admit,excluded:Set<string>):Promise<{model:ModelProfile;admission:Admission;reasons:string[]}> {
  const models=await gateway.listModels();
  const category=taskCategory(task,role);
  const localOnly=task.options.budget.localOnly||task.options.cloudPolicy==='local_only'||!task.options.cloudPolicy;
  const rejected:string[]=[];
  const candidates=models.filter(m=>!excluded.has(m.id)&&user.permissions.providers.includes(m.provider)&&m.state!=='offline'&&m.state!=='error'&&(!localOnly||m.local)&&(task.options.modelSelection!=='required'||m.id===task.options.modelId));
  const usable: {model:ModelProfile;admission:Admission;score:number;thinkingOnly:boolean}[]=[];
  // The personal worker receives personal_tasks even without a file workspace.
  const personalTools=role==='worker'&&task.options.assistantId==='personal';
  for(const model of candidates) {
    if((personalTools||task.options.access==='unrestricted'||task.options.workspaceId||task.options.network&&task.options.network.mode!=='deny'||task.options.mcpServerIds?.length)&&!model.capabilities.tools) {rejected.push(`${model.name}: tool calling is not available`);continue;}
    if(model.contextWindow!==null&&model.contextWindow<task.options.contextTokens) {rejected.push(`${model.name}: selected context is larger than model limit`);continue;}
    const admission=await admit(model,task.options.contextTokens);
    if(!admission.allowed) {rejected.push(`${model.name}: ${admission.reasons.join('; ')}`);continue;}
    const info=model.details.modelInfo as Record<string,unknown>|undefined;
    const thinkingOnly=typeof info?.['general.finetune']==='string'&&/thinking/i.test(info['general.finetune']);
    // Calls default to 2,048 output tokens. Mandatory-thinking variants
    // may spend that entire budget before an answer/tool proposal; prefer an eligible instruct model.
    const measured=taskFitEvidence(model,category);
    const evidenceScore=measured?(measured.passed/measured.total-.5)*60:0;
    const nameHint=category==='coding'&&codingHint(model)?8:0;
    const score=(model.id===task.options.modelId?1000:0)+evidenceScore+nameHint+(model.local?30:0)+(model.state==='ready'&&model.provider!=='lmstudio'?10:0)+(model.capabilities.tools?5:0)+comparableSpeed(model,admission,task.options.contextTokens)-(thinkingOnly?45:0)-(model.sizeBytes??0)/1e11;
    usable.push({model,admission,score,thinkingOnly});
  }
  usable.sort((a,b)=>b.score-a.score);
  const [best,alternative]=usable;
  // Independent review can use a comparable alternative, but must not introduce
  // mandatory thinking into a bounded call merely to select a different model.
  const diversify=!task.options.modelId&&role==='security_reviewer'&&best&&alternative&&best.score-alternative.score<=MAX_REVIEW_SCORE_GAP&&(!alternative.thinkingOnly||best.thinkingOnly);
  const selected=diversify?alternative:best;
  if(!selected) throw new AppError('NO_MODEL',`No currently available model can safely execute this request. ${rejected.slice(0,3).join('. ')||'Start a local runtime and install a compatible model, or explicitly allow a connected cloud provider.'}`,409);
  const evidence=taskFitEvidence(selected.model,category);
  return {...selected,reasons:[selected.model.local?'Local execution: context stays on this computer':'Cloud candidate; egress permission is checked separately',selected.model.id===task.options.modelId?'Your selected model':'Selected from currently discovered, authorized models',`Task category: ${category} (specialist/keyword heuristic; no classifier model call)`,evidence?`Fixed ${category} probes: ${evidence.passed}/${evidence.total} passed on this model artifact. A small probe is not a broad quality guarantee.`:'Task quality unmeasured; selection uses capabilities, availability and comparable measured speed where available.',...(category==='coding'&&codingHint(selected.model)?['Model name suggests coding specialization (weak heuristic, not benchmark evidence).']:[]),...(diversify?['Comparable alternative selected for independent security review']:[]),...selected.admission.reasons]};
}
