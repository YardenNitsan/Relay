import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolBroker } from '../server/tools';
import { sha256 } from '../server/tools/files';
import type { ToolContext, ToolRequest } from '../shared/types';

let directory:string;let broker:ToolBroker;let context:ToolContext;
const request=(name:string,args:Record<string,unknown>={}):ToolRequest=>({id:'tool',name,arguments:args});
beforeEach(async()=>{
  directory=await mkdtemp(join(tmpdir(),'relay-git-tools-'));
  const source=join(directory,'source');await mkdir(join(source,'.git'),{recursive:true});
  await writeFile(join(source,'hello.txt'),'Before\n');await writeFile(join(source,'.git','config'),'[core]\nrepositoryFormatVersion = malicious\n');
  await writeFile(join(source,'.gitattributes'),'* diff=evil filter=evil\n');
  broker=new ToolBroker(join(directory,'data'),()=>false);const workspace=await broker.createWorkspace('Git inspection',source);
  context={taskId:'task',agentId:'reviewer',workspaceId:workspace.id,access:'workspace',allowedTools:broker.definitions().map(item=>item.name),signal:new AbortController().signal,approved:false};
});
afterEach(async()=>{await broker.stopAll();await rm(directory,{recursive:true,force:true});});
describe('actual Git inspection of managed snapshots',()=>{
  it('reports actual Git changes against the import baseline without changing the source',async()=>{
    const baseline=JSON.parse((await broker.execute({...context,access:'read_only'},request('git_status'))).content);
    expect(baseline.files).toEqual([]);expect(baseline.baseline.kind).toBe('workspace_creation');expect(baseline.engine).toMatch(/^git /);
    await broker.execute(context,request('file_write',{path:'hello.txt',content:'After\n',expectedHash:sha256('Before\n')}));
    await broker.execute(context,request('file_write',{path:'space and שלום.txt',content:'Added\n',expectedHash:null}));
    const status=JSON.parse((await broker.execute(context,request('git_status'))).content);
    expect(status.files).toEqual(expect.arrayContaining([{path:'hello.txt',status:'modified'},{path:'space and שלום.txt',status:'added'}]));
    const diff=JSON.parse((await broker.execute(context,request('git_diff',{path:'hello.txt'}))).content);
    expect(diff.content).toContain('-Before');expect(diff.content).toContain('+After');expect(diff.content).not.toContain('Added');
    expect(await readFile(join(directory,'source','hello.txt'),'utf8')).toBe('Before\n');
    expect(await readdir(join(directory,'data','git-runs'))).toEqual([]);
  });
  it('ignores inherited Git configuration, helpers and source attributes while comparing raw bytes',async()=>{
    const keys=['GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0','GIT_CONFIG_GLOBAL','GIT_EXTERNAL_DIFF','GIT_DIR'];const original=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
    const evil=join(directory,'evil-config');await writeFile(evil,'[core]\nrepositoryFormatVersion = invalid\n[diff "evil"]\ncommand = malicious-nonexistent-helper\n[filter "evil"]\nrequired = true\nclean = malicious-nonexistent-helper\n');
    Object.assign(process.env,{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.repositoryFormatVersion',GIT_CONFIG_VALUE_0:'invalid',GIT_CONFIG_GLOBAL:evil,GIT_EXTERNAL_DIFF:'malicious-nonexistent-helper',GIT_DIR:join(directory,'source','.git')});
    try {
      await broker.upload(context.workspaceId!,'hello.txt','Raw bytes\n');const diff=JSON.parse((await broker.execute(context,request('git_diff'))).content);
      expect(diff.content).toContain('+Raw bytes');expect(diff.engine).toMatch(/^git /);
    } finally {for(const key of keys){if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];}}
  });
  it('labels first inspection of a legacy workspace honestly and persists that baseline',async()=>{
    await rm(join(directory,'data','baselines',context.workspaceId!),{recursive:true,force:true});
    await broker.upload(context.workspaceId!,'hello.txt','Legacy now\n');const first=JSON.parse((await broker.execute(context,request('git_status'))).content);
    expect(first.baseline.kind).toBe('first_inspection');expect(first.files).toEqual([]);
    broker=new ToolBroker(join(directory,'data'),()=>false);await broker.upload(context.workspaceId!,'hello.txt','Later\n');
    expect(JSON.parse((await broker.execute(context,request('git_diff'))).content).content).toContain('-Legacy now');
  });
  it('rejects path traversal, no workspace and cancellation before invoking Git',async()=>{
    expect(broker.decide(context,request('git_diff',{path:'../source/.git/config'})).decision).toBe('deny');
    expect(broker.decide({...context,workspaceId:null},request('git_status')).decision).toBe('deny');
    const controller=new AbortController();controller.abort();await expect(broker.execute({...context,signal:controller.signal},request('git_status'))).rejects.toThrow(/cancel/i);
  });
  it('truncates large diffs while retaining truthful Git and baseline metadata',async()=>{
    await broker.upload(context.workspaceId!,'large.txt',Array.from({length:7000},(_,index)=>`Line ${index} of output`).join('\n'));
    const diff=JSON.parse((await broker.execute(context,request('git_diff'))).content);
    expect(diff.truncated).toBe(true);expect(diff.content.length).toBeLessThanOrEqual(32768);expect(diff.engine).toMatch(/^git /);
  });
});
