import { describe, expect, it } from 'vitest';
import { buildReviewContext, fitContext } from '../server/orchestration/context.js';
import { boundedReceipt } from '../server/orchestration/receipts.js';
import type {ModelMessage} from '../shared/types';

const readPair=(id:string,body:string):ModelMessage[]=>[{role:'assistant',content:'',toolCalls:[{id,name:'file_read',arguments:{path:'file.ts'}}]},{role:'tool',toolCallId:id,content:JSON.stringify({path:'file.ts',content:body,sha256:'a'.repeat(64),bytes:body.length,truncated:false})}];
const commandPair=(id:string,body:string):ModelMessage[]=>[{role:'assistant',content:'',toolCalls:[{id,name:'terminal',arguments:{argv:['node','--test'],profile:'node',timeoutSeconds:30}}]},{role:'tool',toolCallId:id,content:JSON.stringify({stdout:body,stderr:'',exitCode:1,checkpointId:'checkpoint',truncated:false})}];

describe('required context integrity',()=>{
  it.each([['file reads',readPair],['test output',commandPair]] as const)('shortens superseded %s only when needed while preserving exact actions and latest receipt',(_name,pair)=>{
    const messages:ModelMessage[]=[{role:'system',content:'Host policy'},{role:'user',content:'Current objective:\nRepair and verify'},...pair('old','x'.repeat(4000)),...pair('latest','Current complete content')];
    const original=JSON.stringify(messages);expect(fitContext(messages,[],16000,1024).messages).toEqual(messages);
    const result=fitContext(messages,[],4096,1024);expect(JSON.stringify(messages)).toBe(original);expect(result.messages).toHaveLength(messages.length);
    expect(result.messages[2]).toEqual(messages[2]);expect(result.messages.slice(4)).toEqual(messages.slice(4));expect(result.messages[3].toolCallId).toBe('old');
    expect(JSON.parse(result.messages[3].content)).toMatchObject({...JSON.parse(messages[3].content),...(_name==='file reads'?{content:expect.any(String)}:{stdout:expect.any(String)}),truncated:true});
    expect(Buffer.byteLength(JSON.stringify(result.messages))).toBeLessThanOrEqual(4096-1024-384);
  });
  it('keeps opaque provider-continuation pairs and refuses to fit by truncating them',()=>{
    const messages:ModelMessage[]=[{role:'system',content:'Host policy'},...readPair('old','x'.repeat(4000)),...readPair('latest','new')];messages[1].providerData={provider:'gemini',data:{signature:'opaque'}};
    expect(()=>fitContext(messages,[],4096,1024)).toThrow(/context budget/);
    delete messages[1].providerData;messages.push({role:'assistant',content:'',providerData:{provider:'anthropic',data:{opaque:'continuation'}}});
    expect(()=>fitContext(messages,[],4096,1024)).toThrow(/context budget/);
  });
  it('does not drop execution metadata or shorten unrelated tool output to fit',()=>{
    const messages:ModelMessage[]=[{role:'system',content:'Host policy'},...commandPair('old','x'.repeat(4000)),...commandPair('latest','new')];
    messages[2].content=JSON.stringify({...JSON.parse(messages[2].content),files:['metadata'.repeat(1000)]});
    expect(()=>fitContext(messages,[],4096,1024)).toThrow(/context budget/);
    const unrelated:ModelMessage[]=[{role:'system',content:'Host policy'},...readPair('old','x'.repeat(4000)),...readPair('latest','new')];
    for(const message of unrelated)for(const call of message.toolCalls??[])call.name='http_get';
    expect(()=>fitContext(unrelated,[],4096,1024)).toThrow(/context budget/);
  });
  it('does not shorten a latest read, unmatched result or ambiguous repeated call ID',()=>{
    for(const messages of [readPair('only','x'.repeat(4000)),[...readPair('same','x'.repeat(4000)),...readPair('same','new')],[{role:'tool' as const,toolCallId:'missing',content:JSON.stringify({content:'x'.repeat(4000),path:'file.ts',sha256:'a'.repeat(64)})},...readPair('latest','new')]]){
      expect(()=>fitContext([{role:'system',content:'Host policy'},...messages],[],4096,1024)).toThrow(/context budget/);
    }
  });
  it('does not discard a workflow assignment or its acceptance criteria to fit a model',()=>{
    for(const prefix of ['Assigned analysis subobjective (untrusted task data;','Proposed acceptance checks (untrusted suggestions;']){
      const messages=[{role:'system' as const,content:'Host instructions'},{role:'user' as const,content:prefix+'x'.repeat(5000)},{role:'user' as const,content:'Current objective:\nReview code'}];
      expect(()=>fitContext(messages,[],4096,1024)).toThrow(/context budget/);
    }
  });
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
