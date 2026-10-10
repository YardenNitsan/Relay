import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {pairBrowser} from './helpers';

// Real native source files in a newly created disposable sibling directory.
// Relay's installation protection remains active; no actual repository is used.
for(const width of [320,390,1440])test(`reviewed original publication and rollback at ${width}px`,async({page})=>{
  const parent=resolve('..'),source=await mkdtemp(join(parent,'relay-publication-e2e-'));
  if(dirname(source)!==parent||!basename(source).startsWith('relay-publication-e2e-'))throw new Error('Unexpected publication fixture boundary');
  const original='export const answer = 1;\n',replacement='export const answer = 2;\n';
  await writeFile(join(source,'example.ts'),original);await writeFile(join(source,'owner-notes.txt'),'Unrelated owner draft');
  try{
    await page.setViewportSize({width,height:900});await page.goto('/');await pairBrowser(page);
    await page.getByRole('button',{name:/^(Choose workspace|Workspace)$/}).click();
    const dialog=page.getByRole('dialog',{name:'Workspaces',exact:true});
    await dialog.getByRole('textbox',{name:'Name',exact:true}).fill(`Publication ${width}`);
    await dialog.getByLabel('Source directory',{exact:false}).fill(source);
    const importing=page.waitForResponse(response=>response.url().endsWith('/api/workspaces')&&response.request().method()==='POST');
    await dialog.getByRole('button',{name:'Import managed copy',exact:true}).click();expect((await importing).ok()).toBe(true);
    const workspace=dialog.locator('article.workspace-item').filter({hasText:`Publication ${width}`});
    await workspace.getByRole('button',{name:'Inspect files',exact:true}).click();await workspace.getByRole('button',{name:'example.ts',exact:true}).click();
    await workspace.getByRole('textbox',{name:'File contents',exact:true}).fill(replacement);
    const saving=page.waitForResponse(response=>response.url().endsWith('/file')&&response.request().method()==='PUT');
    await workspace.getByRole('button',{name:'Save changes',exact:true}).click();expect((await saving).ok()).toBe(true);
    await workspace.getByRole('button',{name:'Close file',exact:true}).click();
    await writeFile(join(source,'owner-notes.txt'),'Unrelated owner edit after import');
    const publication=dialog.getByRole('region',{name:'Original project publication',exact:true});
    await publication.getByRole('button',{name:'Review publication to original',exact:true}).click();
    await publication.getByRole('button',{name:'Prepare publication review',exact:true}).click();
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
    await publication.getByRole('button',{name:'Publish approved changes',exact:true}).click();const applied=await applying;expect(applied.ok()).toBe(true);expect(applied.request().postDataJSON()).toMatchObject({confirmed:true});
    await expect(publication.getByRole('status')).toContainText('published');
    expect(await readFile(join(source,'example.ts'),'utf8')).toBe(replacement);expect(await readFile(join(source,'owner-notes.txt'),'utf8')).toBe('Unrelated owner edit after import');
    await publication.getByRole('button',{name:'Prepare rollback review',exact:true}).click();
    await expect(publication.getByRole('heading',{name:'Review rollback',exact:true})).toBeFocused();
    await expect(publication.getByRole('button',{name:'Apply approved rollback',exact:true})).toBeDisabled();await approve.check();
    const rollingBack=page.waitForResponse(response=>response.url().endsWith('/apply')&&response.request().method()==='POST');
    await publication.getByRole('button',{name:'Apply approved rollback',exact:true}).click();expect((await rollingBack).ok()).toBe(true);
    await expect(publication.getByRole('status')).toContainText('rollback completed');expect(await readFile(join(source,'example.ts'),'utf8')).toBe(original);
    expect(await readFile(join(source,'owner-notes.txt'),'utf8')).toBe('Unrelated owner edit after import');
  }finally{await rm(source,{recursive:true,force:true});}
});
