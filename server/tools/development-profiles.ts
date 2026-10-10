import { z } from 'zod';

export const developmentProfileSchema = z.enum(['default', 'node', 'python', 'dotnet']);
export type DevelopmentProfileId = z.infer<typeof developmentProfileSchema>;
export const toolchainSchema = z.object({ profile: developmentProfileSchema, version: z.string().max(100).regex(/^\d+\.\d+\.\d+[a-z0-9.+-]*$/i) }).strict();
const imageVariables: Record<DevelopmentProfileId, string> = {
  default: 'RELAY_SANDBOX_IMAGE', node: 'RELAY_SANDBOX_NODE_IMAGE', python: 'RELAY_SANDBOX_PYTHON_IMAGE', dotnet: 'RELAY_SANDBOX_DOTNET_IMAGE',
};

/** Owner configuration only; tool arguments cannot supply an image or runtime path. */
export function developmentProfile(requested: DevelopmentProfileId | undefined, env: Record<string, string | undefined> = process.env): { id: DevelopmentProfileId; image: string } {
  const id = developmentProfileSchema.parse(requested ?? 'default');
  const variable = imageVariables[id], image = env[variable];
  if (!image) throw new Error(`Sandbox unavailable: configure ${variable} with a preinstalled trusted Linux image. No image is downloaded automatically.`);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,255}$/.test(image)) throw new Error('Invalid configured sandbox image');
  if (id !== 'default' && !/^(?:[a-zA-Z0-9][a-zA-Z0-9._/:-]*@)?sha256:[a-f0-9]{64}$/.test(image)) throw new Error(`${variable} requires an immutable sha256 image ID or repository digest.`);
  return { id, image };
}

/** Runs only inside the already-unprivileged, offline container child bootstrap. */
export const SANDBOX_PROFILE_PROBE = String.raw`
'use strict';
const {spawnSync}=require('node:child_process');
const profile=process.argv[1];
const profiles={default:['/usr/local/bin/node',['--version']],node:['/usr/local/bin/node',['--version']],python:['/usr/local/bin/python3',['-I','--version']],dotnet:['/usr/bin/dotnet',['--version']]};
if(!Object.hasOwn(profiles,profile))throw new Error('Unknown development profile');
const [executable,args]=profiles[profile];
const result=spawnSync(executable,args,{cwd:'/tmp',env:process.env,shell:false,timeout:5000,maxBuffer:1024,encoding:'utf8'});
if(result.error||result.status!==0||typeof result.stdout!=='string')throw new Error('Development toolchain unavailable');
const raw=result.stdout.trim();const version=profile==='python'?raw.replace(/^Python /,''):raw.replace(/^v/,'');
if(!/^\d+\.\d+\.\d+[a-z0-9.+-]*$/i.test(version)||version.length>100)throw new Error('Unrecognized development toolchain version');
const [major,minor]=version.split('.').map(Number);
if((profile==='node'||profile==='default')&&major<24||profile==='python'&&(major!==3||minor<11)||profile==='dotnet'&&major<8)throw new Error('Unsupported development toolchain version');
process.stdout.write(JSON.stringify({profile,version}));
`;
