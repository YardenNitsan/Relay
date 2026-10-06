import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Native acceptance tools use the same OS-account pairing path as a browser.
// There is no test-only login route, environment bypass, or reusable HTTP secret.
export async function pairLocalSession(address) {
  const origin=new URL(address);
  if(origin.protocol!=='http:'||!['127.0.0.1','localhost'].includes(origin.hostname)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Acceptance requires an exact loopback HTTP origin');
  const dataDirectory=resolve(process.env.RELAY_DATA_DIR??'.data');
  execFileSync(process.execPath,['dist-server/pair.js','--data-dir',dataDirectory],{stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:15000});
  const delivery=JSON.parse(await readFile(join(dataDirectory,'auth','owner-pairing.json'),'utf8'));
  const response=await fetch(`${origin.origin}/api/session/pair`,{method:'POST',headers:{origin:origin.origin,'content-type':'application/json'},body:JSON.stringify({token:delivery.token})});
  if(!response.ok)throw new Error(`Local pairing failed (HTTP ${response.status}); verify RELAY_DATA_DIR points to this host's data directory`);
  const cookie=response.headers.get('set-cookie')?.split(';')[0];const {csrfToken}=await response.json();
  if(!cookie||typeof csrfToken!=='string')throw new Error('Pairing did not establish an authenticated session');
  return {cookie,csrfToken};
}
