import type { Admission, AgentRole, ModelProfile, ProviderGateway, TaskRecord } from '../../shared/types.js';
import { AppError } from '../core/errors.js';
import { assessModel, getHardware } from '../hardware/index.js';
import type { User } from '../auth/policy.js';
import {taskCategory,taskFitEvidence} from '../models/task-fit.js';
import {object} from '../providers/transport.js';
import {taskDemand} from '../models/task-demand.js';
import {callBudget} from './token-policy.js';
import {rankCandidates,policyExplanation,qualityRankingScore} from '../models/selection-policy.js';
import {resolveTaskReasoning} from './reasoning.js';
import type {ReasoningEffort} from '../../shared/model-controls.js';
import {relevantEvaluation,type EvaluationLookup} from '../models/evaluation-routing.js';
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
export async function selectModel(gateway:ProviderGateway,task:TaskRecord,user:User,role:AgentRole,admit:Admit,excluded:Set<string>,evaluations?:EvaluationLookup):Promise<{model:ModelProfile;admission:Admission;reasons:string[];reasoning?:ReasoningEffort}> {
  const models=await gateway.listModels();
  const autoPolicy=task.options.modelId?'balanced':task.options.autoPolicy??'balanced';
  const category=taskCategory(task,role);
  const demand=taskDemand(task.objective);
  const localOnly=task.options.budget.localOnly||task.options.cloudPolicy==='local_only'||!task.options.cloudPolicy;
  const rejected:string[]=[];
  const candidates=models.filter(m=>!excluded.has(m.id)&&user.permissions.providers.includes(m.provider)&&m.state!=='offline'&&m.state!=='error'&&(!localOnly||m.local)&&(task.options.modelSelection!=='required'||m.id===task.options.modelId));
  const usable: {model:ModelProfile;admission:Admission;score:number;qualityScore:number|null;thinkingOnly:boolean;reasoning?:ReasoningEffort;reasoningReason:string;cost:number|null;qualityReason?:string}[]=[];
  // The personal worker receives personal_tasks even without a file workspace.
  const personalTools=role==='worker'&&task.options.assistantId==='personal';
  const workspaceTools=role==='worker'&&((task.options.googleWorkspace?.mail===true&&(!task.options.assistantId||task.options.assistantId==='email'))||(task.options.googleWorkspace?.calendar===true&&(!task.options.assistantId||task.options.assistantId==='calendar')));
  for(const model of candidates) {
    if((personalTools||workspaceTools||task.options.access==='unrestricted'||task.options.workspaceId||task.options.network&&task.options.network.mode!=='deny'||task.options.mcpServerIds?.length)&&!model.capabilities.tools) {rejected.push(`${model.name}: tool calling is not available`);continue;}
    if(model.contextWindow!==null&&model.contextWindow<task.options.contextTokens) {rejected.push(`${model.name}: selected context is larger than model limit`);continue;}
    const policy=callBudget(task.options,model);
    let reasoning:ReturnType<typeof resolveTaskReasoning>;
    try{reasoning=resolveTaskReasoning(model,task,role,policy.maxOutputTokens,demand);}catch(error){rejected.push(`${model.name}: ${error instanceof Error?error.message:'Unsupported reasoning'}`);continue;}
    const prices=[model.inputPricePerMillion,model.outputPricePerMillion];
    const known=prices.every(price=>typeof price==='number'&&Number.isFinite(price)&&price>=0);
    const cost=model.local?0:known?(policy.inputReservationTokens*model.inputPricePerMillion!+policy.maxOutputTokens*model.outputPricePerMillion!)/1e6:null;
    const cap=task.options.budget.maxCostUsd;
    if(autoPolicy==='economy'&&!model.local&&cost===null){rejected.push(`${model.name}: Auto Economy requires verified cloud pricing`);continue;}
    if(!model.local&&cost===null&&(cap!==null||user.role!=='owner'&&!user.permissions.allowUnpricedCloud)){rejected.push(`${model.name}: verified pricing is unavailable for the financial budget`);continue;}
    if(!model.local&&cost!==null&&cap!==null&&cost>cap){rejected.push(`${model.name}: estimated call cost exceeds the task budget`);continue;}
    const admission=await admit(model,task.options.contextTokens);
    if(!admission.allowed) {rejected.push(`${model.name}: ${admission.reasons.join('; ')}`);continue;}
    const info=model.details.modelInfo as Record<string,unknown>|undefined;
    const thinkingOnly=typeof info?.['general.finetune']==='string'&&/thinking/i.test(info['general.finetune']);
    // Calls default to 2,048 output tokens. Mandatory-thinking variants
    // may spend that entire budget before an answer/tool proposal; prefer an eligible instruct model.
    const measured=taskFitEvidence(model,category);
    const quality=relevantEvaluation(evaluations?await evaluations(model,admission):null,demand.categories);
    const evidenceScore=quality?.score??(measured?(measured.passed/measured.total-.5)*60:0);
    const nameHint=category==='coding'&&codingHint(model)?8:0;
    const score=(model.id===task.options.modelId?1000:0)+evidenceScore+nameHint+(model.local?(demand.complexity==='complex'?10:30):0)+(demand.complexity==='complex'&&model.capabilities.reasoning?25:0)-(model.local?0:cost===null?45:Math.min(40,Math.log10(1+cost*1000)*10))+(model.state==='ready'&&model.provider!=='lmstudio'?10:0)+(model.capabilities.tools?5:0)+comparableSpeed(model,admission,task.options.contextTokens)-(thinkingOnly?45:0)-(model.sizeBytes??0)/1e11;
    usable.push({model,admission,score,qualityScore:quality?.score??(measured?qualityRankingScore(measured.passed,measured.total):null),thinkingOnly,reasoning:reasoning.effort,reasoningReason:reasoning.reason,cost,qualityReason:quality?.reason});
  }
  const [best,alternative]=rankCandidates(usable,autoPolicy);
  // Independent review can use a comparable alternative, but must not introduce
  // mandatory thinking into a bounded call merely to select a different model.
  const diversify=autoPolicy==='balanced'&&!task.options.modelId&&role==='security_reviewer'&&best&&alternative&&best.score-alternative.score<=MAX_REVIEW_SCORE_GAP&&(!alternative.thinkingOnly||best.thinkingOnly);
  const selected=diversify?alternative:best;
  if(!selected) throw new AppError('NO_MODEL',`${task.options.modelSelection==='required'&&task.options.modelId?`The required model ${task.options.modelId} is unavailable or ineligible. No substitute was selected.`:'No currently available model can safely execute this request.'} ${rejected.slice(0,3).join('. ')||'Check model availability and the current task policy.'}`,409);
  const evidence=taskFitEvidence(selected.model,category);
  return {...selected,reasons:[task.options.modelId?'Explicit model preference; Auto policy is inactive':policyExplanation(autoPolicy,selected.qualityScore!==null),selected.model.local?'Local execution: context stays on this computer':'Cloud candidate; egress permission is checked separately',selected.model.id===task.options.modelId?'Your selected model':'Selected from currently discovered, authorized models',`Task requirements: ${demand.categories.join(', ')}; ${demand.complexity} (bilingual phrase heuristic; no classifier model call)`,selected.reasoningReason,selected.model.local?'No cloud model charge':selected.cost===null?'Cloud price unknown; explicitly uncapped account policy required':`Conservative call cost estimate: $${selected.cost.toFixed(6)}; remaining task/account budget is checked again before dispatch`,selected.qualityReason??(evidence?`Fixed ${category} probes: ${evidence.passed}/${evidence.total} passed on this model artifact/runtime. These legacy probes do not match hardware, context or output configuration. A small probe is not a broad quality guarantee.`:'Task quality unmeasured; selection uses capabilities, availability and comparable measured speed where available.'),...(category==='coding'&&codingHint(selected.model)?['Model name suggests coding specialization (weak heuristic, not benchmark evidence).']:[]),...(diversify?['Comparable alternative selected for independent security review']:[]),...selected.admission.reasons]};
}
