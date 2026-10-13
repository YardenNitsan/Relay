import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,readdir,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {parseLanPreviewOptions,assertPreviewInterface,preparePreviewDirectory,previewSecrets,createPreviewShutdown} from '../scripts/lan-preview';

const directories:string[]=[];
afterEach(async()=>{vi.unstubAllEnvs();for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});
const args=(host='10.100.102.13')=>[`--data-dir=${resolve('output/relay-lan-preview')}`,`--listen=${host}`,`--cert=${resolve('preview-cert.pem')}`,`--key=${resolve('preview-key.pem')}`];
async function temporary(){const directory=await mkdtemp(join(await realpath(tmpdir()),'relay-lan-preview-'));directories.push(directory);return directory;}

describe('reviewable isolated LAN preview',()=>{
  it('requires explicit material and binds only the separate approved interfaces',()=>{
    vi.stubEnv('DATABASE_URL','postgres://must-not-use');vi.stubEnv('RELAY_LAN_ORIGIN','https://unrelated.example');vi.stubEnv('RELAY_PORT','4317');
    expect(parseLanPreviewOptions(args())).toMatchObject({ownerPort:4327,ownerHost:'127.0.0.1',lan:{host:'10.100.102.13',port:4443,origin:'https://10.100.102.13:4443'}});
    for(const invalid of [[],args().slice(1),[...args(),'--owner-port=4317'],[...args(),'--listen=10.100.102.30'],args().map(x=>x.startsWith('--listen=')?'--listen=0.0.0.0':x),args().map(x=>x.startsWith('--data-dir=')?`--data-dir=${resolve('.data')}`:x),args().map(x=>x.startsWith('--cert=')?'--cert=relative.pem':x)])expect(()=>parseLanPreviewOptions(invalid)).toThrow();
  });
  it.each(['10.100.102.30','10.0.0.1','172.16.0.1','172.31.255.254','192.168.1.2'])('accepts the explicit private IPv4 %s',host=>{
    expect(parseLanPreviewOptions(args(host)).lan).toMatchObject({host,origin:`https://${host}:4443`});
  });
  it.each(['8.8.8.8','127.0.0.1','0.0.0.0','169.254.1.2','100.64.0.1','172.15.0.1','172.32.0.1','192.169.1.2','10.256.0.1','10.01.0.1','10.1','0x0a000001','fd00::1','localhost','10.100.102.13:4443','https://10.100.102.13','10.100.102.13\n','10.100.102.13</domain>','10.100.102.13@evil.example'])('rejects unsafe or noncanonical address %j',host=>{
    expect(()=>parseLanPreviewOptions(args(host))).toThrow();
  });
  it('requires the selected private IPv4 to be assigned to this machine',()=>{
    const host='10.100.102.13';
    const entry={address:host,family:'IPv4',internal:false,netmask:'255.255.255.0',mac:'00:00:00:00:00:00',cidr:`${host}/24`} as const;
    expect(()=>assertPreviewInterface(host,{Ethernet:[entry]})).not.toThrow();
    expect(()=>assertPreviewInterface(host,{})).toThrow(/interface/);
    expect(()=>assertPreviewInterface(host,{Ethernet:[{...entry,internal:true}]})).toThrow(/interface/);
    expect(()=>assertPreviewInterface(host,{Ethernet:[{...entry,address:'10.100.102.30'}]})).toThrow(/interface/);
    expect(()=>assertPreviewInterface('10.100.102.30',{Ethernet:[entry]})).toThrow(/interface/);
    expect(()=>assertPreviewInterface('8.8.8.8',{Ethernet:[{...entry,address:'8.8.8.8'}]})).toThrow();
  });
  it('claims fresh preview storage and permits only marked restarts',async()=>{
    const directory=await temporary();await preparePreviewDirectory(directory);
    await writeFile(join(directory,'retained.txt'),'keep');
    await preparePreviewDirectory(directory);
    expect(await readFile(join(directory,'retained.txt'),'utf8')).toBe('keep');
    expect(await readdir(directory)).toContain('lan-preview.json');
  });
  it('refuses unmarked existing storage without overwriting any contents',async()=>{
    const directory=await temporary();await writeFile(join(directory,'backend.json'),'existing host');
    await expect(preparePreviewDirectory(directory)).rejects.toThrow(/unmarked/);
    expect(await readdir(directory)).toEqual(['backend.json']);
    expect(await readFile(join(directory,'backend.json'),'utf8')).toBe('existing host');
  });
  it('rejects a wrong preview marker and linked storage without claiming their targets',async()=>{
    const directory=await temporary();await writeFile(join(directory,'lan-preview.json'),'{}',{mode:0o600});
    await expect(preparePreviewDirectory(directory)).rejects.toThrow(/unmarked/);
    const target=await temporary(),parent=await temporary(),link=join(parent,'relay-lan-preview');
    await symlink(target,link,process.platform==='win32'?'junction':'dir');
    await expect(preparePreviewDirectory(link)).rejects.toThrow(/links|aliases/);
    expect(await readdir(target)).toEqual([]);
  });
  it('never inherits provider credentials and separates session-only account secrets',async()=>{
    vi.stubEnv('OPENAI_API_KEY','production-secret');const isolated=previewSecrets();
    expect(await isolated.owner.get('openai')).toBeNull();
    expect(await isolated.forUser('member').get('openai')).toBeNull();
    await isolated.owner.set('openai','preview-owner',false);
    await isolated.forUser('member').set('openai','preview-member',false);
    expect(await isolated.owner.get('openai')).toBe('preview-owner');
    expect(await isolated.forUser('member').get('openai')).toBe('preview-member');
    expect(await isolated.forUser('another').get('openai')).toBeNull();
    await expect(isolated.owner.set('openai','do-not-persist',true)).rejects.toThrow(/keyring unavailable/);
    expect(await isolated.oauthVault.get('production-entry')).toBeNull();
    await expect(isolated.oauthVault.set('entry','secret')).rejects.toThrow(/unavailable/);
  });
  it('joins execution and listeners before closing storage once',async()=>{
    const events:string[]=[];const stop=createPreviewShutdown({engine:async()=>{events.push('engine');},listeners:async()=>{events.push('listeners');},store:async()=>{events.push('store');},lock:async()=>{events.push('lock');}});
    await Promise.all([stop(),stop()]);expect(events).toEqual(['engine','listeners','store','lock']);
  });
  it.each(['engine','listeners'] as const)('retains storage and lock when %s cleanup fails',async failure=>{
    const events:string[]=[];const action=(name:string)=>async()=>{events.push(name);if(name===failure)throw Error('controlled cleanup failure');};
    const stop=createPreviewShutdown({engine:action('engine'),listeners:action('listeners'),store:action('store'),lock:action('lock')});
    await expect(stop()).rejects.toThrow();expect(events).toEqual(['engine','listeners']);
  });
  it('retains the service lock when closing the database fails',async()=>{
    const lock=vi.fn();const stop=createPreviewShutdown({engine:async()=>{},listeners:async()=>{},store:async()=>{throw Error('close failed');},lock});
    await expect(stop()).rejects.toThrow('close failed');expect(lock).not.toHaveBeenCalled();
  });
});
