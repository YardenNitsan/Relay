import {expect,test,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {pairBrowser} from './helpers';

const first={id:'history-studio-first',title:'Research notes: a long conversation title that stays readable on a narrow screen',createdAt:'2026-05-12T08:00:00Z',updatedAt:'2026-05-14T09:00:00Z'};
const second={id:'history-studio-second',title:'תכנון הפרויקט והשלבים הבאים',createdAt:'2026-05-11T08:00:00Z',updatedAt:'2026-05-13T09:00:00Z'};
const older={id:'history-studio-older',title:'Earlier saved discussion',createdAt:'2026-04-01T08:00:00Z',updatedAt:'2026-04-02T09:00:00Z'};

async function openHistory(page:Page){
  await page.goto('/');await pairBrowser(page);await page.getByRole('button',{name:'Open conversation history',exact:true}).click();
  return page.getByRole('dialog',{name:'Conversations',exact:true});
}

// API fixtures exercise presentation and navigation states, not persistence.
// Existing history/conversation-delete specs retain real host search and deletion.
for(const [width,height,theme] of [[320,740,'light'],[390,844,'dark'],[844,390,'light'],[1440,1000,'dark']] as const){
  test(`history timeline and focused deletion at ${width}px ${theme}`,async({page})=>{
    await page.setViewportSize({width,height});await page.addInitScript(theme=>localStorage.setItem('relay:theme:v1',theme),theme);
    await page.route('**/api/history/conversations?*',route=>route.fulfill({json:{items:[first,second],nextCursor:null}}));
    const dialog=await openHistory(page);
    await expect(dialog.getByRole('searchbox',{name:'Search history',exact:true})).toBeFocused();
    await expect(dialog.locator('.history-item')).toHaveCount(2);
    await expect(dialog.getByText(first.title,{exact:true})).toBeVisible();
    await expect(dialog.getByText(second.title,{exact:true})).toHaveAttribute('dir','auto');
    expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`output/playwright/history-studio-${width}-${theme}.png`,animations:'disabled'});
    const row=dialog.locator('.history-row').filter({hasText:first.title});
    const trigger=row.getByRole('button',{name:'Delete conversation',exact:true});
    await trigger.click();
    const confirmation=dialog.getByRole('region',{name:'Confirm conversation deletion',exact:true});
    await expect(confirmation.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
    const hiddenSearch=dialog.getByRole('searchbox',{name:'Search history',exact:true,includeHidden:true});
    await expect(hiddenSearch).toHaveCount(1);await expect(hiddenSearch).toBeHidden();
    await expect(confirmation).toContainText('Workspace files remain unchanged');
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(trigger).toBeFocused();
  });
}

test('history keeps opaque paging and exact search syntax while focusing the new result page',async({page})=>{
  const requests:Array<{path:string;q:string|null;before:string|null;limit:string|null}>=[];
  await page.route('**/api/history/*?*',route=>{
    const url=new URL(route.request().url());requests.push({path:url.pathname,q:url.searchParams.get('q'),before:url.searchParams.get('before'),limit:url.searchParams.get('limit')});
    const messages=url.pathname.endsWith('/search');
    return route.fulfill({json:{items:messages?[{messageId:'history-studio-match',conversationId:first.id,conversationTitle:first.title,role:'user',createdAt:first.createdAt,taskId:null,excerpt:'A matching saved message.'}]:url.searchParams.has('before')?[older]:[first,second],nextCursor:messages||url.searchParams.has('before')?null:'opaque-page-two'}});
  });
  const dialog=await openHistory(page);
  await dialog.getByRole('button',{name:'Next',exact:true}).click();
  await expect(dialog.getByText('Page 2',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('heading',{name:'Your conversations',exact:true})).toBeFocused();
  await expect(dialog.locator('.history-item')).toHaveCount(1);
  expect(requests.at(-1)).toEqual({path:'/api/history/conversations',q:null,before:'opaque-page-two',limit:'40'});
  const expression='"quoted phrase" OR עברית -excluded';
  await dialog.getByRole('searchbox',{name:'Search history',exact:true}).fill(expression);
  const searching=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/history/search');
  await dialog.getByLabel('Search in',{exact:true}).selectOption('messages');
  await searching;
  await expect(dialog.getByRole('heading',{name:'Matching messages',exact:true})).toBeFocused();
  expect(requests.at(-1)).toEqual({path:'/api/history/search',q:expression,before:null,limit:'40'});
  await expect(dialog.getByText('Page 1',{exact:true})).toBeVisible();
});

test('history retains cached rows and an unsubmitted search during refresh failure',async({page})=>{
  let fail=false;
  await page.route('**/api/history/conversations?*',route=>fail?route.fulfill({status:503,json:{error:'History refresh unavailable'}}):route.fulfill({json:{items:[first,second],nextCursor:null}}));
  const dialog=await openHistory(page);await expect(dialog.locator('.history-item')).toHaveCount(2);
  await dialog.getByRole('searchbox',{name:'Search history',exact:true}).fill('Unsubmitted search');
  fail=true;await dialog.getByRole('button',{name:'Refresh history',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('History refresh unavailable');
  await expect(dialog.locator('.history-item')).toHaveCount(2);
  await expect(dialog.getByRole('searchbox',{name:'Search history',exact:true})).toHaveValue('Unsubmitted search');
});

test('history can return to the previous page after an uncached page fails',async({page})=>{
  await page.route('**/api/history/conversations?*',route=>new URL(route.request().url()).searchParams.has('before')
    ?route.fulfill({status:503,json:{error:'The next history page is unavailable'}})
    :route.fulfill({json:{items:[first,second],nextCursor:'opaque-unavailable-page'}}));
  const dialog=await openHistory(page);
  await expect(dialog.locator('.history-item')).toHaveCount(2);
  await dialog.getByRole('button',{name:'Next',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('The next history page is unavailable');
  await expect(dialog.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
  await expect(dialog.getByRole('button',{name:'Previous',exact:true})).toBeEnabled();
  await dialog.getByRole('button',{name:'Previous',exact:true}).click();
  await expect(dialog.getByText('Page 1',{exact:true})).toBeVisible();
  await expect(dialog.locator('.history-item')).toHaveCount(2);
  await expect(dialog.getByRole('heading',{name:'Your conversations',exact:true})).toBeFocused();
});

test('history refresh does not move focus inside a deletion review',async({page})=>{
  let refresh=false,release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  const updatedTitle='Updated elsewhere while reviewing deletion';
  await page.route('**/api/history/conversations?*',async route=>{
    if(refresh)await held;
    await route.fulfill({json:{items:[first,refresh?{...second,title:updatedTitle}:second],nextCursor:null}});
  });
  try{
    const dialog=await openHistory(page);
    await expect(dialog.locator('.history-item')).toHaveCount(2);
    refresh=true;
    await dialog.getByRole('button',{name:'Refresh history',exact:true}).click();
    await dialog.locator('.history-row').filter({hasText:first.title}).getByRole('button',{name:'Delete conversation',exact:true}).click();
    const confirmation=dialog.getByRole('region',{name:'Confirm conversation deletion',exact:true});
    const deleteButton=confirmation.getByRole('button',{name:'Delete conversation',exact:true});
    await deleteButton.focus();
    release();
    await expect(dialog.locator('.history-row').filter({hasText:updatedTitle})).toHaveCount(1);
    await expect(deleteButton).toBeFocused();
    await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(dialog.locator('.history-row').filter({hasText:first.title}).getByRole('button',{name:'Delete conversation',exact:true})).toBeFocused();
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});

test('history blocks navigation during deletion and applies acknowledgement before refresh',async({page})=>{
  let failRefresh=false,attempts=0;
  await page.route('**/api/history/conversations?*',route=>failRefresh?route.fulfill({status:503,json:{error:'Refresh failed after deletion'}}):route.fulfill({json:{items:[first,second],nextCursor:null}}));
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/conversations/${first.id}`,async route=>{attempts++;await held;failRefresh=true;await route.fulfill({json:{ok:true}});});
  try{
    const dialog=await openHistory(page);
    await dialog.locator('.history-row').filter({hasText:first.title}).getByRole('button',{name:'Delete conversation',exact:true}).click();
    const confirmation=dialog.getByRole('region',{name:'Confirm conversation deletion',exact:true});
    await confirmation.getByRole('button',{name:'Delete conversation',exact:true}).click();
    await expect(confirmation.getByRole('button',{name:'Deleting…',exact:true})).toBeDisabled();
    await dialog.getByRole('button',{name:'Close Conversations',exact:true}).click();
    await expect(dialog.getByRole('status')).toContainText('Wait for the current operation');
    await expect(dialog.getByRole('button',{name:'New',exact:true})).toBeDisabled();
    release();
    await expect(confirmation).toHaveCount(0);
    await expect(dialog.locator('.history-row').filter({hasText:first.title})).toHaveCount(0);
    await expect(dialog.locator('.history-row').filter({hasText:second.title})).toBeVisible();
    await expect(dialog.getByRole('searchbox',{name:'Search history',exact:true})).toBeFocused();
    await expect(dialog.getByRole('button',{name:'New',exact:true})).toBeEnabled();
    await expect(dialog.getByRole('alert')).toContainText('Refresh failed after deletion');
    expect(attempts).toBe(1);
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});
