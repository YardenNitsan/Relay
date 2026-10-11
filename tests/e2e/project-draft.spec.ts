import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {openProjectChooser,pairBrowser,projectIndex} from './helpers';

for(const dismissal of ['escape','close','backdrop'] as const)test(`project file draft survives outer ${dismissal} until explicit discard`,async({page})=>{
  await page.setViewportSize({width:dismissal==='escape'?320:1440,height:900});
  await page.goto('/');await pairBrowser(page);
  if(dismissal==='close')await page.getByRole('button',{name:'Switch to dark theme',exact:true}).click();
  // Real authenticated workspace/file API; only disposable fixture-host data.
  const name=`Draft protection ${dismissal}`;
  await page.evaluate(async name=>{
    const session=await(await fetch('/api/session')).json() as {csrfToken:string};
    const headers={'content-type':'application/json','x-relay-csrf':session.csrfToken};
    const created=await fetch('/api/workspaces',{method:'POST',headers,body:JSON.stringify({name,personal:true})});if(!created.ok)throw new Error('Workspace fixture failed');
    const workspace=await created.json() as {id:string};
    const file=await fetch(`/api/workspaces/${workspace.id}/files`,{method:'POST',headers,body:JSON.stringify({path:'draft.txt',content:'Saved source'})});if(!file.ok)throw new Error('File fixture failed');
  },name);
  await page.reload();await openProjectChooser(page);
  const projects=page.getByRole('dialog',{name:'Workspaces',exact:true});
  await projectIndex(page);
  await projects.getByRole('button',{name:'Open '+name,exact:true}).click();
  await projects.getByRole('button',{name:'draft.txt',exact:true}).click();
  await projects.getByRole('textbox',{name:'File contents',exact:true}).fill('Unsaved important edit');
  if(dismissal==='close'){
    await projects.getByRole('button',{name:'draft.txt',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Unsaved changes',exact:true})).toHaveCount(0);
    await expect(projects.getByRole('textbox',{name:'File contents',exact:true})).toHaveValue('Unsaved important edit');
  }
  if(dismissal==='backdrop'){
    await page.clock.install();await page.clock.fastForward(11_000);
    await page.route('**/api/workspaces/*/files',route=>route.fulfill({status:503,json:{error:'File list temporarily unavailable'}}));
    const refresh=page.waitForResponse(response=>response.url().endsWith('/files')&&response.status()===503);
    await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));await refresh;
    await expect(projects.getByRole('alert')).toContainText('File list temporarily unavailable');
    await expect(projects.getByRole('textbox',{name:'File contents',exact:true})).toHaveValue('Unsaved important edit');
  }
  await page.keyboard.press('ControlOrMeta+k');
  await expect(projects.getByRole('textbox',{name:'File contents',exact:true})).toHaveValue('Unsaved important edit');
  if(dismissal==='escape')await page.keyboard.press('Escape');
  else if(dismissal==='backdrop')await page.mouse.click(2,2);
  else await projects.getByRole('button',{name:'Close Workspaces',exact:true}).click();
  const warning=page.getByRole('dialog',{name:'Unsaved changes',exact:true});
  await expect(warning).toBeVisible();
  await expect(warning.getByRole('button',{name:'Keep editing',exact:true})).toBeFocused();
  await page.keyboard.press('ControlOrMeta+k');await expect(warning).toBeVisible();
  // Audit the settled surface, not the intermediate native-dialog opacity frame.
  await warning.evaluate(async element=>{await Promise.all(element.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>undefined)));});
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`output/playwright/project-draft-${dismissal}.png`});
  await warning.getByRole('button',{name:'Keep editing',exact:true}).click();
  await expect(projects.getByRole('textbox',{name:'File contents',exact:true})).toHaveValue('Unsaved important edit');
  if(dismissal==='escape'){
    await projects.getByRole('button',{name:'All projects',exact:true}).click();
    await warning.getByRole('button',{name:'Discard edits',exact:true}).click();
    await expect(projects.getByRole('searchbox',{name:'Find a project',exact:true})).toBeFocused();
    await projects.getByRole('button',{name:'Open '+name,exact:true}).click();
    await projects.getByRole('button',{name:'draft.txt',exact:true}).click();
    await expect(projects.getByRole('textbox',{name:'File contents',exact:true})).toHaveValue('Saved source');
    await projects.getByRole('textbox',{name:'File contents',exact:true}).fill('Another unsaved edit');
  }
  if(dismissal==='close'){
    let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
    await page.route('**/api/workspaces/*/file',async route=>{
      if(route.request().method()!=='PUT'){await route.continue();return;}
      const response=await route.fetch();await held;await route.fulfill({response});
    });
    try{
      await projects.getByRole('button',{name:'Save changes',exact:true}).click();
      await expect(projects.getByRole('textbox',{name:'File contents',exact:true})).toBeDisabled();
      await page.keyboard.press('ControlOrMeta+k');await expect(projects).toBeVisible();
      await projects.getByRole('button',{name:'Close Workspaces',exact:true}).click();
      await expect(projects.getByRole('status')).toContainText('Wait for the current operation');
      await expect(projects).toBeVisible();
    }finally{release();}
    await expect(projects.getByRole('textbox',{name:'File contents',exact:true})).toBeEnabled();
    await expect(projects.getByText('Wait for the current operation',{exact:false})).toHaveCount(0);
    await projects.getByRole('textbox',{name:'File contents',exact:true}).fill('Another unsaved edit');
  }
  await projects.getByRole('button',{name:'Close Workspaces',exact:true}).click();
  await warning.getByRole('button',{name:'Discard edits',exact:true}).click();
  await expect(projects).toHaveCount(0);
});
