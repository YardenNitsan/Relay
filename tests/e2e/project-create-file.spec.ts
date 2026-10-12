import {expect,test,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {openProjectChooser,pairBrowser,projectIndex} from './helpers';

async function project(page:Page,width:number,existing=false){
  await page.setViewportSize({width,height:900});await page.goto('/');await pairBrowser(page);
  const workspace=await page.evaluate(async existing=>{
    const session=await(await fetch('/api/session')).json() as {csrfToken:string};
    const response=await fetch('/api/workspaces',{method:'POST',headers:{'content-type':'application/json','x-relay-csrf':session.csrfToken},body:JSON.stringify({name:'File authoring',personal:true})});
    if(!response.ok)throw new Error('Workspace setup failed');const workspace=await response.json() as {id:string};
    if(existing){const created=await fetch(`/api/workspaces/${workspace.id}/file`,{method:'PUT',headers:{'content-type':'application/json','x-relay-csrf':session.csrfToken},body:JSON.stringify({path:'existing.txt',content:'Saved contents',expectedHash:null})});if(!created.ok)throw new Error('File setup failed');}return workspace;
  },existing);
  await page.reload();await openProjectChooser(page);const dialog=await projectIndex(page);
  await dialog.getByRole('button',{name:'Open File authoring',exact:true}).click();return {dialog,id:workspace.id};
}

for(const width of [320,1440])test(`creates a nested empty file, edits and deletes with held list refresh at ${width}px`,async({page})=>{
  const {dialog,id}=await project(page,width);let hold=false,release=()=>{};
  const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/workspaces/${id}/files`,async route=>{if(hold)await held;await route.continue();});
  try{
    await expect(dialog.getByRole('button',{name:'New file',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'New file',exact:true}).click();
    const editor=dialog.getByRole('region',{name:'Create project file',exact:true});
    await expect(editor.getByRole('textbox',{name:'Relative file path',exact:true})).toBeFocused();
    await editor.getByRole('textbox',{name:'Relative file path',exact:true}).fill('src/new-feature/empty.ts');
    await dialog.getByRole('button',{name:'Close Workspaces',exact:true}).click();
    const warning=page.getByRole('dialog',{name:'Unsaved changes',exact:true});await expect(warning).toBeVisible();await warning.getByRole('button',{name:'Keep editing',exact:true}).click();
    expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    await page.screenshot({path:`output/playwright/project-new-file-${width}.png`,animations:'disabled'});
    hold=true;
    const creating=page.waitForResponse(response=>response.url().endsWith('/file')&&response.request().method()==='PUT');
    await editor.getByRole('button',{name:'Create file',exact:true}).click();expect((await creating).ok()).toBe(true);
    await expect(dialog.getByRole('heading',{name:'src/new-feature/empty.ts',exact:true})).toBeFocused();
    const contents=dialog.getByRole('textbox',{name:'File contents',exact:true});await expect(contents).toBeEnabled();await expect(contents).toHaveValue('');
    await contents.fill('export const ready = true;');
    await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
    await expect(dialog.getByRole('button',{name:'Close file',exact:true})).toBeEnabled();
    expect(await page.evaluate(async id=>await(await fetch(`/api/workspaces/${id}/file?path=src/new-feature/empty.ts`)).json(),id)).toMatchObject({content:'export const ready = true;'});
    await dialog.getByRole('button',{name:'Delete file',exact:true}).click();await dialog.getByRole('button',{name:'Confirm delete',exact:true}).click();
    await expect(dialog.getByRole('button',{name:'New file',exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'src/new-feature/empty.ts',exact:true})).toHaveCount(0);
    expect(await page.evaluate(async id=>(await fetch(`/api/workspaces/${id}/file?path=src/new-feature/empty.ts`)).status,id)).toBe(404);
    await dialog.getByRole('button',{name:'Close Workspaces',exact:true}).click();await expect(dialog).toHaveCount(0);
  }finally{hold=false;release();await page.unrouteAll({behavior:'wait'});}
});

test('acknowledged edits release the phone editor while list refresh is stalled',async({page})=>{
  const {dialog,id}=await project(page,320,true);let release=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
  await dialog.getByRole('button',{name:'existing.txt',exact:true}).click();const contents=dialog.getByRole('textbox',{name:'File contents',exact:true});await contents.fill('Saved new contents');
  await page.route(`**/api/workspaces/${id}/files`,async route=>{await held;await route.continue();});
  try{
    const saving=page.waitForResponse(response=>response.url().endsWith('/file')&&response.request().method()==='PUT');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();expect((await saving).ok()).toBe(true);
    await expect(contents).toBeEnabled();await expect(dialog.getByRole('button',{name:'Close file',exact:true})).toBeEnabled();
    await contents.fill('A later unsaved draft');await dialog.getByRole('button',{name:'Close Workspaces',exact:true}).click();await expect(page.getByRole('dialog',{name:'Unsaved changes',exact:true})).toBeVisible();
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});

test('new-file collisions retain the draft and never overwrite the existing file',async({page})=>{
  const {dialog,id}=await project(page,390);
  await page.evaluate(async id=>{const session=await(await fetch('/api/session')).json() as {csrfToken:string};const response=await fetch(`/api/workspaces/${id}/file`,{method:'PUT',headers:{'content-type':'application/json','x-relay-csrf':session.csrfToken},body:JSON.stringify({path:'existing.txt',content:'Owner contents',expectedHash:null})});if(!response.ok)throw new Error('File setup failed');},id);
  await expect(dialog.getByRole('button',{name:'New file',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'New file',exact:true}).click();
  const editor=dialog.getByRole('region',{name:'Create project file',exact:true});
  await editor.getByRole('textbox',{name:'Relative file path',exact:true}).fill('existing.txt');await editor.getByRole('textbox',{name:'New file contents',exact:true}).fill('Unsaved draft');
  await editor.getByRole('button',{name:'Create file',exact:true}).click();await expect(editor.getByRole('alert')).toContainText('This file changed');
  await expect(editor.getByRole('textbox',{name:'New file contents',exact:true})).toHaveValue('Unsaved draft');
  expect(await page.evaluate(async id=>await(await fetch(`/api/workspaces/${id}/file?path=existing.txt`)).json(),id)).toMatchObject({content:'Owner contents'});
  await editor.getByRole('textbox',{name:'Relative file path',exact:true}).fill('different.txt');await editor.getByRole('button',{name:'Create file',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'different.txt',exact:true})).toBeFocused();await expect(dialog.getByRole('textbox',{name:'File contents',exact:true})).toHaveValue('Unsaved draft');
});

test('new-file creation remains guarded and reachable in dark short landscape',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('relay:theme:v1','dark'));
  const {dialog}=await project(page,844);await page.setViewportSize({width:844,height:390});
  await dialog.getByRole('button',{name:'New file',exact:true}).click();const editor=dialog.getByRole('region',{name:'Create project file',exact:true});
  await editor.getByRole('textbox',{name:'Relative file path',exact:true}).fill('short-screen.txt');await editor.getByRole('textbox',{name:'New file contents',exact:true}).fill('Real managed file');
  await expect(editor.getByRole('button',{name:'Create file',exact:true})).toBeInViewport({ratio:1});await expect(editor.getByRole('button',{name:'Cancel new file',exact:true})).toBeInViewport({ratio:1});
  expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:'output/playwright/project-new-file-844-dark.png',animations:'disabled'});
  let release=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/workspaces/*/file',async route=>{if(route.request().method()!=='PUT'){await route.continue();return;}const response=await route.fetch();await held;await route.fulfill({response});});
  try{
    await editor.getByRole('button',{name:'Create file',exact:true}).click();await expect(editor.getByRole('textbox',{name:'Relative file path',exact:true})).toBeDisabled();
    await expect(editor.getByRole('button',{name:'Cancel new file',exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'Close Workspaces',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Wait for the current operation');
  }finally{release();await page.unrouteAll({behavior:'wait'});}
  await expect(dialog.getByRole('heading',{name:'short-screen.txt',exact:true})).toBeFocused();await expect(dialog.getByRole('textbox',{name:'File contents',exact:true})).toHaveValue('Real managed file');
});
