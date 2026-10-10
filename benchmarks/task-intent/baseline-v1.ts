/** Explainable multi-label hints, not measured intelligence or semantic classification. */
export function taskDemand(objective:string) {
  const rules:Record<string,RegExp>={
    debugging:/\b(debug|bug|fix|diagnose)\b/i,
    coding:/\b(code|coding|implement|typescript|javascript|python|function)\b/i,
    repository_architecture:/\b(repository|architecture|codebase)\b/i,
    multi_file_implementation:/\b(multi[- ]file|multiple files|across.*files)\b/i,
    structured_extraction:/\b(extract|json|schema)\b/i,
    document_analysis:/\b(document|pdf|report|contract)\b/i,
    research_synthesis:/\b(research|sources|synthesize|compare)\b/i,
    tool_driven:/\b(run|execute|search|browse|download|write.*file)\b/i,
    planning_delegation:/\b(plan|delegate|schedule|workflow)\b/i,
    review_verification:/\b(review|verify|verification|test|tests|security)\b/i,
    mathematics:/\b(calculate|equation|algebra|theorem|derive|proof)\b/i,
    complex_reasoning:/\b(prove|theorem|derive|multi[- ]step|algorithm|tradeoffs)\b/i,
    multimodal:/\b(image|picture|screenshot|audio|video)\b/i,
    factual_explanation:/\b(explain|what is|define|definition)\b/i,
  };
  const categories=Object.entries(rules).filter(([,pattern])=>pattern.test(objective)).map(([category])=>category);
  if(!categories.length)categories.push('conversation');
  const complex=categories.some(category=>['debugging','multi_file_implementation','complex_reasoning','repository_architecture'].includes(category));
  const complexity: 'simple'|'standard'|'complex'=complex?'complex':objective.length<220&&categories.every(category=>['conversation','factual_explanation'].includes(category))?'simple':'standard';
  return {categories,complexity,method:'keyword-v1' as const};
}
