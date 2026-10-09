import {describe,expect,it} from 'vitest';
import {authorizeOptions,chatPermissions,type Principal} from '../server/auth/policy.js';
import type {TaskOptions} from '../shared/types.js';

const options:TaskOptions={depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:8192,budget:{maxCalls:4,maxSeconds:30,maxIterations:3,maxCostUsd:0,localOnly:true},network:{mode:'ask',allowedOrigins:['https://example.com']}};
const principal:Principal={remote:true,sessionId:'test',user:{id:'guest',name:'Guest',email:null,role:'chat',enabled:true,permissions:chatPermissions,sessionVersion:0,createdAt:new Date().toISOString(),lastActiveAt:null}};
describe('network authority is independent from model and filesystem access',()=>{
  it('requires an independent external tool server grant even for an authorized research origin',()=>{
    const permitted={...principal,user:{...principal.user,permissions:{...chatPermissions,networkOrigins:['https://example.com'],maxNetworkAccess:'allow' as const}}};
    expect(()=>authorizeOptions(permitted,{...options,mcpServerIds:['public-docs']})).toThrow(/external tool/i);
    const granted={...permitted,user:{...permitted.user,permissions:{...permitted.user.permissions,mcpServerIds:['public-docs']}}};
    expect(authorizeOptions(granted,{...options,mcpServerIds:['public-docs']}).mcpServerIds).toEqual(['public-docs']);
    expect(()=>authorizeOptions(granted,{...options,mcpServerIds:['other-server']})).toThrow(/external tool/i);
  });
  it('denies a network request by a chat user with no explicit network grant',()=>{expect(()=>authorizeOptions(principal,options)).toThrow(/network/i);});
  it('allows only the granted origins and approval ceiling',()=>{
    const permitted={...principal,user:{...principal.user,permissions:{...chatPermissions,networkOrigins:['https://example.com'],maxNetworkAccess:'ask' as const}}};
    expect(authorizeOptions(permitted,options).network?.mode).toBe('ask');
    expect(()=>authorizeOptions(permitted,{...options,network:{mode:'allow',allowedOrigins:['https://example.com']}})).toThrow(/network/i);
    expect(()=>authorizeOptions(permitted,{...options,network:{mode:'ask',allowedOrigins:['https://other.example']}})).toThrow(/network/i);
  });
  it('lets the local owner authorize exact public origins but never local service URLs',()=>{
    const owner={...principal,remote:false,user:{...principal.user,id:'owner',role:'owner' as const}};
    expect(authorizeOptions(owner,options).network).toEqual(options.network);
    expect(()=>authorizeOptions(owner,{...options,network:{mode:'allow',allowedOrigins:['http://127.0.0.1:4317']}})).toThrow();
  });
});
