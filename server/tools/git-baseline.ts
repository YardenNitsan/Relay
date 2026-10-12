import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { z } from 'zod';
import { copySnapshot, snapshot, type Guard } from './files';
import { inspectPath, readFlags } from './platform';
import type { ToolStore } from './store';
import { StorageBudget } from './storage-budget';

const metadataSchema=z.object({kind:z.enum(['workspace_creation','first_inspection']),createdAt:z.iso.datetime()}).strict();
export type BaselineMetadata=z.infer<typeof metadataSchema>;
export async function captureGitBaseline(store:ToolStore,workspaceId:string,files:Map<string,string>,kind:BaselineMetadata['kind'],guard:Guard):Promise<void> {
  z.uuid().parse(workspaceId);await store.init();guard();
  await new StorageBudget(store.root).assertCapacity([...files.values()].reduce((sum,value)=>sum+Buffer.byteLength(value),8192));guard();
  const stage=await inspectPath(store.root,`baselines/.capture-${randomUUID()}`);
  await mkdir(stage,{mode:0o700});
  try {
    const fileRoot=await inspectPath(stage,'files');await mkdir(fileRoot,{mode:0o700});await copySnapshot(fileRoot,files,guard);
    const handle=await open(await inspectPath(stage,'metadata.json'),'wx',0o600);
    try {await handle.writeFile(JSON.stringify({kind,createdAt:new Date().toISOString()}));await handle.sync();}finally{await handle.close();}
    guard();await rename(stage,await inspectPath(store.root,`baselines/${workspaceId}`));
  } finally {await rm(stage,{recursive:true,force:true,maxRetries:3,retryDelay:25});}
}
export async function readGitBaseline(store:ToolStore,workspaceId:string,current:Map<string,string>,guard:Guard,requireCreation=false):Promise<{metadata:BaselineMetadata;files:Map<string,string>}> {
  z.uuid().parse(workspaceId);await store.init();
  const root=await inspectPath(store.root,`baselines/${workspaceId}`);
  let handle;
  try {handle=await open(await inspectPath(root,'metadata.json'),readFlags());}
  catch(error) {
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    if(requireCreation)throw new Error('The authentic fork baseline is missing; integration cannot infer an ancestor');
    // A legacy workspace has no authentic import snapshot. Record a truthful new baseline.
    await captureGitBaseline(store,workspaceId,current,'first_inspection',guard);
    handle=await open(await inspectPath(root,'metadata.json'),readFlags());
  }
  let metadata:BaselineMetadata;
  try {const stat=await handle.stat();if(!stat.isFile() || stat.nlink!==1 || stat.size>2048)throw new Error('Invalid baseline metadata');metadata=metadataSchema.parse(JSON.parse(await handle.readFile('utf8')));}finally{await handle.close();}
  if(requireCreation&&metadata.kind!=='workspace_creation')throw new Error('Integration requires the original workspace creation baseline');
  const files=await snapshot(await inspectPath(root,'files'),true);guard();return {metadata,files};
}
