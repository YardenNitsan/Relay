import {expect,test,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {openCommands,pairBrowser} from './helpers';

const bounded={depth:'fast',modelId:null,reasoning:'auto',efficiency:'efficient',access:'read_only',workspaceId:null,contextTokens:4096,cloudPolicy:'local_only',network:{mode:'deny',allowedOrigins:[]},mcpServerIds:[],budget:{maxCalls:4,maxIterations:2,maxSeconds:120,maxOutputTokens:512,maxCostUsd:0,localOnly:true}};
const upcoming={id:'schedule-studio-upcoming',name:'Morning project review',objective:'Summarize the selected project without modifying files.',options:bounded,intervalMinutes:60,missedPolicy:'once',nextRunAt:'2099-06-01T09:00:00.000Z',enabled:false,archivedAt:null,lastError:null};
const archived={...upcoming,id:'schedule-studio-archived',name:'Archived project review',enabled:false,archivedAt:'2026-01-01T10:00:00.000Z',nextRunAt:null};
async function openStudio(page:Page){
  await page.route('**/api/schedules',route=>route.request().method()==='GET'?route.fulfill({json:[upcoming,archived]}):route.fallback());
  await page.route('**/api/schedules/*/runs',route=>route.fulfill({json:[{id:'history-fixture',scheduledAt:'2026-01-01T09:00:00.000Z',taskId:null,status:'skipped',reason:'Relay was unavailable when this run was due.',taskStatus:null}]}));
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Manage schedules/}).click();
  return page.getByRole('dialog',{name:'Scheduled tasks',exact:true});
}

for(const [width,height] of [[320,740],[360,800],[390,844],[412,915],[844,390],[1440,960]])for(const theme of ['light','dark'])test(`Schedule Studio index, approval and archive history at ${width} ${theme}`,async({page})=>{
  await page.setViewportSize({width,height});await page.addInitScript(value=>localStorage.setItem('relay:theme:v1',value),theme);
  const dialog=await openStudio(page);await expect(dialog.getByRole('button',{name:'Inspect Morning project review',exact:true})).toBeVisible();
  await page.screenshot({path:`output/playwright/schedule-studio-index-${width}-${theme}.png`,animations:'disabled'});
  await dialog.getByRole('button',{name:'Inspect Morning project review',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Morning project review',exact:true})).toBeFocused();
  await page.screenshot({path:`output/playwright/schedule-studio-inspector-${width}-${theme}.png`,animations:'disabled'});
  await dialog.getByRole('button',{name:'Enable schedule',exact:true}).click();
  const approved=dialog.getByRole('button',{name:'Enable approved schedule',exact:true});await expect(approved).toBeDisabled();
  await dialog.getByRole('checkbox',{name:'I authorize these limits for each scheduled run',exact:true}).check();await expect(approved).toBeEnabled();
  await dialog.getByRole('button',{name:'Cancel enable',exact:true}).click();await expect(dialog.getByRole('button',{name:'Enable schedule',exact:true})).toBeFocused();
  await expect(dialog).toContainText('never replay a backlog');await expect(dialog).toContainText('Local only');
  if(width<900)await dialog.getByRole('button',{name:'All schedules',exact:true}).click();
  await dialog.getByRole('searchbox',{name:'Search schedules'}).fill('Archived');
  await dialog.getByRole('button',{name:'Inspect Archived project review',exact:true}).click();
  await dialog.getByRole('button',{name:'Show run history',exact:true}).click();await expect(dialog).toContainText('Relay was unavailable');
  await expect(dialog.getByRole('button',{name:'Enable schedule',exact:true})).toHaveCount(0);
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:`output/playwright/schedule-studio-history-${width}-${theme}.png`,animations:'disabled'});
  await dialog.getByRole('button',{name:'New schedule',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Create a schedule',exact:true})).toBeFocused();
  await page.screenshot({path:`output/playwright/schedule-studio-create-${width}-${theme}.png`,animations:'disabled'});
  await dialog.getByRole('textbox',{name:'Schedule name',exact:true}).fill('Future read-only review');await dialog.getByRole('textbox',{name:'Objective',exact:true}).fill('Summarize local notes without changing files.');
  await dialog.getByLabel('First run',{exact:true}).fill('2099-06-01T12:00');const save=dialog.getByRole('button',{name:'Save disabled schedule',exact:true});await expect(save).toBeDisabled();
  await dialog.getByRole('checkbox',{name:'I approve saving this local, read-only schedule',exact:true}).check();await expect(save).toBeEnabled();await save.scrollIntoViewIfNeeded();await expect(save).toBeInViewport();
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
});

test('Schedule Studio protects a draft across refresh, narrow layout and discarded navigation',async({page})=>{
  await page.setViewportSize({width:1440,height:960});const dialog=await openStudio(page);await dialog.getByRole('button',{name:'New schedule',exact:true}).click();
  const name=dialog.getByRole('textbox',{name:'Schedule name',exact:true});await name.fill('Preserved schedule draft');
  await dialog.getByRole('textbox',{name:'Objective',exact:true}).fill('Review local project notes.');
  await dialog.getByRole('checkbox',{name:'I approve saving this local, read-only schedule',exact:true}).check();
  await dialog.getByRole('combobox',{name:'Repeat',exact:true}).selectOption('interval');
  await expect(dialog.getByRole('checkbox',{name:'I approve saving this local, read-only schedule',exact:true})).not.toBeChecked();
  await expect(dialog).toContainText('Local clock time can shift when daylight saving changes.');
  await dialog.getByRole('button',{name:'Refresh schedules',exact:true}).click();
  await page.setViewportSize({width:320,height:740});await expect(name).toHaveValue('Preserved schedule draft');
  await dialog.getByRole('button',{name:'Cancel creation',exact:true}).click();
  const guard=page.getByRole('dialog',{name:'Unsaved changes',exact:true});await expect(guard).toBeVisible();await guard.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(name).toHaveValue('Preserved schedule draft');
  await page.keyboard.press('Escape');await expect(guard).toBeVisible();await guard.getByRole('button',{name:'Keep editing',exact:true}).click();
  await dialog.getByRole('button',{name:'Cancel creation',exact:true}).click();await guard.getByRole('button',{name:'Discard edits',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'New schedule',exact:true})).toBeFocused();
});

test('Schedule Studio keeps a failed save draft and blocks closing during the request',async({page})=>{
  await page.setViewportSize({width:390,height:844});const dialog=await openStudio(page);let attempts=0;
  let release:(()=>void)|undefined;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/schedules',async route=>{if(route.request().method()!=='POST')return route.fallback();attempts++;await held;return route.fulfill({status:503,json:{error:'Schedule storage unavailable'}});});
  try{
  await dialog.getByRole('button',{name:'New schedule',exact:true}).click();await dialog.getByRole('textbox',{name:'Schedule name',exact:true}).fill('Retry this draft');
  await dialog.getByRole('textbox',{name:'Objective',exact:true}).fill('Review local files without edits.');await dialog.getByLabel('First run',{exact:true}).fill('2099-06-01T12:00');
  await dialog.getByRole('checkbox',{name:'I approve saving this local, read-only schedule',exact:true}).check();await dialog.getByRole('button',{name:'Save disabled schedule',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Saving…',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(dialog).toBeVisible();expect(attempts).toBe(1);
  release?.();await expect(dialog.getByRole('alert')).toContainText('Schedule storage unavailable');await expect(dialog.getByRole('textbox',{name:'Schedule name',exact:true})).toHaveValue('Retry this draft');
  await expect(dialog.getByRole('button',{name:'Save disabled schedule',exact:true})).toBeEnabled();
  }finally{release?.();await page.unrouteAll({behavior:'ignoreErrors'});}
});

test('Schedule Studio preserves authorization on refresh and retains a failed enable review',async({page})=>{
  await page.setViewportSize({width:390,height:844});const dialog=await openStudio(page);
  await dialog.getByRole('button',{name:'Inspect Morning project review',exact:true}).click();await dialog.getByRole('button',{name:'Enable schedule',exact:true}).click();
  const approval=dialog.getByRole('checkbox',{name:'I authorize these limits for each scheduled run',exact:true});await approval.check();
  const refreshed=page.waitForResponse(response=>response.url().endsWith('/api/schedules')&&response.request().method()==='GET');
  await dialog.getByRole('button',{name:'Refresh schedules',exact:true}).click();await refreshed;await expect(approval).toBeChecked();
  let release:(()=>void)|undefined;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/schedules/${upcoming.id}/enabled`,async route=>{expect(route.request().postDataJSON()).toEqual({enabled:true,confirmed:true});await held;return route.fulfill({status:503,json:{error:'Schedule enable unavailable'}});});
  try{
  await dialog.getByRole('button',{name:'Enable approved schedule',exact:true}).click();await expect(dialog.getByRole('button',{name:'Enabling…',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'All schedules',exact:true})).toBeDisabled();
  release?.();await expect(dialog.getByRole('alert')).toContainText('Schedule enable unavailable');await expect(approval).toBeChecked();
  await expect(dialog.getByRole('button',{name:'Enable approved schedule',exact:true})).toBeEnabled();
  await dialog.getByRole('button',{name:'Cancel enable',exact:true}).click();await expect(dialog.getByRole('button',{name:'Enable schedule',exact:true})).toBeFocused();
  }finally{release?.();await page.unrouteAll({behavior:'ignoreErrors'});}
});

test('Schedule Studio discarded authorization stays cleared when reopening the same schedule',async({page})=>{
  await page.setViewportSize({width:390,height:844});const dialog=await openStudio(page);
  const row=dialog.getByRole('button',{name:'Inspect Morning project review',exact:true});await row.click();
  await dialog.getByRole('button',{name:'Enable schedule',exact:true}).click();await dialog.getByRole('checkbox',{name:'I authorize these limits for each scheduled run',exact:true}).check();
  await dialog.getByRole('button',{name:'All schedules',exact:true}).click();
  await page.getByRole('dialog',{name:'Unsaved changes',exact:true}).getByRole('button',{name:'Discard edits',exact:true}).click();await expect(row).toBeFocused();
  await row.click();await expect(dialog.getByRole('heading',{name:'Morning project review',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog',{name:'Unsaved changes',exact:true})).toHaveCount(0);await expect(dialog.getByRole('group',{name:'Review schedule authorization',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Enable schedule',exact:true}).click();await expect(dialog.getByRole('checkbox',{name:'I authorize these limits for each scheduled run',exact:true})).not.toBeChecked();
  await dialog.getByRole('button',{name:'Cancel enable',exact:true}).click();await dialog.getByRole('button',{name:'New schedule',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Create a schedule',exact:true})).toBeVisible();
});

test('Schedule Studio task opening blocks draft navigation until its failed lookup settles',async({page})=>{
  await page.setViewportSize({width:390,height:844});const dialog=await openStudio(page);
  await page.route('**/api/schedules/*/runs',route=>route.fulfill({json:[{id:'task-receipt',scheduledAt:'2026-01-01T09:00:00.000Z',taskId:'schedule-studio-task',status:'dispatched',reason:null,taskStatus:'completed'}]}));
  let release:(()=>void)|undefined;const held=new Promise<void>(resolve=>{release=resolve;});let lookups=0;
  await page.route('**/api/tasks/schedule-studio-task',async route=>{lookups++;await held;return route.fulfill({status:503,json:{error:'Recorded task lookup unavailable'}});});
  try{
    await dialog.getByRole('button',{name:'Inspect Morning project review',exact:true}).click();await dialog.getByRole('button',{name:'Show run history',exact:true}).click();await dialog.getByRole('button',{name:'Open task',exact:true}).click();
    await expect(dialog.getByRole('button',{name:'New schedule',exact:true})).toBeDisabled();await expect(dialog.getByRole('button',{name:'All schedules',exact:true})).toBeDisabled();
    await page.keyboard.press('Escape');await expect(dialog).toBeVisible();expect(lookups).toBe(1);
    release?.();await expect(dialog.getByRole('alert')).toContainText('Recorded task lookup unavailable');await expect(dialog.getByRole('button',{name:'Open task',exact:true})).toBeEnabled();
    await dialog.getByRole('button',{name:'New schedule',exact:true}).click();await dialog.getByRole('textbox',{name:'Schedule name',exact:true}).fill('Draft after failed lookup');await expect(dialog.getByRole('textbox',{name:'Schedule name',exact:true})).toHaveValue('Draft after failed lookup');
  }finally{release?.();await page.unrouteAll({behavior:'ignoreErrors'});}
});

test('Schedule Studio acknowledges enabled state before a delayed failing catalog refresh',async({page})=>{
  await page.setViewportSize({width:1440,height:960});const dialog=await openStudio(page);
  await dialog.getByRole('button',{name:'Inspect Morning project review',exact:true}).click();await dialog.getByRole('button',{name:'Enable schedule',exact:true}).click();await dialog.getByRole('checkbox',{name:'I authorize these limits for each scheduled run',exact:true}).check();
  let release:(()=>void)|undefined;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/schedules',async route=>{if(route.request().method()!=='GET')return route.fallback();await held;return route.fulfill({status:503,json:{error:'Schedule refresh unavailable'}});});
  await page.route(`**/api/schedules/${upcoming.id}/enabled`,route=>route.fulfill({json:{...upcoming,enabled:true}}));
  try{
    await dialog.getByRole('button',{name:'Enable approved schedule',exact:true}).click();await expect(dialog.getByRole('button',{name:'Disable and cancel active runs',exact:true})).toBeEnabled();
    await expect(dialog.getByRole('button',{name:'New schedule',exact:true})).toBeEnabled();
    release?.();await expect(dialog.getByRole('alert')).toContainText('Schedule refresh unavailable');
    await expect(dialog.getByRole('button',{name:'Inspect Morning project review',exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Disable and cancel active runs',exact:true})).toBeEnabled();
  }finally{release?.();await page.unrouteAll({behavior:'ignoreErrors'});}
});

test('Schedule Studio keeps cached run receipts after a failed history refresh',async({page})=>{
  await page.setViewportSize({width:390,height:844});const dialog=await openStudio(page);
  await dialog.getByRole('button',{name:'Inspect Morning project review',exact:true}).click();await dialog.getByRole('button',{name:'Show run history',exact:true}).click();await expect(dialog).toContainText('Relay was unavailable when this run was due.');
  await page.route('**/api/schedules/*/runs',route=>route.fulfill({status:503,json:{error:'Run history refresh unavailable'}}));
  await dialog.getByRole('button',{name:'Hide run history',exact:true}).click();await dialog.getByRole('button',{name:'Show run history',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Run history refresh unavailable',{timeout:20000});await expect(dialog.getByText('Relay was unavailable when this run was due.',{exact:true})).toBeVisible();
});

test('Schedule Studio retains an acknowledged archive when its catalog refresh fails',async({page})=>{
  await page.setViewportSize({width:1440,height:960});const dialog=await openStudio(page);
  await dialog.getByRole('button',{name:'Inspect Morning project review',exact:true}).click();
  await page.route('**/api/schedules',route=>route.request().method()==='GET'?route.fulfill({status:503,json:{error:'Archived catalog refresh unavailable'}}):route.fallback());
  await page.route(`**/api/schedules/${upcoming.id}/archive`,route=>route.fulfill({json:{ok:true}}));
  await dialog.getByRole('button',{name:'Archive schedule',exact:true}).click();await dialog.getByRole('button',{name:'Confirm archive',exact:true}).click();
  const inspector=dialog.getByRole('article',{name:'Morning project review schedule',exact:true});await expect(inspector).toContainText('Archived');
  await expect(inspector.getByRole('button',{name:'Enable schedule',exact:true})).toHaveCount(0);await expect(inspector.getByRole('button',{name:'Archive schedule',exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toContainText('Archived catalog refresh unavailable');await expect(dialog.getByRole('button',{name:'Inspect Morning project review',exact:true})).toBeVisible();
  await inspector.getByRole('button',{name:'Show run history',exact:true}).click();await expect(inspector).toContainText('Relay was unavailable');
});
