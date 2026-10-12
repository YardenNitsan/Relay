import {expect,test,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {openCommands,pairBrowser} from './helpers';

async function seedNotes(page:Page){
  return page.evaluate(async()=>{
    const session=await(await fetch('/api/session')).json();
    const notes=[];const suffix=crypto.randomUUID().slice(0,8);
    for(const [title,content,enabled] of [
      ['Writing preferences','Use clear explanations.\n\nתשובות בעברית כשאני כותב בעברית.',true],
      ['Project vocabulary','Keep original names in quoted source material.',false],
    ] as const){
      const response=await fetch('/api/memory',{method:'POST',headers:{'content-type':'application/json','x-relay-csrf':session.csrfToken},body:JSON.stringify({title:`${title} ${suffix}`,content,enabled,workspaceId:null,confirm:true})});
      if(!response.ok)throw new Error('Memory fixture creation failed');
      notes.push(await response.json() as {id:string;revision:number;title:string;content:string;enabled:boolean});
    }
    return notes;
  });
}

async function openMemory(page:Page){
  await openCommands(page);await page.getByRole('option',{name:/Manage memory/}).click();
  return page.getByRole('dialog',{name:'Your memory',exact:true});
}

for(const [width,height,theme] of [[390,844,'dark'],[1440,1000,'light']] as const){
  test(`memory notebook protects edits and keeps a focused pane at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height});await page.goto('/');await pairBrowser(page);
    const [note,other]=await seedNotes(page);const dialog=await openMemory(page);
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const row=dialog.getByRole('button',{name:`Open ${note.title}`,exact:true});
    await row.click();
    const heading=dialog.getByRole('heading',{name:note.title,exact:true});
    await expect(heading).toBeFocused();
    await expect(dialog.getByRole('article')).toContainText('תשובות בעברית');
    if(width===390){await expect(dialog.getByRole('searchbox',{name:'Search notes',exact:true,includeHidden:true})).toHaveCount(1);await expect(dialog.getByRole('searchbox',{name:'Search notes',exact:true,includeHidden:true})).toBeHidden();}
    await dialog.getByRole('button',{name:'Edit',exact:true}).click();
    const title=dialog.getByRole('textbox',{name:'Title',exact:true});
    const content=dialog.getByRole('textbox',{name:'What should Relay remember?',exact:true});
    const approval=dialog.getByRole('checkbox',{name:'I approve saving this memory for my future tasks',exact:true});
    await expect(dialog.getByRole('combobox',{name:'Scope',exact:true})).toBeDisabled();
    await content.fill('A draft that must survive navigation.');await approval.check();
    await title.fill(`${note.title} revised`);await expect(approval).not.toBeChecked();
    await page.keyboard.press('Escape');
    const guard=page.getByRole('dialog',{name:'Unsaved changes',exact:true});
    await expect(guard.getByRole('button',{name:'Keep editing',exact:true})).toBeFocused();
    await guard.getByRole('button',{name:'Keep editing',exact:true}).click();
    await expect(content).toHaveValue('A draft that must survive navigation.');
    if(width===390)await dialog.getByRole('button',{name:'All notes',exact:true}).click();
    else await dialog.getByRole('button',{name:`Open ${other.title}`,exact:true}).click();
    await expect(guard).toBeVisible();await guard.getByRole('button',{name:'Keep editing',exact:true}).click();
    await approval.check();
    const saving=page.waitForResponse(response=>response.url().endsWith(`/api/memory/${note.id}`)&&response.request().method()==='PUT');
    await dialog.getByRole('button',{name:'Save approved memory',exact:true}).click();
    const saved=await saving;expect(saved.ok()).toBe(true);
    expect(saved.request().postDataJSON()).toMatchObject({revision:1,confirm:true});
    expect(await saved.json()).toMatchObject({revision:2});
    await expect(dialog.getByRole('article')).toContainText('A draft that must survive navigation.');
    await expect(dialog.getByRole('heading',{name:`${note.title} revised`,exact:true})).toBeFocused();
    if(width===390){
      await dialog.getByRole('button',{name:'All notes',exact:true}).click();
      await expect(dialog.getByRole('button',{name:`Open ${note.title} revised`,exact:true})).toBeFocused();
      await dialog.getByRole('button',{name:`Open ${note.title} revised`,exact:true}).click();
    }
    expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const controls=await dialog.locator('.memory-studio button:visible').evaluateAll(elements=>elements.map(el=>el.getBoundingClientRect().height));
    expect(controls.every(height=>height>=44)).toBe(true);
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:`output/playwright/memory-studio-${width}-${theme}.png`,animations:'disabled'});
  });
}

test('memory keeps drafts during pending saves and cached notes through refresh errors',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await page.goto('/');await pairBrowser(page);
  const [note]=await seedNotes(page);const dialog=await openMemory(page);
  await dialog.getByRole('button',{name:`Open ${note.title}`,exact:true}).first().click();
  await dialog.getByRole('button',{name:'Edit',exact:true}).click();
  const content=dialog.getByRole('textbox',{name:'What should Relay remember?',exact:true});
  await content.fill('Keep this draft after failure.');
  await dialog.getByRole('checkbox',{name:'I approve saving this memory for my future tasks',exact:true}).check();
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/memory/${note.id}`,async route=>{
    if(route.request().method()!=='PUT')return route.continue();
    await held;await route.fulfill({status:503,json:{error:'Memory storage is temporarily unavailable.'}});
  });
  try{
    await dialog.getByRole('button',{name:'Save approved memory',exact:true}).click();
    await expect(dialog.getByRole('button',{name:'Saving…',exact:true})).toBeDisabled();
    await dialog.getByRole('button',{name:'Close Your memory',exact:true}).click();
    await expect(dialog.getByRole('status')).toContainText('Wait for the current operation');
    release();await expect(dialog.getByRole('alert')).toContainText('Memory storage is temporarily unavailable');
    await expect(content).toHaveValue('Keep this draft after failure.');
    await page.route('**/api/memory',route=>route.fulfill({status:503,json:{error:'Cannot refresh notes right now.'}}));
    await dialog.getByRole('button',{name:'Refresh notes',exact:true}).click();
    await expect(dialog.getByRole('alert').filter({hasText:'Cannot refresh notes'})).toBeVisible();
    await expect(dialog.getByRole('button',{name:`Open ${note.title}`,exact:true}).first()).toBeVisible();
    await expect(content).toHaveValue('Keep this draft after failure.');
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});

test('memory saves the revision opened for editing even after a newer note is refreshed',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await page.goto('/');await pairBrowser(page);
  const [note]=await seedNotes(page);const dialog=await openMemory(page);
  await dialog.getByRole('button',{name:`Open ${note.title}`,exact:true}).first().click();
  await dialog.getByRole('button',{name:'Edit',exact:true}).click();
  const content=dialog.getByRole('textbox',{name:'What should Relay remember?',exact:true});
  await content.fill('My unsaved revision.');
  await page.evaluate(async note=>{
    const session=await(await fetch('/api/session')).json();
    const response=await fetch(`/api/memory/${note.id}`,{method:'PUT',headers:{'content-type':'application/json','x-relay-csrf':session.csrfToken},body:JSON.stringify({title:note.title,content:'Saved by another view.',enabled:true,revision:1,confirm:true})});
    if(!response.ok)throw new Error('Concurrent fixture update failed');
  },note);
  await dialog.getByRole('button',{name:'Refresh notes',exact:true}).click();
  await expect(dialog.getByText('This saved note changed while you were editing.',{exact:false})).toBeVisible();
  await dialog.getByRole('checkbox',{name:'I approve saving this memory for my future tasks',exact:true}).check();
  const saving=page.waitForResponse(response=>response.url().endsWith(`/api/memory/${note.id}`)&&response.request().method()==='PUT');
  await dialog.getByRole('button',{name:'Save approved memory',exact:true}).click();
  const failed=await saving;expect(failed.status()).toBe(409);expect(failed.request().postDataJSON().revision).toBe(1);
  await expect(content).toHaveValue('My unsaved revision.');
  const persisted=await page.request.get(`/api/memory/${note.id}`);
  expect(await persisted.json()).toMatchObject({revision:2,content:'Saved by another view.'});
});
