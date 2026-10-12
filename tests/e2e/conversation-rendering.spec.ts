import {expect,test} from '@playwright/test';
import {pairBrowser} from './helpers';
import {historyConversationId} from '../../scripts/history-fixture';
import {performanceResponse} from '../../scripts/performance-fixture';
import type {ConversationDetail} from '../../shared/types';

// Presentation stress fixture; real storage/history semantics remain covered by
// history.spec. Keep complete content and keyboard access across skipped layout.
for(const [width,height,theme] of [[390,844,'light'],[1440,1000,'dark']] as const)test(`long responses retain keyboard access and reading position at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height});await page.addInitScript(value=>localStorage.setItem('relay:theme:v1',value),theme);
  await page.route(`**/api/conversations/${historyConversationId}`,async route=>{
    const response=await route.fetch(),detail=await response.json() as ConversationDetail;
    detail.messages=detail.messages.slice(-40).map((message,index)=>({...message,taskId:null,role:index%2?'assistant':'user',content:index%2?`## Complete response ${index}\n\n${performanceResponse}`:`Review ${index}`}));
    detail.tasks=[];await route.fulfill({response,json:detail});
  });
  await page.goto(`/?conversation=${historyConversationId}`);await pairBrowser(page);
  const responses=page.locator('.message-assistant'),scroller=page.locator('.conversation-scroll');
  await expect(responses).toHaveCount(20);await expect(responses.last().getByRole('button',{name:'Copy response',exact:true})).toBeInViewport();
  await responses.last().getByRole('button',{name:'Copy response',exact:true}).focus();
  await expect(page.getByRole('button',{name:'Jump to latest',exact:true})).toHaveCount(0);
  // Native focus must reveal an offscreen code region without removing its text.
  const code=responses.first().getByRole('region',{name:'Code block',exact:true}).first();
  await code.focus();await expect(code).toBeFocused();await expect(code).toBeInViewport();
  await expect(code).toContainText("await workspace.read('src/example-0.ts')");
  await expect(page.getByRole('button',{name:'Jump to latest',exact:true})).toBeVisible();
  const top=await code.evaluate(element=>element.getBoundingClientRect().top);
  await page.getByRole('textbox',{name:'Your objective',exact:true}).fill('Keep reading this earlier response.');
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  expect(Math.abs(await code.evaluate(element=>element.getBoundingClientRect().top)-top)).toBeLessThan(5);
  await expect(responses.first()).toContainText('Review section 24');
  await expect(responses.first().locator('pre')).toHaveCount(24);
  await page.getByRole('button',{name:'Jump to latest',exact:true}).click();
  await expect.poll(()=>scroller.evaluate(element=>element.scrollHeight-element.scrollTop-element.clientHeight)).toBeLessThan(5);
  await expect(responses.last().getByRole('button',{name:'Copy response',exact:true})).toBeInViewport();
  await expect(page.getByRole('textbox',{name:'Your objective',exact:true})).toHaveValue('Keep reading this earlier response.');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
