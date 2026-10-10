import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ToolStore} from '../server/tools/store.js';
import {snapshot} from '../server/tools/files.js';
import type {DockerSandbox} from '../server/tools/sandbox.js';
import {CodeEvaluationSandbox} from '../server/tools/code-evaluation.js';
import {codeHarnessDigest} from '../server/models/code-evaluation.js';

let root:string,store:ToolStore;
const identity={imageId:`sha256:${'a'.repeat(64)}`,toolchainVersion:'24.0.0',harnessDigest:codeHarnessDigest};
const signal=new AbortController().signal,guard=()=>signal.throwIfAborted();
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'relay-code-eval-'));store=new ToolStore(root);});
afterEach(async()=>{if(dirname(resolve(root))!==resolve(tmpdir())||!basename(root).startsWith('relay-code-eval-'))throw new Error('Unexpected test directory');await rm(root,{recursive:true,force:true});});
function sandbox(){return {status:vi.fn(async()=>({available:true,reason:'Fixture sandbox only'})),run:vi.fn(async(...[path,argv,,signal,guard,profile]:Parameters<DockerSandbox['run']>)=>{signal.throwIfAborted();guard();expect(profile).toBe('node');return {stdout:argv.includes('-e')?'relay-code-evaluation-ready':'[[],[[1,5]],[[1,2],[3,4]],[[1,10]],[[0,0],[2,3]]]',stderr:'',exitCode:0,truncated:false,durationMs:12,files:await snapshot(path,true),imageId:identity.imageId,toolchain:{profile:'node' as const,version:identity.toolchainVersion}};})};}
describe('coding verifier container boundary',()=>{
  it('fails unavailable preflight without preparing or executing generated code',async()=>{
    const adapter=sandbox();adapter.status.mockResolvedValue({available:false,reason:'Pinned image is not installed'});await expect(new CodeEvaluationSandbox(store,adapter).preflight(signal,guard)).rejects.toThrow('Pinned image');expect(adapter.run).not.toHaveBeenCalled();
  });
  it('passes code only as staged data to a fixed isolated command and cleans host staging',async()=>{
    const adapter=sandbox(),verifier=new CodeEvaluationSandbox(store,adapter);expect(await verifier.preflight(signal,guard)).toEqual(identity);
    const source='throw new Error("This fixture must never execute on the host");';const result=await verifier.verify('interval-repair',source,identity,signal,guard);expect(result.grade.passed).toBe(true);expect(result.receipt).toMatchObject({imageId:identity.imageId,toolchainVersion:'24.0.0'});
    expect(adapter.run.mock.calls[1][1]).toEqual(['/usr/local/bin/node','--max-old-space-size=128','/workspace/runner.cjs']);expect(adapter.run.mock.calls[1][2]).toBe(15);expect(await readdir(join(root,'runs'))).toEqual([]);
  });
  it.each(['runner.cjs','solution.cjs','inputs.json'])('rejects altered %s instead of trusting a successful process exit',async name=>{
    const adapter=sandbox(),original=adapter.run.getMockImplementation()!;adapter.run.mockImplementation(async(...args)=>{const result=await original(...args);result.files.set(name,'tampered');return result;});
    await expect(new CodeEvaluationSandbox(store,adapter).verify('interval-repair','module.exports = x => x;',identity,signal,guard)).rejects.toThrow('modified during execution');expect(await readdir(join(root,'runs'))).toEqual([]);
  });
  it('rejects changed image or toolchain identity',async()=>{
    const adapter=sandbox(),original=adapter.run.getMockImplementation()!;adapter.run.mockImplementation(async(...args)=>({...await original(...args),imageId:`sha256:${'b'.repeat(64)}`}));await expect(new CodeEvaluationSandbox(store,adapter).verify('interval-repair','module.exports = x => x;',identity,signal,guard)).rejects.toThrow('identity changed');
  });
});
