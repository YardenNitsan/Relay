import type {Admission,ModelProfile,TaskRecord} from '../../shared/types.js';
import type {User} from '../auth/policy.js';
import type {Store} from '../db/store.js';
import {getHardware} from '../hardware/index.js';
import {callBudget} from '../orchestration/token-policy.js';
import {EvaluationStore} from './evaluation-store.js';
import {compatibleEvaluationIdentity,localEvaluationIdentity,type EvaluationCategory} from './evaluation.js';
import {qualityRankingScore} from './selection-policy.js';

export interface RoutingEvidence {categories:Partial<Record<EvaluationCategory,{passed:number;total:number}>>;measuredAt:string;}
export type EvaluationLookup=(model:ModelProfile,admission:Admission)=>Promise<RoutingEvidence|null>;
/** Load account-scoped evidence lazily, only after hard model eligibility. */
export function evaluationLookup(store:Store,user:User,task:TaskRecord):EvaluationLookup{
  const repository=new EvaluationStore(store);
  let history:ReturnType<EvaluationStore['history']>|undefined,hardware:ReturnType<typeof getHardware>|undefined;
  return async(model,admission)=>{
    if(!model.local)return null;
    // Current suites use runtime-default reasoning. An explicit effort changes
    // the generation configuration and cannot inherit those measurements.
    if(task.options.reasoning&&!['auto','default'].includes(task.options.reasoning))return null;
    const saved=await (history??=repository.history({userId:user.id,sessionVersion:user.sessionVersion},40));
    const candidates=saved.filter(record=>record.identity.modelId===model.id&&record.result);
    if(!candidates.length)return null;
    const snapshot=await (hardware??=getHardware());
    let identity;
    try{identity=localEvaluationIdentity(model,snapshot,task.options.contextTokens,callBudget(task.options,model).maxOutputTokens,admission.execution);}catch{return null;}
    // Automatic offload is a requested policy, not a measured configuration.
    // Keep the report inspectable, but do not transfer its score across loads
    // whose actual placement cannot be shown to match.
    if(identity.gpuOffload==='runtime-auto')return null;
    return candidates.find(record=>compatibleEvaluationIdentity(record.identity,identity))?.result??null;
  };
}

export function relevantEvaluation(evidence:RoutingEvidence|null,categories:string[]):{score:number;reason:string}|null{
  if(!evidence)return null;
  const selected=new Set<EvaluationCategory>(['instructions']);
  const mappings:Record<string,EvaluationCategory[]>={debugging:['debugging','reasoning'],coding:['debugging','structured'],repository_architecture:['context','reasoning'],multi_file_implementation:['context','debugging','recovery'],structured_extraction:['structured','extraction'],document_analysis:['extraction','context'],research_synthesis:['extraction','context'],tool_driven:['tools','recovery'],planning_delegation:['reasoning'],review_verification:['debugging','reasoning'],mathematics:['reasoning'],complex_reasoning:['reasoning']};
  for(const category of categories)for(const mapped of mappings[category]??[])selected.add(mapped);
  let passed=0,total=0;
  for(const category of selected){const result=evidence.categories[category];if(result){passed+=result.passed;total+=result.total;}}
  if(!total)return null;
  // A symmetric four-case prior shrinks small samples toward unknown (zero).
  // This is a ranking contribution, never a probability of real task success.
  return {score:qualityRankingScore(passed,total),reason:`Versioned capability cases relevant to this task: ${passed}/${total} passed (${evidence.measuredAt}); exact artifact/runtime/hardware/context/output match. Small synthetic sample; uncertainty remains high.`};
}
