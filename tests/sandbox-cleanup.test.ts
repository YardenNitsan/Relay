import {afterEach,describe,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import {DockerSandbox} from '../server/tools/sandbox';
import type {ToolStore} from '../server/tools/store';

vi.mock('node:child_process',()=>({spawn:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
describe('owned sandbox cleanup',()=>{
  it('joins concurrent cleanup instead of racing Docker removal against itself',async()=>{
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    vi.mocked(spawn).mockImplementation(()=>{
      const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:vi.fn()});
      void gate.then(()=>child.emit('close',0));return child as unknown as ReturnType<typeof spawn>;
    });
    const name='relay-00000000-0000-4000-8000-000000000000';
    const forgetContainer=vi.fn(async()=>{});
    const sandbox=new DockerSandbox({containers:async()=>[name],forgetContainer} as unknown as ToolStore);
    const stopping=Promise.all([sandbox.stopAll(),sandbox.stopAll()]);
    try {await vi.waitFor(()=>expect(spawn).toHaveBeenCalled());expect(spawn).toHaveBeenCalledTimes(1);}
    finally {release();await stopping;}
    expect(forgetContainer).toHaveBeenCalledTimes(1);
  });
  it('retains the recovery marker on failure and allows a verified cleanup retry',async()=>{
    let attempts=0;
    vi.mocked(spawn).mockImplementation(()=>{
      const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:vi.fn()});
      const failed=++attempts===1;
      queueMicrotask(()=>{if(failed)child.stderr.write('Daemon unavailable');child.emit('close',failed?1:0);});
      return child as unknown as ReturnType<typeof spawn>;
    });
    const forgetContainer=vi.fn(async()=>{});
    const sandbox=new DockerSandbox({containers:async()=>['relay-00000000-0000-4000-8000-000000000000'],forgetContainer} as unknown as ToolStore);
    await expect(sandbox.stopAll()).rejects.toThrow(/cleanup remains unverified/);
    expect(forgetContainer).not.toHaveBeenCalled();
    await sandbox.stopAll();expect(forgetContainer).toHaveBeenCalledTimes(1);expect(spawn).toHaveBeenCalledTimes(2);
  });
});
