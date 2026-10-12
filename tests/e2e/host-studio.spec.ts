import {expect,test,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type {HardwareSnapshot} from '../../shared/types';
import {openCommands,pairBrowser} from './helpers';
const snapshot:HardwareSnapshot={sampledAt:'2026-10-11T12:00:00.000Z',platform:'win32',architecture:'x64',memoryArchitecture:'discrete',cpu:{name:'Intel Core Ultra 7 — controlled browser fixture',physicalCores:20,logicalCores:20,utilization:24},memory:{totalBytes:32*1024**3,availableBytes:20*1024**3,swapTotalBytes:null,swapUsedBytes:null},gpus:[{name:'NVIDIA RTX 5070',vendor:'NVIDIA',totalBytes:12*1024**3,usedBytes:3*1024**3,utilization:null,temperature:null,memoryShared:false,driver:null}],storage:null,warnings:['Browser fixture; these values do not measure the current host.']};
async function openHost(page:Page){
  await page.route('**/api/hardware',route=>route.fulfill({json:snapshot}));
  await page.goto('/');await pairBrowser(page);await openCommands(page);
  await page.getByRole('option',{name:/Inspect this machine/}).click();
  return page.getByRole('dialog',{name:'This machine',exact:true});
}
for(const [width,height] of [[320,740],[390,844],[844,390],[1440,960]])for(const theme of ['light','dark'])test(`Host Studio focused sections ${width} ${theme}`,async({page})=>{
  await page.setViewportSize({width,height});await page.addInitScript(value=>localStorage.setItem('relay:theme:v1',value),theme);
  const dialog=await openHost(page),navigation=dialog.getByRole('navigation',{name:'Host sections'});
  await expect(navigation).toBeVisible();await expect(dialog.getByText(snapshot.cpu.name,{exact:true})).toBeVisible();
  await expect(dialog.locator('.meter-block').filter({hasText:'Swap / pagefile in use'})).toContainText('Unavailable');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:`output/playwright/host-studio-${width}-${theme}.png`,animations:'disabled'});
  await navigation.getByRole('button',{name:'Model safety',exact:true}).click();
  await expect(dialog.getByLabel('Resource profile')).toBeVisible();
  await expect(dialog.getByText('Resident allocation is unavailable in the deterministic browser fixture.',{exact:true})).toBeVisible();
  await navigation.getByRole('button',{name:'Recovery',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Export diagnostic bundle',exact:true})).toBeVisible();
  await dialog.getByText('Data retention',{exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Preview cleanup',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
});
test('host policy draft survives section navigation and guards dismissal',async({page})=>{
  const dialog=await openHost(page);await dialog.getByRole('button',{name:'Model safety',exact:true}).click();
  const profile=dialog.getByLabel('Resource profile');await profile.selectOption('balanced');
  await dialog.getByRole('button',{name:'Overview',exact:true}).click();
  await dialog.getByRole('button',{name:'Model safety',exact:true}).click();await expect(profile).toHaveValue('balanced');
  await dialog.getByRole('button',{name:'Close This machine',exact:true}).click();
  const guard=page.getByRole('dialog',{name:'Unsaved changes',exact:true});await expect(guard).toBeVisible();
  await guard.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(profile).toHaveValue('balanced');
  await dialog.getByRole('button',{name:'Discard changes',exact:true}).click();
  await dialog.getByRole('button',{name:'Close This machine',exact:true}).click();await expect(dialog).toHaveCount(0);
});
test('host overview exposes pending restoration without changing sections automatically',async({page})=>{
  await page.route('**/api/admin/restoration',route=>route.fulfill({json:{pending:true}}));
  const dialog=await openHost(page);
  await expect(dialog.getByText('This restored copy needs review before execution can resume.',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Overview',exact:true})).toHaveAttribute('aria-current','page');
  await dialog.getByRole('button',{name:'Review recovery',exact:true}).click();
  await expect(dialog.getByRole('region',{name:'Restored data review',exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Record restoration review',exact:true})).toBeDisabled();
});
test('host diagnostic export keeps its pending operation visible until failure',async({page})=>{
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/admin/diagnostics',async route=>{await pending;await route.fulfill({status:503,json:{error:'Diagnostic export is temporarily unavailable.'}});});
  try{
    const dialog=await openHost(page);await dialog.getByRole('button',{name:'Recovery',exact:true}).click();
    await dialog.getByRole('button',{name:'Export diagnostic bundle',exact:true}).click();
    await expect(dialog.getByRole('button',{name:'Preparing diagnostics…',exact:true})).toBeDisabled();
    await dialog.getByRole('button',{name:'Close This machine',exact:true}).click();await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Wait for the current operation to finish before leaving this view.',{exact:true})).toBeVisible();
    release();await expect(dialog.getByRole('alert')).toContainText('Diagnostic export is temporarily unavailable.');
    await dialog.getByRole('button',{name:'Close This machine',exact:true}).click();await expect(dialog).toHaveCount(0);
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});
