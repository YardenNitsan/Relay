import { describe, expect, it, afterEach } from 'vitest';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { remoteConfig, RemoteIdentity } from '../server/auth/remote.js';
import { openDatabase } from '../server/db/database.js';
import { Store } from '../server/db/store.js';
import { authorizeOptions, chatPermissions, permissionSchema, type Principal } from '../server/auth/policy.js';
import { hostPlatform } from '../server/host/platform.js';

let store:Store|undefined;afterEach(async()=>{await store?.close();store=undefined;});
describe('remote identity and authorization',()=>{
  it('upgrades only the local owner provider grants once and preserves existing account policy',async()=>{
    store=new Store(await openDatabase());await store.init();
    const legacy={...chatPermissions,providers:['ollama','openai']};
    await store.db.query('UPDATE users SET permissions=$1 WHERE id=$2',[JSON.stringify(legacy),'owner']);
    await store.db.query('INSERT INTO users(id,name,role,permissions) VALUES ($1,$2,$3,$4)',['friend','Friend','chat',JSON.stringify(legacy)]);
    await store.db.query('DELETE FROM schema_migrations WHERE version=3');
    await store.init();
    const owner=(await store.db.query("SELECT permissions FROM users WHERE id='owner'"))[0].permissions;
    expect(owner).toEqual({...legacy,providers:['ollama','openai','xai','deepseek']});
    expect((await store.db.query("SELECT permissions FROM users WHERE id='friend'"))[0].permissions).toEqual(legacy);
    await store.db.query('UPDATE users SET permissions=$1 WHERE id=$2',[JSON.stringify(legacy),'owner']);
    await store.init();
    expect((await store.db.query("SELECT permissions FROM users WHERE id='owner'"))[0].permissions).toEqual(legacy);
  });
  it.each(['xai','deepseek'] as const)('requires an explicit %s grant independently of cloud spending permission',provider=>{
    expect(permissionSchema.parse({...chatPermissions,providers:['ollama','lmstudio','openai','anthropic','gemini','xai','deepseek']}).providers).toHaveLength(7);
    const p={remote:true,sessionId:'s',user:{id:'friend',enabled:true,role:'chat',permissions:{...chatPermissions,allowUnpricedCloud:true}}} as Principal;
    const options={depth:'fast' as const,modelId:`${provider}/test`,workspaceId:null,access:'read_only' as const,contextTokens:4096,cloudPolicy:'allow' as const,budget:{maxCalls:4,maxSeconds:60,maxIterations:2,maxCostUsd:null,localOnly:false}};
    expect(()=>authorizeOptions(p,options)).toThrow(/granted/);
    p.user.permissions.providers.push(provider);
    expect(authorizeOptions(p,options)).toEqual(options);
  });
  it('is disabled without an explicit setting and rejects insecure issuer/origin config',()=>{
    expect(remoteConfig({})).toBeNull();
    expect(()=>remoteConfig({RELAY_REMOTE_ENABLED:'1',RELAY_REMOTE_ORIGIN:'http://public.example',RELAY_ACCESS_ISSUER:'https://team.cloudflareaccess.com',RELAY_ACCESS_AUDIENCE:'aud'})).toThrow();
    expect(()=>remoteConfig({RELAY_REMOTE_ENABLED:'1',RELAY_REMOTE_ORIGIN:'https://relay.example',RELAY_ACCESS_ISSUER:'https://evil.example',RELAY_ACCESS_AUDIENCE:'aud'})).toThrow();
  });
  it('requires signed invited identity, correct audience and revocable user grant',async()=>{
    store=new Store(await openDatabase());await store.init();
    await store.db.query('INSERT INTO users(id,name,email,role,permissions) VALUES ($1,$2,$3,$4,$5)',['friend','Friend','friend@example.com','chat',JSON.stringify(chatPermissions)]);
    const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='test';
    const config={publicOrigin:'https://relay.example',issuer:'https://team.cloudflareaccess.com',audience:'relay',port:4318};
    const identity=new RemoteIdentity(store,config,createLocalJWKSet({keys:[jwk]}));
    const expiresAt=Math.floor(Date.now()/1000)+300;
    const token=await new SignJWT({email:'friend@example.com',type:'app'}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('subject').setIssuer(config.issuer).setAudience('relay').setIssuedAt().setExpirationTime(expiresAt).sign(privateKey);
    expect(await identity.authenticate(token)).toBe('friend');
    expect(await identity.authenticateContext(token)).toEqual({userId:'friend',expiresAtMs:expiresAt*1000});
    const forged=token.split('.');const payload=JSON.parse(Buffer.from(forged[1],'base64url').toString()) as Record<string,unknown>;payload.exp=expiresAt+86400;forged[1]=Buffer.from(JSON.stringify(payload)).toString('base64url');
    await expect(identity.authenticateContext(forged.join('.'))).rejects.toThrow(/verified/);
    await expect(identity.authenticate(`${token.slice(0,-4)}FAKE`)).rejects.toThrow(/verified/);
    const other=new RemoteIdentity(store,{...config,audience:'another-app'},createLocalJWKSet({keys:[jwk]}));
    await expect(other.authenticate(token)).rejects.toThrow();
    await store.db.query("UPDATE users SET enabled=false WHERE id='friend'");await expect(identity.authenticate(token)).rejects.toThrow(/granted/);
  });
  it('chat users cannot select host workspaces or increase their access level',()=>{
    const p={remote:true,sessionId:'s',user:{id:'friend',enabled:true,role:'chat',permissions:chatPermissions}} as Principal;
    const options={depth:'fast' as const,modelId:null,workspaceId:null,access:'read_only' as const,contextTokens:4096,budget:{maxCalls:4,maxSeconds:60,maxIterations:2,maxCostUsd:null,localOnly:true}};
    expect(()=>authorizeOptions(p,options)).not.toThrow();
    expect(()=>authorizeOptions(p,{...options,access:'workspace'})).toThrow(/exceeds/);
    expect(()=>authorizeOptions(p,{...options,workspaceId:'any-id'})).toThrow(/granted/);
    expect(()=>authorizeOptions(p,{...options,modelId:'openai:any'})).toThrow(/granted/);
  });
  it('scopes conversation access in the data layer',async()=>{
    store=new Store(await openDatabase());await store.init();const c=await store.createConversation('Private');
    await expect(store.conversation(c.id,'friend')).rejects.toThrow(/not found/);
    expect(await store.conversations('friend')).toEqual([]);
  });
  it('requires the owner personal billing grant and never drops an explicit task cost cap',()=>{
    const permissions={...chatPermissions,providers:['openai' as const]};
    const p={remote:true,sessionId:'s',user:{id:'friend',enabled:true,role:'chat',permissions}} as Principal;
    const options={depth:'fast' as const,modelId:'openai/test',workspaceId:null,access:'read_only' as const,contextTokens:4096,cloudPolicy:'allow' as const,budget:{maxCalls:4,maxSeconds:60,maxIterations:2,maxCostUsd:null,localOnly:false}};
    expect(()=>authorizeOptions(p,options)).toThrow(/spending/);
    p.user.permissions={...permissions,allowUnpricedCloud:true};
    expect(authorizeOptions(p,options).budget.maxCostUsd).toBeNull();
    p.user.permissions.dailyCloudBudgetUsd=1;
    expect(authorizeOptions(p,{...options,budget:{...options.budget,maxCostUsd:0.5}}).budget.maxCostUsd).toBe(0.5);
    expect(()=>authorizeOptions(p,{...options,modelId:'anthropic/test'})).toThrow(/granted/);
  });
});
describe('first class host adapters',()=>{
  it('defines native data and secret backends for all three targets',()=>{
    expect(hostPlatform('win32').secretBackend()).toContain('Windows');
    expect(hostPlatform('darwin').secretBackend()).toContain('Keychain');
    expect(hostPlatform('linux').secretBackend()).toContain('Secret Service');
    expect(()=>hostPlatform('freebsd')).toThrow(/Unsupported/);
  });
});
