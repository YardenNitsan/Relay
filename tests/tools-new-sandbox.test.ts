import { describe,expect,it } from 'vitest';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { SandboxOutput,sandboxInput } from '../server/tools/sandbox-protocol';
import { SANDBOX_SUPERVISOR } from '../server/tools/sandbox-worker';
import { sandboxArguments } from '../server/tools/sandbox';

const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const result={type:'result',stdout:'ok',stderr:'',exitCode:0,truncated:false,durationMs:20};
const file=(path='hello.txt',text='Hello')=>({type:'file',path,data:Buffer.from(text).toString('base64'),sha256:digest(Buffer.from(text))});
const lines=(values:unknown[])=>Buffer.from(values.map(value=>JSON.stringify(value)).join('\n')+'\n');
describe('bounded container workspace exchange',()=>{
  it('accepts validated text snapshots only after an authentic complete envelope',()=>{
    const output=new SandboxOutput();const data=lines([result,file(),{type:'complete',files:1,bytes:5}]);for(let index=0;index<data.length;index+=7)output.push(data.subarray(index,index+7));const parsed=output.finish();expect(parsed.files.get('hello.txt')).toBe('Hello');expect(parsed.stdout).toBe('ok');
  });
  it.each(['../escape','/etc/passwd','.ssh/key','a\\b','x:stream'])('rejects unsafe exported path %s',(path)=>{const output=new SandboxOutput();expect(()=>output.push(lines([result,file(path)]))).toThrow();});
  it('rejects duplicate paths, wrong hashes, binary data, symlink records and changed totals',()=>{
    for(const values of [[result,file(),file()],[result,{...file(),sha256:'0'.repeat(64)}],[result,{...file(),data:Buffer.from([0,1]).toString('base64')}],[result,{...file(),type:'symlink',target:'/etc/passwd'}],[result,file(),{type:'complete',files:2,bytes:5}]])expect(()=>{const output=new SandboxOutput();output.push(lines(values));output.finish();}).toThrow();
  });
  it('refuses partial output, excess data and records after completion',()=>{
    const partial=new SandboxOutput();partial.push(lines([result,file()]));expect(()=>partial.finish()).toThrow(/complete/i);
    expect(()=>new SandboxOutput().push(Buffer.alloc(2*1024*1024+1,65))).toThrow(/limit/i);
    expect(()=>new SandboxOutput().push(lines([result,{type:'complete',files:0,bytes:0},file()]))).toThrow();
  });
  it('bounds source seeding and never converts model argv into shell syntax',()=>{
    const parts=[...sandboxInput(new Map([['hello.txt','Hello']]),['node','-e','process.exit(0)'],1000)];const records=Buffer.concat(parts).toString('utf8').trim().split('\n').map(line=>JSON.parse(line));expect(records[0].argv).toEqual(['node','-e','process.exit(0)']);expect(records[1].path).toBe('hello.txt');expect(records.at(-1).type).toBe('complete');
    expect(()=>[...sandboxInput(new Map([['../escape','x']]),['node'],1000)]).toThrow();
  });
  it('keeps host mounts read-only and kernel-bounds all writable container volumes',()=>{
    const args=sandboxArguments('/private/supervisor.cjs','relay-00000000-0000-4000-8000-000000000000',`sha256:${'a'.repeat(64)}`,['node','--privileged']);
    expect(args).toContain('--log-driver');expect(args[args.indexOf('--log-driver')+1]).toBe('none');expect(args).toContain('--no-healthcheck');expect(args).toContain('--init');
    const mounts=args.filter((_,index)=>args[index-1]==='--mount');expect(mounts).toEqual(['type=bind,source=/private/supervisor.cjs,target=/relay-supervisor.cjs,readonly']);
    expect(args.some(arg=>arg.startsWith('/workspace:')&&arg.includes('size=64m')&&arg.includes('nr_inodes=10000'))).toBe(true);
    expect(args[args.indexOf('--entrypoint')+1]).toBe('/usr/local/bin/node');expect(args).not.toContain('--privileged');
  });
  it('ships a syntactically valid immutable trusted supervisor',()=>{expect(()=>new Script(SANDBOX_SUPERVISOR)).not.toThrow();});
});
