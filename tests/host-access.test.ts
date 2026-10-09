import { expect, it } from 'vitest';
import { authorizeOptions, chatPermissions, type Principal } from '../server/auth/policy.js';
import { decide } from '../server/tools/policy.js';
import type { TaskOptions, ToolContext } from '../shared/types.js';

const options: TaskOptions = { access:'unrestricted',hostAccessConfirmed:true,depth:'fast',modelId:null,workspaceId:null,contextTokens:8192,budget:{maxCalls:4,maxSeconds:60,maxIterations:2,maxCostUsd:null,localOnly:true} };
const owner: Principal = {remote:false,sessionId:'owner-session',user:{id:'owner',role:'owner',name:'Owner',email:null,enabled:true,permissions:{...chatPermissions,maxAccess:'workspace'},sessionVersion:0,createdAt:'',lastActiveAt:null}};
it('requires explicit local-owner confirmation; remote and lower roles cannot select host access',()=>{
  expect(authorizeOptions(owner,options).access).toBe('unrestricted');
  expect(()=>authorizeOptions(owner,{...options,hostAccessConfirmed:false})).toThrow(/Confirm/);
  expect(()=>authorizeOptions({...owner,remote:true},options)).toThrow(/local owner/);
  expect(()=>authorizeOptions({...owner,user:{...owner.user,id:'friend',role:'trusted'}},options)).toThrow(/local owner/);
});
it('host tools require a controller-issued capability and cannot turn model arguments into grants',()=>{
  const context: ToolContext={taskId:'task',agentId:'agent',workspaceId:null,access:'unrestricted',allowedTools:['host_read'],approved:false,signal:new AbortController().signal};
  const request={id:'proposal',name:'host_read',arguments:{path:'C:/project/note.txt'}};
  expect(decide(context,request,false).decision).toBe('deny');
  expect(decide({...context,hostAccess:true},request,false).decision).toBe('allow');
  expect(decide({...context,hostAccess:true}, {...request,arguments:{...request.arguments,hostAccess:true}},false).decision).toBe('deny');
  expect(decide({...context,hostAccess:true,access:'read_only'},request,false).decision).toBe('deny');
  expect(decide({...context,hostAccess:true},request,true).decision).toBe('deny');
  const controller=new AbortController();controller.abort();
  expect(decide({...context,hostAccess:true,signal:controller.signal},request,false).decision).toBe('deny');
});
