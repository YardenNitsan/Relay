import { describe, expect, it } from 'vitest';
import { buildReviewContext, fitContext } from '../server/orchestration/context.js';
import { boundedReceipt } from '../server/orchestration/receipts.js';

describe('required context integrity',()=>{
  it('refreshes a saved reviewer context without losing action receipts or private provider continuity',()=>{
    const action={role:'assistant' as const,content:'',toolCalls:[{id:'read',name:'file_read',arguments:{path:'a.ts'}}],providerData:{provider:'ollama' as const,data:'opaque'}};
    const receipt={role:'tool' as const,toolCallId:'read',content:'Observed bytes'};
    const context=buildReviewContext('Fix it','The complete candidate',[],8192,[{role:'user',content:'Legacy incomplete findings'},action,receipt]);
    const fitted=fitContext(context,[],8192,2048).messages;
    expect(fitted.some(message=>message.content.includes('The complete candidate'))).toBe(true);
    expect(fitted).toContainEqual(action);expect(fitted).toContainEqual(receipt);
    expect(fitted.some(message=>message.content.includes('Legacy incomplete findings'))).toBe(false);
  });
  it('does not silently shorten verification details to make a reviewer call fit',()=>{
    const context=buildReviewContext('Fix it','Candidate',[{id:'check',taskId:'task',kind:'command_exit',summary:'Observed output',passed:true,createdAt:'now',details:{output:'x'.repeat(9000)}}],8192);
    expect(()=>fitContext(context,[],8192,2048)).toThrow(/context budget/);
  });
  it('budgets serialized UTF-8 receipt bytes while retaining metadata',()=>{
    const receipt=boundedReceipt(JSON.stringify({path:'a.ts',content:'😀\n"'.repeat(1000),sha256:'a'.repeat(64),bytes:9000,truncated:false}),512);
    const parsed=JSON.parse(receipt) as Record<string,unknown>;
    expect(parsed.sha256).toBe('a'.repeat(64));expect(parsed.truncated).toBe(true);expect(Buffer.byteLength(receipt)).toBeLessThanOrEqual(512);
  });
  it('keeps command exit and checkpoint metadata when logs are truncated',()=>{
    const receipt=boundedReceipt(JSON.stringify({stdout:'x'.repeat(3000),stderr:'y'.repeat(3000),exitCode:1,checkpointId:'checkpoint',filesChanged:2,durationMs:12,truncated:false}),512);
    expect(Buffer.byteLength(receipt)).toBeLessThanOrEqual(512);
    expect(JSON.parse(receipt)).toMatchObject({exitCode:1,checkpointId:'checkpoint',filesChanged:2,truncated:true});
  });
});
