import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const manifest=JSON.parse(await readFile('package.json','utf8'));
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const output=resolve('release',stamp);await mkdir(output,{recursive:true});
const checksums=[];
for(const platform of ['windows','linux','macos']) {
  const name=`relay-${manifest.version}-${platform}`;const directory=join(output,name);await mkdir(directory);
  for(const path of ['dist','dist-server','package.json','package-lock.json','README.md','THIRD_PARTY_NOTICES.md','docs','launch.mjs','start.cmd','start.ps1','start.sh'])await cp(path,join(directory,path),{recursive:true});
  await cp(`packaging/${platform}`,join(directory,'service'),{recursive:true});
  const extension=platform==='windows'?'.zip':'.tar.gz';const archive=join(output,`${name}${extension}`);
  // No shell; tar handles archiving only from the known release directory.
  execFileSync('tar',platform==='windows'?['-a','-c','-f',archive,'-C',output,name]:['-c','-z','-f',archive,'-C',output,name],{stdio:'inherit'});
  checksums.push(`${createHash('sha256').update(await readFile(archive)).digest('hex')}  ${name}${extension}`);
}
await writeFile(join(output,'SHA256SUMS'),checksums.join('\n')+'\n');console.log(output);
