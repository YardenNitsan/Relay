import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';
import {pairLocalSession} from '../../scripts/local-session.mjs';

test('actual local host renders persisted execution, real models and resources at desktop and phone sizes',async({page})=>{
  const {cookie}=await pairLocalSession('http://127.0.0.1:4317');const delimiter=cookie.indexOf('=');
  await page.context().addCookies([{name:cookie.slice(0,delimiter),value:cookie.slice(delimiter+1),url:'http://127.0.0.1:4317',httpOnly:true,sameSite:'Strict'}]);
  const acceptance=JSON.parse(await readFile('output/local-acceptance.json','utf8'));
  const previous=acceptance.passed?acceptance:JSON.parse(await readFile('output/production-smoke.json','utf8'));
  expect(previous.passed).toBe(true);
  const response=await page.request.get(`/api/tasks/${previous.taskId}`);expect(response.ok()).toBe(true);
  const persisted=await response.json();expect(persisted.task.status).toBe('completed');
  await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
  await page.goto(`/?conversation=${persisted.task.conversationId}`);
  await expect(page.getByText('Local service connected',{exact:true})).toBeVisible();await expect(page.getByText('Completed',{exact:true}).first()).toBeVisible();
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:'output/playwright/production-conversation-light.png'});
  await page.getByRole('button',{name:'Switch to dark theme',exact:true}).click();await page.screenshot({path:'output/playwright/production-conversation-dark.png'});
  await page.getByRole('button',{name:'Models',exact:true}).click();await expect(page.getByRole('dialog',{name:'Models & connections'})).toBeVisible();await expect(page.getByRole('heading',{name:'qwen3:4b-instruct',exact:true})).toBeVisible();
  await page.screenshot({path:'output/playwright/production-models.png'});await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Machine',exact:true}).click();await expect(page.getByRole('dialog',{name:'This machine'})).toBeVisible();await page.screenshot({path:'output/playwright/production-hardware.png'});await page.keyboard.press('Escape');
  await page.setViewportSize({width:320,height:740});await page.getByRole('button',{name:'Open navigation',exact:true}).click();await expect(page.getByRole('dialog',{name:'Navigate Relay'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:'output/playwright/production-phone-navigation.png'});
  await page.keyboard.press('Escape');
  await page.getByRole('combobox',{name:'Computer access',exact:true}).selectOption('unrestricted');
  const hostConfirmation=page.getByRole('region',{name:'Confirm host file access',exact:true});
  await expect(hostConfirmation.getByRole('button',{name:'Enable host access',exact:true})).toBeVisible();
  await hostConfirmation.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Open conversation history',exact:true}).click();
  await expect(page.getByRole('button',{name:'Delete conversation',exact:true}).first()).toBeVisible();
});

test('real balanced auto greeting finishes with one natural answer and no completion commentary',async({page})=>{
  test.setTimeout(120_000);
  const {cookie}=await pairLocalSession('http://127.0.0.1:4317');const delimiter=cookie.indexOf('=');
  await page.context().addCookies([{name:cookie.slice(0,delimiter),value:cookie.slice(delimiter+1),url:'http://127.0.0.1:4317',httpOnly:true,sameSite:'Strict'}]);
  await page.goto('/');await expect(page.getByText('Local service connected',{exact:true})).toBeVisible();
  await page.getByLabel('Compute depth').selectOption('balanced');await page.getByRole('combobox',{name:'Model',exact:true}).selectOption('');
  await page.getByRole('textbox',{name:'Objective'}).fill('hello how are you today?');await page.getByRole('button',{name:'Send objective'}).click();
  const conversationId=new URL(page.url()).searchParams.get('conversation');
  let current;
  await expect.poll(async()=>{
    const response=await page.request.get(`/api/conversations/${conversationId}`);const detail=await response.json();current=detail.tasks.at(-1);
    return ['completed','paused','failed','waiting_for_user'].includes(current?.status);
  },{timeout:100_000}).toBe(true);
  expect(current.status,current.error??'The actual local-model task must complete').toBe('completed');
  const reply=page.getByRole('article',{name:'Relay response'});await expect(reply).toHaveCount(1);
  await expect(reply).not.toContainText(/original objective|no action is needed|objective is already fulfilled|REVIEW:/i);
  await expect(page.getByText('Checking the answer.',{exact:true})).toHaveCount(0);
  await page.screenshot({path:'output/playwright/production-balanced-greeting.png'});
  await page.reload();await expect(reply).toHaveCount(1);await expect(reply).not.toContainText(/original objective|no action is needed|REVIEW:/i);
});
