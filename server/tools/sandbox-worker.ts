/** Fixed preflight runs after dropping UID/GID and before the requested executable. */
export const SANDBOX_CHILD_BOOTSTRAP=String.raw`
'use strict';const fs=require('node:fs');const {spawn}=require('node:child_process');
function fail(){process.stderr.write('Unprivileged execution preflight failed');process.exit(125);}
if(process.getuid()!==1000||process.getgid()!==1000||process.getgroups().some(group=>group!==1000))fail();
const status=fs.readFileSync('/proc/self/status','utf8');
for(const name of ['CapPrm','CapEff','CapInh','CapAmb']){const value=new RegExp('^'+name+':\\s+([a-fA-F0-9]+)$','m').exec(status)?.[1];if(!value||BigInt('0x'+value)!==0n)fail();}
if(!/^NoNewPrivs:\s+1$/m.test(status)||!/^Seccomp:\s+2$/m.test(status))fail();
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',data=>{input+=data;if(input.length>300000)fail();});process.stdin.on('end',()=>{let argv;try{argv=JSON.parse(input);if(!Array.isArray(argv)||!argv.length||argv.some(arg=>typeof arg!=='string'||arg.includes('\0')))fail();}catch{fail();}
const child=spawn(argv[0],argv.slice(1),{shell:false,cwd:'/workspace',env:process.env,stdio:['ignore','inherit','inherit']});child.on('error',()=>{process.stderr.write('Requested executable unavailable');process.exit(127);});child.on('exit',(code,signal)=>process.exit(code??(signal?137:1)));});
`;
/** Fixed trusted code mounted read-only into a Linux container; never interpolates model source. */
export const SANDBOX_SUPERVISOR=String.raw`
'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {spawn}=require('node:child_process');
const FILE=1048576,TOTAL=52428800,COUNT=2000,LINE=2097152,OUTPUT=32768;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function check(value,message){if(!value)throw new Error(message);}
function statusField(text,name){return [...text.matchAll(new RegExp('^'+name+':\\s+([^\\n]+)$','gm'))].at(-1)?.[1].trim();}
function rootPreflight(){
  check(process.platform==='linux'&&Number(process.versions.node.split('.')[0])>=24&&process.getuid()===0&&process.getgid()===0,'Unsupported supervisor runtime');
  process.setgroups([]);check(process.getgroups().every(group=>group===0),'Supplementary groups could not be cleared');
  const status=fs.readFileSync('/proc/self/status','utf8');
  for(const key of ['CapPrm','CapEff','CapBnd'])check(BigInt('0x'+statusField(status,key))===224n,'Unexpected supervisor capability set');
  for(const key of ['CapInh','CapAmb'])check(BigInt('0x'+statusField(status,key))===0n,'Unexpected inherited capability');
  check(statusField(status,'NoNewPrivs')==='1'&&statusField(status,'Seccomp')==='2','Kernel process protections unavailable');
  for(const [mount,size] of [['/workspace',67108864],['/tmp',67108864],['/dev/shm',16777216]]){const stat=fs.statfsSync(mount);check(stat.type===0x01021994&&stat.blocks*stat.bsize<=size,'Unbounded writable mount');}
  for(const mount of ['/workspace','/tmp'])check(fs.statfsSync(mount).files<=10000,'Unbounded writable inodes');
}
function cleanPath(value){check(typeof value==='string'&&value.length>0&&value.length<=2048&&!/[\\:\x00-\x1f\x7f]/.test(value)&&!value.startsWith('/'),'Unsafe exported path');const parts=value.split('/');check(parts.length<=24&&parts.every(part=>part&&part!=='.'&&part!=='..'&&part.length<=200),'Unsafe path segments');return value;}
function readRegular(file){const before=fs.lstatSync(file);check(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1&&before.size<=FILE,'Unsafe generated file');const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const stat=fs.fstatSync(fd);check(stat.ino===before.ino&&stat.dev===before.dev&&stat.nlink===1,'Generated file changed');const bytes=Buffer.alloc(FILE+1);let offset=0;while(offset<bytes.length){const size=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!size)break;offset+=size;}check(offset<=FILE,'Generated file exceeds limit');const data=bytes.subarray(0,offset);const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data);check(!text.includes('\0'),'Generated binary file unsupported');return data;}finally{fs.closeSync(fd);}}
async function seed(){
  let pending='',transferred=0,config,complete=false,count=0,bytes=0;const seen=new Set();const decoder=new TextDecoder('utf-8',{fatal:true});
  const record=value=>{
    check(!complete,'Input continued after completion');
    if(!config){check(value.type==='run'&&value.version===1&&Array.isArray(value.argv)&&value.argv.length>0&&value.argv.length<=64&&value.argv.every(arg=>typeof arg==='string'&&arg.length<=4096&&!arg.includes('\0'))&&Number.isInteger(value.timeoutMs)&&value.timeoutMs>=1000&&value.timeoutMs<=120000,'Invalid supervisor configuration');check(value.filter&&Array.isArray(value.filter.directories)&&typeof value.filter.files==='string','Missing export filter');config=value;return;}
    if(value.type==='complete'){check(value.files===count&&value.bytes===bytes,'Input totals mismatch');complete=true;return;}
    check(value.type==='file'&&typeof value.data==='string','Invalid input record');const relative=cleanPath(value.path);check(!seen.has(relative),'Duplicate input path');seen.add(relative);
    const data=Buffer.from(value.data,'base64');check(data.length<=FILE&&data.toString('base64')===value.data,'Invalid input content');bytes+=data.length;count++;check(bytes<=TOTAL&&count<=COUNT,'Input workspace exceeds limit');
    const target=path.join('/workspace',relative);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o777});fs.writeFileSync(target,data,{flag:'wx',mode:0o666});
  };
  for await(const chunk of process.stdin){transferred+=chunk.length;check(transferred<=83886080,'Input stream limit');pending+=decoder.decode(chunk,{stream:true});while(pending.includes('\n')){const index=pending.indexOf('\n');check(index<=LINE,'Input line limit');record(JSON.parse(pending.slice(0,index)));pending=pending.slice(index+1);}check(pending.length<=LINE,'Input line limit');}
  pending+=decoder.decode();check(complete&&!pending&&config,'Incomplete input');return config;
}
const childBootstrap=${JSON.stringify(SANDBOX_CHILD_BOOTSTRAP)};
function workers(){const result=[];for(const entry of fs.readdirSync('/proc')){if(!/^\d+$/.test(entry))continue;try{const text=fs.readFileSync('/proc/'+entry+'/status','utf8');const uid=statusField(text,'Uid')?.split(/\s+/).map(Number);const state=statusField(text,'State');if(uid?.some(value=>value===1000)&&!state?.startsWith('Z'))result.push(Number(entry));}catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}}return result;}
async function quiesce(){let empty=0;for(let attempt=0;attempt<100;attempt++){const pids=workers();if(!pids.length){if(++empty===3)return;}else{empty=0;for(const pid of pids)try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}await delay(10);}throw new Error('Worker termination could not be verified');}
async function execute(config){
  const start=Date.now();let stdout='',stderr='',truncated=false;const env={PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/tmp',TMPDIR:'/tmp',LANG:'C.UTF-8'};
  const child=spawn('/usr/local/bin/node',['-e',childBootstrap],{uid:1000,gid:1000,cwd:'/workspace',env,shell:false,stdio:['pipe','pipe','pipe']});
  const append=(kind,data)=>{const value=data.toString('utf8');const previous=kind==='stdout'?stdout:stderr;if(previous.length+value.length>OUTPUT)truncated=true;if(kind==='stdout')stdout=(previous+value).slice(0,OUTPUT);else stderr=(previous+value).slice(0,OUTPUT);};
  child.stdout.on('data',data=>append('stdout',data));child.stderr.on('data',data=>append('stderr',data));child.stdin.on('error',()=>undefined);
  let timer;let timedOut=false;
  try{const exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve(code??(signal?137:1)));timer=setTimeout(()=>{timedOut=true;void quiesce().catch(()=>child.kill('SIGKILL'));},config.timeoutMs);child.stdin.end(JSON.stringify(config.argv));});
    await quiesce();check(!timedOut,'Command timed out');check(exitCode!==125,'Worker security preflight failed');return {type:'result',stdout,stderr,exitCode,truncated,durationMs:Date.now()-start};
  }finally{clearTimeout(timer);await quiesce();}
}
async function emit(record){const value=JSON.stringify(record)+'\n';if(!process.stdout.write(value))await new Promise(resolve=>process.stdout.once('drain',resolve));}
async function exportFiles(filter){
  const directories=new Set(filter.directories);const blocked=new RegExp(filter.files,'i');let entries=0,count=0,bytes=0;
  const ignored=name=>directories.has(name.toLowerCase())||blocked.test(name)||/\.(?:pem|key|p12|pfx)$/i.test(name)||name.startsWith('.relay-');
  async function walk(relative){for(const entry of fs.readdirSync(path.join('/workspace',relative),{withFileTypes:true})){check(++entries<=10000,'Output entry limit');if(ignored(entry.name))continue;const next=relative?relative+'/'+entry.name:entry.name;cleanPath(next);const absolute=path.join('/workspace',next);const info=fs.lstatSync(absolute);check(!info.isSymbolicLink(),'Output links forbidden');if(info.isDirectory()){await walk(next);continue;}const data=readRegular(absolute);bytes+=data.length;count++;check(count<=COUNT&&bytes<=TOTAL,'Output workspace limit');await emit({type:'file',path:next,data:data.toString('base64'),sha256:crypto.createHash('sha256').update(data).digest('hex')});}}
  await walk('');await emit({type:'complete',files:count,bytes});
}
(async()=>{process.umask(0);rootPreflight();const config=await seed();const result=await execute(config);await emit(result);await exportFiles(config.filter);})().catch(async()=>{try{await quiesce();await emit({type:'error',message:'Isolated supervisor rejected execution or output'});}finally{process.exitCode=1;}});
`;
