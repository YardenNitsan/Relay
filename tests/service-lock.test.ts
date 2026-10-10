import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile,lstat,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireServiceLock} from '../server/host/service-lock.js';

const roots:string[]=[];
async function directory(){const root=await mkdtemp(join(tmpdir(),'relay-service-lock-'));roots.push(root);return root;}
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});

it('serializes simultaneous stale-lock recovery before either contender can inspect the PID',async()=>{
  const root=await directory();await writeFile(join(root,'service.lock'),'2147483647');
  let inspected!:()=>void,finish!:()=>void;
  const entered=new Promise<void>(resolve=>{inspected=resolve;}),wait=new Promise<void>(resolve=>{finish=resolve;});
  const first=acquireServiceLock(root,{isAlive:async()=>{inspected();await wait;return false;}});
  await entered;
  await expect(acquireServiceLock(root)).rejects.toThrow(/starting|startup/i);
  expect(await readFile(join(root,'service.lock'),'utf8')).toBe('2147483647');
  finish();const lock=await first;
  expect(await readFile(join(root,'service.lock'),'utf8')).toBe(String(process.pid));
  await expect(acquireServiceLock(root)).rejects.toThrow(/already running/i);
  await lock.release();await expect(lstat(join(root,'service.lock'))).rejects.toMatchObject({code:'ENOENT'});
});

it('fails closed on an interrupted startup guard instead of racing to delete it',async()=>{
  const root=await directory();await writeFile(join(root,'.service-start.lock'),'2147483647');
  await expect(acquireServiceLock(root)).rejects.toThrow(/startup/i);
  expect(await readFile(join(root,'.service-start.lock'),'utf8')).toBe('2147483647');
});

it('preserves incomplete and live service locks and releases its temporary guard',async()=>{
  const root=await directory();
  for(const value of ['', '0', 'NaN', String(process.pid)]){
    await writeFile(join(root,'service.lock'),value);
    await expect(acquireServiceLock(root)).rejects.toThrow(/incomplete|already running/i);
    expect(await readFile(join(root,'service.lock'),'utf8')).toBe(value);
    await expect(lstat(join(root,'.service-start.lock'))).rejects.toMatchObject({code:'ENOENT'});
  }
});

it('never removes a replacement service lock on shutdown',async()=>{
  const root=await directory(),lock=await acquireServiceLock(root);
  await unlink(join(root,'service.lock'));await writeFile(join(root,'service.lock'),'12345');
  await expect(lock.release()).rejects.toThrow(/changed/i);
  expect(await readFile(join(root,'service.lock'),'utf8')).toBe('12345');
});

it('refuses offline backup both before stale inspection and after acquisition',async()=>{
  const root=await directory();await writeFile(join(root,'.backup.lock'),'backup');
  await expect(acquireServiceLock(root)).rejects.toThrow(/backup/i);
  await unlink(join(root,'.backup.lock'));await writeFile(join(root,'service.lock'),'2147483647');
  await expect(acquireServiceLock(root,{isAlive:async()=>{await writeFile(join(root,'.backup.lock'),'backup');return false;}})).rejects.toThrow(/backup/i);
  await expect(lstat(join(root,'service.lock'))).rejects.toMatchObject({code:'ENOENT'});
  expect(await readFile(join(root,'.backup.lock'),'utf8')).toBe('backup');
});
