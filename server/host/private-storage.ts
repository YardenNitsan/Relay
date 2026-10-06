import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const run=promisify(execFile);
const restrictWindowsDirectory=`$ErrorActionPreference='Stop'
$path=$env:RELAY_PRIVATE_DIRECTORY
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$item=Get-Item -LiteralPath $path -Force
if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked private storage is not allowed' }
if ($item.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Owner).GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Private storage belongs to another Windows account' }
$acl=$item.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
$acl.SetAccessRuleProtection($true,$false)
foreach ($existing in @($acl.Access)) { $acl.RemoveAccessRuleAll($existing) }
$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
$acl.AddAccessRule($rule)
$item.SetAccessControl($acl)
$saved=Get-Acl -LiteralPath $path
if (-not $saved.AreAccessRulesProtected) { throw 'Private storage inheritance remained enabled' }
foreach ($access in $saved.Access) {
 if ($access.AccessControlType -eq 'Allow' -and $access.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Private storage ACL contains another account' }
}`;

export async function privateDirectory(path:string):Promise<string> {
  const directory=resolve(path);await mkdir(directory,{recursive:true,mode:0o700});
  const info=await lstat(directory);
  if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Private storage must be an ordinary directory');
  if(process.platform==='win32') {
    try {
      await run(join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(restrictWindowsDirectory,'utf16le').toString('base64')],{env:{...process.env,RELAY_PRIVATE_DIRECTORY:directory},windowsHide:true,timeout:10000,maxBuffer:16000});
    } catch(error) {throw new Error('Could not restrict private storage to the current Windows account',{cause:error});}
  } else {
    if(info.uid!==process.getuid?.())throw new Error('Private storage belongs to another OS account');
    // macOS extended allow ACLs are independent of the POSIX mode bits. Remove
    // them on this private directory before enforcing owner-only traversal.
    if(process.platform==='darwin')await run('/bin/chmod',['-N',directory],{timeout:5000,maxBuffer:4096});
    await chmod(directory,0o700);
    if(((await lstat(directory)).mode&0o077)!==0)throw new Error('Private storage permissions are not restrictive');
  }
  return directory;
}

// The containing directory must have passed privateDirectory first. O_EXCL keeps
// temporary files from following links; rename replaces the delivery file itself.
export async function writePrivate(path:string,content:string):Promise<void> {
  const temporary=join(dirname(path),`.private-${randomUUID()}`);
  try {const file=await open(temporary,'wx',0o600);try{await file.writeFile(content);await file.sync();}finally{await file.close();}await rename(temporary,path);}
  finally {await unlink(temporary).catch(()=>{});}
}

export async function readPrivate(path:string):Promise<string> {
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>4096)throw new Error('Invalid private credential file');
  if(process.platform!=='win32'&&(info.uid!==process.getuid?.()||(info.mode&0o077)!==0))throw new Error('Private credential permissions are not restrictive');
  const file=await open(path,'r');try{return await file.readFile('utf8');}finally{await file.close();}
}
