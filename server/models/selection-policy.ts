import type {AutoModelPolicy} from '../../shared/types.js';

interface RankedCandidate {score:number;qualityScore:number|null;cost:number|null}
// Existing evidence scores are shrunk sample-ranking contributions, not success
// probabilities. Unknown is neutral; failed measured probes can rank below it.
const evidence=(candidate:RankedCandidate)=>candidate.qualityScore??0;
export const economyQualityBand=10;
/** Same four-case prior for legacy and versioned evidence contributions. */
export function qualityRankingScore(passed:number,total:number):number{return (passed-total/2)/(total+4)*80;}

/** Rank only candidates already admitted by deterministic eligibility gates. */
export function rankCandidates<T extends RankedCandidate>(candidates:T[],policy:AutoModelPolicy):T[]{
  if(policy==='quality')return [...candidates].sort((a,b)=>evidence(b)-evidence(a)||b.score-a.score);
  if(policy==='economy'){
    if(!candidates.length)return [];
    const strongest=Math.max(...candidates.map(evidence));
    return candidates.filter(candidate=>candidate.cost!==null&&evidence(candidate)>=strongest-economyQualityBand)
      .sort((a,b)=>a.cost!-b.cost!||b.score-a.score);
  }
  return [...candidates].sort((a,b)=>b.score-a.score);
}

export function policyExplanation(policy:AutoModelPolicy,measured:boolean):string{
  const uncertainty=measured?'Relevant measured evidence contributes to ranking; small samples remain uncertain.':'Relevant task quality is unmeasured; this is a conservative fallback, not verified task competence.';
  if(policy==='quality')return `Auto Quality: prioritize compatible measured task evidence, then capability, readiness and cost. ${uncertainty}`;
  if(policy==='economy')return `Auto Economy: lowest known conservative cloud-call estimate within ${economyQualityBand} quality-ranking points of the strongest eligible candidate. Local execution has no cloud model charge; hardware and electricity are not priced. ${uncertainty}`;
  return `Auto Balanced: consider task evidence, capability, privacy, readiness, speed and cost. ${uncertainty}`;
}
