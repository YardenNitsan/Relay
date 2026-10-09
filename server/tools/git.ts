import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { ToolResult } from '../../shared/types';
import { snapshot, type Guard } from './files';
import { inspectPath, OUTPUT_LIMIT, safePath } from './platform';
import type { ToolStore } from './store';
import { readGitBaseline } from './git-baseline';
import { gitCommand, trustedGitBinary, type GitExecution } from './git-process';
import { StorageBudget } from './storage-budget';

function* importSnapshots(baseline:Map<string,string>,current:Map<string,string>):Generator<Buffer> {
  for(const [ref,files] of [['baseline',baseline],['current',current]] as const) {
    yield Buffer.from(`commit refs/heads/${ref}\ncommitter Relay <relay@localhost> 0 +0000\ndata 9\nSnapshot\n\ndeleteall\n`);
    for(const [path,content] of files) {
      safePath(path);const bytes=Buffer.from(content,'utf8');
      yield Buffer.from(`M 100644 inline ${JSON.stringify(path)}\ndata ${bytes.length}\n`);yield bytes;yield Buffer.from('\n');
    }
    yield Buffer.from('\n');
  }
  yield Buffer.from('done\n');
}
export class ManagedGit {
  private readonly active=new Set<AbortController>();
  constructor(private readonly store:ToolStore){}
  stopAll():void {for(const controller of this.active)controller.abort();}
  async inspect(workspaceId:string,root:string,kind:'git_status'|'git_diff',path:string|undefined,taskSignal:AbortSignal,guard:Guard):Promise<ToolResult> {
    const controller=new AbortController();this.active.add(controller);const timeout=setTimeout(()=>controller.abort(),30_000);timeout.unref();
    const signal=AbortSignal.any([controller.signal,taskSignal]);let directory:string|undefined;
    try {
      signal.throwIfAborted();guard();const binary=await trustedGitBinary();const current=await snapshot(root,true);guard();
      const baseline=await readGitBaseline(this.store,workspaceId,current,guard);
      await new StorageBudget(this.store.root).assertCapacity([...baseline.files.values(),...current.values()].reduce((sum,value)=>sum+3*Buffer.byteLength(value),4*1024*1024));guard();
      directory=await inspectPath(this.store.root,`git-runs/${randomUUID()}`);await mkdir(directory,{mode:0o700});
      const emptyDirectory=await inspectPath(directory,'empty');await mkdir(emptyDirectory,{mode:0o700});
      const emptyFile=await inspectPath(directory,'empty-config');await writeFile(emptyFile,'',{flag:'wx',mode:0o600});
      const execution:GitExecution={binary,directory,emptyDirectory,emptyFile,signal};
      const version=(await gitCommand(execution,['--version'],undefined,1024)).stdout.trim();
      const repo=await inspectPath(directory,'objects.git');
      await gitCommand(execution,['init','--bare','--object-format=sha256',`--template=${emptyDirectory}`,repo]);
      const prefix=[`--git-dir=${repo}`];
      await gitCommand(execution,[...prefix,'fast-import','--quiet','--done'],importSnapshots(baseline.files,current));
      guard();const shared=[...prefix,'diff-tree','--no-commit-id','--no-ext-diff','--no-textconv','--no-renames','-r'];
      if(kind==='git_status') {
        const result=await gitCommand(execution,[...shared,'--name-status','-z','refs/heads/baseline','refs/heads/current','--'],undefined,4*1024*1024);
        if(result.truncated)throw new Error('Git status exceeded the inspection limit');
        const values=result.stdout.split('\0');const files:Array<{path:string;status:string}>=[];let total=0;let length=0;
        for(let index=0;index+1<values.length;index+=2){const status=({A:'added',M:'modified',D:'deleted'} as Record<string,string>)[values[index]];if(!status)throw new Error('Unexpected Git status');const item={path:safePath(values[index+1]),status};total++;const bytes=JSON.stringify(item).length;if(length+bytes<=OUTPUT_LIMIT/2){files.push(item);length+=bytes;}}
        guard();return {content:JSON.stringify({engine:version,scope:'managed_workspace_baseline',baseline:baseline.metadata,files,total,truncated:files.length<total,trust:'untrusted'}),evidence:[{kind:'git_status',summary:`Git compared ${total} changed managed files against the Relay baseline`,passed:true,details:{baseline:baseline.metadata,total}}]};
      }
      const result=await gitCommand(execution,[...shared,'-p','--unified=3','refs/heads/baseline','refs/heads/current','--',...(path?[safePath(path)]:[])]);
      guard();return {content:JSON.stringify({engine:version,scope:'managed_workspace_baseline',baseline:baseline.metadata,path:path??null,content:result.stdout,truncated:result.truncated,trust:'untrusted'}),evidence:[{kind:'git_diff',summary:`Git inspected ${path?'one file':'managed file changes'} against the Relay baseline`,passed:true,details:{baseline:baseline.metadata,truncated:result.truncated}}]};
    } finally {
      clearTimeout(timeout);this.active.delete(controller);
      if(directory)await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:25});
    }
  }
}
