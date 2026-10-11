import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireServiceLock} from '../server/host/service-lock.js';

const scenario=vi.hoisted(()=>({path:'',held:9007199254740992n,current:9007199254740993n,links:1n}));
vi.mock('node:fs/promises',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:fs/promises')>();
  const identity=(value:bigint,options:unknown)=>options&&typeof options==='object'&&'bigint' in options&&options.bigint?value:Number(value);
  return {
    ...actual,
    open:async(...args:Parameters<typeof actual.open>)=>{
      const handle=await actual.open(...args);
      if(args[0]===scenario.path&&args[1]==='wx'){
        const stat=handle.stat.bind(handle);
        vi.spyOn(handle,'stat').mockImplementation(async options=>Object.assign(await stat(options),{
          ino:identity(scenario.held,options),nlink:identity(scenario.links,options),
        }));
      }
      return handle;
    },
    lstat:async(...args:Parameters<typeof actual.lstat>)=>{
      const stat=await actual.lstat(...args);
      return args[0]===scenario.path?Object.assign(stat,{ino:identity(scenario.current,args[1])}):stat;
    },
  };
});
const roots:string[]=[];
afterEach(async()=>{scenario.path='';vi.restoreAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});

for(const kind of ['rounded identity collision','unlinked handle with reused identity'] as const){
  it(`preserves a replacement lock despite ${kind}`,async()=>{
    const root=await mkdtemp(join(tmpdir(),'relay-lock-identity-'));roots.push(root);
    scenario.path=join(root,'service.lock');
    scenario.held=9007199254740992n;
    scenario.current=kind==='rounded identity collision'?9007199254740993n:scenario.held;
    scenario.links=kind==='rounded identity collision'?1n:0n;
    expect(Number(scenario.held)).toBe(Number(scenario.current));
    const lock=await acquireServiceLock(root);
    await unlink(scenario.path);await writeFile(scenario.path,'12345');
    await expect(lock.release()).rejects.toThrow(/identity changed/i);
    expect(await readFile(scenario.path,'utf8')).toBe('12345');
  });
}
