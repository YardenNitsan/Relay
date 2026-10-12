import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {openCommands,pairBrowser} from './helpers';

// All starts are in the future. These scenarios exercise real scheduling CRUD,
// never dispatch inference and never claim that a model actually ran.
for(const width of [320,390,1440])test(`future local schedule control at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:width===320?740:900});
  await page.goto('/');await pairBrowser(page);await openCommands(page);
  await page.getByRole('option',{name:/Manage schedules/}).click();
  const dialog=page.getByRole('dialog',{name:'Scheduled tasks',exact:true});
  await dialog.getByRole('button',{name:'New schedule',exact:true}).click();
  const name=`Future schedule ${width} ${Date.now()} ${'x'.repeat(40)}`;
  await dialog.getByRole('textbox',{name:'Schedule name',exact:true}).fill(name);
  await dialog.getByRole('textbox',{name:'Objective',exact:true}).fill('Summarize the explicitly selected project without modifying files.');
  await dialog.getByLabel('First run', {exact:true}).fill('2099-06-01T12:00');
  if(width===390){await dialog.getByRole('combobox',{name:'Repeat',exact:true}).selectOption('interval');await dialog.getByRole('spinbutton',{name:'Interval in minutes',exact:true}).fill('60');}
  await expect(dialog.getByRole('button',{name:'Save disabled schedule',exact:true})).toBeDisabled();
  await dialog.getByRole('checkbox',{name:'I approve saving this local, read-only schedule',exact:true}).check();
  const creating=page.waitForResponse(response=>response.url().endsWith('/api/schedules')&&response.request().method()==='POST');
  await dialog.getByRole('button',{name:'Save disabled schedule',exact:true}).click();
  const response=await creating;expect(response.ok()).toBe(true);
  const schedule=await response.json() as {id:string;enabled:boolean;intervalMinutes:number|null};expect(schedule.enabled).toBe(false);
  expect(schedule.intervalMinutes).toBe(width===390?60:null);
  expect(response.request().postDataJSON()).toMatchObject({confirmed:true,enabled:false,options:{access:'read_only',cloudPolicy:'local_only',budget:{maxCalls:4,maxSeconds:120,maxOutputTokens:512,maxCostUsd:0,localOnly:true}}});
  const card=dialog.getByRole('article').filter({has:page.getByRole('heading',{name,exact:true})});await expect(card).toBeVisible();
  await card.getByRole('button',{name:'Enable schedule',exact:true}).click();
  await expect(card.getByRole('button',{name:'Enable approved schedule',exact:true})).toBeDisabled();
  await card.getByRole('checkbox',{name:'I authorize these limits for each scheduled run',exact:true}).check();
  const enabling=page.waitForResponse(item=>item.url().endsWith(`/api/schedules/${schedule.id}/enabled`)&&item.request().method()==='POST');
  await card.getByRole('button',{name:'Enable approved schedule',exact:true}).click();expect((await enabling).ok()).toBe(true);
  await expect(card.getByRole('button',{name:'Disable and cancel active runs',exact:true})).toBeVisible();
  const disabling=page.waitForResponse(item=>item.url().endsWith(`/api/schedules/${schedule.id}/enabled`)&&item.request().method()==='POST');
  await card.getByRole('button',{name:'Disable and cancel active runs',exact:true}).click();expect((await disabling).ok()).toBe(true);
  await expect(card.getByRole('button',{name:'Enable schedule',exact:true})).toBeVisible();
  await card.getByRole('button',{name:'Show run history',exact:true}).click();await expect(card).toContainText('No scheduled runs yet.');
  expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await card.scrollIntoViewIfNeeded();await page.screenshot({path:`output/playwright/schedules-${width}.png`,animations:'disabled'});
  if(width!==390)expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await card.getByRole('button',{name:'Archive schedule',exact:true}).click();await expect(card).toContainText('Run history will be kept.');
  await card.getByRole('button',{name:'Keep schedule',exact:true}).click();await expect(card.getByRole('button',{name:'Archive schedule',exact:true})).toBeFocused();
  await card.getByRole('button',{name:'Archive schedule',exact:true}).click();
  const archiving=page.waitForResponse(item=>item.url().endsWith(`/api/schedules/${schedule.id}/archive`)&&item.request().method()==='POST');
  await card.getByRole('button',{name:'Confirm archive',exact:true}).click();expect((await archiving).ok()).toBe(true);
  await expect(card).toContainText('Archived');await expect(card.getByRole('button',{name:'Enable schedule',exact:true})).toHaveCount(0);
});
