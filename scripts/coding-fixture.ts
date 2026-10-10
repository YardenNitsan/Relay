// Source corpus preparation only. Repository code is never imported or executed
// here; the acceptance driver sends it to the existing isolated Node profile.
import {execFileSync} from 'node:child_process';
import {boundedText,sha256} from '../server/tools/files.js';
import {FILE_COUNT_LIMIT,FILE_LIMIT,safePath,WORKSPACE_LIMIT} from '../server/tools/platform.js';

export const fixtureCommit='d1e19fef2f60a6fbfddf920ef8efd8ae6b4e4988';
export const targetPaths=['shared/task-deadline.ts','web/task-progress.ts'] as const;
export const visibleTestPath='tests/relay-acceptance.test.mjs';
export const sandboxImage='sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1';
export interface CorpusManifest {commit:string;trackedPaths:number;files:number;bytes:number;omissions:{path:string;reason:string}[];hashes:Record<string,string>}

export function codingCorpus(repository:string):{files:Map<string,string>;manifest:CorpusManifest} {
  const git=(argv:string[],input?:string)=>execFileSync('git',argv,{cwd:repository,input,windowsHide:true,timeout:30_000,maxBuffer:WORKSPACE_LIMIT+1_000_000});
  const entries=git(['ls-tree','-rz','-l',fixtureCommit]).toString('utf8').split('\0').filter(Boolean);
  const omissions:CorpusManifest['omissions']=[],selected:{path:string;oid:string;size:number}[]=[];let bytes=0;
  for(const entry of entries){
    const match=/^(\d+) (\w+) ([a-f0-9]{40}) +(-|\d+)\t([\s\S]+)$/.exec(entry);
    if(!match)throw new Error('Unexpected Git tree record');
    const [,mode,type,oid,sizeText,path]=match,size=Number(sizeText);
    let reason='';
    if(!['100644','100755'].includes(mode)||type!=='blob')reason='Non-regular Git entry';
    else if(!Number.isSafeInteger(size)||size>FILE_LIMIT)reason='File exceeds bounded text policy';
    else try{safePath(path);}catch(error){reason=String(error);}
    if(reason){omissions.push({path,reason});continue;}
    if(selected.length>=FILE_COUNT_LIMIT||bytes+size>WORKSPACE_LIMIT)throw new Error('Corpus exceeds existing workspace limits');
    selected.push({path,oid,size});bytes+=size;
  }
  const objects=git(['cat-file','--batch'],selected.map(entry=>entry.oid).join('\n')+'\n');let offset=0;
  const files=new Map<string,string>();
  for(const entry of selected){
    const end=objects.indexOf(10,offset);if(end<0)throw new Error('Truncated Git batch header');
    const expected=`${entry.oid} blob ${entry.size}`;
    if(objects.subarray(offset,end).toString('ascii')!==expected)throw new Error('Git batch identity mismatch');
    offset=end+1;const content=objects.subarray(offset,offset+entry.size);offset+=entry.size;
    if(objects[offset++]!==10)throw new Error('Truncated Git blob');
    try{const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(content);boundedText(text);files.set(entry.path,text);}
    catch{omissions.push({path:entry.path,reason:'Non-UTF-8 or binary content'});}
  }
  if(offset!==objects.length)throw new Error('Unexpected trailing Git batch output');
  for(const path of targetPaths)if(!files.has(path))throw new Error(`Missing acceptance target ${path}`);
  if(files.has(visibleTestPath))throw new Error('Acceptance harness collides with versioned source');
  files.set(visibleTestPath,visibleHarness);
  return {files,manifest:{commit:fixtureCommit,trackedPaths:entries.length,files:files.size,bytes:[...files.values()].reduce((n,text)=>n+Buffer.byteLength(text),0),omissions,hashes:Object.fromEntries([...files].map(([path,text])=>[path,sha256(text)]))}};
}

export function seededCorpus(pristine:Map<string,string>):Map<string,string>{
  const result=new Map(pristine);
  for(const [path,before,after] of [
    [targetPaths[0],'seconds*1000','seconds'],
    [targetPaths[1],'if(event.taskId!==task.id)continue;',''],
  ]){
    const text=result.get(path)!;if(text.split(before).length!==2)throw new Error(`Seed no longer matches fixed source: ${path}`);
    result.set(path,text.replace(before,after));
  }
  return result;
}

export const visibleHarness=`import test from 'node:test';
import assert from 'node:assert/strict';
import {taskDeadlineMs} from '../shared/task-deadline.ts';
import {taskProgress} from '../web/task-progress.ts';
test('overall deadline is expressed in host clock milliseconds',()=>{
  assert.equal(taskDeadlineMs({createdAt:'2026-10-10T12:00:00.000Z',options:{budget:{maxElapsedSeconds:60}}}),Date.parse('2026-10-10T12:01:00.000Z'));
});
test('activity belongs to the selected task',()=>{
  const events=[{taskId:'selected',type:'TOOL_STARTED',data:{tool:'file_read'}},{taskId:'other',type:'TOOL_STARTED',data:{tool:'host_delete'}}];
  assert.equal(taskProgress({id:'selected',status:'executing'},events),'Reading authorized files.');
});
`;

// Independent assertions stay outside the model workspace, including edge cases
// not present in its visible harness. A two-fault task is not a broad benchmark.
export const independentHarness=`import test from 'node:test';
import assert from 'node:assert/strict';
import {taskDeadlineMs} from './shared/task-deadline.ts';
import {taskProgress} from './web/task-progress.ts';
const createdAt='2024-02-29T23:59:59.500Z';
for(const seconds of [30,31,3600,86400,604800])test('deadline '+seconds,()=>assert.equal(taskDeadlineMs({createdAt,options:{budget:{maxElapsedSeconds:seconds}}}),Date.parse(createdAt)+seconds*1000));
test('invalid and legacy deadlines',()=>{
 for(const seconds of [0,29,30.5,604801])assert.ok(Number.isNaN(taskDeadlineMs({createdAt,options:{budget:{maxElapsedSeconds:seconds}}})));
 assert.equal(taskDeadlineMs({createdAt,options:{budget:{}}}),null);
});
test('unrelated activity cannot change fallback or earlier selected activity',()=>{
 const task={id:'kept',status:'executing'};
 const others=[{taskId:'wrong',type:'AGENT_STARTED',data:{role:'reviewer'}},{taskId:'wrong',type:'TOOL_STARTED',data:{tool:'terminal'}}];
 assert.equal(taskProgress(task,others),'Working on your request.');
 assert.equal(taskProgress(task,[{taskId:'kept',type:'TOOL_STARTED',data:{tool:'file_search'}},...others]),'Searching the workspace.');
 assert.equal(taskProgress(task,[...others,{taskId:'kept',type:'AGENT_STARTED',data:{role:'reviewer'}}]),'Checking the answer.');
 assert.equal(taskProgress({...task,status:'waiting_for_approval'},others),'Waiting for your approval.');
});
`;

export function independentlyGradeTree(before:Map<string,string>,after:Map<string,string>):void {
  if(before.size!==after.size)throw new Error('Model added or deleted files outside the two-target repair');
  for(const [path,text] of before){
    if(!after.has(path))throw new Error(`Missing file: ${path}`);
    if(!(targetPaths as readonly string[]).includes(path)&&after.get(path)!==text)throw new Error(`Unrelated file changed: ${path}`);
  }
  for(const path of targetPaths)if(before.get(path)===after.get(path))throw new Error(`Target was not repaired: ${path}`);
}
