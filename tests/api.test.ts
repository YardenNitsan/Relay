import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/api/app.js';
import { openDatabase } from '../server/db/database.js';
import { Store } from '../server/db/store.js';
import { ToolBroker } from '../server/tools/index.js';
import { Providers } from '../server/providers/index.js';
import { SecretManager } from '../server/providers/secrets.js';
import { Engine } from '../server/orchestration/engine.js';

let app:FastifyInstance,store:Store,engine:Engine,dir:string;
const host='127.0.0.1:4317';let cookie:string,csrf:string;
beforeEach(async()=>{
  dir=await mkdtemp(join(tmpdir(),'relay-api-'));store=new Store(await openDatabase());await store.init();
  const providers=new Providers({fetch:async()=>new Response('{}',{status:503}),secrets:new SecretManager({env:{}})});
  const broker=new ToolBroker(dir,()=>engine?.isStopped()??false);engine=new Engine(store,providers,broker);
  app=await createApp({store,providers,broker,engine},{staticRoot:join(dir,'missing')});
  const session=await app.inject({url:'/api/session',headers:{host}});cookie=session.headers['set-cookie']!.toString().split(';')[0];csrf=session.json().csrfToken;
});
afterEach(async()=>{await engine.shutdown();await app.close();await store.close();await rm(dir,{recursive:true,force:true});});
describe('local HTTP boundary',()=>{
  it('rejects unauthenticated, cross-origin, wrong-host and mutation-without-CSRF requests',async()=>{
    expect((await app.inject({url:'/api/conversations',headers:{host}})).statusCode).toBe(401);
    expect((await app.inject({url:'/api/session',headers:{host,origin:'https://evil.example'}})).statusCode).toBe(403);
    expect((await app.inject({url:'/api/session',headers:{host:'evil.example'}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/conversations',headers:{host,cookie},payload:{}})).statusCode).toBe(403);
  });
  it('persists a conversation with session+CSRF and never returns credentials in provider state',async()=>{
    const response=await app.inject({method:'POST',url:'/api/conversations',headers:{host,cookie,'x-relay-csrf':csrf},payload:{title:'A real conversation'}});
    expect(response.statusCode).toBe(200);
    expect((await app.inject({url:'/api/conversations',headers:{host,cookie}})).json()[0].title).toBe('A real conversation');
    const models=await app.inject({url:'/api/models',headers:{host,cookie}});expect(models.statusCode).toBe(200);expect(models.body).not.toContain('apiKey');
  });
  it('rejects unrestricted execution and disabled scheduling on the server',async()=>{
    const c=await store.createConversation();const payload={content:'test',options:{depth:'fast',modelId:null,access:'unrestricted',workspaceId:null,contextTokens:4096,budget:{maxCalls:4,maxSeconds:60,maxIterations:3,maxCostUsd:null,localOnly:true}}};
    expect((await app.inject({method:'POST',url:`/api/conversations/${c.id}/messages`,headers:{host,cookie,'x-relay-csrf':csrf},payload})).statusCode).toBe(403);
    await engine.stopAll();payload.options.access='read_only';
    expect((await app.inject({method:'POST',url:`/api/conversations/${c.id}/messages`,headers:{host,cookie,'x-relay-csrf':csrf},payload})).statusCode).toBe(409);
  });
});
