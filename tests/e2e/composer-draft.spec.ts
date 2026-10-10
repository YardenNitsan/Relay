import {expect,test} from '@playwright/test';
import {pairBrowser} from './helpers';

test('typing the next draft while a saved conversation send is pending preserves the new text',async({page})=>{
  await page.goto('/');await pairBrowser(page);
  await page.getByRole('button',{name:'Open conversation history',exact:true}).click();
  await page.locator('.history-item').first().click();
  await expect(page).toHaveURL(/conversation=/);
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  let arrived!:()=>void;const started=new Promise<void>(resolve=>{arrived=resolve;});
  await page.route('**/api/conversations/*/messages',async route=>{
    if(route.request().method()==='POST'){arrived();await gate;}
    await route.continue();
  });
  const objective=page.getByRole('textbox',{name:'Your objective',exact:true});
  try {
    await objective.fill('Explain the execution model');await page.getByRole('button',{name:'Send objective',exact:true}).click();
    await started;await objective.fill('Keep this next draft while the first request completes.');
    const response=page.waitForResponse(item=>/\/api\/conversations\/[^/]+\/messages$/.test(item.url())&&item.request().method()==='POST');
    release();await response;
    await expect(page.getByRole('button',{name:'Sending objective',exact:true})).toHaveCount(0);
    await expect(objective).toHaveValue('Keep this next draft while the first request completes.');
    await page.reload();await expect(objective).toHaveValue('Keep this next draft while the first request completes.');
  } finally {release();}
});
