import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {openProjectChooser,pairBrowser,projectIndex} from './helpers';

for(const [width,height] of [[320,740],[844,390]])test(`branch creation preserves name and reports waiting/failure at ${width}`,async({page})=>{
  await page.setViewportSize({width,height});await page.goto('/');await pairBrowser(page);
  await page.evaluate(async()=>{
    const session=await(await fetch('/api/session')).json();
    const response=await fetch('/api/workspaces',{method:'POST',headers:{'content-type':'application/json','x-relay-csrf':session.csrfToken},body:JSON.stringify({name:'Failure feedback fixture',personal:true})});
    if(!response.ok)throw new Error('Fixture workspace failed');
  });
  // The fixture writes outside React Query; refresh the catalog before opening it.
  await page.reload();
  await openProjectChooser(page);const dialog=await projectIndex(page);
  await dialog.getByRole('button',{name:'Open Failure feedback fixture',exact:true}).click();
  await dialog.getByRole('button',{name:'Create isolated branch',exact:true}).click();
  await dialog.getByRole('textbox',{name:'Branch workspace name',exact:true}).fill('Retain this name');
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/workspaces/*/fork',async route=>{await held;await route.fulfill({status:503,json:{error:'Storage temporarily unavailable. No branch was created.'}});});
  try{
    await dialog.getByRole('button',{name:'Create branch workspace',exact:true}).click();
    await expect(dialog.getByRole('button',{name:'Creating isolated branch...',exact:true})).toBeDisabled();
    await dialog.getByRole('button',{name:'Close Workspaces',exact:true}).click();
    await expect(dialog.getByRole('status')).toContainText('Wait for the current operation');
    await page.screenshot({path:`output/playwright/project-fork-waiting-${width}.png`,animations:'disabled'});
    release();await expect(dialog.getByRole('alert')).toContainText('Storage temporarily unavailable');
    await expect(dialog.getByRole('textbox',{name:'Branch workspace name',exact:true})).toHaveValue('Retain this name');
    await expect(dialog.getByRole('button',{name:'Create branch workspace',exact:true})).toBeEnabled();
    await dialog.getByRole('alert').scrollIntoViewIfNeeded();
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`output/playwright/project-fork-error-${width}.png`,animations:'disabled'});
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});
