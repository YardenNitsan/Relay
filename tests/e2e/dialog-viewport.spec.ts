import {expect,test,type Locator,type Page} from '@playwright/test';
import {openCommands,pairBrowser} from './helpers';

async function viewport(page:Page,height:number,offsetTop:number,scale=1){
  await page.evaluate(values=>{Object.assign(window.visualViewport!,values);window.visualViewport!.dispatchEvent(new Event('resize'));window.visualViewport!.dispatchEvent(new Event('scroll'));}, {height,offsetTop,scale});
}
async function visibleBounds(dialog:Locator,top:number,height:number){
  await expect.poll(async()=>{const box=(await dialog.boundingBox())!;return box.y>=top-1&&box.y+box.height<=top+height+1;}).toBe(true);
  const close=await dialog.getByRole('button',{name:/^Close /}).boundingBox();expect(close!.y).toBeGreaterThanOrEqual(top);expect(close!.y+close!.height).toBeLessThanOrEqual(top+height);
}
test.beforeEach(async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>{Object.defineProperty(window,'visualViewport',{configurable:true,value:Object.assign(new EventTarget(),{height:844,offsetTop:0,scale:1})});});
  await page.goto('/');await pairBrowser(page);
});

test('history stays within the visible phone viewport and preserves search through resize',async({page})=>{
  await page.getByRole('button',{name:'Open conversation history',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Conversations',exact:true});const input=dialog.getByRole('searchbox',{name:'Search history',exact:true});await input.fill('Keep this history query');
  await viewport(page,380,60);await visibleBounds(dialog,60,380);await expect(input).toHaveValue('Keep this history query');
  const refresh=dialog.getByRole('button',{name:'Refresh history',exact:true});await refresh.scrollIntoViewIfNeeded();
  const refreshBox=await refresh.boundingBox();expect(refreshBox!.y).toBeGreaterThanOrEqual(59);expect(refreshBox!.y+refreshBox!.height).toBeLessThanOrEqual(441);
  const firstConversation=dialog.locator('.history-item').first();await firstConversation.scrollIntoViewIfNeeded();await expect(firstConversation).toBeInViewport();
  const rowBox=await firstConversation.boundingBox();expect(rowBox!.y).toBeGreaterThanOrEqual(59);expect(rowBox!.y+rowBox!.height).toBeLessThanOrEqual(441);
  await page.screenshot({path:'output/final-evolution/history-visible-viewport.png'});
  await viewport(page,844,0);await expect.poll(async()=>(await dialog.boundingBox())!.height).toBeGreaterThan(700);await expect(input).toHaveValue('Keep this history query');
  await dialog.getByRole('button',{name:'Close Conversations',exact:true}).click();await expect(page.getByRole('button',{name:'Open conversation history',exact:true})).toBeFocused();
});

test('MCP connection draft remains reachable when the phone viewport scrolls above the keyboard',async({page})=>{
  await openCommands(page);await page.getByRole('option',{name:/Manage MCP tools/}).click();const dialog=page.getByRole('dialog',{name:'MCP tools',exact:true});await dialog.getByRole('button',{name:'Review a new server',exact:true}).click();const input=dialog.getByLabel('Server endpoint',{exact:true});await input.fill('https://example.com/keyboard-draft');
  await viewport(page,360,90);await visibleBounds(dialog,90,360);const discover=dialog.getByRole('button',{name:'Discover tools',exact:true});await discover.scrollIntoViewIfNeeded();const box=await discover.boundingBox();expect(box!.y+box!.height).toBeLessThanOrEqual(450);await expect(input).toHaveValue('https://example.com/keyboard-draft');
  await viewport(page,844,0);await expect(input).toHaveValue('https://example.com/keyboard-draft');
});

test('nested unsaved-draft review and usage drawer obey the visible viewport',async({page})=>{
  await openCommands(page);await page.getByRole('option',{name:/Connect an external client/}).click();const clients=page.getByRole('dialog',{name:'External clients',exact:true});await clients.getByRole('button',{name:'New client token',exact:true}).click();await clients.getByLabel('Application label',{exact:true}).fill('Keyboard draft');
  await viewport(page,360,40);await clients.getByRole('button',{name:'Close External clients',exact:true}).click();const guard=page.getByRole('dialog',{name:'Unsaved changes',exact:true});await visibleBounds(guard,40,360);await guard.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(clients.getByLabel('Application label',{exact:true})).toHaveValue('Keyboard draft');
  await clients.getByRole('button',{name:'Close External clients',exact:true}).click();await page.getByRole('dialog',{name:'Unsaved changes',exact:true}).getByRole('button',{name:'Discard edits',exact:true}).click();
  await openCommands(page);await page.getByRole('option',{name:/^Usage/}).click();await visibleBounds(page.getByRole('dialog',{name:'Usage',exact:true}),40,360);
});

test('pinch zoom releases viewport constraints instead of shrinking dialog controls',async({page})=>{
  await openCommands(page);await page.getByRole('option',{name:/^Settings/}).click();const dialog=page.getByRole('dialog',{name:'Settings',exact:true});
  await viewport(page,380,40);await visibleBounds(dialog,40,380);await viewport(page,380,40,2);
  await expect.poll(async()=>(await dialog.boundingBox())!.height).toBeGreaterThan(700);await expect(dialog.getByRole('button',{name:'Light appearance',exact:true})).toHaveCSS('min-height','64px');
});
