import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cpus,platform,arch} from 'node:os';
import {performance} from 'node:perf_hooks';
import {z} from 'zod';
import {taskDemand as baseline} from '../benchmarks/task-intent/baseline-v1.js';
import {labels,phraseDemand,prototypeClassifier,type Demand,type IntentCase} from '../benchmarks/task-intent/candidates.js';

const root='benchmarks/task-intent';
const item=z.object({id:z.string(),language:z.enum(['en','he']),objective:z.string().min(1).max(16_384),required:z.array(z.enum(labels)),forbidden:z.array(z.enum(labels))}).strict();
const corpus=z.object({version:z.string(),provenance:z.string(),cases:z.array(item).min(1)}).strict();
const read=async(path:string)=>corpus.parse(JSON.parse(await readFile(path,'utf8')));
// Git text checkout policy must not invalidate evidence between Windows and Unix.
const digest=async(path:string)=>createHash('sha256').update((await readFile(path,'utf8')).replace(/\r\n/g,'\n')).digest('hex');
const paths=['candidates.ts','baseline-v1.ts','development-v1.json','heldout-v1.json'];
const hashes=Object.fromEntries(await Promise.all(paths.map(async path=>[path,await digest(`${root}/${path}`)])));
const evaluatorHash=await digest('scripts/benchmark-task-intent.ts');
const gateSchema=z.object({minimumCaseGainPercentagePoints:z.number().min(0).max(100),maximumExtraForbiddenLabels:z.number().int().min(0),maximumP95Milliseconds:z.number().positive()}).strict();
const gatesBeforeReview={minimumCaseGainPercentagePoints:10,maximumExtraForbiddenLabels:0,maximumP95Milliseconds:2};
let gate=gateSchema.parse(gatesBeforeReview);
const development=await read(`${root}/development-v1.json`);
const mode=process.argv[2];
if(!['--development','--freeze','--heldout'].includes(mode??''))throw new Error('Use --development, --freeze or --heldout');
if(mode==='--freeze'){
  await writeFile(`${root}/freeze-v2.json`,JSON.stringify({protocol:'relay-intent-comparison-v2',frozenAt:new Date().toISOString(),hashEncoding:'UTF-8 with CRLF normalized to LF',hashes,evaluatorHash,gate,priorFreeze:'freeze-v1.json',disclosure:'Evaluator binding was added after the initial held-out run. Same candidate/data and thresholds; this repeat is not a fresh held-out experiment.',rule:'Do not tune these candidates after held-out evaluation. A future experiment needs a new held-out corpus.'},null,2)+'\n',{flag:'wx'});
  console.log('Evaluator, thresholds, candidates and datasets bound for reproducible repeats. Initial held-out disclosure retained.');
}else{
  if(mode==='--heldout'){
    const freeze=JSON.parse(await readFile(`${root}/freeze-v2.json`,'utf8')) as {hashes:Record<string,string>;evaluatorHash:string;gate:unknown};
    for(const path of paths)if(freeze.hashes[path]!==hashes[path])throw new Error(`Frozen artifact changed: ${path}`);
    if(freeze.evaluatorHash!==evaluatorHash)throw new Error('Frozen evaluator changed');
    gate=gateSchema.parse(freeze.gate);
  }
  const data=mode==='--development'?development:await read(`${root}/heldout-v1.json`);
  if(new Set(data.cases.map(test=>test.id)).size!==data.cases.length)throw new Error('Duplicate case IDs');
  for(const test of data.cases)if(test.required.some(label=>test.forbidden.includes(label)))throw new Error(`Contradictory labels: ${test.id}`);
  const classifiers:Record<string,(objective:string)=>Demand>={baseline,phrases:phraseDemand,prototype:prototypeClassifier(development.cases)};
  const score=(classify:(objective:string)=>Demand,cases:IntentCase[])=>{
    let satisfied=0,required=0,found=0,forbiddenViolations=0;
    const perLabel:Record<string,{required:number;found:number}>={};
    const failures:{id:string;missing:string[];forbidden:string[]}[]=[];
    for(const test of cases){
      const predicted=classify(test.objective).categories;
      const missing=test.required.filter(label=>!predicted.includes(label)),forbidden=test.forbidden.filter(label=>predicted.includes(label));
      required+=test.required.length;found+=test.required.length-missing.length;forbiddenViolations+=forbidden.length;
      for(const label of test.required){const entry=perLabel[label]??={required:0,found:0};entry.required++;entry.found+=Number(predicted.includes(label));}
      if(missing.length||forbidden.length)failures.push({id:test.id,missing,forbidden});else satisfied++;
    }
    return {cases:cases.length,satisfied,caseSatisfaction:satisfied/cases.length,required,found,requiredRecall:required?found/required:null,forbiddenViolations,perLabel,failures};
  };
  const results=Object.fromEntries(Object.entries(classifiers).map(([name,classify])=>{
    for(let index=0;index<100;index++)classify(data.cases[index%data.cases.length]!.objective);
    const timings:number[]=[];
    for(let index=0;index<1000;index++){const start=performance.now();classify(data.cases[index%data.cases.length]!.objective);timings.push(performance.now()-start);}
    timings.sort((a,b)=>a-b);
    const worstStart=performance.now();classify('א'.repeat(16_384));const boundedInputMs=performance.now()-worstStart;
    return [name,{...score(classify,data.cases),languages:Object.fromEntries(['en','he'].map(language=>[language,score(classify,data.cases.filter(test=>test.language===language))])),timing:{iterations:1000,medianMs:timings[500],p95Ms:timings[950],boundedInputMs}}];
  }));
  const base=results.baseline!;
  const gates=Object.fromEntries(Object.entries(results).filter(([name])=>name!=='baseline').map(([name,result])=>[name,{caseGainPercentagePoints:(result.caseSatisfaction-base.caseSatisfaction)*100,accepted:result.caseSatisfaction-base.caseSatisfaction>=gate.minimumCaseGainPercentagePoints/100-Number.EPSILON&&result.forbiddenViolations<=base.forbiddenViolations+gate.maximumExtraForbiddenLabels&&result.timing.p95Ms!<gate.maximumP95Milliseconds}]));
  const report={protocol:'relay-intent-comparison-v2',measuredAt:new Date().toISOString(),mode,corpus:data.version,provenance:data.provenance,hashes,evaluatorHash,gate,environment:{node:process.version,platform:platform(),architecture:arch(),cpu:cpus()[0]?.model},limitations:['Synthetic labeled objectives, not production traffic or model task success.','Partially specified labels: no precision/F1 claim.','Prototype uses development examples only and is lexical, not semantic embeddings.','Timing measures this process; repeat without concurrent heavy work before promotion.','Evaluator binding added after the initial held-out run; this is reproduction, not a new unseen evaluation.'],results,gates};
  await mkdir('output/final-evolution',{recursive:true});const output=`output/final-evolution/intent-${mode.slice(2)}.json`;
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,results:Object.fromEntries(Object.entries(results).map(([name,result])=>[name,{satisfied:result.satisfied,total:result.cases,recall:result.requiredRecall,forbidden:result.forbiddenViolations,p95Ms:result.timing.p95Ms,...mode==='--development'?{failures:result.failures}:{}}])),gates},null,2));
}
