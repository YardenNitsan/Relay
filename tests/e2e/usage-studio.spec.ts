import {expect,test,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type {UsageReport} from '../../shared/usage';
import {openCommands,pairBrowser} from './helpers';

const report:UsageReport={periodStart:'2026-10-11T00:00:00Z',periodEnd:'2026-10-11T12:34:00Z',truncated:false,models:[
  {modelId:'ollama/local',provider:'ollama',name:'Local model with a long name for reading on a small phone',local:true,requests:3,inputTokens:1800,outputTokens:400,unreportedCalls:1,limits:null},
  {modelId:'openai/cloud',provider:'openai',name:'מודל ענן לבדיקת תצוגה',local:false,requests:2,inputTokens:1200,outputTokens:600,unreportedCalls:0,limits:{observedAt:'2026-10-11T12:30:00Z',limits:[{kind:'tokens',remaining:0,limit:100000,reset:'30s'},{kind:'requests',remaining:4,limit:null,reset:null}]}},
  {modelId:'deepseek/unknown',provider:'deepseek',name:'Cloud without reported limits',local:false,requests:0,inputTokens:0,outputTokens:0,unreportedCalls:0,limits:null},
]};

async function openUsage(page:Page){
  await page.goto('/');await pairBrowser(page);
  await openCommands(page);
  await page.getByRole('combobox',{name:'Search commands'}).fill('Usage');
  await page.getByRole('option',{name:/^Usage/}).click();
  return page.getByRole('dialog',{name:'Usage',exact:true});
}

for(const [width,height,theme] of [[320,740,'light'],[390,844,'dark'],[844,390,'dark'],[1440,1000,'light']] as const){
  test(`usage report retains measured and unknown values at ${width}px ${theme}`,async({page})=>{
    await page.setViewportSize({width,height});await page.addInitScript(theme=>localStorage.setItem('relay:theme:v1',theme),theme);
    await page.route('**/api/usage',route=>route.fulfill({json:report}));
    const dialog=await openUsage(page);
    await expect(dialog.getByText('4,000',{exact:true})).toBeVisible();
    await expect(dialog.getByText('Reported totals are partial.',{exact:false})).toBeVisible();
    const cloud=dialog.getByRole('article',{name:`${report.models[1]!.name} usage`});
    await expect(cloud.getByText('0',{exact:true})).toBeVisible();
    await expect(cloud.getByText('4',{exact:true})).toBeVisible();
    await expect(cloud.getByRole('heading',{name:report.models[1]!.name,exact:true})).toHaveAttribute('dir','auto');
    await expect(dialog.getByText('Remaining tokens not reported by provider',{exact:true})).toBeVisible();
    await expect(dialog.locator('progress,[role="progressbar"]')).toHaveCount(0);
    expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:`output/playwright/usage-studio-${width}-${theme}.png`,animations:'disabled'});
  });
}

test('usage retains the dated report after refresh failure and recovers without a dismissal guard',async({page})=>{
  let fail=false;
  await page.route('**/api/usage',route=>route.fulfill(fail?{status:503,json:{error:'Usage refresh unavailable'}}:{json:report}));
  const dialog=await openUsage(page);
  await expect(dialog.getByText('4,000',{exact:true})).toBeVisible();
  fail=true;await dialog.getByRole('button',{name:'Refresh usage',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Usage refresh unavailable');
  await expect(dialog.getByText('Showing the last loaded report.',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('article')).toHaveCount(3);
  await expect(dialog.getByText('4,000',{exact:true})).toBeVisible();
  fail=false;await dialog.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
});

test('diagnostic export reports its exact scope and download preparation',async({page})=>{
  let payload:unknown;
  await page.route('**/api/admin/diagnostics',route=>{payload=route.request().postDataJSON();return route.fulfill({json:{format:1,scope:'own_account',window:{days:7},tasks:[]}});});
  await page.setViewportSize({width:320,height:740});await page.goto('/');await pairBrowser(page);await openCommands(page);
  await page.getByRole('option',{name:/Inspect this machine/}).click();
  const dialog=page.getByRole('dialog',{name:'This machine',exact:true});
  await dialog.getByRole('button',{name:'Recovery',exact:true}).click();
  const section=dialog.getByRole('region',{name:'Diagnostics',exact:true});
  await expect(section).toContainText('Your account · last seven days · up to 200 tasks');
  await expect(section).toContainText('Conversation text, prompts, tool content, model names, paths and credentials.');
  const pending=page.waitForEvent('download');await section.getByRole('button',{name:'Export diagnostic bundle',exact:true}).click();
  const download=await pending;expect(download.suggestedFilename()).toBe('relay-diagnostics.json');
  expect(payload).toEqual({days:7,maxTasks:200});
  await expect(section.getByRole('status')).toContainText('Diagnostic file prepared.');
  await expect(section.getByRole('button',{name:'Export diagnostic bundle',exact:true})).toBeEnabled();
  expect(await section.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});
