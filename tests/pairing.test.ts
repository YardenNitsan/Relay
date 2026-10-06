import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, lstat, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LocalPairing } from '../server/auth/pairing.js';

let directory:string,pairing:LocalPairing;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'relay-pairing-'));pairing=new LocalPairing(directory);});
afterEach(async()=>{vi.restoreAllMocks();await rm(directory,{recursive:true,force:true});});
describe('OS-account local pairing',()=>{
  it('delivers a short-lived code privately and stores only its hash in the redeemable challenge',async()=>{
    const issued=await pairing.issue();expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Date(issued.expiresAt).getTime()-Date.now()).toBeLessThanOrEqual(300000);
    const delivery=JSON.parse(await readFile(issued.deliveryFile,'utf8')) as {token:string};expect(delivery.token===issued.token).toBe(true);
    const challenge=(await readdir(pairing.directory)).find(name=>name.startsWith('challenge-'))!;
    expect((await readFile(join(pairing.directory,challenge),'utf8')).includes(issued.token)).toBe(false);
    if(process.platform!=='win32'){expect((await lstat(pairing.directory)).mode&0o077).toBe(0);expect((await lstat(issued.deliveryFile)).mode&0o077).toBe(0);}
    await pairing.redeem(issued.token);await expect(pairing.redeem(issued.token)).rejects.toThrow(/invalid, expired, or already used/);
  });
  it('allows exactly one concurrent redemption across independent broker instances',async()=>{
    const issued=await pairing.issue();const second=new LocalPairing(directory);await second.initialize();
    const results=await Promise.allSettled([pairing.redeem(issued.token),second.redeem(issued.token)]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  });
  it('retains an exclusive redemption claim across a burst and later broker restart',async()=>{
    const issued=await pairing.issue();const second=new LocalPairing(directory);await second.initialize();
    const results=await Promise.allSettled(Array.from({length:32},(_,index)=>(index%2?pairing:second).redeem(issued.token)));
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    const claims=(await readdir(pairing.directory)).filter(name=>name.startsWith('redeemed-'));
    expect(claims).toHaveLength(1);
    await expect(new LocalPairing(directory).redeem(issued.token)).rejects.toThrow(/already used/);
  });
  it('rejects expired and guessed credentials with the same public failure',async()=>{
    const issued=await pairing.issue();vi.spyOn(Date,'now').mockReturnValue(new Date(issued.expiresAt).getTime()+1);
    await expect(pairing.redeem(issued.token)).rejects.toThrow(/invalid, expired, or already used/);
    await expect(pairing.redeem('X'.repeat(43))).rejects.toThrow(/invalid, expired, or already used/);
  });
  it('refuses a linked private credential directory',async()=>{
    const elsewhere=join(directory,'elsewhere');await mkdir(elsewhere);await symlink(elsewhere,join(directory,'auth'),process.platform==='win32'?'junction':'dir');
    await expect(pairing.initialize()).rejects.toThrow(/ordinary directory/);
  });
  it('the operational CLI prints the protected file location without printing its code',async()=>{
    const output=await promisify(execFile)(process.execPath,['--import','tsx','server/auth/pair-cli.ts','--data-dir',directory],{windowsHide:true,timeout:15000,maxBuffer:16000});
    const delivery=JSON.parse(await readFile(pairing.deliveryFile,'utf8')) as {token:string};
    expect(output.stdout).toContain(pairing.deliveryFile);expect(output.stdout.includes(delivery.token)).toBe(false);expect(output.stderr.includes(delivery.token)).toBe(false);
    await pairing.redeem(delivery.token);
  });
});
