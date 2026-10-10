import {expect,test} from '@playwright/test';
import {pairBrowser} from './helpers';

test('balanced auto greeting uses one worker and persists only the answer prose',async({page})=>{
  await page.goto('/');await pairBrowser(page);
  await page.getByLabel('Compute depth').selectOption('balanced');
  await expect(page.getByRole('button',{name:'Choose model',exact:true})).toContainText('Auto');
  await page.getByRole('textbox',{name:'Your objective',exact:true}).fill('hello how are you today?');
  const admission=page.waitForResponse(response=>response.url().endsWith('/api/conversations/start')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Send objective'}).click();
  const created=await (await admission).json();
  await expect(page.getByText('Completed',{exact:true}).first()).toBeVisible();
  const detailResponse=await page.request.get(`/api/tasks/${created.task.id}`);expect(detailResponse.status()).toBe(200);
  const detail=await detailResponse.json();
  expect(detail.task.options.depth).toBe('balanced');expect(detail.task.options.modelId).toBeNull();expect(detail.task.callsUsed).toBe(1);
  expect(detail.steps.map((step:{role:string})=>step.role)).toEqual(['worker']);
  expect(detail.events.find((event:{type:string})=>event.type==='TASK_ANALYZED')?.data.strategy).toBe('Single worker');
  expect(detail.verification.some((check:{kind:string})=>check.kind==='model_review')).toBe(false);
  const reply=page.getByRole('article',{name:'Relay response'});
  await expect(reply).toHaveCount(1);
  await expect(reply).toContainText('A deterministic response for browser testing.');
  await expect(page.getByText('Checking the answer.',{exact:true})).toHaveCount(0);
  await expect(reply).not.toContainText('REVIEW:');
  await page.reload();await expect(reply).toHaveCount(1);
  await expect(reply).not.toContainText('objective is fulfilled');
});
