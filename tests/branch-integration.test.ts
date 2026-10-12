import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ToolBroker} from '../server/tools';
import {ToolStore} from '../server/tools/store';
import {sha256} from '../server/tools/files';
import type {Workspace} from '../shared/types';
import {UncertainToolEffect} from '../server/tools/errors';

let directory:string,broker:ToolBroker,parent:Workspace,child:Workspace;
const authorize=async()=>{};
beforeEach(async()=>{
  directory=await mkdtemp(join(tmpdir(),'relay-integration-'));broker=new ToolBroker(directory,()=>false);
  parent=await broker.createWorkspace('Parent');await broker.upload(parent.id,'a.txt','base');await broker.upload(parent.id,'remove.txt','remove');
  child=await broker.forkWorkspace(parent.id,'Child',authorize,async()=>{});
});
afterEach(async()=>{vi.restoreAllMocks();await broker.stopAll();await rm(directory,{recursive:true,force:true,maxRetries:3});});
const review=()=>broker.reviewBranch(child.id,parent.id,authorize);
async function edit(workspace:Workspace,path:string,content:string|null,before:string|null){await broker.changeFile(workspace.id,path,content,before===null?null:sha256(before),authorize);}
async function changed(){await edit(child,'a.txt','child','base');return review();}

it('integrates reviewed create/edit/delete changes, preserves independent parent files and leaves child bytes intact',async()=>{
  await edit(child,'a.txt','child','base');await edit(child,'remove.txt',null,'remove');await edit(child,'new/deep.txt','new',null);await edit(parent,'parent-only.txt','parent',null);
  const preview=await review();expect(preview.entries.map(entry=>[entry.path,entry.status])).toEqual([['a.txt','ready'],['new/deep.txt','ready'],['remove.txt','ready']]);
  const result=await broker.integrateBranch(child.id,parent.id,preview.digest,preview.entries.map(entry=>entry.path),authorize);
  expect(result.state).toBe('committed');expect((await broker.readFile(parent.id,'a.txt')).content).toBe('child');expect((await broker.readFile(child.id,'a.txt')).content).toBe('child');expect((await broker.readFile(parent.id,'parent-only.txt')).content).toBe('parent');expect(await broker.listFiles(parent.id)).toEqual(['a.txt','new/deep.txt','parent-only.txt']);
  const recreated=new ToolBroker(directory,()=>false);expect((await recreated.branchIntegrations(child.id,parent.id,authorize))[0].id).toBe(result.id);
});
it('reports divergent edits and identical already-applied changes without merging guesses',async()=>{
  await edit(child,'a.txt','child','base');await edit(parent,'a.txt','parent','base');await edit(child,'remove.txt',null,'remove');await edit(parent,'remove.txt',null,'remove');
  const preview=await review();expect(preview.entries.map(entry=>[entry.path,entry.status])).toEqual([['a.txt','conflict'],['remove.txt','already_applied']]);
  await expect(broker.integrateBranch(child.id,parent.id,preview.digest,['a.txt'],authorize)).rejects.toThrow(/conflict/i);expect((await broker.readFile(parent.id,'a.txt')).content).toBe('parent');
});
it.each(['parent','child'] as const)('rejects a stale review when %s changes',async(which)=>{
  const preview=await changed();await edit(which==='parent'?parent:child,'later.txt','later',null);
  await expect(broker.integrateBranch(child.id,parent.id,preview.digest,['a.txt'],authorize)).rejects.toThrow(/changed|stale/i);expect((await broker.readFile(parent.id,'a.txt')).content).toBe('base');
});
it.each(['missing','first_inspection'] as const)('refuses a %s fork baseline instead of fabricating an ancestor',async(kind)=>{
  const metadata=join(directory,'baselines',child.id,'metadata.json');if(kind==='missing')await rm(metadata);else await writeFile(metadata,JSON.stringify({kind,createdAt:new Date().toISOString()}));
  await expect(review()).rejects.toThrow(/baseline|ancestor/i);if(kind==='missing')await expect(readFile(metadata)).rejects.toMatchObject({code:'ENOENT'});
});
it('rejects another parent and duplicate or unreviewed selected paths',async()=>{
  const unrelated=await broker.createWorkspace('Unrelated');await expect(broker.reviewBranch(child.id,unrelated.id,authorize)).rejects.toThrow(/parent/i);
  const preview=await changed();for(const paths of [['a.txt','a.txt'],['../escape'],['not-in-review.txt'],[]])await expect(broker.integrateBranch(child.id,parent.id,preview.digest,paths,authorize)).rejects.toThrow();
  expect((await broker.readFile(parent.id,'a.txt')).content).toBe('base');
});
it('reads the exact base, parent and child for a selected file without writing',async()=>{
  const preview=await changed();expect(await broker.branchFile(child.id,parent.id,'a.txt',preview.digest,authorize)).toMatchObject({path:'a.txt',base:'base',parent:'base',child:'child'});expect((await broker.readFile(parent.id,'a.txt')).content).toBe('base');
});
it('rejects authorization after queueing and again immediately before filesystem publication',async()=>{
  const preview=await changed();await expect(broker.integrateBranch(child.id,parent.id,preview.digest,['a.txt'],async()=>{throw new Error('revoked');})).rejects.toThrow('revoked');
  const saved=ToolStore.prototype.saveCheckpoint;let prepared=false;
  vi.spyOn(ToolStore.prototype,'saveCheckpoint').mockImplementation(async function(this:ToolStore,checkpoint){await saved.call(this,checkpoint);if(checkpoint.taskId===`branch-${child.id}`&&checkpoint.state==='prepared')prepared=true;});
  await expect(broker.integrateBranch(child.id,parent.id,preview.digest,['a.txt'],async()=>{if(prepared)throw new Error('revoked at effect');})).rejects.toBeInstanceOf(UncertainToolEffect);
  expect((await broker.readFile(parent.id,'a.txt')).content).toBe('base');expect((await broker.branchIntegrations(child.id,parent.id,authorize))[0].state).toBe('prepared');
  await expect(broker.integrateBranch(child.id,parent.id,preview.digest,['a.txt'],authorize)).rejects.toThrow(/uncertain|interrupted/i);
});
it('rejects file/directory collisions before applying any selected change',async()=>{
  await edit(child,'folder/nested.txt','child',null);await edit(parent,'folder','parent',null);
  const preview=await review();expect(preview.entries[0]).toMatchObject({path:'folder/nested.txt',status:'conflict'});
  await expect(broker.integrateBranch(child.id,parent.id,preview.digest,['folder/nested.txt'],authorize)).rejects.toThrow(/conflict/i);
});
it('rolls back a committed integration only against its unchanged parent bytes',async()=>{
  const preview=await changed();const applied=await broker.integrateBranch(child.id,parent.id,preview.digest,['a.txt'],authorize);
  await broker.revertBranch(child.id,parent.id,applied.id,authorize);expect((await broker.readFile(parent.id,'a.txt')).content).toBe('base');expect((await broker.branchIntegrations(child.id,parent.id,authorize)).find(receipt=>receipt.id===applied.id)?.state).toBe('reverted');expect((await broker.readFile(child.id,'a.txt')).content).toBe('child');
});
it('refuses rollback after a later parent edit and rejects another branch checkpoint',async()=>{
  const preview=await changed();const applied=await broker.integrateBranch(child.id,parent.id,preview.digest,['a.txt'],authorize);await edit(parent,'a.txt','later','child');
  await expect(broker.revertBranch(child.id,parent.id,applied.id,authorize)).rejects.toThrow(/conflict|changed/i);expect((await broker.readFile(parent.id,'a.txt')).content).toBe('later');
  const sibling=await broker.forkWorkspace(parent.id,'Sibling',authorize,async()=>{});await expect(broker.revertBranch(sibling.id,parent.id,applied.id,authorize)).rejects.toThrow(/another|belongs/i);
});
it('keeps a partial rollback prepared and refuses retry instead of overwriting later work',async()=>{
  await edit(child,'a.txt','child','base');await edit(child,'remove.txt','kept','remove');const preview=await review();
  const applied=await broker.integrateBranch(child.id,parent.id,preview.digest,['a.txt','remove.txt'],authorize);
  let effects=0;const saved=ToolStore.prototype.saveCheckpoint;let rollingBack=false;
  vi.spyOn(ToolStore.prototype,'saveCheckpoint').mockImplementation(async function(this:ToolStore,record){await saved.call(this,record);if(record.revertsCheckpointId&&record.state==='prepared')rollingBack=true;});
  await expect(broker.revertBranch(child.id,parent.id,applied.id,async()=>{if(rollingBack&&++effects===2)throw new Error('Revoked between rollback files');})).rejects.toBeInstanceOf(UncertainToolEffect);
  expect((await broker.readFile(parent.id,'remove.txt')).content).toBe('remove');expect((await broker.readFile(parent.id,'a.txt')).content).toBe('child');
  expect((await broker.branchIntegrations(child.id,parent.id,authorize)).some(record=>record.state==='prepared'&&record.revertsCheckpointId===applied.id)).toBe(true);
  await expect(broker.revertBranch(child.id,parent.id,applied.id,authorize)).rejects.toThrow(/interrupted/i);
});
it('rejects cancelled and emergency-stopped integrations before modifying files',async()=>{
  const preview=await changed(),controller=new AbortController();controller.abort();await expect(broker.integrateBranch(child.id,parent.id,preview.digest,['a.txt'],authorize,controller.signal)).rejects.toThrow(/cancel/i);
  let reached=()=>{},release=()=>{};const entered=new Promise<void>(resolve=>{reached=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
  const operation=broker.integrateBranch(child.id,parent.id,preview.digest,['a.txt'],async()=>{reached();await held;});const outcome=expect(operation).rejects.toThrow(/Emergency stop/i);await entered;await broker.stopAll();release();await outcome;expect((await broker.readFile(parent.id,'a.txt')).content).toBe('base');
});
it.each(['before','after'] as const)('closes an interrupted receipt only after independently verifying the complete %s state',async(state)=>{
  const preview=await changed();const saved=ToolStore.prototype.saveCheckpoint;
  vi.spyOn(ToolStore.prototype,'saveCheckpoint').mockImplementation(async function(this:ToolStore,record){if(record.taskId===`branch-${child.id}`&&record.state==='committed')throw new Error('Lost commit receipt');return saved.call(this,record);});
  await expect(broker.integrateBranch(child.id,parent.id,preview.digest,['a.txt'],authorize)).rejects.toBeInstanceOf(UncertainToolEffect);vi.restoreAllMocks();
  if(state==='before')await edit(parent,'a.txt','base','child');const receipt=(await broker.branchIntegrations(child.id,parent.id,authorize))[0];
  const result=await broker.reconcileBranch(child.id,parent.id,receipt.id,authorize);expect(result.state).toBe(state==='after'?'committed':'reverted');expect((await broker.readFile(parent.id,'a.txt')).content).toBe(state==='after'?'child':'base');
});
it('refuses to reconcile mixed file states and blocks sibling integration into that uncertain parent',async()=>{
  await edit(child,'a.txt','child','base');await edit(child,'remove.txt','child second','remove');const preview=await review();
  let prepared=false,effects=0;const saved=ToolStore.prototype.saveCheckpoint;
  vi.spyOn(ToolStore.prototype,'saveCheckpoint').mockImplementation(async function(this:ToolStore,record){await saved.call(this,record);if(record.taskId===`branch-${child.id}`&&record.state==='prepared')prepared=true;});
  await expect(broker.integrateBranch(child.id,parent.id,preview.digest,['a.txt','remove.txt'],async()=>{if(prepared&&++effects===2)throw new Error('Interrupted');})).rejects.toBeInstanceOf(UncertainToolEffect);vi.restoreAllMocks();
  const receipt=(await broker.branchIntegrations(child.id,parent.id,authorize))[0];await expect(broker.reconcileBranch(child.id,parent.id,receipt.id,authorize)).rejects.toThrow(/mixed|neither/i);
  const sibling=await broker.forkWorkspace(parent.id,'Sibling',authorize,async()=>{});await edit(sibling,'sibling.txt','sibling',null);const next=await broker.reviewBranch(sibling.id,parent.id,authorize);await expect(broker.integrateBranch(sibling.id,parent.id,next.digest,['sibling.txt'],authorize)).rejects.toThrow(/interrupted/i);
});
