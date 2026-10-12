import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {pairBrowser} from './helpers';

for(const width of [320,390,768,1024,1440,2560])for(const theme of ['light','dark'] as const){
  test(`Dispatch preserves drafts and visible navigation at ${width}px ${theme}`,async({page})=>{
    await page.addInitScript(value=>localStorage.setItem('relay:theme:v1',value),theme);
    await page.setViewportSize({width,height:900});await page.goto('/');await pairBrowser(page);
    const draft=page.getByRole('textbox',{name:'Your objective',exact:true});await draft.fill('Keep this draft while I check my agents.');
    await page.getByRole('button',{name:'Work',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Your work, moving forward.',exact:true})).toBeVisible();
    await expect(draft).toBeHidden();
    await page.getByRole('button',{name:'Agents',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Agents',exact:true})).toBeVisible();await page.keyboard.press('Escape');
    await expect(page.getByRole('button',{name:'Agents',exact:true})).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:`output/playwright/dispatch-${width}-${theme}.png`,animations:'disabled'});
    await page.getByRole('button',{name:'Conversation',exact:true}).click();await expect(draft).toHaveValue('Keep this draft while I check my agents.');
  });
}

test('Dispatch opens real task evidence and its conversation without inventing progress',async({page})=>{
  await page.setViewportSize({width:1440,height:960});await page.goto('/');await pairBrowser(page);
  const objective='Dispatch browser evidence task';
  await page.getByRole('textbox',{name:'Your objective',exact:true}).fill(objective);await page.getByRole('button',{name:'Send objective',exact:true}).click();
  await expect(page.locator('.message-assistant')).toContainText('A deterministic response for browser testing');
  await page.getByRole('button',{name:'Work',exact:true}).click();
  await page.getByRole('searchbox',{name:'Search this task page',exact:true}).fill('Dispatch browser evidence');
  await page.getByRole('button',{name:`Inspect task: ${objective}`,exact:true}).click();
  const detail=page.getByRole('region',{name:'Selected task',exact:true});
  await expect(detail.getByRole('heading',{name:objective,exact:true})).toBeVisible();
  await expect(detail.getByText('Completed',{exact:true}).first()).toBeVisible();
  await expect(detail.getByRole('progressbar')).toHaveCount(0);
  await detail.getByRole('button',{name:'Open execution',exact:true}).click();
  await expect(page.getByRole('complementary',{name:'Task activity',exact:true})).toBeVisible();
  await expect(page.locator('.message-user')).toContainText(objective);
});

test('Dispatch exposes a failed feed and a working retry without losing a draft',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await pairBrowser(page);
  await page.getByRole('textbox',{name:'Your objective',exact:true}).fill('Network-safe draft');
  let fail=true;
  await page.route('**/api/tasks?*',route=>fail?route.fulfill({status:503,json:{error:'Task list temporarily unavailable'}}):route.continue());
  await page.getByRole('button',{name:'Work',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Task list temporarily unavailable');
  fail=false;await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.getByRole('searchbox',{name:'Search this task page',exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button',{name:'Conversation',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Your objective',exact:true})).toHaveValue('Network-safe draft');
});

test('Work remains selected when a delayed real task admission completes',async({page})=>{
  await page.goto('/');await pairBrowser(page);
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  let admitted!:()=>void;const ready=new Promise<void>(resolve=>{admitted=resolve;});
  await page.route('**/api/conversations/start',async route=>{const response=await route.fetch();admitted();await gate;await route.fulfill({response});});
  await page.getByRole('textbox',{name:'Your objective',exact:true}).fill('Delayed Dispatch admission');
  await page.getByRole('button',{name:'Send objective',exact:true}).click();await ready;
  await page.getByRole('button',{name:'Work',exact:true}).click();release();
  await expect(page.getByRole('button',{name:'Inspect task: Delayed Dispatch admission',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Your work, moving forward.',exact:true})).toBeVisible();
});

test('Work survives refresh and browser back while retaining a conversation draft',async({page})=>{
  await page.goto('/');await pairBrowser(page);
  await page.getByRole('textbox',{name:'Your objective',exact:true}).fill('Keep my navigation draft');
  await page.getByRole('button',{name:'Work',exact:true}).click();
  await expect(page).toHaveURL(/view=work/);await page.reload();
  await expect(page.getByRole('heading',{name:'Your work, moving forward.',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Conversation',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Your objective',exact:true})).toHaveValue('Keep my navigation draft');
  await page.goBack();await expect(page.getByRole('heading',{name:'Your work, moving forward.',exact:true})).toBeVisible();
});

test('cached work and evidence survive a failed reconnect refresh',async({page})=>{
  await page.setViewportSize({width:1440,height:960});await page.goto('/');await pairBrowser(page);
  await page.getByRole('button',{name:'Work',exact:true}).click();
  const task=page.getByRole('button',{name:/^Inspect task:/}).first();const name=await task.getAttribute('aria-label');await task.click();
  const detail=page.getByRole('region',{name:'Selected task',exact:true});await expect(detail.getByRole('button',{name:'Open execution',exact:true})).toBeVisible();
  await page.route('**/api/tasks**',route=>route.fulfill({status:503,json:{error:'Evidence refresh unavailable'}}));
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('alert').first()).toContainText('Evidence refresh unavailable');
  await expect(page.getByRole('button',{name:name!,exact:true})).toBeVisible();
  await expect(detail.getByRole('button',{name:'Open execution',exact:true})).toBeVisible();
});

test('mobile task failure keeps focus on a visible region and returns to the task',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await pairBrowser(page);
  await page.getByRole('button',{name:'Work',exact:true}).click();
  await page.route(/\/api\/tasks\/[^/?]+$/,route=>route.fulfill({status:503,json:{error:'Task details unavailable'}}));
  const task=page.getByRole('button',{name:/^Inspect task:/}).first();await task.click();
  const detail=page.getByRole('region',{name:'Selected task',exact:true});await expect(detail).toBeFocused();await expect(detail.getByRole('alert')).toContainText('Task details unavailable');
  await detail.getByRole('button',{name:'Back to tasks',exact:true}).click();await expect(task).toBeFocused();
});

test('deleting a conversation removes its cached work and selected evidence',async({page})=>{
  await page.setViewportSize({width:1440,height:960});await page.goto('/');await pairBrowser(page);
  const objective='Remove this completed Dispatch evidence';
  await page.getByRole('textbox',{name:'Your objective',exact:true}).fill(objective);await page.getByRole('button',{name:'Send objective',exact:true}).click();
  await expect(page.locator('.message-assistant')).toContainText('A deterministic response for browser testing');
  await page.getByRole('button',{name:'New conversation',exact:true}).click();
  await page.getByRole('button',{name:'Work',exact:true}).click();
  const task=page.getByRole('button',{name:`Inspect task: ${objective}`,exact:true});await task.click();
  await page.getByRole('button',{name:'Open conversation history',exact:true}).click();
  const history=page.getByRole('dialog',{name:'Conversations',exact:true});
  await history.locator('.history-row').filter({hasText:objective}).getByRole('button',{name:'Delete conversation',exact:true}).click();
  await history.getByRole('region',{name:'Confirm conversation deletion',exact:true}).getByRole('button',{name:'Delete conversation',exact:true}).click();
  await expect(history.getByRole('status')).toContainText('Deleted');await page.keyboard.press('Escape');
  await expect(task).toHaveCount(0);await expect(page.getByRole('region',{name:'Selected task',exact:true})).toHaveCount(0);
});
