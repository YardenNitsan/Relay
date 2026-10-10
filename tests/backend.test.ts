import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recordBackend} from '../server/host/backend.js';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('records the database backend once and refuses accidental backend changes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'relay-backend-'));roots.push(root);
  await recordBackend(root,false);await recordBackend(root,false);
  expect(JSON.parse(await readFile(join(root,'backend.json'),'utf8'))).toEqual({format:1,backend:'embedded'});
  await expect(recordBackend(root,true)).rejects.toThrow(/different database/);
});
