import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../server/db/database';
import { Store } from '../server/db/store';
import { resolveRemoteSetup, savedRemoteSetup, validateRemoteSetup } from '../server/auth/remote-config';
let store:Store;
const setup={publicOrigin:'https://relay.example',issuer:'https://team.cloudflareaccess.com',audience:'application-id',registration:'approval' as const};
beforeEach(async()=>{store=new Store(await openDatabase());await store.init();});
afterEach(async()=>{await store.close();});
describe('permanent remote setup',()=>{
  it('defaults to local only, reloads saved deployment without changing its address, and honors environment disable',async()=>{
    expect(await resolveRemoteSetup(store,{})).toBeNull();
    await store.db.query('INSERT INTO settings(key,value) VALUES ($1,$2)',['remote_config',JSON.stringify(setup)]);
    expect(await resolveRemoteSetup(store,{})).toEqual({...setup,port:4318});
    expect(await savedRemoteSetup(store)).toEqual(await resolveRemoteSetup(store,{}));
    expect(await resolveRemoteSetup(store,{RELAY_REMOTE_ENABLED:'0'})).toBeNull();
  });
  it.each([{...setup,publicOrigin:'http://relay.example'}, {...setup,issuer:'https://evil.example'}, {...setup,publicOrigin:'https://relay.example/path'}, {...setup,port:4317}, {...setup,tunnelToken:'secret'}, {...setup,registration:'public'}])('rejects insecure or unexpected setup fields %j',input=>{
    expect(()=>validateRemoteSetup(input)).toThrow();
  });
});
