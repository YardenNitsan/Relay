import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdtemp,writeFile,readFile,rm,lstat} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {openProjectChooser,pairBrowser} from './helpers';

// Real native source files in a newly created disposable sibling directory.
// Relay's installation protection remains active; no actual repository is used.
for(const width of [320,390,1440])test(`reviewed original publication and rollback at ${width}px`,async({page})=>{
  const parent=resolve('..'),source=await mkdtemp(join(parent,'relay-publication-e2e-'));
  if(dirname(source)!==parent||!basename(source).startsWith('relay-publication-e2e-'))throw new Error('Unexpected publication fixture boundary');
  const original='export const answer = 1;\n',replacement='export const answer = 2;\n';
  let releaseHistory=()=>{},holdHistory=false;
  await writeFile(join(source,'example.ts'),original);await writeFile(join(source,'owner-notes.txt'),'Unrelated owner draft');
  try{
    await page.setViewportSize({width,height:900});await page.goto('/');await pairBrowser(page);
    await openProjectChooser(page);
    const dialog=page.getByRole('dialog',{name:'Workspaces',exact:true});
    await dialog.getByRole('button',{name:'New workspace',exact:true}).click();
    await dialog.getByRole('textbox',{name:'Name',exact:true}).fill(`Publication ${width}`);
    await dialog.getByLabel('Source directory',{exact:false}).fill(source);
    const importing=page.waitForResponse(response=>response.url().endsWith('/api/workspaces')&&response.request().method()==='POST');
    await dialog.getByRole('button',{name:'Import managed copy',exact:true}).click();expect((await importing).ok()).toBe(true);
    const workspace=dialog.getByRole('region',{name:'Project inspector',exact:true});
    await expect(workspace).toBeFocused();
    await workspace.getByRole('button',{name:'example.ts',exact:true}).click();
    await workspace.getByRole('textbox',{name:'File contents',exact:true}).fill(replacement);
    const saving=page.waitForResponse(response=>response.url().endsWith('/file')&&response.request().method()==='PUT');
    await workspace.getByRole('button',{name:'Save changes',exact:true}).click();expect((await saving).ok()).toBe(true);
    await workspace.getByRole('button',{name:'Close file',exact:true}).click();
    await writeFile(join(source,'owner-notes.txt'),'Unrelated owner edit after import');
    await dialog.getByRole('button',{name:'Original source & review',exact:true}).click();
    const publication=dialog.getByRole('region',{name:'Original project publication',exact:true});
    if(width===320){const held=new Promise<void>(resolve=>{releaseHistory=resolve;});await page.route('**/api/workspaces/*/publications',async route=>{if(holdHistory)await held;await route.continue();});}
    await publication.getByRole('button',{name:'Review publication to original',exact:true}).click();
    let releasePreview:()=>void=()=>{};
    const previewHeld=new Promise<void>(resolve=>{releasePreview=resolve;});
    if(width===320)await page.route('**/api/workspaces/*/publications/preview',async route=>{
      const response=await route.fetch();await previewHeld;await route.fulfill({response});
    });
    const preparing=page.waitForResponse(response=>response.url().endsWith('/publications/preview')&&response.request().method()==='POST');
    await publication.getByRole('button',{name:'Prepare publication review',exact:true}).click();
    try{if(width===320)await expect(publication.getByRole('status').filter({hasText:'Preparing publication review'})).toBeVisible();}
    finally{releasePreview();}
    expect((await preparing).ok()).toBe(true);
    await expect(publication.getByRole('heading',{name:'Review original project changes',exact:true})).toBeFocused();
    const approve=publication.getByRole('checkbox',{name:'I approve these exact changes to the original files',exact:true});
    await expect(publication.getByRole('button',{name:'Publish approved changes',exact:true})).toBeDisabled();
    expect(await readFile(join(source,'example.ts'),'utf8')).toBe(original);
    if(width===390){
      await writeFile(join(source,'example.ts'),'Independent edit after review');await approve.check();
      const conflict=page.waitForResponse(response=>response.url().endsWith('/apply')&&response.request().method()==='POST');
      await publication.getByRole('button',{name:'Publish approved changes',exact:true}).click();expect((await conflict).status()).toBe(409);
      await expect(publication.getByRole('alert')).toContainText('Original file changed');expect(await readFile(join(source,'example.ts'),'utf8')).toBe('Independent edit after review');
      await writeFile(join(source,'example.ts'),original);await expect(approve).not.toBeChecked();
    }
    await approve.check();
    expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    await publication.scrollIntoViewIfNeeded();await page.screenshot({path:`output/playwright/publication-${width}.png`,animations:'disabled'});
    if(width!==390)expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    const applying=page.waitForResponse(response=>response.url().endsWith('/apply')&&response.request().method()==='POST');
    holdHistory=true;
    await publication.getByRole('button',{name:'Publish approved changes',exact:true}).click();const applied=await applying;expect(applied.ok()).toBe(true);expect(applied.request().postDataJSON()).toMatchObject({confirmed:true});
    await expect(publication.getByRole('status')).toContainText('published');
    expect(await readFile(join(source,'example.ts'),'utf8')).toBe(replacement);expect(await readFile(join(source,'owner-notes.txt'),'utf8')).toBe('Unrelated owner edit after import');
    await expect(publication.getByRole('button',{name:'Prepare rollback review',exact:true})).toBeEnabled();
    const rollbackPreview=page.waitForResponse(response=>response.url().endsWith('/rollback-preview')&&response.request().method()==='POST');
    await publication.getByRole('button',{name:'Prepare rollback review',exact:true}).click();expect((await rollbackPreview).ok()).toBe(true);
    await expect(publication.getByRole('heading',{name:'Review rollback',exact:true})).toBeFocused();
    await expect(publication.getByRole('button',{name:'Apply approved rollback',exact:true})).toBeDisabled();await approve.check();
    const rollingBack=page.waitForResponse(response=>response.url().endsWith('/apply')&&response.request().method()==='POST');
    await publication.getByRole('button',{name:'Apply approved rollback',exact:true}).click();expect((await rollingBack).ok()).toBe(true);
    await expect(publication.getByRole('status')).toContainText('rollback completed');expect(await readFile(join(source,'example.ts'),'utf8')).toBe(original);
    expect(await readFile(join(source,'owner-notes.txt'),'utf8')).toBe('Unrelated owner edit after import');
    await expect(publication.getByRole('button',{name:'Prepare publication review',exact:true})).toBeEnabled();
    await dialog.getByRole('button',{name:'Close Workspaces',exact:true}).click();await expect(dialog).toHaveCount(0);
  }finally{holdHistory=false;releaseHistory();await page.unrouteAll({behavior:'wait'});await rm(source,{recursive:true,force:true});}
});

for(const width of [320,1440])test(`presence-aware publication reviews and rolls back a rename and empty addition at ${width}px`,async({page})=>{
  const parent=resolve('..'),source=await mkdtemp(join(parent,'relay-publication-e2e-'));
  if(dirname(source)!==parent||!basename(source).startsWith('relay-publication-e2e-'))throw new Error('Unexpected publication fixture boundary');
  const original='export const answer = 42;\n';await writeFile(join(source,'old-name.ts'),original);
  try{
    await page.setViewportSize({width,height:900});await page.goto('/');await pairBrowser(page);
    if(width===1440)await page.getByRole('button',{name:'Switch to dark theme',exact:true}).click();
    await openProjectChooser(page);
    const dialog=page.getByRole('dialog',{name:'Workspaces',exact:true});
    await dialog.getByRole('button',{name:'New workspace',exact:true}).click();
    await dialog.getByRole('textbox',{name:'Name',exact:true}).fill(`Presence ${width}`);await dialog.getByLabel('Source directory',{exact:false}).fill(source);
    const importing=page.waitForResponse(response=>response.url().endsWith('/api/workspaces')&&response.request().method()==='POST');
    await dialog.getByRole('button',{name:'Import managed copy',exact:true}).click();const response=await importing;expect(response.ok()).toBe(true);const workspace=await response.json() as {id:string};
    // Arrange managed changes through the actual authenticated/CSRF API. The
    // review, approval and recovery below use the rendered UI and native source.
    expect(await page.evaluate(async({id,original})=>{
      const session=await(await fetch('/api/session')).json() as {csrfToken:string};const headers={'content-type':'application/json','x-relay-csrf':session.csrfToken};
      const states=[];
      for(const [path,content] of [['new-name.ts',original],['empty.txt','']])states.push((await fetch(`/api/workspaces/${id}/files`,{method:'POST',headers,body:JSON.stringify({path,content})})).status);
      const file=await(await fetch(`/api/workspaces/${id}/file?path=old-name.ts`)).json() as {sha256:string};
      states.push((await fetch(`/api/workspaces/${id}/file`,{method:'DELETE',headers,body:JSON.stringify({path:'old-name.ts',expectedHash:file.sha256})})).status);return states;
    },{id:workspace.id,original})).toEqual([200,200,200]);
    await dialog.getByRole('button',{name:'Original source & review',exact:true}).click();
    const publication=dialog.getByRole('region',{name:'Original project publication',exact:true});
    await publication.getByRole('button',{name:'Review publication to original',exact:true}).click();
    const preparing=page.waitForResponse(response=>response.url().endsWith('/publications/preview')&&response.request().method()==='POST');
    await publication.getByRole('button',{name:'Prepare publication review',exact:true}).click();expect((await preparing).ok()).toBe(true);
    const select=publication.getByRole('combobox',{name:'Reviewed file',exact:true});
    await expect(select.locator('option')).toHaveText(['Add / empty.txt','Add / new-name.ts','Delete / old-name.ts']);
    await expect(publication.locator('.publication-operation')).toContainText('does not exist');
    await publication.getByText('Inspect exact before and after contents',{exact:true}).click();
    await expect(publication.getByText('Empty file (0 bytes)',{exact:true})).toBeVisible();
    await select.selectOption({label:'Delete / old-name.ts'});await expect(publication.locator('.publication-operation')).toContainText('will be removed');
    await expect(publication.getByText(/original permissions are not restored/)).toBeVisible();
    expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    await select.scrollIntoViewIfNeeded();await page.screenshot({path:`output/playwright/publication-presence-${width}.png`,animations:'disabled'});
    const approve=publication.getByRole('checkbox',{name:'I approve these exact changes to the original files',exact:true});await approve.check();
    await publication.getByRole('button',{name:'Publish approved changes',exact:true}).click();await expect(publication.getByRole('status')).toContainText('published');
    expect(await readFile(join(source,'new-name.ts'),'utf8')).toBe(original);expect(await readFile(join(source,'empty.txt'),'utf8')).toBe('');await expect(lstat(join(source,'old-name.ts'))).rejects.toMatchObject({code:'ENOENT'});
    const rollbackPreview=page.waitForResponse(response=>response.url().endsWith('/rollback-preview')&&response.request().method()==='POST');
    await publication.getByRole('button',{name:'Prepare rollback review',exact:true}).click();expect((await rollbackPreview).ok()).toBe(true);await expect(publication.getByRole('heading',{name:'Review rollback',exact:true})).toBeFocused();
    await approve.check();await publication.getByRole('button',{name:'Apply approved rollback',exact:true}).click();await expect(publication.getByRole('status')).toContainText('rollback completed');
    expect(await readFile(join(source,'old-name.ts'),'utf8')).toBe(original);for(const path of ['new-name.ts','empty.txt'])await expect(lstat(join(source,path))).rejects.toMatchObject({code:'ENOENT'});
  }finally{await rm(source,{recursive:true,force:true});}
});
