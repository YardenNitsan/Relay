import {expect,test,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {pairBrowser} from './helpers';

async function requestApproval(page:Page) {
  await page.goto('/');await pairBrowser(page);
  await page.getByLabel('Computer access').selectOption('supervised');
  await page.getByRole('textbox',{name:'Objective'}).fill('Create a notes file and verify the content');
  await page.getByRole('button',{name:'Send objective',exact:true}).click();
  await page.getByRole('button',{name:'Activity',exact:true}).click();
  await expect(page.getByRole('button',{name:'Allow once',exact:true})).toBeVisible();
}

for(const width of [320,1440])for(const theme of ['light','dark'] as const) {
  test(`focused approval preserves exact consent at ${width}px in ${theme}`,async({page})=>{
    await page.addInitScript(value=>localStorage.setItem('relay:theme:v1',value),theme);
    await page.setViewportSize({width,height:844});await requestApproval(page);
    const trigger=page.getByRole('button',{name:'Review action',exact:true});await trigger.click();
    const dialog=page.getByRole('dialog',{name:'Review requested action',exact:true});
    await expect(dialog.getByRole('heading',{name:'Create notes.txt',exact:true})).toBeVisible();
    await expect(dialog.getByText('Changes a file in the managed workspace.',{exact:false})).toBeVisible();
    const hostName=await page.evaluate(async()=> (await(await fetch('/api/session')).json() as {hostName:string}).hostName);
    await expect(dialog.getByText(hostName,{exact:true})).toBeVisible();
    await dialog.getByText('Inspect exact arguments',{exact:true}).click();
    await expect(dialog.locator('.approval-arguments')).toContainText('Verified fixture content');
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`output/playwright/approval-review-${width}-${theme}.png`});
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
    await expect(page.getByRole('button',{name:'Allow once',exact:true})).toBeVisible();
    await trigger.click();
    await dialog.getByRole('button',{name:width===320?'Deny':'Allow once',exact:true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('complementary',{name:'Task activity'})).toBeFocused();
    if(width===1440) {
      await expect(page.getByRole('complementary',{name:'Task activity'}).getByText('Completed',{exact:true}).first()).toBeVisible({timeout:20_000});
      await page.getByRole('tab',{name:/^Changes/}).click();
      await expect(page.getByLabel('Unified diff for notes.txt')).toContainText('+Verified fixture content');
    } else {
      await expect(page.getByRole('button',{name:'Allow once',exact:true})).toHaveCount(0);
      await page.getByRole('tab',{name:/^Changes/}).click();
      await expect(page.getByRole('heading',{name:'No recorded file changes',exact:true})).toBeVisible();
    }
  });
}

test('short landscape review retains decision controls and reports a rejected decision inside the dialog',async({page})=>{
  await page.setViewportSize({width:844,height:390});await requestApproval(page);
  await page.getByRole('button',{name:'Review action',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Review requested action',exact:true});
  const body=dialog.locator('.approval-review-body');expect((await body.boundingBox())!.height).toBeGreaterThan(140);
  for(const name of ['Allow once','Allow for this task','Deny']) {
    const button=dialog.getByRole('button',{name,exact:true});const bounds=(await button.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(44);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(390);
  }
  await page.route(/\/api\/approvals\/[^/]+$/,route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'REVOKED',error:'Approval permission was revoked.'})}));
  await dialog.getByRole('button',{name:'Allow once',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Approval permission was revoked.');
  await expect(dialog.getByRole('alert')).toBeInViewport();
  await expect(dialog.getByRole('button',{name:'Deny',exact:true})).toBeInViewport();
  await expect(dialog.getByRole('button',{name:'Allow once',exact:true})).toBeEnabled();
  await page.screenshot({path:'output/playwright/approval-review-landscape-rejected.png'});
  await page.unroute(/\/api\/approvals\/[^/]+$/);
  await dialog.getByRole('button',{name:'Deny',exact:true}).click();await expect(dialog).toHaveCount(0);
});
