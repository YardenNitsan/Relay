import {expect,test} from '@playwright/test';
import {pairBrowser} from './helpers';

test('landscape message search leaves results and pagination reachable',async({page})=>{
  await page.setViewportSize({width:844,height:390});
  await page.route('**/api/history/*?*',route=>route.fulfill({json:{items:new URL(route.request().url()).pathname.endsWith('/search')?[{messageId:'landscape-message',conversationId:'landscape-conversation',conversationTitle:'A recorded discussion',role:'user',createdAt:'2026-10-12T10:00:00Z',taskId:null,excerpt:'A matching message with useful context.'}]:[],nextCursor:'opaque-next'}}));
  await page.goto('/');await pairBrowser(page);
  await page.getByRole('button',{name:'Open conversation history',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Conversations',exact:true});
  await dialog.getByRole('searchbox',{name:'Search history',exact:true}).fill('"matching message"');
  await dialog.getByLabel('Search in',{exact:true}).selectOption('messages');
  const result=dialog.getByText('A matching message with useful context.',{exact:true});
  await result.scrollIntoViewIfNeeded();
  await expect(result).toBeInViewport({ratio:1});
  await page.screenshot({path:'output/playwright/history-dispatch-search-landscape.png',animations:'disabled'});
  const next=dialog.getByRole('button',{name:'Next',exact:true});
  await next.scrollIntoViewIfNeeded();await expect(next).toBeInViewport({ratio:1});
  await next.click();await expect(dialog.getByText('Page 2',{exact:true})).toBeVisible();
});
