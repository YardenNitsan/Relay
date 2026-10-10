// Explicit opt-in native acceptance. Never executes imported project code on the host.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {copySnapshot} from '../server/tools/files.js';
import {DockerSandbox} from '../server/tools/sandbox.js';
import {ToolStore} from '../server/tools/store.js';
import {codingCorpus,independentHarness,sandboxImage,seededCorpus,targetPaths,visibleHarness,visibleTestPath} from './coding-fixture.js';
import {codingModelAcceptance} from './coding-model-acceptance.js';

const args=process.argv.slice(2);
if(args.length<1||args.length>2||!(args[0]==='--sandbox-only'||args[0]==='--discover'||args[0].startsWith('--model='))||args[1]!==undefined&&!/^--context=(16384|32768)$/.test(args[1]))throw new Error('Choose --sandbox-only, --discover, or --model=EXACT_INSTALLED_ID; optional --context=16384|32768');
const contextTokens=args[1]?Number(args[1].slice('--context='.length)):16384;
const output=resolve('output/final-evolution');await mkdir(output,{recursive:true});
const root=await mkdtemp(join(output,'coding-'));
const corpus=codingCorpus(resolve('.')),seeded=seededCorpus(corpus.files);
const report:Record<string,unknown>={testedAt:new Date().toISOString(),platform:process.platform,node:process.version,scope:'Versioned substantial-source two-fault repair; not full application build',manifest:corpus.manifest,seededFaults:[{path:targetPaths[0],fault:'Seconds added to millisecond clock'},{path:targetPaths[1],fault:'Unrelated task activity attributed to selected task'}],model:{state:'not_run'},root};
process.env.RELAY_SANDBOX_NODE_IMAGE=sandboxImage;process.env.RELAY_SANDBOX_IMAGE=sandboxImage;
const sandbox=new DockerSandbox(new ToolStore(join(root,'sandbox-data')));
const gradingFiles=(files:Map<string,string>)=>new Map<string,string>([['package.json','{"type":"module"}'],['independent.test.mjs',independentHarness],[visibleTestPath,visibleHarness],...targetPaths.map(path=>[path,files.get(path)!] as [string,string])]);
const gradingTests=['independent.test.mjs',visibleTestPath];
async function run(name:string,files:Map<string,string>,testPath:string|string[]){
  const signal=AbortSignal.timeout(90_000),guard=()=>signal.throwIfAborted();
  const path=join(root,name);await mkdir(path);await copySnapshot(path,files,guard);
  const {files:resultFiles,...receipt}=await sandbox.run(path,['node','--test','--test-reporter=tap',...[testPath].flat()],30,signal,guard,'node');
  assert.deepEqual(resultFiles,files,'Test execution unexpectedly mutated its source tree');
  return {...receipt,fileCount:files.size};
}
try{
  const pristine=await run('pristine',corpus.files,visibleTestPath);report.pristine=pristine;
  assert.equal(pristine.exitCode,0,'Pristine visible harness must pass before seeding');
  const broken=await run('seeded',seeded,visibleTestPath);report.seeded=broken;
  assert.notEqual(broken.exitCode,0,'Both seeded regressions must be observable');
  assert.match(broken.stdout,/# fail 2/,'Expected exactly two failing visible assertions');
  const independent=await run('independent-pristine',gradingFiles(corpus.files),gradingTests);report.independentPristine=independent;
  assert.equal(independent.exitCode,0,'Independent grader must accept pristine behavior');
  // Reproduce the stale-receipt review finding: a later edit can break a visible
  // case not covered by the hidden set. Final grading must catch it again.
  const stale=new Map(corpus.files);stale.set(targetPaths[0],stale.get(targetPaths[0])!.replace('seconds*1000','(seconds===60?seconds:seconds*1000)'));
  const rejected=await run('independent-reject-stale',gradingFiles(stale),gradingTests);report.independentRejectsStaleResult=rejected;
  assert.notEqual(rejected.exitCode,0);assert.match(rejected.stdout,/# fail 1\n/);
  report.sandboxPreflight='passed';
  if(args[0]!=='--sandbox-only'){
    report.model=await codingModelAcceptance(root,seeded,args[0]==='--discover'?null:args[0].slice('--model='.length),async(files,label)=>{
      const receipt=await run(label,gradingFiles(files),gradingTests);
      assert.equal(receipt.exitCode,0,'Independent behavioral acceptance failed');assert.equal(receipt.truncated,false);assert.match(receipt.stdout,/# tests 9\n/);assert.match(receipt.stdout,/# pass 9\n/);return receipt;
    },contextTokens);
    const state=(report.model as {state:string}).state;if(!['passed','discovery_only'].includes(state))process.exitCode=1;
  }
}catch(error){report.sandboxPreflight='failed';report.error=error instanceof Error?error.message:String(error);process.exitCode=1;}
finally{
  try{await sandbox.stopAll();}catch(error){report.cleanupError=error instanceof Error?error.message:String(error);process.exitCode=1;}
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(join(output,'coding-latest.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({report:join(root,'report.json'),sandboxPreflight:report.sandboxPreflight,files:corpus.manifest.files,bytes:corpus.manifest.bytes,omitted:corpus.manifest.omissions.length,model:report.model,error:report.error}));
}
