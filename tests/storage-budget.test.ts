import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {StorageBudget} from '../server/tools/storage-budget.js';
import {ToolBroker} from '../server/tools/index.js';
let root:string;
afterEach(async()=>{vi.restoreAllMocks();if(root)await rm(root,{recursive:true,force:true});});
async function fixture(){root=await mkdtemp(join(tmpdir(),'relay-storage-'));for(const path of ['workspaces','baselines','checkpoints','runs','git-runs']){await mkdir(join(root,path));await writeFile(join(root,path,'content'),'1234567890');}return root;}
it('accounts for snapshots, baselines, checkpoints and temporary copies before allowing growth',async()=>{
  const budget=new StorageBudget(await fixture(),{limitBytes:60,reserveBytes:10,disk:async()=>({total:1000,available:500})});
  expect(await budget.assertCapacity(10)).toMatchObject({usedBytes:50,limitBytes:60});await expect(budget.assertCapacity(11)).rejects.toThrow(/storage/i);
});
it('retains host disk headroom even when the application quota has room',async()=>{
  const budget=new StorageBudget(await fixture(),{limitBytes:1000,reserveBytes:200,disk:async()=>({total:1000,available:210})});
  await expect(budget.assertCapacity(11)).rejects.toThrow(/disk/i);await expect(budget.assertCapacity(10)).resolves.toBeDefined();
});
it('includes private publication journals when admitting unrelated managed writes',async()=>{
  const budget=new StorageBudget(await fixture(),{limitBytes:65,reserveBytes:10,disk:async()=>({total:1000,available:500})});
  await mkdir(join(root,'publications'));await writeFile(join(root,'publications','review.json'),'1234567890');
  expect((await budget.assertCapacity(5)).usedBytes).toBe(60);await expect(budget.assertCapacity(6)).rejects.toThrow(/quota/i);
});
it('enforces the content ceiling even before any managed directories exist',async()=>{
  root=await mkdtemp(join(tmpdir(),'relay-storage-empty-'));const budget=new StorageBudget(root,{limitBytes:10,reserveBytes:1,disk:async()=>({total:1000,available:500})});await expect(budget.assertCapacity(11)).rejects.toThrow(/quota/i);
});
it('never interprets missing disk telemetry as free space',async()=>{
  const budget=new StorageBudget(await fixture(),{disk:async()=>{throw new Error('Disk telemetry failed');}});await expect(budget.assertCapacity(1)).rejects.toThrow(/disk/i);
});
it('counts only controlled artifact directories and rejects nonfinite reservation sizes',async()=>{
  const budget=new StorageBudget(await fixture(),{limitBytes:60,reserveBytes:10,disk:async()=>({total:1000,available:500})});
  await writeFile(join(root,'database-private-file'),'not part of managed artifacts');expect((await budget.assertCapacity(0)).usedBytes).toBe(50);
  await expect(budget.assertCapacity(NaN)).rejects.toThrow();await expect(budget.assertCapacity(-1)).rejects.toThrow();
});
it('rejects a broker write before a file or checkpoint changes when disk capacity is unavailable',async()=>{
  root=await mkdtemp(join(tmpdir(),'relay-storage-broker-'));const broker=new ToolBroker(root,()=>false);const workspace=await broker.createWorkspace('Quota test');
  vi.spyOn(StorageBudget.prototype,'assertCapacity').mockRejectedValue(new Error('Disk reserve unavailable'));
  await expect(broker.execute({taskId:'test',agentId:'worker',workspaceId:workspace.id,access:'workspace',allowedTools:['file_write'],approved:false,signal:new AbortController().signal},{id:'write',name:'file_write',arguments:{path:'must-not-exist.txt',content:'Denied',expectedHash:null}})).rejects.toThrow(/disk/i);
  expect(await broker.listFiles(workspace.id)).toEqual([]);expect(await broker.changes('test')).toEqual([]);
});
