import { createPrivateKey, X509Certificate } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { createSecureContext } from 'node:tls';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export interface LanConfig { origin:string;host:string;port:number;certFile:string;keyFile:string; }
export interface LanTls { cert:Buffer;key:Buffer;minVersion:'TLSv1.2'; }
const run=promisify(execFile);
const comparable=(path:string)=>process.platform==='win32'?path.toLowerCase():path;
const unbracket=(host:string)=>host.startsWith('[')&&host.endsWith(']')?host.slice(1,-1):host;
function privateAddress(host:string):boolean {
  if(isIP(host)===4) {const [a,b]=host.split('.').map(Number);return a===10||a===172&&b>=16&&b<=31||a===192&&b===168;}
  return isIP(host)===6&&/^f[cd][0-9a-f]{2}:/i.test(host);
}
function localPath(value:string|undefined):string {
  if(!value||value.length>4096||!isAbsolute(value)||/^[\\/]{2}/.test(value)||/[\x00-\x1f\x7f]/.test(value)||value.split(/[\\/]/).some(part=>part==='.'||part==='..'))throw new Error('LAN TLS files require absolute local paths without links or traversal');
  if(process.platform==='win32') {
    if(!/^[A-Za-z]:[\\/]/.test(value)||value.slice(2).includes(':')||value.slice(3).split(/[\\/]/).some(part=>/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw new Error('LAN TLS paths cannot use Windows device names or alternate streams');
  } else if(value.includes('\\'))throw new Error('LAN TLS paths cannot contain platform-ambiguous separators');
  return resolve(value);
}
export function lanConfig(env:NodeJS.ProcessEnv):LanConfig|null {
  if(env.RELAY_LAN_ENABLED===undefined||env.RELAY_LAN_ENABLED==='0')return null;
  if(env.RELAY_LAN_ENABLED!=='1')throw new Error('RELAY_LAN_ENABLED must be 0 or 1');
  const host=env.RELAY_LAN_HOST??'';
  if(!privateAddress(host))throw new Error('LAN host must be one explicit RFC1918 IPv4 or IPv6 ULA interface address');
  const input=env.RELAY_LAN_ORIGIN??'';
  if(!/^https:\/\/[^/?#\\]+\/?$/.test(input)||/[\s\x00-\x1f\x7f]/.test(input))throw new Error('LAN origin must be an exact HTTPS origin');
  let origin:URL;try {origin=new URL(input);}catch {throw new Error('LAN origin must be an exact HTTPS origin');}
  if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.username||origin.password||origin.search||origin.hash)throw new Error('LAN origin must be an exact HTTPS origin');
  const hostname=unbracket(origin.hostname);
  const bindHostname=new URL(isIP(host)===6?`https://[${host}]`:`https://${host}`).hostname;
  if(hostname==='localhost'||hostname.endsWith('.localhost')||hostname.endsWith('.')||isIP(hostname)&&(!privateAddress(hostname)||bindHostname!==origin.hostname))throw new Error('LAN origin must identify the configured private address or its DNS hostname');
  const port=Number(origin.port||443);
  if(!Number.isInteger(port)||port<1||port>65535||port===4317||port===4318)throw new Error('LAN HTTPS needs a separate port from owner and public gateway listeners');
  return {origin:origin.origin,host,port,certFile:localPath(env.RELAY_LAN_CERT_FILE),keyFile:localPath(env.RELAY_LAN_KEY_FILE)};
}

// Read-only inspection. No ACL, trust-store, firewall or certificate changes.
// Administrators/SYSTEM already control a Windows service account; other allow
// entries are refused conservatively, including inherited broad access.
const windowsPrivateKey=`$ErrorActionPreference='Stop'
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
foreach($path in @($env:RELAY_LAN_KEY_CHECK,[System.IO.Path]::GetDirectoryName($env:RELAY_LAN_KEY_CHECK))) {
 $item=Get-Item -LiteralPath $path -Force
 if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked TLS storage is not allowed' }
 $acl=Get-Acl -LiteralPath $path
 if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid) { throw 'TLS storage belongs to another account' }
 foreach($entry in $acl.Access) {
  if($entry.AccessControlType -eq 'Allow' -and $entry.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin @($sid,'S-1-5-18','S-1-5-32-544')) { throw 'TLS storage grants another account access' }
 }
}`;
async function assertPrivateKey(path:string):Promise<void> {
  if(process.platform==='win32') {
    try {await run(join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(windowsPrivateKey,'utf16le').toString('base64')],{env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',RELAY_LAN_KEY_CHECK:path},windowsHide:true,timeout:5000,maxBuffer:4096});}
    catch(error) {throw new Error('LAN TLS private key and its directory must be owned by this OS account with no access granted to other ordinary accounts',{cause:error});}
    return;
  }
  for(const entry of [path,dirname(path)]) {
    const info=await lstat(entry);
    if(info.uid!==process.getuid?.()||(info.mode&0o077)!==0)throw new Error('LAN TLS private key and its directory must be private to this OS account');
    if(process.platform==='darwin') {
      // macOS extended ACLs are independent of POSIX mode bits. Conservatively
      // refuse extended entries; do not remove or reinterpret the owner's ACL.
      const {stdout}=await run('/bin/ls',['-lde',entry],{env:{LANG:'C'},timeout:5000,maxBuffer:4096});
      if(/^\s*\d+:\s/m.test(stdout))throw new Error('LAN TLS private storage must not contain extended ACL entries');
    }
  }
}
async function boundedFile(path:string,maximum:number,privateKey=false):Promise<Buffer> {
  path=localPath(path);
  const root=parse(path).root;let current=root;
  for(const component of relative(root,path).split(/[\\/]/)) {
    current=join(current,component);const info=await lstat(current);
    if(info.isSymbolicLink()||comparable(await realpath(current))!==comparable(current))throw new Error('LAN TLS files cannot traverse links or filesystem aliases');
    if(current!==path&&!info.isDirectory())throw new Error('LAN TLS parent must be an ordinary directory');
  }
  const original=await lstat(path);
  if(!original.isFile()||original.nlink!==1)throw new Error('LAN TLS material must be an ordinary single-link regular file');
  if(original.size<1||original.size>maximum)throw new Error('LAN TLS file size is outside its allowed bound');
  if(privateKey)await assertPrivateKey(path);
  const file=await open(path,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW));
  try {
    const start=await file.stat();
    if(!start.isFile()||start.nlink!==1||start.dev!==original.dev||start.ino!==original.ino)throw new Error('LAN TLS file changed while opening');
    const bytes=Buffer.alloc(maximum+1);let length=0;
    while(length<bytes.length) {const read=await file.read(bytes,length,bytes.length-length,length);if(read.bytesRead===0)break;length+=read.bytesRead;}
    const end=await file.stat();const pathEnd=await lstat(path);
    if(length>maximum||length!==start.size||end.size!==start.size||end.mtimeMs!==start.mtimeMs||pathEnd.ino!==start.ino||pathEnd.dev!==start.dev||pathEnd.nlink!==1)throw new Error('LAN TLS file size or identity changed during reading');
    return bytes.subarray(0,length);
  } finally {await file.close();}
}

/** Server-side material checks do not establish trust on any client device.
 * Certificate rotation requires a controlled restart; never log the result.
 */
export async function loadLanTls(config:LanConfig):Promise<LanTls> {
  const cert=await boundedFile(config.certFile,128*1024);
  // Resolve links before passing the key path to native permission inspection.
  const key=await boundedFile(config.keyFile,64*1024,true);
  try {
    const certificateText=cert.toString('utf8');const blocks=certificateText.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if(!blocks?.length||blocks.length>8||certificateText.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,'').trim())throw new Error('LAN TLS certificate file must contain a bounded PEM certificate chain');
    const chain=blocks.map(block=>new X509Certificate(block));const leaf=chain[0];
    if(chain.some(item=>Date.now()<Date.parse(item.validFrom)||Date.now()>=Date.parse(item.validTo)))throw new Error('LAN TLS certificate is outside its validity period');
    if(leaf.ca)throw new Error('LAN TLS requires a leaf certificate, not a CA signing certificate');
    const hostname=unbracket(new URL(config.origin).hostname);
    if(!(isIP(hostname)?leaf.checkIP(hostname):leaf.checkHost(hostname,{subject:'never',partialWildcards:false,multiLabelWildcards:false})))throw new Error('LAN TLS certificate SAN does not match the configured origin');
    if(leaf.keyUsage?.length&&!leaf.keyUsage.includes('1.3.6.1.5.5.7.3.1')&&!leaf.keyUsage.includes('2.5.29.37.0'))throw new Error('LAN TLS certificate does not permit server authentication');
    if(!leaf.checkPrivateKey(createPrivateKey(key)))throw new Error('LAN TLS private key does not match the leaf certificate');
    const tls:LanTls={cert,key,minVersion:'TLSv1.2'};createSecureContext(tls);return tls;
  } catch(error) {key.fill(0);throw error;}
}
