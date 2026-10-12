import {describe,expect,it} from 'vitest';
import {activityReplayCursor,activityReplayScope} from '../server/api/activity-replay';
import type {Principal} from '../server/auth/policy';

const principal={user:{id:'one',sessionVersion:0},sessionId:'browser-one',remote:false} as Principal;
describe('authenticated replay namespace',()=>{
  it('is stable for one Store/session and changes across principals, revocation and host restarts',()=>{
    const store={},scope=activityReplayScope(store,principal);expect(scope).toMatch(/^[a-f0-9]{64}$/);expect(activityReplayScope(store,principal)).toBe(scope);
    for(const next of [{...principal,sessionId:'browser-two'},{...principal,user:{...principal.user,id:'two'}},{...principal,user:{...principal.user,sessionVersion:1}},{...principal,remote:true}])expect(activityReplayScope(store,next)).not.toBe(scope);
    expect(activityReplayScope({},principal)).not.toBe(scope);
  });
  it('accepts Last-Event-ID only within the matching scope and current event head',()=>{
    expect(activityReplayCursor('scope','scope',3,'5',10)).toBe(5);
    expect(activityReplayCursor('scope','old',3,'5',10)).toBe(0);
    expect(activityReplayCursor('scope',undefined,3,'5',10)).toBe(0);
    expect(activityReplayCursor('scope','scope',90,'5',10)).toBe(0);
    expect(activityReplayCursor('scope','scope',3,'50',10)).toBe(0);
    expect(activityReplayCursor('scope','scope',3,'NaN',10)).toBe(3);
    expect(activityReplayCursor('scope','scope',3,String(Number.MAX_SAFE_INTEGER+1),10)).toBe(3);
    expect(()=>activityReplayCursor('scope','scope',0,undefined,NaN)).toThrow(/invalid/);
  });
});
