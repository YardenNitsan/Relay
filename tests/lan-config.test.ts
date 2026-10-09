import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { generateKeyPairSync, X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lanConfig, loadLanTls, type LanConfig } from '../server/auth/lan-config';
import { privateDirectory } from '../server/host/private-storage';

let directory:string;let caseDirectory:string;
let fixture:{key:string;server:string;cnOnly:string;client:string};
const environment=()=>({RELAY_LAN_ENABLED:'1',RELAY_LAN_ORIGIN:'https://relay.test:4319',RELAY_LAN_HOST:'192.168.1.40',RELAY_LAN_CERT_FILE:resolve('cert.pem'),RELAY_LAN_KEY_FILE:resolve('key.pem')});
beforeAll(async()=>{
  await mkdir(resolve('output'),{recursive:true});
  directory=await privateDirectory(await mkdtemp(resolve('output/lan-tls-')));
  fixture=JSON.parse((await readFile(new URL('./fixtures/lan-tls.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
});
beforeEach(async()=>{caseDirectory=await mkdtemp(join(directory,'case-'));vi.spyOn(Date,'now').mockReturnValue(new Date(new X509Certificate(fixture.server).validFrom).getTime()+60000);});
afterEach(()=>vi.restoreAllMocks());
afterAll(async()=>{if(directory)await rm(directory,{recursive:true,force:true});});
async function configured(certificate=fixture.server):Promise<LanConfig> {
  const config=lanConfig({...environment(),RELAY_LAN_CERT_FILE:join(caseDirectory,'cert.pem'),RELAY_LAN_KEY_FILE:join(caseDirectory,'key.pem')})!;
  await writeFile(config.certFile,certificate,{mode:0o600});await writeFile(config.keyFile,fixture.key,{mode:0o600});return config;
}
describe('LAN listener configuration',()=>{
  it('is disabled by default and derives an explicit separate TLS listener',()=>{
    expect(lanConfig({})).toBeNull();expect(lanConfig({...environment(),RELAY_LAN_ENABLED:'0'})).toBeNull();
    expect(lanConfig(environment())).toMatchObject({origin:'https://relay.test:4319',host:'192.168.1.40',port:4319});
    expect(lanConfig({...environment(),RELAY_LAN_ORIGIN:'https://relay.test'})).toMatchObject({port:443});
    expect(lanConfig({...environment(),RELAY_LAN_ORIGIN:'https://[fd12::40]:4319',RELAY_LAN_HOST:'fd12::40'})).toMatchObject({host:'fd12::40'});
  });
  it.each(['0.0.0.0','::','127.0.0.1','::1','8.8.8.8','169.254.1.2','fe80::1','::ffff:192.168.1.40','relay.test','192.168.001.40'])('refuses unsafe or ambiguous bind address %s',host=>{
    expect(()=>lanConfig({...environment(),RELAY_LAN_HOST:host})).toThrow();
  });
  it.each(['http://relay.test:4319','https://relay.test/path','https://relay.test/../','https://relay.test\\','https://relay.test/?secret=value','https://relay.test/#fragment','https://user:password@relay.test','https://localhost:4319','https://127.0.0.1:4319','https://192.168.1.41:4319','https://relay.test:4317','https://relay.test:4318'])('refuses an unsafe origin %s',origin=>{
    expect(()=>lanConfig({...environment(),RELAY_LAN_ORIGIN:origin})).toThrow();
  });
  it('requires absolute local certificate paths without traversal, aliases or URI syntax',()=>{
    for(const path of ['relative.pem','file:///tmp/key.pem','\\\\server\\share\\key.pem',join(caseDirectory,'..','key.pem')+'/../key.pem'])expect(()=>lanConfig({...environment(),RELAY_LAN_KEY_FILE:path})).toThrow();
    expect(()=>lanConfig({...environment(),RELAY_LAN_ENABLED:'yes'})).toThrow();
  });
  it('loads matching bounded certificates for DNS, IPv4 and IPv6 SANs',async()=>{
    const config=await configured();const loaded=await loadLanTls(config);expect(loaded.cert.toString()).toBe(fixture.server);expect(loaded.key.toString()).toBe(fixture.key);expect(loaded.minVersion).toBe('TLSv1.2');
    await expect(loadLanTls({...config,origin:'https://192.168.1.40:4319'})).resolves.toBeDefined();
    await expect(loadLanTls({...config,origin:'https://[fd12::40]:4319',host:'fd12::40'})).resolves.toBeDefined();
  });
  it('rejects certificate mismatch, CN-only certificates and client-only certificates',async()=>{
    const config=await configured();await expect(loadLanTls({...config,origin:'https://other.test:4319'})).rejects.toThrow(/SAN/);
    await writeFile(config.certFile,fixture.cnOnly);await expect(loadLanTls(config)).rejects.toThrow(/SAN/);
    await writeFile(config.certFile,fixture.client);await expect(loadLanTls(config)).rejects.toThrow(/server authentication/);
    await writeFile(config.certFile,fixture.server);const other=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({type:'pkcs8',format:'pem'});await writeFile(config.keyFile,other);await expect(loadLanTls(config)).rejects.toThrow(/match/);
  });
  it('rejects expired and not-yet-valid leaf certificates',async()=>{
    const config=await configured();const cert=new X509Certificate(fixture.server);
    vi.mocked(Date.now).mockReturnValue(new Date(cert.validTo).getTime()+1);await expect(loadLanTls(config)).rejects.toThrow(/validity/);
    vi.mocked(Date.now).mockReturnValue(new Date(cert.validFrom).getTime()-1);await expect(loadLanTls(config)).rejects.toThrow(/validity/);
  });
  it('refuses malformed, oversized and hard-linked TLS material',async()=>{
    const config=await configured();await writeFile(config.certFile,'not a certificate');await expect(loadLanTls(config)).rejects.toThrow();
    await writeFile(config.certFile,'a'.repeat(128*1024+1));await expect(loadLanTls(config)).rejects.toThrow(/size/);
    await writeFile(config.certFile,fixture.server);await link(config.keyFile,join(caseDirectory,'alias.pem'));await expect(loadLanTls(config)).rejects.toThrow(/regular/);
  });
  it('refuses certificate paths through linked directories',async()=>{
    const config=await configured();const alias=join(directory,'linked');await symlink(caseDirectory,alias,process.platform==='win32'?'junction':'dir');
    await expect(loadLanTls({...config,certFile:join(alias,'cert.pem')})).rejects.toThrow(/link|alias/);
  });
  it.skipIf(process.platform==='win32')('refuses a private key readable by another OS account',async()=>{
    const config=await configured();await chmod(config.keyFile,0o644);await expect(loadLanTls(config)).rejects.toThrow(/private/);
  });
  it.skipIf(process.platform!=='win32')('refuses a Windows key ACL that grants another ordinary account access',async()=>{
    const config=await configured();
    // Only the public test fixture is changed, within the owner-private test root.
    await promisify(execFile)(join(process.env.SystemRoot??'C:\\Windows','System32','icacls.exe'),[config.keyFile,'/grant','*S-1-1-0:R'],{windowsHide:true,timeout:5000,maxBuffer:4096});
    await expect(loadLanTls(config)).rejects.toThrow(/private key/);
  });
});
