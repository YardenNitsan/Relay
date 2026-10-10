// Explicit owner/developer provisioning, never exposed as a model tool.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {localDockerEndpoint} from './development-image-policy.js';

const profiles=['node','python','dotnet'] as const;
const requested=process.argv.slice(2);
assert.ok(requested.length===1&&['all',...profiles].includes(requested[0]!), 'Choose node, python, dotnet or all');
const selected=requested[0]==='all'?profiles:profiles.filter(profile=>profile===requested[0]);
const run=promisify(execFile),executable=process.platform==='win32'?'docker.exe':'docker';
async function docker(argv:string[],timeout=30_000){return run(executable,argv,{windowsHide:true,timeout,maxBuffer:4_000_000,encoding:'utf8'});}
const context=JSON.parse((await docker(['context','inspect'])).stdout) as Array<{Endpoints?:{docker?:{Host?:string}}}>;
const endpoint=localDockerEndpoint(context[0]?.Endpoints?.docker?.Host??'',process.env.DOCKER_HOST,process.env.BUILDX_BUILDER);
const prefix=['--host',endpoint];
const info=JSON.parse((await docker([...prefix,'info','--format','{{json .}}'])).stdout) as {OSType:string;Architecture:string};
assert.equal(info.OSType,'linux','Linux containers are required');
assert.ok(['x86_64','aarch64','amd64','arm64'].includes(info.Architecture),'Unreviewed engine architecture');
const output=resolve('output/final-evolution');await mkdir(output,{recursive:true});
const root=await mkdtemp(join(output,'development-images-'));
const report:{testedAt:string;engine:typeof info;images:unknown[];error?:string}={testedAt:new Date().toISOString(),engine:{OSType:info.OSType,Architecture:info.Architecture},images:[]};
try{
  for(const profile of selected){
    // Never send a repository or user workspace to Docker. The complete context
    // is one reviewed Dockerfile, copied as text into an owned empty directory.
    const source=await readFile(new URL(`../development-images/${profile}.Dockerfile`,import.meta.url),'utf8');
    assert.ok(source.length<16_384&&!/^\s*(?:ADD|COPY)\s+(?!--from=supervisor)/im.test(source),'Local context copying is forbidden');
    const directory=join(root,profile);await mkdir(directory);await writeFile(join(directory,'Dockerfile'),source);
    const iid=join(root,`${profile}.iid`),tag=`relay-development-${profile}:${basename(root).toLowerCase()}`;
    console.log(`Building ${profile} from pinned official images; build commands have no network`);
    try{
      const result=await docker([...prefix,'build','--builder','default','--network=none','--provenance=false','--iidfile',iid,'--tag',tag,directory],600_000);
      await writeFile(join(root,`${profile}-build.log`),result.stdout+result.stderr);
    }catch(error){
      const detail=error as {stdout?:string;stderr?:string};await writeFile(join(root,`${profile}-build.log`),(detail.stdout??'')+(detail.stderr??''));throw error;
    }
    const buildConfigId=(await readFile(iid,'utf8')).trim();assert.match(buildConfigId,/^sha256:[a-f0-9]{64}$/);
    // Containerd stores the manifest digest as Id while build --iidfile can emit
    // the config digest. Resolve our unique tag through the actual local engine.
    const inspected=JSON.parse((await docker([...prefix,'image','inspect',tag])).stdout) as Array<{Id:string;Os:string;Architecture:string}>;
    const imageId=inspected[0]?.Id;assert.match(imageId??'',/^sha256:[a-f0-9]{64}$/);assert.equal(inspected[0]?.Os,'linux');
    report.images.push({profile,imageId,buildConfigId,architecture:inspected[0]?.Architecture,dockerfileSha256:createHash('sha256').update(source).digest('hex'),configurationVariable:`RELAY_SANDBOX_${profile.toUpperCase()}_IMAGE`});
    console.log(JSON.stringify(report.images.at(-1)));
  }
}catch(error){report.error=error instanceof Error?error.message:String(error);process.exitCode=1;}
finally{
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(join(output,'development-images-latest.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`Provisioning report: ${join(root,'report.json')}. Running host configuration was not changed. Broker execution acceptance is still required.`);
}
