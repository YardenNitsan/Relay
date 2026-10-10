import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

describe('native test environment', () => {
  it.skipIf(process.platform !== 'win32')('runs Windows children with account-owned fixtures and propagates their failure', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'relay-test-owner-')));
    directories.push(root);
    const command = "& ./scripts/windows-test-token.ps1 -Command powershell.exe -CommandArguments @('-NoProfile','-NonInteractive','-Command',$env:RELAY_TEST_PROBE); exit $LASTEXITCODE";
    const probe = "$ErrorActionPreference='Stop'; $path=Join-Path $env:RELAY_TEST_ROOT 'created-by-child'; [void][IO.Directory]::CreateDirectory($path); $owner=(Get-Acl -LiteralPath $path).GetOwner([Security.Principal.SecurityIdentifier]).Value; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; @{accountOwned=($owner -eq $sid)} | ConvertTo-Json -Compress";
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-Command', command];
    const options = { env: { ...process.env, RELAY_TEST_ROOT: root, RELAY_TEST_PROBE: probe }, windowsHide: true, timeout: 15000 };
    expect(JSON.parse((await run('powershell.exe', args, options)).stdout)).toEqual({ accountOwned: true });
    await expect(run('powershell.exe', args, { ...options, env: { ...options.env, RELAY_TEST_PROBE: 'exit 37' } })).rejects.toMatchObject({ code: 37 });
  });

  it('gives child fixtures canonical temporary paths while retaining workspace link refusal', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'relay-test-environment-')));
    directories.push(root);
    const target = join(root, 'ordinary'); const alias = join(root, 'alias');
    await mkdir(target); await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
    // The unmodified test environment makes ordinary fixture paths inherit the
    // alias and fail inspectPath; the bootstrap must normalize before creation.
    const probe = `
      import {tmpdir} from 'node:os';
      import {mkdtemp,rm} from 'node:fs/promises';
      import {join} from 'node:path';
      import {inspectPath} from './server/tools/platform.ts';
      const path=await mkdtemp(join(tmpdir(),'relay-probe-'));
      try {
        await inspectPath(path);
        let refused=false;try{await inspectPath(process.env.RELAY_TEST_ALIAS);}catch{refused=true;}
        console.log(JSON.stringify({temporaryRoot:tmpdir(),aliasRefused:refused}));
      } finally {await rm(path,{recursive:true,force:true});}
    `;
    const result = await run(process.execPath, ['--import', './scripts/test-environment.mjs', '--import', 'tsx', '--input-type=module', '-e', probe], {
      cwd: resolve('.'), env: { ...process.env, TMPDIR: alias, TMP: alias, TEMP: alias, RELAY_TEST_ALIAS: alias }, windowsHide: true,
    });
    expect(JSON.parse(result.stdout)).toEqual({ temporaryRoot: target, aliasRefused: true });
  });
});
