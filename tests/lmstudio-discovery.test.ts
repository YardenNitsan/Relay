import {describe,it,expect} from 'vitest';
import {lmstudioModels} from '../server/providers/registry.js';
import {Providers} from '../server/providers/index.js';
import {SecretManager} from '../server/providers/secrets.js';

describe('LM Studio installed catalog',()=>{
  it('retains downloaded unloaded chat models and their reported capabilities',()=>{
    const models=lmstudioModels({models:[
      {type:'llm',key:'publisher/downloaded',display_name:'Downloaded model',loaded_instances:[],size_bytes:123,capabilities:{trained_for_tool_use:true,vision:true,reasoning:{allowed_options:['off','on']}}},
      {type:'llm',key:'loaded',loaded_instances:[{id:'loaded-instance',config:{context_length:8192}}]},
      {type:'embedding',key:'embeddings'},
      {type:'llm',key:''},
    ]});
    expect(models.map(model=>model.id)).toEqual(['lmstudio/publisher/downloaded','lmstudio/loaded']);
    expect(models[0]).toMatchObject({state:'available',capabilities:{tools:true,vision:true,reasoning:true},details:{capabilitySource:'LM Studio /api/v1/models'}});
    expect(models[1]).toMatchObject({state:'ready',capabilities:{tools:false,vision:false},details:{loadedContext:8192}});
  });
  it('explains why a stopped server cannot expose its downloaded models',async()=>{
    const providers=new Providers({secrets:new SecretManager({env:{},keyring:null}),fetch:async()=>{throw new TypeError('fetch failed');}});
    const status=await providers.verify('lmstudio');
    expect(status.state).toBe('unreachable');
    expect(status.error).toMatch(/Developer.*Start Server/);
    expect(status.error).toContain('1234');
  });
  it('does not mistake authentication refusal for a stopped server',async()=>{
    const providers=new Providers({secrets:new SecretManager({env:{},keyring:null}),fetch:async()=>new Response('',{status:401})});
    expect(await providers.verify('lmstudio')).toMatchObject({state:'unauthorized',error:'Provider returned HTTP 401'});
  });
});
