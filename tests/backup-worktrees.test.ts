import {randomUUID} from 'node:crypto';
import {access,mkdir,mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {createBackup,restoreBackup} from '../server/db/backup';
import {openDatabase} from '../server/db/database';
import {Store} from '../server/db/store';
import {ToolBroker} from '../server/tools';
import {ToolStore} from '../server/tools/store';
import {ManagedWorktrees} from '../server/tools/git-worktrees';
import {gitCommand,trustedGitBinary,type GitExecution} from '../server/tools/git-process';

it('restores real linked worktrees into a new root without the original, preserving dirty files and unpublished registrations',async()=>{
  const root=await mkdtemp(join(tmpdir(),'relay-backup-worktrees-'));
  const source=join(root,'source'),backup=join(root,'encrypted'),archived=join(root,'unavailable-original');
  const passphrase=Buffer.from('fixture-only-worktree-backup-passphrase');
  let broker:ToolBroker|undefined;
  try{
    await mkdir(source);await writeFile(join(source,'backend.json'),JSON.stringify({format:1,backend:'embedded'}));
    const db=await openDatabase(join(source,'postgres'));
    let first!:Awaited<ReturnType<ToolBroker['forkWorkspace']>>,second!:typeof first,parent!:Awaited<ReturnType<ToolBroker['createWorkspace']>>;
    const interruptedId=randomUUID();
    try{
      const store=new Store(db);await store.init();broker=new ToolBroker(source,()=>false);
      parent=await broker.createWorkspace('Parent',undefined,'owner');await store.saveWorkspace(parent);
      await writeFile(join(source,'workspaces',parent.id,'files','example.txt'),'baseline\r\n');
      first=await broker.forkWorkspace(parent.id,'First',async()=>{},workspace=>store.saveWorkspace(workspace));
      second=await broker.forkWorkspace(first.id,'Second',async()=>{},workspace=>store.saveWorkspace(workspace));
      await writeFile(join(source,'workspaces',first.id,'files','example.txt'),'dirty first\n');
      const interruptedRoot=join(source,'workspaces',interruptedId,'files');
      await expect(new ManagedWorktrees(new ToolStore(source)).create(parent.id,interruptedId,new Map([['pending.txt','pending']]),new AbortController().signal,()=>{},async()=>{
        if(await access(join(interruptedRoot,'.git')).then(()=>true,()=>false))throw new Error('authorization revoked after registration');
      })).rejects.toThrow('authorization revoked after registration');
    }finally{await broker?.stopAll();broker=undefined;await db.close();}
    const beforeGit=await readFile(join(source,'workspaces',first.id,'files','.git'),'utf8');
    const beforeJournal=await readFile(join(source,'git-projects',parent.id,'operations',`${interruptedId}.json`),'utf8');
    await createBackup({sourceDir:source,backupDir:backup,passphrase});
    await rename(source,archived); // Original absolute pointers now lead to a nonexistent path.
    const restored=await restoreBackup({backupDir:backup,destinationDir:join(root,'restore'),passphrase});
    const firstRoot=join(restored.dataDirectory,'workspaces',first.id,'files'),secondRoot=join(restored.dataDirectory,'workspaces',second.id,'files');
    const emptyDirectory=join(root,'empty');await mkdir(emptyDirectory);const emptyFile=join(root,'empty-config');await writeFile(emptyFile,'');
    const execution:GitExecution={binary:await trustedGitBinary(),directory:root,emptyDirectory,emptyFile,signal:new AbortController().signal};
    for(const [workspace,path] of [[first,firstRoot],[second,secondRoot]] as const){
      expect((await gitCommand(execution,['-C',path,'rev-parse','HEAD'])).stdout.trim()).toBe(workspace.git!.baseCommit);
      expect((await gitCommand(execution,['-C',path,'symbolic-ref','HEAD'])).stdout.trim()).toBe(`refs/heads/${workspace.git!.branch}`);
      expect((await gitCommand(execution,['-C',path,'show',':example.txt'])).stdout).toBe('baseline\r\n');
    }
    expect(await readFile(join(firstRoot,'example.txt'),'utf8')).toBe('dirty first\n');
    expect(await readFile(join(secondRoot,'example.txt'),'utf8')).toBe('baseline\r\n');
    const restoredTools=new ToolStore(restored.dataDirectory);
    expect((await restoredTools.workspaces()).map(workspace=>workspace.id).sort()).toEqual([parent.id,first.id,second.id].sort());
    expect(await readFile(join(restored.dataDirectory,'git-projects',parent.id,'operations',`${interruptedId}.json`),'utf8')).toBe(beforeJournal);
    await expect(access(join(restored.dataDirectory,'git-projects',parent.id,'operations',`${interruptedId}.ready.json`))).rejects.toMatchObject({code:'ENOENT'});
    expect((await gitCommand(execution,['-C',join(restored.dataDirectory,'workspaces',interruptedId,'files'),'symbolic-ref','HEAD'])).stdout.trim()).toBe(`refs/heads/relay/${interruptedId}`);
    expect(await readFile(join(archived,'workspaces',first.id,'files','.git'),'utf8')).toBe(beforeGit);
    await expect(access(source)).rejects.toMatchObject({code:'ENOENT'});
    const restoredDb=await openDatabase(join(restored.dataDirectory,'postgres'));
    try{
      expect((await restoredDb.query("SELECT value FROM settings WHERE key='restoration_pending'"))[0].value).toBe(true);
      expect((await restoredDb.query("SELECT metadata FROM audit_events WHERE operation='BACKUP_RESTORED'"))[0].metadata).toMatchObject({repairedWorktrees:3,restorationPending:true});
      expect((await restoredDb.query('SELECT id FROM workspaces')).map(row=>row.id).sort()).toEqual([parent.id,first.id,second.id].sort());
    }finally{await restoredDb.close();}
  }finally{passphrase.fill(0);await broker?.stopAll();await rm(root,{recursive:true,force:true});}
},120000);
