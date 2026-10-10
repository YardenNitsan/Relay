// Opt-in offline, actual DockerSandbox language acceptance; no host code execution.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {DockerSandbox} from '../server/tools/sandbox.js';
import {ToolStore} from '../server/tools/store.js';
import {copySnapshot} from '../server/tools/files.js';
import type {DevelopmentProfileId} from '../server/tools/development-profiles.js';

assert.equal(process.argv.length,3,'Supply the provisioning report.json path');
const provision=JSON.parse(await readFile(process.argv[2]!,'utf8')) as {images:Array<{profile:DevelopmentProfileId;imageId:string}>};
for(const profile of ['node','python','dotnet']){
  const image=provision.images.find(image=>image.profile===profile);assert.ok(image,`Missing ${profile} image`);
  assert.match(image.imageId,/^sha256:[a-f0-9]{64}$/);process.env[`RELAY_SANDBOX_${profile.toUpperCase()}_IMAGE`]=image.imageId;
}
const output=resolve('output/final-evolution');await mkdir(output,{recursive:true});
const root=await mkdtemp(join(output,'native-languages-'));
const sandbox=new DockerSandbox(new ToolStore(join(root,'data')));
const report:{testedAt:string;platform:string;scope:string;checks:unknown[];error?:string;diagnostic?:unknown;cleanupError?:string}={testedAt:new Date().toISOString(),platform:process.platform,scope:'Small offline multi-file runtime acceptance; not medium-project build or model coding acceptance',checks:[]};
const nodeFiles=new Map([['package.json','{"type":"module"}'],['invoice.ts','export const total=(price:number,count:number)=>price*count;'],['test.mjs',"import assert from 'node:assert/strict';import {total} from './invoice.ts';assert.equal(total(7,3),21);assert.equal(total(0,8),0);console.log('VERIFIED: node two cases');"]]);
const pythonFiles=new Map([['invoice.py','def total(price, count):\n    return price * count\n'],['test_invoice.py','import unittest\nfrom invoice import total\nclass InvoiceTests(unittest.TestCase):\n    def test_total(self): self.assertEqual(total(7, 3), 21)\n    def test_zero(self): self.assertEqual(total(0, 8), 0)\n']]);
const dotnetFiles=new Map([
  ['Invoice.csproj','<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>'],
  ['NuGet.Config','<configuration><packageSources><clear /></packageSources></configuration>'],
  ['Invoice.cs','public static class Invoice { public static int Total(int price, int count) => price * count; }'],
  ['Program.cs','if (Invoice.Total(7,3)!=21 || Invoice.Total(0,8)!=0) { Console.Error.WriteLine("REGRESSION: invoice total"); return 23; } Console.WriteLine("VERIFIED: dotnet two cases"); return 0;'],
]);
const dotnetCommand="const {spawnSync}=require('node:child_process');for(const args of [['build','Invoice.csproj','--disable-build-servers','--nologo','--verbosity','quiet','-m:1','-p:UseSharedCompilation=false','-p:BaseOutputPath=/tmp/build/','-p:BaseIntermediateOutputPath=/tmp/obj/'],['/tmp/build/Debug/net10.0/Invoice.dll']]){const r=spawnSync('/usr/bin/dotnet',args,{stdio:'inherit',env:process.env});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1)}";
async function check(profile:DevelopmentProfileId,files:Map<string,string>,argv:string[],faultPath:string,from:string,to:string,pass:RegExp,fail:RegExp){
  for(const broken of [true,false]){
    const input=new Map(files);if(broken){assert.ok(input.get(faultPath)?.includes(from));input.set(faultPath,input.get(faultPath)!.replace(from,to));}
    const directory=join(root,`${profile}-${broken?'broken':'fixed'}`);await mkdir(directory);
    const signal=AbortSignal.timeout(120_000),guard=()=>signal.throwIfAborted();await copySnapshot(directory,input,guard);
    const {files:after,...receipt}=await sandbox.run(directory,argv,60,signal,guard,profile);
    report.checks.push({profile,broken,...receipt});
    assert.deepEqual(after,input,'Language execution unexpectedly changed source files');
    assert.equal(receipt.truncated,false);assert.equal(receipt.toolchain?.profile,profile);
    if(broken){assert.notEqual(receipt.exitCode,0);assert.match(receipt.stdout+receipt.stderr,fail);}
    else{assert.equal(receipt.exitCode,0);assert.match(receipt.stdout+receipt.stderr,pass);}
    console.log(`${profile} ${broken?'seeded regression rejected':'fixed behavior verified'} (${receipt.durationMs}ms)`);
  }
}
try{
  await check('node',nodeFiles,['node','test.mjs'],'invoice.ts','price*count','price+count',/VERIFIED: node two cases/,/AssertionError/);
  await check('python',pythonFiles,['python3','-B','-m','unittest','-v'],'invoice.py','price * count','price + count',/Ran 2 tests[\s\S]*OK/,/FAILED \(failures=2\)/);
  await check('dotnet',dotnetFiles,['node','-e',dotnetCommand],'Invoice.cs','price * count','price + count',/VERIFIED: dotnet two cases/,/REGRESSION: invoice total/);
  const directory=join(root,'dotnet-boundaries');await mkdir(directory);const signal=AbortSignal.timeout(30_000);
  const {files:_,...boundaries}=await sandbox.run(directory,['node','-e',"const fs=require('node:fs');console.log(JSON.stringify({uid:process.getuid(),memory:fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),pids:fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),cpu:fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim(),limits:fs.readFileSync('/proc/self/limits','utf8'),wxOverride:process.env.DOTNET_EnableWriteXorExecute??null}))"],10,signal,()=>signal.throwIfAborted(),'dotnet');
  assert.equal(boundaries.exitCode,0);const measured=JSON.parse(boundaries.stdout) as {uid:number;memory:string;pids:string;cpu:string;limits:string;wxOverride:unknown};
  assert.equal(measured.uid,1000);assert.equal(measured.memory,'536870912');assert.equal(measured.pids,'64');assert.equal(measured.cpu,'100000 100000');assert.equal(measured.wxOverride,null);assert.match(measured.limits,/Max file size\s+67108864\s+67108864/);
  report.checks.push({profile:'dotnet',boundaryMeasurement:measured,...boundaries});
}catch(error){
  report.error=error instanceof Error?error.message:String(error);process.exitCode=1;
  // Keep the failed profile result. Inspect only the known toolchain through the
  // same isolation limits, using Node so probe failure can return diagnostics.
  try{
    process.env.RELAY_SANDBOX_IMAGE=process.env.RELAY_SANDBOX_DOTNET_IMAGE;
    const directory=join(root,'diagnostic');await mkdir(directory);const signal=AbortSignal.timeout(30_000);
    const {files:_,...receipt}=await sandbox.run(directory,['node','-e',"const fs=require('node:fs');const r=require('node:child_process').spawnSync('/usr/bin/dotnet',['--version'],{encoding:'utf8',timeout:5000});console.log(JSON.stringify({exists:fs.existsSync('/usr/bin/dotnet'),status:r.status,signal:r.signal,error:r.error?.message,stdout:r.stdout,stderr:r.stderr}))"],10,signal,()=>signal.throwIfAborted(),'default');
    report.diagnostic=receipt;
  }catch(diagnostic){report.diagnostic=String(diagnostic);}
}
finally{
  try{await sandbox.stopAll();}catch(error){report.cleanupError=String(error);process.exitCode=1;}
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(`Native language evidence: ${join(root,'report.json')}`);
}
