import {createHash} from 'node:crypto';
import {z} from 'zod';
import {compatibleEvaluationIdentity,evaluationIdentitySchema,type EvaluationCase} from './evaluation.js';

export const codeEvaluationProtocol='relay-code-eval-v1' as const;
export const codeHash=(value:string)=>createHash('sha256').update(value).digest('hex');
/** Trusted runner is copied as DATA and runs only inside DockerSandbox. No keys. */
export const CODE_EVALUATION_HARNESS=`'use strict';
const fs=require('node:fs');
const inputs=JSON.parse(fs.readFileSync('/workspace/inputs.json','utf8'));
const solve=require('/workspace/solution.cjs');
if(typeof solve!=='function')throw new Error('Export one function');
const outputs=inputs.map(input=>solve(input));
process.stdout.write(JSON.stringify(outputs));
`;
export const codeHarnessDigest=codeHash(CODE_EVALUATION_HARNESS);
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const codeSandboxIdentitySchema=z.object({imageId:z.string().regex(/^sha256:[a-f0-9]{64}$/),toolchainVersion:z.string().max(100).regex(/^\d+\.\d+\.\d+[a-z0-9.+-]*$/i).refine(value=>Number(value.split('.')[0])>=24),harnessDigest:z.literal(codeHarnessDigest)}).strict();
export type CodeSandboxIdentity=z.infer<typeof codeSandboxIdentitySchema>;
export const codeEvaluationIdentitySchema=z.object({model:evaluationIdentitySchema,sandbox:codeSandboxIdentitySchema}).strict();
export type CodeEvaluationIdentity=z.infer<typeof codeEvaluationIdentitySchema>;
export function compatibleCodeIdentity(a:unknown,b:unknown){const first=codeEvaluationIdentitySchema.safeParse(a),second=codeEvaluationIdentitySchema.safeParse(b);return first.success&&second.success&&compatibleEvaluationIdentity(first.data.model,second.data.model)&&first.data.sandbox.imageId===second.data.sandbox.imageId&&first.data.sandbox.toolchainVersion===second.data.sandbox.toolchainVersion&&first.data.sandbox.harnessDigest===second.data.sandbox.harnessDigest;}
const cases=[
  {id:'settled-totals',prompt:'Implement solve(entries). Each entry has customer (string), status and cents. Include only status === "settled", nonempty string customer, and nonnegative safe integer cents. Sum by customer, including names such as __proto__. Return an array of [customer,total] pairs sorted by customer using ordinary JavaScript string ordering. Include a zero-total customer if a valid settled entry exists. Ignore invalid entries. Empty input returns []. Do not print diagnostics.',inputs:[[],[{customer:'b',status:'settled',cents:20},{customer:'a',status:'pending',cents:50},{customer:'b',status:'settled',cents:3}],[{customer:'__proto__',status:'settled',cents:4},{customer:'a',status:'settled',cents:0}],[{customer:'x',status:'settled',cents:-1},{customer:'x',status:'settled',cents:1.5},{customer:'x',status:'settled',cents:'2'},{customer:'',status:'settled',cents:3}],[{customer:'b',status:'settled',cents:1},{customer:'a',status:'settled',cents:2},{customer:'b',status:'cancelled',cents:9}]],expected:[[],[['b',23]],[['__proto__',4],['a',0]],[],[['a',2],['b',1]]]},
  {id:'interval-repair',prompt:'Repair and implement solve(intervals), merging closed integer intervals. Return intervals sorted by start; overlap or touching endpoints merge; nested ranges never shrink the enclosing range. Empty input returns []. Inputs are valid pairs [start,end] with start<=end. Faulty implementation: module.exports = xs => { xs.sort((a,b)=>a[0]-b[0]); const out=[]; let last=xs[0]; for(let i=1;i<xs.length;i++){ const next=xs[i]; if(last[1]>next[0])last[1]=next[1]; else{out.push(last);last=next;} } return out; }; Return a complete corrected module.',inputs:[[],[[1,3],[2,5]],[[3,4],[1,2]],[[1,10],[2,3],[4,8]],[[2,2],[2,3],[0,0]]],expected:[[],[[1,5]],[[1,2],[3,4]],[[1,10]],[[0,0],[2,3]]]},
  {id:'dependency-order',prompt:'Implement solve({nodes,edges}). nodes contains distinct string IDs; edges contains [before,after] pairs. Return a topological ordering by repeatedly taking the lexicographically smallest currently ready ID (ordinary JavaScript string ordering). Duplicate edges count once. Return null for a cycle, repeated node ID, or an edge mentioning an unknown node. Empty graph returns []. Handle disconnected nodes. No library dependencies.',inputs:[{nodes:[],edges:[]},{nodes:['d','c','b','a'],edges:[['a','b'],['a','c'],['b','d'],['c','d']]},{nodes:['a','b'],edges:[['a','b'],['b','a']]},{nodes:['b','a'],edges:[['a','b'],['a','b']]},{nodes:['a'],edges:[['a','missing']]}],expected:[[],['a','b','c','d'],null,['a','b'],null]},
] as const;
const system='Synthetic executable coding evaluation. Return ONLY JSON with exactly {"files":{"solution.cjs":"..."}}. The file must be a CommonJS module exporting one synchronous function: module.exports = function solve(input) { ... }. Use standard JavaScript and Node 24, no packages, network or external files. Do not execute tools or claim tests passed. Your source will be run later inside an offline resource-limited container; actual outputs are graded separately.';
export function codeEvaluationCases():EvaluationCase[]{return cases.map(item=>({id:item.id,category:'debugging',messages:[{role:'system',content:system},{role:'user',content:item.prompt}],tools:[]}));}
function known(id:string){const item=cases.find(item=>item.id===id);if(!item)throw new Error('Unknown executable evaluation case');return item;}
export function codeEvaluationInputs(id:string):unknown[]{return structuredClone(known(id).inputs) as unknown as unknown[];}
export function parseCodeSubmission(text:string):string{if(Buffer.byteLength(text)>40000)throw new Error('Code submission exceeds limit');return z.object({files:z.object({'solution.cjs':z.string().min(1).max(32768).refine(value=>!value.includes('\0')&&Buffer.byteLength(value)<=32768)}).strict()}).strict().parse(JSON.parse(text)).files['solution.cjs'];}
function canonical(value:unknown,depth=0):string{if(depth>24)throw new Error('Output nesting exceeds limit');if(Array.isArray(value))return `[${value.map(item=>canonical(item,depth+1)).join(',')}]`;if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item,depth+1)}`).join(',')}}`;return JSON.stringify(value);}
export function gradeCodeExecution(id:string,result:{stdout:string;exitCode:number;truncated:boolean}){
  const entry=known(id);let output:unknown,valid=false;
  try{if(Buffer.byteLength(result.stdout)<=32768){output=JSON.parse(result.stdout);valid=Array.isArray(output)&&output.length===entry.expected.length;}}catch{/* No valid deterministic output. */}
  const checks=[{name:'command-completed',passed:result.exitCode===0&&!result.truncated},{name:'bounded-json-output',passed:valid}];
  entry.expected.forEach((expected,index)=>{let matched=false;try{matched=valid&&canonical((output as unknown[])[index])===canonical(expected);}catch{/* Malformed nested data cannot pass. */}checks.push({name:`vector-${index+1}`,passed:matched});});
  return {passed:checks.every(check=>check.passed),checks};
}
const gradeSchema=z.object({passed:z.boolean(),checks:z.array(z.object({name:z.string().max(80),passed:z.boolean()}).strict()).min(1).max(10)}).strict();
export const codeExecutionReceiptSchema=z.object({imageId:z.string().regex(/^sha256:[a-f0-9]{64}$/),toolchainVersion:z.string().max(100),harnessDigest:z.literal(codeHarnessDigest),sourceSha256:hash,outputSha256:hash,exitCode:z.number().int().min(-1).max(255),truncated:z.boolean(),durationMs:z.number().finite().nonnegative().max(180000)}).strict();
export type CodeExecutionReceipt=z.infer<typeof codeExecutionReceiptSchema>;
export const codeSampleSchema=z.object({caseId:z.string(),grade:gradeSchema,receipt:codeExecutionReceiptSchema.nullable()}).strict();
export type CodeSample=z.infer<typeof codeSampleSchema>;
export const codeEvaluationReportSchema=z.object({protocol:z.literal(codeEvaluationProtocol),source:z.enum(['fixture','provider']),identity:codeEvaluationIdentitySchema,measuredAt:z.iso.datetime(),samples:z.array(codeSampleSchema).length(cases.length)}).strict();
export type CodeEvaluationReport=z.infer<typeof codeEvaluationReportSchema>;
export function codeEvaluationEvidence(value:unknown,identity:unknown,now=Date.now()){
  const parsed=codeEvaluationReportSchema.safeParse(value);if(!parsed.success||parsed.data.source!=='provider'||!compatibleCodeIdentity(parsed.data.identity,identity)||!Number.isFinite(now)||Date.parse(parsed.data.measuredAt)>now+5000)return null;
  const report=parsed.data;if(new Set(report.samples.map(sample=>sample.caseId)).size!==cases.length)return null;
  for(const sample of report.samples){const entry=cases.find(item=>item.id===sample.caseId);if(!entry||sample.grade.passed!==sample.grade.checks.every(check=>check.passed))return null;
    if(!sample.receipt){if(sample.grade.passed||sample.grade.checks.length!==1||sample.grade.checks[0].name!=='bounded-code-submission')return null;continue;}
    if(sample.receipt.imageId!==report.identity.sandbox.imageId||sample.receipt.toolchainVersion!==report.identity.sandbox.toolchainVersion||sample.receipt.harnessDigest!==report.identity.sandbox.harnessDigest)return null;
    const names=['command-completed','bounded-json-output',...entry.expected.map((_,index)=>`vector-${index+1}`)];if(JSON.stringify(names)!==JSON.stringify(sample.grade.checks.map(check=>check.name)))return null;
    if(sample.grade.checks[0].passed!==(sample.receipt.exitCode===0&&!sample.receipt.truncated))return null;
  }
  return {passed:report.samples.filter(sample=>sample.grade.passed).length,total:cases.length,executed:report.samples.filter(sample=>sample.receipt).length,measuredAt:report.measuredAt};
}
