import {describe,expect,it} from 'vitest';
import {codeEvaluationCases,codeEvaluationInputs,codeEvaluationEvidence,codeEvaluationProtocol,gradeCodeExecution,parseCodeSubmission,CODE_EVALUATION_HARNESS,codeHarnessDigest} from '../server/models/code-evaluation.js';

describe('executable coding evaluation contracts',()=>{
  it('accepts only one bounded fixed-path source submission',()=>{
    expect(parseCodeSubmission('{"files":{"solution.cjs":"module.exports = x => x;"}}')).toBe('module.exports = x => x;');
    for(const files of [{'../outside.cjs':'source'},{'solution.cjs':'source','runner.cjs':'tamper'},{'solution.cjs':'x'.repeat(32769)}])expect(()=>parseCodeSubmission(JSON.stringify({files}))).toThrow();
    expect(()=>parseCodeSubmission('```json\n{}\n```')).toThrow();
  });
  it('keeps expected answers outside sandbox input and never accepts self-reported success',()=>{
    expect(codeEvaluationCases()).toHaveLength(3);expect(CODE_EVALUATION_HARNESS).not.toMatch(/expected|passed|node:vm/);expect(codeHarnessDigest).toMatch(/^[a-f0-9]{64}$/);
    for(const item of codeEvaluationCases()){expect(JSON.stringify(item)).not.toContain('expected');expect(codeEvaluationInputs(item.id).length).toBeGreaterThan(3);expect(gradeCodeExecution(item.id,{stdout:'{"passed":true}',exitCode:0,truncated:false}).passed).toBe(false);}
  });
  it('requires successful process completion and exact per-vector outputs',()=>{
    const success={stdout:JSON.stringify([[],[[1,5]],[[1,2],[3,4]],[[1,10]],[[0,0],[2,3]]]),exitCode:0,truncated:false};
    expect(gradeCodeExecution('interval-repair',success).passed).toBe(true);
    expect(gradeCodeExecution('interval-repair',{...success,exitCode:1}).passed).toBe(false);
    expect(gradeCodeExecution('interval-repair',{...success,truncated:true}).passed).toBe(false);
    expect(gradeCodeExecution('interval-repair',{...success,stdout:'[]'}).passed).toBe(false);
  });
  it('keeps fixture, incompatible and tampered reports ineligible as measured evidence',()=>{
    const identity={model:{modelId:'ollama/fixture',provider:'ollama',digest:'model-digest',runtime:'ollama',runtimeVersion:'1',quantization:'Q4',contextTokens:8192,gpuOffload:0,executionSettings:{temperature:null,seed:null,reasoning:'runtime-default',maxOutputTokens:512},hardwareFingerprint:'a'.repeat(64)},sandbox:{imageId:`sha256:${'a'.repeat(64)}`,toolchainVersion:'24.0.0',harnessDigest:codeHarnessDigest}};
    const report={protocol:codeEvaluationProtocol,source:'provider',identity,measuredAt:new Date().toISOString(),samples:codeEvaluationCases().map(sample=>({caseId:sample.id,grade:gradeCodeExecution(sample.id,{stdout:'[]',exitCode:0,truncated:false}),receipt:{...identity.sandbox,sourceSha256:'a'.repeat(64),outputSha256:'b'.repeat(64),exitCode:0,truncated:false,durationMs:5}}))};
    expect(codeEvaluationEvidence(report,identity)).toMatchObject({passed:0,total:3,executed:3});expect(codeEvaluationEvidence({...report,source:'fixture'},identity)).toBeNull();expect(codeEvaluationEvidence(report,{...identity,sandbox:{...identity.sandbox,toolchainVersion:'24.1.0'}})).toBeNull();expect(codeEvaluationEvidence({...report,protocol:'relay-capability-eval-v2'},identity)).toBeNull();
    const tampered=structuredClone(report);tampered.samples[0].grade.passed=true;expect(codeEvaluationEvidence(tampered,identity)).toBeNull();
  });
});
