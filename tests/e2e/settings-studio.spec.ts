import {expect,test,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {openCommands,pairBrowser} from './helpers';

async function settings(page:Page){await page.getByRole('button',{name:'Open navigation',exact:true}).filter({visible:true}).click();await page.getByRole('dialog',{name:'Navigate Relay',exact:true}).getByRole('button',{name:'Settings',exact:true}).click();return page.getByRole('dialog',{name:'Settings',exact:true});}

for(const [width,height,theme] of [[320,740,'light'],[390,844,'dark'],[844,390,'light'],[1440,1000,'dark']] as const)test(`settings opens with usable preferences and connections at ${width}px ${theme}`,async({page})=>{
  await page.setViewportSize({width,height});await page.addInitScript(value=>localStorage.setItem('relay:theme:v1',value),theme);await page.goto('/');await pairBrowser(page);
  const draft=page.getByRole('textbox',{name:'Your objective',exact:true});await draft.fill('Keep this draft while I review settings.');
  const dialog=await settings(page);await expect(dialog.getByRole('heading',{name:'Connections',exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Host resources',exact:true})).toBeVisible();
  const opposite=theme==='light'?'Dark':'Light';await dialog.getByRole('button',{name:`${opposite} appearance`,exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme',opposite.toLowerCase());expect(await page.evaluate(()=>localStorage.getItem('relay:theme:v1'))).toBe(opposite.toLowerCase());
  expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);await page.screenshot({path:`output/playwright/settings-studio-${width}-${opposite.toLowerCase()}.png`,animations:'disabled'});
  await dialog.getByRole('button',{name:'Memory',exact:true}).click();const memory=page.getByRole('dialog',{name:'Your memory',exact:true});await expect(memory).toBeVisible();await memory.getByRole('button',{name:'Close Your memory',exact:true}).click();await expect(draft).toHaveValue('Keep this draft while I review settings.');
});

test('shared-account settings expose personal connections without owner management',async({page})=>{
  await page.goto('/');await pairBrowser(page);
  const session=await page.evaluate(async()=>await(await fetch('/api/session')).json());
  await page.route('**/api/session',route=>route.fulfill({json:{...session,remote:true,connection:'remote',user:{...session.user,role:'trusted'}}}));await page.reload();
  await openCommands(page);await page.getByRole('option',{name:/^Settings/}).click();const dialog=page.getByRole('dialog',{name:'Settings',exact:true});
  for(const label of ['Host resources','Access & devices','MCP tools','Scheduled tasks'])await expect(dialog.getByRole('button',{name:label,exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Models & providers',exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Google Workspace',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Google Workspace',exact:true}).click();await expect(page.getByRole('dialog',{name:'Google Workspace',exact:true})).toBeVisible();
});
