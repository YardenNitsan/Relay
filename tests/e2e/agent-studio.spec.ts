import {expect,test,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {assistantDefinitions,type AssistantCatalog} from '../../shared/assistants';
import {openCommands,pairBrowser} from './helpers';

const catalog:AssistantCatalog={assistants:assistantDefinitions.map(role=>({id:role.id,name:role.name,description:role.description,available:true,status:'limited',tools:[...role.allowedTools],limitations:role.id==='browser'?['Interactive browsing is not implemented; clicks and form submissions are unavailable.']:['Tools require task permissions.'],...(role.id==='browser'?{requiredIntegration:'Interactive browser automation',integrationState:'not_implemented' as const}:{})}))};
async function openStudio(page:Page){
  await page.route('**/api/assistants',route=>route.fulfill({json:catalog}));
  await page.goto('/');await pairBrowser(page);await openCommands(page);
  await page.getByRole('option',{name:/Choose an agent/}).click();
  return page.getByRole('dialog',{name:'Agents',exact:true});
}

for(const [width,height] of [[320,740],[360,800],[390,844],[412,915],[844,390],[1440,960]])for(const theme of ['light','dark'])test(`Agent Studio index and honest tools at ${width} ${theme}`,async({page})=>{
  await page.setViewportSize({width,height});await page.addInitScript(value=>localStorage.setItem('relay:theme:v1',value),theme);
  let mutations=0;await page.route('**/api/workspaces',route=>{if(route.request().method()==='POST')mutations++;return route.fallback();});
  const dialog=await openStudio(page),search=dialog.getByRole('searchbox',{name:'Search roles and tools'});
  await expect(dialog.getByRole('button',{name:/^Inspect .* agent$/})).toHaveCount(10);
  await page.screenshot({path:`output/playwright/agent-studio-index-${width}-${theme}.png`,animations:'disabled'});
  await search.fill('public web');await expect(dialog.getByRole('button',{name:'Inspect Browser agent',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Inspect Browser agent',exact:true}).click();
  const inspector=dialog.getByRole('article',{name:'Browser agent',exact:true});
  await expect(inspector).toBeVisible();await expect(inspector).toContainText('Live actions are not implemented in this release');
  await page.screenshot({path:`output/playwright/agent-studio-inspector-${width}-${theme}.png`,animations:'disabled'});
  await expect(inspector.getByRole('button',{name:'Connect',exact:true})).toHaveCount(0);
  await inspector.getByText('Tools this role can request',{exact:false}).click();
  await expect(inspector.getByText('Read public web pages',{exact:true})).toBeVisible();
  await inspector.getByRole('button',{name:'Use Browser agent',exact:true}).scrollIntoViewIfNeeded();
  await expect(inspector.getByRole('button',{name:'Use Browser agent',exact:true})).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:`output/playwright/agent-studio-${width}-${theme}.png`,animations:'disabled'});
  if(width<900){await dialog.getByRole('button',{name:'All specialists',exact:true}).click();await expect(dialog.getByRole('button',{name:'Inspect Browser agent',exact:true})).toBeFocused();}
  await expect(search).toHaveValue('public web');await search.fill('no matching specialist');
  await expect(dialog.getByText('No matching specialists',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Clear search',exact:true}).click();await expect(search).toBeFocused();
  await expect(dialog.getByRole('button',{name:/^Inspect .* agent$/})).toHaveCount(10);expect(mutations).toBe(0);
});

test('Agent Studio preserves index scroll and focus across detail and breakpoint changes',async({page})=>{
  await page.setViewportSize({width:390,height:420});const dialog=await openStudio(page);
  const row=dialog.getByRole('button',{name:'Inspect Computer agent',exact:true});await row.scrollIntoViewIfNeeded();
  const before=await dialog.locator('.agent-index-scroll').evaluate(node=>node.scrollTop);
  await row.click();await expect(dialog.getByRole('heading',{name:'Computer',exact:true})).toBeFocused();
  await page.setViewportSize({width:1440,height:960});await expect(dialog.getByRole('heading',{name:'Computer',exact:true})).toBeFocused();
  await dialog.getByRole('searchbox',{name:'Search roles and tools'}).focus();
  await page.setViewportSize({width:390,height:420});await expect(dialog.getByRole('searchbox',{name:'Search roles and tools'})).toBeFocused();
  await row.click();await dialog.getByRole('button',{name:'All specialists',exact:true}).click();await expect(row).toBeFocused();
  expect(Math.abs(await dialog.locator('.agent-index-scroll').evaluate(node=>node.scrollTop)-before)).toBeLessThan(3);
});

test('Agent Studio Back focuses search when the inspected role was filtered out',async({page})=>{
  await page.setViewportSize({width:1440,height:960});const dialog=await openStudio(page);
  await dialog.getByRole('button',{name:'Inspect Browser agent',exact:true}).click();
  const search=dialog.getByRole('searchbox',{name:'Search roles and tools'});await search.fill('gmail');
  await expect(dialog.getByRole('button',{name:'Inspect Browser agent',exact:true})).toHaveCount(0);
  await dialog.getByRole('heading',{name:'Browser',exact:true}).focus();
  await page.setViewportSize({width:390,height:844});
  await dialog.getByRole('button',{name:'All specialists',exact:true}).click();
  await expect(search).toBeFocused();await expect(search).toHaveValue('gmail');
  await expect(dialog.getByRole('button',{name:'Inspect Email agent',exact:true})).toBeVisible();
});

test('Agent Studio guards preparation, retains failed selection and retries once',async({page})=>{
  await page.setViewportSize({width:390,height:844});const dialog=await openStudio(page);let attempts=0;
  let release:(()=>void)|undefined;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/workspaces',async route=>{
    if(route.request().method()!=='POST')return route.fallback();attempts++;
    if(attempts===1){await held;return route.fulfill({status:503,json:{error:'Private workspace preparation failed'}});}return route.fallback();
  });
  await dialog.getByRole('button',{name:'Inspect Computer agent',exact:true}).click();
  const use=dialog.getByRole('button',{name:'Use Computer agent',exact:true});await use.click();await expect(use).toBeDisabled();
  await page.keyboard.press('Escape');await expect(dialog).toBeVisible();expect(attempts).toBe(1);
  release?.();await expect(dialog.getByRole('alert')).toContainText('Private workspace preparation failed');await expect(use).toBeEnabled();
  await use.click();await expect(dialog).not.toBeVisible();expect(attempts).toBe(2);
  await expect(page.getByRole('button',{name:'Choose agent',exact:true})).toContainText('Computer');
});
