import {expect,test,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {openProjectChooser,pairBrowser,projectIndex} from './helpers';
import {readFile} from 'node:fs/promises';
import {basename,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {ToolStore} from '../../server/tools/store';

async function prepare(page:Page){
  await page.goto('/');await pairBrowser(page);
  const records=await page.evaluate(async()=>{
    const session=await(await fetch('/api/session')).json(),headers={'content-type':'application/json','x-relay-csrf':session.csrfToken};
    const request=async(path:string,body:unknown,method='POST')=>{const response=await fetch(`/api${path}`,{method,headers,body:JSON.stringify(body)});if(!response.ok)throw new Error(await response.text());return response.json();};
    const parent=await request('/workspaces',{name:'Release workspace'});await request(`/workspaces/${parent.id}/files`,{path:'a.txt',content:'original'});
    const child=await request(`/workspaces/${parent.id}/fork`,{name:'Reviewed feature'});const file=await(await fetch(`/api/workspaces/${child.id}/file?path=a.txt`)).json();await request(`/workspaces/${child.id}/file`,{path:'a.txt',content:'reviewed change',expectedHash:file.sha256},'PUT');return {parent,child};
  });
  await page.reload();await openProjectChooser(page);const dialog=await projectIndex(page);await dialog.getByRole('button',{name:'Open Reviewed feature',exact:true}).click();await dialog.getByRole('button',{name:'Review integration',exact:true}).click();return {...records,dialog};
}
for(const [width,height,theme] of [[320,740,'light'],[390,844,'dark'],[844,390,'light'],[1440,960,'light']] as const)test(`reviewed branch integration and durable rollback at ${width}px ${theme}`,async({page})=>{
  await page.setViewportSize({width,height});await page.addInitScript(theme=>localStorage.setItem('relay:theme:v1',theme),theme);
  const {parent,dialog}=await prepare(page);
  await expect(dialog.getByRole('heading',{name:'Bring changes into Release workspace',exact:true})).toBeVisible();
  await page.screenshot({path:`output/final-evolution/branch-review-${width}-${theme}.png`});
  const apply=dialog.getByRole('button',{name:'Integrate selected files',exact:true});await expect(apply).toBeDisabled();
  await dialog.getByRole('button',{name:'Inspect a.txt',exact:true}).click();await expect(dialog.getByRole('region',{name:'Reviewed file difference',exact:true})).toContainText('+reviewed change');
  await dialog.getByRole('checkbox',{name:'Integrate a.txt',exact:true}).check();await dialog.getByRole('checkbox',{name:'I approve selected changes to Release workspace',exact:true}).check();
  await apply.scrollIntoViewIfNeeded();await expect(apply).toBeInViewport({ratio:1});expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:`output/final-evolution/branch-integration-${width}-${theme}.png`});
  const committed=page.waitForResponse(response=>response.request().method()==='POST'&&/\/integration$/.test(new URL(response.url()).pathname));await apply.click();expect((await committed).ok()).toBe(true);await expect(dialog.getByRole('status')).toContainText('Integrated 1 file');
  expect(await page.evaluate(async id=>(await(await fetch(`/api/workspaces/${id}/file?path=a.txt`)).json()).content,parent.id)).toBe('reviewed change');
  await dialog.getByRole('button',{name:/^Review receipt /}).first().click();await expect(dialog.getByRole('region',{name:'Saved integration receipt',exact:true})).toContainText('a.txt');
  await dialog.getByRole('checkbox',{name:'I approve restoring these parent files',exact:true}).check();const rollback=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/rollback'));await dialog.getByRole('button',{name:'Restore parent files',exact:true}).click();expect((await rollback).ok()).toBe(true);await expect(dialog.getByRole('status')).toContainText('Parent files restored');
  expect(await page.evaluate(async id=>(await(await fetch(`/api/workspaces/${id}/file?path=a.txt`)).json()).content,parent.id)).toBe('original');
});

test('integration preserves review selection on dismissal and blocks stale publication',async({page})=>{
  await page.setViewportSize({width:390,height:844});const {parent,dialog}=await prepare(page);
  await dialog.getByRole('checkbox',{name:'Integrate a.txt',exact:true}).check();await dialog.getByRole('button',{name:'Files',exact:true}).click();const guard=page.getByRole('dialog',{name:'Unsaved changes',exact:true});await expect(guard).toBeVisible();await guard.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(dialog.getByRole('checkbox',{name:'Integrate a.txt',exact:true})).toBeChecked();
  await page.evaluate(async id=>{const s=await(await fetch('/api/session')).json();const file=await(await fetch(`/api/workspaces/${id}/file?path=a.txt`)).json();const response=await fetch(`/api/workspaces/${id}/file`,{method:'PUT',headers:{'content-type':'application/json','x-relay-csrf':s.csrfToken},body:JSON.stringify({path:'a.txt',content:'Later parent edit',expectedHash:file.sha256})});if(!response.ok)throw new Error('Fixture edit failed');},parent.id);
  await dialog.getByRole('checkbox',{name:'I approve selected changes to Release workspace',exact:true}).check();await dialog.getByRole('button',{name:'Integrate selected files',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('changed since review');
  expect(await page.evaluate(async id=>(await(await fetch(`/api/workspaces/${id}/file?path=a.txt`)).json()).content,parent.id)).toBe('Later parent edit');
});

test('integration blocks duplicate actions and dismissal until the reviewed write settles',async({page})=>{
  await page.setViewportSize({width:390,height:844});const {child,dialog}=await prepare(page);let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let finished!:()=>void;const handled=new Promise<void>(resolve=>{finished=resolve;});let calls=0;
  await page.route(`**/api/workspaces/${child.id}/integration`,async route=>{if(route.request().method()!=='POST'){await route.continue();return;}calls++;try{await gate;await route.continue();}finally{finished();}});
  try{
    await dialog.getByRole('checkbox',{name:'Integrate a.txt',exact:true}).check();await dialog.getByRole('checkbox',{name:'I approve selected changes to Release workspace',exact:true}).check();const applying=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith('/integration'));
    await dialog.getByRole('button',{name:'Integrate selected files',exact:true}).click();await expect(dialog.getByRole('button',{name:'Applying reviewed changes…',exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'Files',exact:true}).click();await expect(dialog.getByText('Wait for the current operation to finish before leaving this view.',{exact:true})).toBeVisible();await expect(dialog.getByRole('checkbox',{name:'Integrate a.txt',exact:true})).toBeChecked();expect(calls).toBe(1);
    release();expect((await applying).ok()).toBe(true);await expect(dialog.getByRole('status')).toContainText('Integrated 1 file');
  }finally{release();await handled;await page.unrouteAll({behavior:'wait'});}
});

test('integration acknowledges the durable result before slow history refresh',async({page})=>{
  await page.setViewportSize({width:390,height:844});const {child,dialog}=await prepare(page);let hold=false,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/workspaces/${child.id}/integration`,async route=>{if(hold&&route.request().method()==='GET')await gate;await route.continue();});
  try{
    await dialog.getByRole('checkbox',{name:'Integrate a.txt',exact:true}).check();await dialog.getByRole('checkbox',{name:'I approve selected changes to Release workspace',exact:true}).check();hold=true;
    await dialog.getByRole('button',{name:'Integrate selected files',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Integrated 1 file');await dialog.getByRole('button',{name:'Files',exact:true}).click();await expect(dialog.getByRole('searchbox',{name:'Search files',exact:true})).toBeVisible();await expect(page.getByRole('dialog',{name:'Unsaved changes',exact:true})).toHaveCount(0);
  }finally{hold=false;release();await page.unrouteAll({behavior:'wait'});}
});

test('an injected interrupted receipt can be verified without replaying a file write',async({page})=>{
  await page.setViewportSize({width:390,height:844});const {parent,child,dialog}=await prepare(page);
  const fixture=JSON.parse(await readFile(resolve('.e2e-data/host/fixture-workspace-root.json'),'utf8')) as {root:string};const root=resolve(fixture.root);
  if(dirname(root)!==resolve(tmpdir())||!/^relay-e2e-[\w-]+$/.test(basename(root)))throw new Error('Unexpected disposable fixture path');
  // Explicitly injected durable interruption: browser acceptance exercises the
  // real owner API and byte verification; broker fault tests cover its creation.
  const checkpointId=randomUUID();await new ToolStore(root).saveCheckpoint({id:checkpointId,taskId:`branch-${child.id}`,workspaceId:parent.id,createdAt:new Date().toISOString(),state:'prepared',entries:[{path:'a.txt',before:'original',after:'reviewed change'}]});
  await dialog.getByRole('button',{name:'Refresh review',exact:true}).click();await expect(dialog.getByText(/An interrupted integration needs inspection/)).toBeVisible();await expect(dialog.getByRole('checkbox',{name:'Integrate a.txt',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:`Review receipt ${checkpointId.slice(0,8)}`,exact:true}).click();await dialog.getByRole('checkbox',{name:'I approve verifying this receipt without changing files',exact:true}).check();const completed=page.waitForResponse(response=>response.url().endsWith('/reconcile'));await dialog.getByRole('button',{name:'Verify saved file states',exact:true}).click();expect((await completed).ok()).toBe(true);await expect(dialog.getByRole('status')).toContainText('Receipt verified. Parent files were not changed.');
  expect(await page.evaluate(async id=>(await(await fetch(`/api/workspaces/${id}/file?path=a.txt`)).json()).content,parent.id)).toBe('original');
});
