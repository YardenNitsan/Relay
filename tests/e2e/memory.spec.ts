import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';
import {openCommands,pairBrowser} from './helpers';

// Real paired fixture-host CRUD and JSON download. No model/provider calls or
// intercepted memory responses are used as evidence of persistence.
for(const size of [{width:320,height:740},{width:390,height:844},{width:1440,height:1000}]){
  test(`approved memory CRUD, revision and export at ${size.width}px`,async({page})=>{
    await page.setViewportSize(size);
    await page.goto('/');await pairBrowser(page);await openCommands(page);
    await page.getByRole('option',{name:/Manage memory/}).click();
    let dialog=page.getByRole('dialog',{name:'Your memory',exact:true});
    const title=`Memory ${size.width} ${Date.now()} ${'x'.repeat(75)}`;
    await dialog.getByRole('button',{name:'New memory',exact:true}).click();
    await dialog.getByRole('textbox',{name:'Title',exact:true}).fill(title);
    await dialog.getByRole('textbox',{name:'What should Relay remember?',exact:true}).fill('Prefer concise explanations. This note was explicitly saved in a browser test.');
    const approval=dialog.getByRole('checkbox',{name:'I approve saving this memory for my future tasks',exact:true});
    await expect(dialog.getByRole('button',{name:'Save approved memory',exact:true})).toBeDisabled();
    await approval.check();
    const createdResponse=page.waitForResponse(response=>response.url().endsWith('/api/memory')&&response.request().method()==='POST');
    await dialog.getByRole('button',{name:'Save approved memory',exact:true}).click();
    const response=await createdResponse;expect(response.ok()).toBe(true);
    const saved=await response.json() as {id:string;revision:number};expect(saved.revision).toBe(1);
    expect(response.request().postDataJSON()).toMatchObject({confirm:true,workspaceId:null,enabled:true});
    let card=dialog.getByRole('article').filter({has:page.getByRole('heading',{name:title,exact:true})});
    await expect(card).toBeVisible();
    const toggle=card.getByRole('checkbox',{name:`Use ${title} in future tasks`,exact:true});
    for(const [checked,revision] of [[false,2],[true,3]] as const){
      const updatedResponse=page.waitForResponse(item=>item.url().endsWith(`/api/memory/${saved.id}`)&&item.request().method()==='PUT');
      // This controlled checkbox changes after the durable update completes.
      // click() dispatches once; assert the saved response and eventual state.
      await toggle.click();
      const updated=await updatedResponse;expect(updated.ok()).toBe(true);
      expect(await updated.json()).toMatchObject({enabled:checked,revision});
      await expect(toggle).toBeChecked({checked});await expect(toggle).toBeEnabled();
    }
    await card.getByRole('button',{name:'Edit',exact:true}).click();
    await expect(approval).not.toBeChecked();await expect(dialog.getByRole('combobox',{name:'Scope',exact:true})).toBeDisabled();
    await dialog.getByRole('textbox',{name:'What should Relay remember?',exact:true}).fill('Updated and explicitly approved preference.');
    await approval.check();
    const editedResponse=page.waitForResponse(item=>item.url().endsWith(`/api/memory/${saved.id}`)&&item.request().method()==='PUT');
    await dialog.getByRole('button',{name:'Save approved memory',exact:true}).click();
    const edited=await editedResponse;expect(edited.ok()).toBe(true);expect(await edited.json()).toMatchObject({revision:4});
    await expect(card).toContainText('Updated and explicitly approved preference.');
    await page.reload();await openCommands(page);await page.getByRole('option',{name:/Manage memory/}).click();
    dialog=page.getByRole('dialog',{name:'Your memory',exact:true});
    await dialog.getByRole('button',{name:`Open ${title}`,exact:true}).click();
    card=dialog.getByRole('article').filter({has:page.getByRole('heading',{name:title,exact:true})});
    await expect(card).toContainText('Updated and explicitly approved preference.');
    expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({path:`output/playwright/memory-${size.width}.png`,animations:'disabled'});
    if(size.width!==390)expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    const allNotes=dialog.getByRole('button',{name:'All notes',exact:true});
    if(await allNotes.isVisible())await allNotes.click();
    const downloading=page.waitForEvent('download');await dialog.getByRole('button',{name:'Export JSON',exact:true}).click();
    const downloaded=await downloading;expect(downloaded.suggestedFilename()).toBe('relay-memory.json');
    const exported=JSON.parse(await readFile((await downloaded.path())!,'utf8')) as {version:number;notes:Array<{id:string;revision:number;content:string}>};
    expect(exported.version).toBe(1);expect(exported.notes.find(item=>item.id===saved.id)).toMatchObject({revision:4,content:'Updated and explicitly approved preference.'});
    await dialog.getByRole('button',{name:`Open ${title}`,exact:true}).click();
    await card.getByRole('button',{name:'Delete',exact:true}).click();await expect(card.getByRole('button',{name:'Delete permanently',exact:true})).toBeVisible();
    await card.getByRole('button',{name:'Keep memory',exact:true}).click();await expect(card).toBeVisible();
    await card.getByRole('button',{name:'Delete',exact:true}).click();
    const deletedResponse=page.waitForResponse(item=>item.url().endsWith(`/api/memory/${saved.id}`)&&item.request().method()==='DELETE');
    await card.getByRole('button',{name:'Delete permanently',exact:true}).click();
    const deleted=await deletedResponse;expect(deleted.ok()).toBe(true);expect(deleted.request().postDataJSON()).toEqual({revision:4});
    await expect(card).toHaveCount(0);await expect(dialog.getByRole('status')).toContainText('Memory deleted');
  });
}
