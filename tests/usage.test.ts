import {afterEach,describe,expect,it} from 'vitest';
import {openDatabase} from '../server/db/database.js';
import {Store} from '../server/db/store.js';
import {buildUsageReport} from '../server/api/usage.js';
import {parseRateLimits} from '../server/providers/limits.js';
import {Providers} from '../server/providers/index.js';
import {SecretManager} from '../server/providers/secrets.js';
import {profile} from '../server/providers/registry.js';
import {chatPermissions,type User} from '../server/auth/policy.js';

let store:Store|undefined;
afterEach(async()=>{await store?.close();store=undefined;});
describe('private usage and honest remaining limits',()=>{
 it('aggregates only this user and UTC day, preserves unknown calls and disconnected models',async()=>{
  store=new Store(await openDatabase());await store.init();
  await store.db.query('INSERT INTO users(id,name,role,permissions) VALUES ($1,$2,$3,$4)',['friend','Friend','chat',JSON.stringify(chatPermissions)]);
  for(const [id,user,model,input,output,date] of [
   ['a','friend','ollama/local',10,5,'2026-10-09T10:00:00Z'],['b','owner','ollama/local',9999,9999,'2026-10-09T10:00:00Z'],
   ['c','friend','ollama/local',null,null,'2026-10-09T11:00:00Z'],['d','friend','ollama/local',999,999,'2026-10-08T23:59:59Z'],
   ['e','friend','ollama/removed',7,3,'2026-10-09T12:00:00Z'],['f','friend','openai/private',3,3,'2026-10-09T12:00:00Z'],
  ])await store.db.query('INSERT INTO inference_requests(id,user_id,token_id,model_id,status,input_tokens,output_tokens,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[id,user,'fixture',model,'completed',input,output,date]);
  const gateway={listModels:async()=>[profile('ollama','local')],rateLimits:()=>[]};
  const report=await buildUsageReport(store,{id:'friend',permissions:chatPermissions} as User,gateway,new Date('2026-10-09T14:00:00Z'));
  expect(report.periodStart).toBe('2026-10-09T00:00:00.000Z');
  expect(report.models).toHaveLength(2);
  expect(report.models.find(m=>m.modelId==='ollama/local')).toMatchObject({requests:2,inputTokens:10,outputTokens:5,unreportedCalls:1,limits:null});
  expect(report.models.find(m=>m.modelId==='ollama/removed')).toMatchObject({requests:1,inputTokens:7,outputTokens:3});
 });
 it('counts in-app model calls and external inference once without exposing stored context',async()=>{
  store=new Store(await openDatabase());await store.init();
  await store.db.query("INSERT INTO conversations(id,user_id,title) VALUES ('usage-conversation','owner','Private title')");
  await store.db.query("INSERT INTO tasks(id,conversation_id,user_id,objective,status,options) VALUES ('usage-task','usage-conversation','owner','Private prompt','completed','{}')");
  await store.db.query("INSERT INTO task_steps(id,task_id,role,title,dependencies,status,ordinal) VALUES ('usage-step','usage-task','worker','Work','[]','completed',0)");
  await store.db.query("INSERT INTO agent_runs(id,task_id,step_id,role,model_id,status) VALUES ('usage-agent','usage-task','usage-step','worker','openai/gpt-test','completed')");
  await store.db.query("INSERT INTO model_calls(id,task_id,agent_id,model_id,status,input_tokens,output_tokens,context) VALUES ('usage-call','usage-task','usage-agent','openai/gpt-test','completed',12,8,'{\"secret\":\"never return context\"}')");
  const gateway={listModels:async()=>[],rateLimits:()=>[]};
  const report=await buildUsageReport(store,{id:'owner',permissions:{...chatPermissions,providers:['openai']}} as User,gateway);
  expect(report.models).toEqual([expect.objectContaining({modelId:'openai/gpt-test',requests:1,inputTokens:12,outputTokens:8,unreportedCalls:0})]);
  expect(JSON.stringify(report)).not.toMatch(/Private|secret|context/);
 });
 it('accepts only documented nonnegative numeric rate headers, never invents a balance',()=>{
  expect(parseRateLimits('openai',new Headers({'x-ratelimit-remaining-tokens':'0','x-ratelimit-limit-tokens':'100','x-ratelimit-reset-tokens':'1m'}))).toEqual([{kind:'tokens',remaining:0,limit:100,reset:'1m'}]);
  expect(parseRateLimits('anthropic',new Headers({'anthropic-ratelimit-input-tokens-remaining':'2000','anthropic-ratelimit-input-tokens-limit':'3000'}))).toEqual([{kind:'input_tokens',remaining:2000,limit:3000,reset:null}]);
  expect(parseRateLimits('gemini',new Headers({'x-ratelimit-remaining-tokens':'25'}))).toEqual([]);
  expect(parseRateLimits('openai',new Headers({'x-ratelimit-remaining-tokens':'-1','x-ratelimit-remaining-requests':'NaN'}))).toEqual([]);
 });
 it('captures rate limits from failed calls and clears them when credentials change',async()=>{
  const providers=new Providers({secrets:new SecretManager({env:{OPENAI_API_KEY:'fixture'},keyring:null}),fetch:async()=>new Response('',{status:429,headers:{'x-ratelimit-remaining-tokens':'0','x-ratelimit-limit-tokens':'100'}})});
  const model=profile('openai','gpt-test');
  await expect(async()=>{for await(const _chunk of providers.stream({model,messages:[],tools:[],contextTokens:2048,maxOutputTokens:128,signal:new AbortController().signal})){/* consume */}}).rejects.toThrow();
  expect(providers.rateLimits()).toEqual([expect.objectContaining({modelId:model.id,limits:[{kind:'tokens',remaining:0,limit:100,reset:null}]})]);
  const friend=await providers.forUser('friend');expect(friend.rateLimits()).toEqual([]);
  providers.credentialsChanged('openai');expect(providers.rateLimits()).toEqual([]);
 });
});
