import {expect,test} from '@playwright/test';
import {openCommands,pairBrowser} from './helpers';

test('a persisted policy is acknowledged while hardware refresh is still pending',async({page})=>{
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/hardware',async route=>{
    await pending;
    await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Telemetry still unavailable.'})});
  });
  try {
    await page.goto('/');await pairBrowser(page);
    await openCommands(page);await page.getByRole('option',{name:/^Inspect this machine/}).click();
    const dialog=page.getByRole('dialog',{name:'This machine'});
    await dialog.getByRole('button',{name:'Model safety',exact:true}).click();
    const profile=dialog.getByLabel('Resource profile');
    const save=dialog.getByRole('button',{name:'Save resource policy',exact:true});
    await expect(profile).toHaveValue('safe');await profile.selectOption('balanced');await save.click();
    await expect(dialog.getByText('Applied: Balanced',{exact:true})).toBeVisible();
    await expect(dialog.getByText('Resource policy saved',{exact:true})).toBeVisible({timeout:1500});
    await expect(profile).toBeEnabled();
    const stored=await page.evaluate(async()=>(await(await fetch('/api/hardware/policy')).json() as {policy:{profile:string}}).policy);
    expect(stored.profile).toBe('balanced');
    await profile.selectOption('safe');await save.click();
    await expect(dialog.getByText('Applied: Safe',{exact:true})).toBeVisible();
    await expect(dialog.getByText('Resource policy saved',{exact:true})).toBeVisible();
  } finally {release();await page.unrouteAll({behavior:'wait'});}
});
