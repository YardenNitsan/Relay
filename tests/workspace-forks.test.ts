import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ToolBroker } from '../server/tools';

let directory:string; let broker:ToolBroker;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'relay-fork-registration-'));broker=new ToolBroker(directory,()=>false);});
afterEach(async()=>{await broker.stopAll();await rm(directory,{recursive:true,force:true});});
const authorize=async()=>{};

it('retains a complete registration intent but exposes no child when SQL publication fails',async()=>{
  const parent=await broker.createWorkspace('Parent',undefined,'owner');
  await expect(broker.forkWorkspace(parent.id,'Child',authorize,async()=>{throw new Error('SQL unavailable');})).rejects.toThrow('SQL unavailable');
  expect((await broker.listWorkspaces()).map(w=>w.id)).toEqual([parent.id]);
  const operations=join(directory,'git-projects',parent.id,'operations');
  const names=await readdir(operations);const prepared=names.find(name=>name.endsWith('.registration-prepared.json'))!;
  const record=JSON.parse(await readFile(join(operations,prepared),'utf8'));
  expect(record.workspace).toMatchObject({name:'Child',ownerUserId:'owner',sourcePath:null,git:{parentWorkspaceId:parent.id}});
  expect(names.some(name=>name.endsWith('.registration-published.json'))).toBe(false);
});

it('joins final registration on stop and refuses publishing the child after the stop generation changes',async()=>{
  const parent=await broker.createWorkspace('Parent');
  let reached!:()=>void;let release!:()=>void;
  const ready=new Promise<void>(resolve=>{reached=resolve;});const held=new Promise<void>(resolve=>{release=resolve;});
  const fork=broker.forkWorkspace(parent.id,'Child',authorize,async()=>{reached();await held;});
  const refused=expect(fork).rejects.toThrow(/stop/i);await ready;
  let stopped=false;const stop=broker.stopAll().then(()=>{stopped=true;});await Promise.resolve();expect(stopped).toBe(false);
  release();await stop;await refused;
  expect((await broker.listWorkspaces()).map(w=>w.id)).toEqual([parent.id]);
});

it('rechecks authorization after persistence and retains the intent if the session was revoked',async()=>{
  const parent=await broker.createWorkspace('Parent');let revoked=false;
  const check=async()=>{if(revoked)throw new Error('session revoked');};
  await expect(broker.forkWorkspace(parent.id,'Child',check,async()=>{revoked=true;})).rejects.toThrow('session revoked');
  expect((await broker.listWorkspaces()).map(w=>w.id)).toEqual([parent.id]);
});
