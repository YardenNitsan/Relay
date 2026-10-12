import {readFile,realpath} from 'node:fs/promises';
import {basename,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {ToolBroker} from '../../server/tools/index';

// Native fixture setup only. This module is never bundled into Relay. The
// workspace is first created through the authenticated API; all browser reads
// and edits still exercise that API. Repeated sample uploads would otherwise
// exhaust its shared production IP limit before the UI scenario begins.
export async function seedProjectFiles(id:string,files:ReadonlyArray<readonly [string,string]>) {
  const fixture=JSON.parse(await readFile(resolve('.e2e-data/host/fixture-workspace-root.json'),'utf8')) as {root:string};
  const root=resolve(fixture.root);
  if(dirname(root)!==resolve(tmpdir())||!/^relay-e2e-[\w-]+$/.test(basename(root))||await realpath(root)!==root)throw new Error('Unexpected disposable browser fixture directory');
  const broker=new ToolBroker(root,()=>false);
  for(const [path,content] of files)await broker.upload(id,path,content);
}
