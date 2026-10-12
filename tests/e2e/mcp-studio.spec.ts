import {expect,test,type Page} from '@playwright/test';
import {openCommands,pairBrowser} from './helpers';
import {catalogTool} from '../../server/mcp/schema';
import AxeBuilder from '@axe-core/playwright';

const endpoint='https://example.com/studio-tools';
const contract=catalogTool({name:'inspect_document',description:'Untrusted <img src=x onerror=alert(1)>',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']}});
const server={id:'studio-server',name:'Reference library',url:endpoint,enabled:false,tools:[contract]};
const configuration={servers:[server],protocol:'2025-03-26',transport:'streamable-http'};
async function openMcp(page:Page){await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Manage MCP tools/}).click();const dialog=page.getByRole('dialog',{name:'MCP tools',exact:true});await expect(dialog.getByRole('heading',{name:'Saved servers',exact:true})).toBeVisible();return dialog;}
async function draft(page:Page){const dialog=await openMcp(page);await dialog.getByRole('button',{name:'Review a new server',exact:true}).click();await dialog.getByLabel('Server endpoint',{exact:true}).fill(endpoint);return dialog;}

test('MCP endpoint draft survives deliberate dismissal',async({page})=>{
  await page.route('**/api/mcp/servers',route=>route.fulfill({json:configuration}));
  const dialog=await draft(page);await page.keyboard.press('Escape');
  const guard=page.getByRole('dialog',{name:'Unsaved changes',exact:true});await expect(guard).toBeVisible();
  await guard.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(dialog.getByLabel('Server endpoint',{exact:true})).toHaveValue(endpoint);
});

test('MCP pending pin freezes the reviewed contract and blocks dismissal',async({page})=>{
  let release!:()=>void,calls=0;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/mcp/discover',route=>route.fulfill({json:{tools:[contract]}}));
  await page.route('**/api/mcp/servers',async route=>{if(route.request().method()==='PUT'){calls++;await held;await route.fulfill({json:{...configuration,servers:route.request().postDataJSON().servers}});}else await route.fulfill({json:configuration});});
  const dialog=await draft(page);
  try{
    await dialog.getByRole('button',{name:'Discover tools',exact:true}).click();await dialog.getByLabel('Connection name',{exact:true}).fill('Reviewed connection');await dialog.getByRole('checkbox',{name:contract.name,exact:true}).check();
    await dialog.getByRole('button',{name:'Save selected tools as disabled',exact:true}).click();await expect.poll(()=>calls).toBe(1);
    await expect(dialog.getByLabel('Connection name',{exact:true})).toBeDisabled();await expect(dialog.getByRole('checkbox',{name:contract.name,exact:true})).toBeDisabled();
    await dialog.getByRole('button',{name:'Close MCP tools',exact:true}).click();await expect(dialog.getByText('Wait for the current operation to finish before leaving this view.',{exact:true})).toBeVisible();
    release();await expect(dialog.getByText('Tool contracts saved. This server is disabled until you enable it.',{exact:true})).toBeVisible();expect(calls).toBe(1);
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});

test('MCP enable acknowledges the authoritative save before a held refresh',async({page})=>{
  let saved=false,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/mcp/servers',async route=>{if(route.request().method()==='PUT'){expect(route.request().postDataJSON()).toEqual({servers:[{...server,enabled:true}]});saved=true;await route.fulfill({json:{...configuration,servers:[{...server,enabled:true}]}});}else {if(saved)await held;await route.fulfill({json:configuration});}});
  const dialog=await openMcp(page);
  try{await dialog.getByRole('button',{name:'Inspect Reference library',exact:true}).click();await dialog.getByRole('button',{name:'Enable server',exact:true}).click();await expect(dialog.getByRole('button',{name:'Disable server',exact:true})).toBeEnabled();await expect(dialog.getByText('Reference library enabled. Tasks still need server and network grants.',{exact:true})).toBeVisible();}
  finally{release();await page.unrouteAll({behavior:'wait'});}
});

test('MCP saved configuration remains inspectable after refresh failure',async({page})=>{
  let failed=false;await page.route('**/api/mcp/servers',route=>route.fulfill(failed?{status:503,json:{error:'Configuration temporarily unavailable'}}:{json:configuration}));
  const dialog=await openMcp(page);await expect(dialog.getByText(server.name,{exact:true})).toBeVisible();failed=true;
  await dialog.getByRole('button',{name:'Refresh MCP servers',exact:true}).click();await expect(dialog.getByText('Configuration temporarily unavailable',{exact:false})).toBeVisible();await expect(dialog.getByText(server.name,{exact:true})).toBeVisible();
});

for(const [width,height,theme] of [[320,740,'light'],[360,780,'dark'],[390,844,'dark'],[412,880,'light'],[768,1024,'dark'],[844,390,'light'],[1440,1000,'light'],[1440,1000,'dark']] as const)test(`MCP contract inspection and return focus at ${width}px ${theme}`,async({page})=>{
  let discoveries=0;await page.setViewportSize({width,height});await page.addInitScript(value=>localStorage.setItem('relay:theme:v1',value),theme);
  await page.route('**/api/mcp/servers',route=>route.fulfill({json:configuration}));await page.route('**/api/mcp/discover',route=>{discoveries++;return route.fulfill({json:{tools:[contract]}});});
  const dialog=await openMcp(page),search=dialog.getByRole('searchbox',{name:'Search MCP servers',exact:true});await search.fill('Reference');
  const row=dialog.getByRole('button',{name:'Inspect Reference library',exact:true});await row.click();
  const inspector=dialog.getByRole('region',{name:'MCP connection inspector',exact:true});
  await expect(inspector.getByRole('heading',{name:server.name,exact:true})).toBeFocused();
  await inspector.getByText('Inspect schema and fingerprint',{exact:true}).click();await expect(inspector.getByRole('region',{name:`${contract.name} schema`,exact:true})).toContainText('path');
  await expect(inspector.getByText(contract.schemaHash,{exact:true})).toBeVisible();await expect(inspector.locator('img')).toHaveCount(0);expect(discoveries).toBe(0);
  expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:`output/playwright/mcp-studio-${width}-${theme}.png`,animations:'disabled'});
  await dialog.getByRole('button',{name:'All servers',exact:true}).click();await expect(row).toBeFocused();await expect(search).toHaveValue('Reference');
});

test('MCP accepted discard resets the old reviewed draft',async({page})=>{
  await page.route('**/api/mcp/servers',route=>route.fulfill({json:configuration}));const dialog=await draft(page);
  await dialog.getByRole('button',{name:'Review a new server',exact:true}).click();await page.getByRole('dialog',{name:'Unsaved changes',exact:true}).getByRole('button',{name:'Discard edits',exact:true}).click();
  await expect(dialog.getByLabel('Server endpoint',{exact:true})).toHaveValue('');await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
});

test('MCP discovery blocks navigation until the exact request settles',async({page})=>{
  let release!:()=>void,finished!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;}),done=new Promise<void>(resolve=>{finished=resolve;});
  await page.route('**/api/mcp/servers',route=>route.fulfill({json:configuration}));await page.route('**/api/mcp/discover',async route=>{try{expect(route.request().postDataJSON()).toEqual({url:endpoint});await held;await route.fulfill({json:{tools:[contract]}});}finally{finished();}});
  const dialog=await draft(page);
  try{await dialog.getByRole('button',{name:'Discover tools',exact:true}).click();await expect(dialog.getByLabel('Server endpoint',{exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'All servers',exact:true}).click();await expect(dialog.getByText('Wait for the current operation to finish before leaving this view.',{exact:true})).toBeVisible();release();await done;await expect(dialog.getByRole('checkbox',{name:contract.name,exact:true})).toBeEnabled();}
  finally{release();await done;await page.unrouteAll({behavior:'wait'});}
});
