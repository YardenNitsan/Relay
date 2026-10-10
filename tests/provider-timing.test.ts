import {afterEach,expect,it,vi} from 'vitest';
import {Providers} from '../server/providers/index.js';
import type {LmStudioRuntime} from '../server/providers/lmstudio-runtime.js';
import type {ModelRequest,ModelTiming} from '../shared/types.js';
import {profile} from '../server/providers/registry.js';
import {timingRecord} from '../server/models/usage.js';

afterEach(()=>vi.restoreAllMocks());
function fixture(body:string,failCleanup=false){
  let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock);
  const timing:ModelTiming={};
  const gateway=new Providers({lmstudioRuntime:{load:async()=>{clock=20;return {identifier:'relay-timing',unload:async()=>{clock+=30;if(failCleanup)throw new Error('cleanup uncertain');}};}} as unknown as LmStudioRuntime,
    fetch:async(_url,init)=>{expect(JSON.parse(String(init?.body))).not.toHaveProperty('timing');clock=50;return new Response(body);}});
  const request:ModelRequest={model:{...profile('lmstudio','test'),local:true},messages:[],tools:[],contextTokens:4096,maxOutputTokens:512,signal:new AbortController().signal,timing};
  return {gateway,request,timing,advance:()=>{clock+=10;}};
}
const body='data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\ndata: [DONE]\n\n';

it('measures first observed content, managed load and verified cleanup without changing usage',async()=>{
  const f=fixture(body),chunks=[];
  for await(const chunk of f.gateway.stream(f.request)){chunks.push(chunk);f.advance();}
  expect(f.timing).toMatchObject({firstContentMs:50,loadWallMs:20,cleanupWallMs:30});
  expect(f.timing.streamWallMs).toBeGreaterThanOrEqual(30);
  expect(chunks.filter(chunk=>chunk.type==='usage')).toEqual([{type:'usage',inputTokens:3,outputTokens:1}]);
});
it('records cleanup after interrupted consumption without inventing a first token',async()=>{
  const f=fixture(body);for await(const _chunk of f.gateway.stream(f.request))break;
  expect(f.timing.cleanupWallMs).toBe(30);expect(f.timing.firstContentMs).toBe(50);
  expect(f.timing).not.toHaveProperty('firstTokenMs');
});
it('leaves failed cleanup unmeasured and propagates its failure',async()=>{
  const f=fixture(body,true);
  await expect(async()=>{for await(const _chunk of f.gateway.stream(f.request)){/* consume */}}).rejects.toThrow(/cleanup/);
  expect(f.timing.cleanupWallMs).toBeUndefined();expect(f.timing.firstContentMs).toBe(50);
});
it('does not interpret empty text or usage as first content',async()=>{
  const f=fixture('data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":0}}\n\ndata: [DONE]\n\n');
  for await(const _chunk of f.gateway.stream(f.request)){/* consume */}
  expect(f.timing.firstContentMs).toBeUndefined();expect(f.timing.cleanupWallMs).toBe(30);
});
it('persists only finite nonnegative observed counters',()=>{
  expect(timingRecord({firstContentMs:0,loadWallMs:Infinity,cleanupWallMs:-1,streamWallMs:12,private:'secret'} as ModelTiming)).toEqual({firstContentMs:0,streamWallMs:12});
});
