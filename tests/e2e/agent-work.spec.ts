import {expect,test} from '@playwright/test';
import type {TaskFeedPage} from '../../shared/task-feed';
import {openCommands,pairBrowser} from './helpers';

const feed:TaskFeedPage={version:1,nextCursor:'older-page-exists',items:[
  {id:'agent-learning-task',conversationId:'learning-conversation',objective:'Explain the recursion exercise',objectiveTruncated:false,status:'completed',assistantId:'learning',createdAt:'2026-10-12T09:00:00Z',updatedAt:'2026-10-12T09:03:00Z'},
  {id:'agent-coding-task',conversationId:'coding-conversation',objective:'Review the setup script',objectiveTruncated:false,status:'waiting_for_approval',assistantId:'coding',createdAt:'2026-10-12T08:00:00Z',updatedAt:'2026-10-12T08:04:00Z'},
  {id:'agent-general-task',conversationId:'general-conversation',objective:'Summarize my next steps',objectiveTruncated:false,status:'paused',assistantId:null,createdAt:'2026-10-12T07:00:00Z',updatedAt:'2026-10-12T07:01:00Z'},
]};

test('keyboard opening the Agents recent-work preview focuses the new work filter',async({page})=>{
  await page.setViewportSize({width:1440,height:960});
  await page.route('**/api/tasks?*',route=>route.fulfill({json:feed}));
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose an agent/}).click();
  const dialog=page.getByRole('dialog',{name:'Agents',exact:true});
  const preview=dialog.getByRole('button',{name:'See all recent work',exact:true});
  await preview.focus();await expect(preview).toBeFocused();await page.keyboard.press('Enter');
  await expect(dialog.getByRole('combobox',{name:'Filter work by specialist',exact:true})).toBeFocused();
  await expect(dialog.getByRole('button',{name:'Recent work',exact:true})).toHaveAttribute('aria-pressed','true');
  await dialog.getByRole('button',{name:'Specialists',exact:true}).click();
  const workTab=dialog.getByRole('button',{name:'Recent work',exact:true});
  await workTab.focus();await page.keyboard.press('Enter');await expect(workTab).toBeFocused();
});

test('Agents shows persisted role work from one bounded feed and retains it through refresh failure',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  let failed=false;const detailRequests:string[]=[];const feedLimits:string[]=[];
  page.on('request',request=>{if(/\/api\/tasks\/[^/]+$/.test(new URL(request.url()).pathname))detailRequests.push(request.url());});
  await page.route('**/api/tasks?*',route=>{feedLimits.push(new URL(route.request().url()).searchParams.get('limit')??'');return failed?route.fulfill({status:503,json:{error:'Recent work is temporarily unavailable'}}):route.fulfill({json:feed});});
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose an agent/}).click();
  const dialog=page.getByRole('dialog',{name:'Agents',exact:true});
  await dialog.getByRole('button',{name:'Recent work',exact:true}).click();
  const work=dialog.getByRole('region',{name:'Recent agent work',exact:true});
  await expect(work).toContainText('3 tasks loaded');
  await expect(work).toContainText('Waiting for approval');
  await expect(work).toContainText('Paused');
  await expect(work).toContainText('Older tasks may not appear here');
  await work.getByRole('combobox',{name:'Filter work by specialist',exact:true}).selectOption('learning');
  await expect(work).toContainText('Explain the recursion exercise');
  await expect(work).not.toContainText('Review the setup script');
  failed=true;await work.getByRole('button',{name:'Refresh recent work',exact:true}).click();
  await expect(work.getByRole('alert')).toContainText('Recent work is temporarily unavailable');
  await expect(work).toContainText('Explain the recursion exercise');
  failed=false;await work.getByRole('button',{name:'Refresh recent work',exact:true}).click();
  await expect(work.getByRole('alert')).toHaveCount(0);
  await expect(work.getByRole('combobox',{name:'Filter work by specialist',exact:true})).toHaveValue('learning');
  await dialog.getByRole('button',{name:'Specialists',exact:true}).click();
  await dialog.getByRole('button',{name:'Inspect Coding agent',exact:true}).click();
  const coding=dialog.getByRole('article',{name:'Coding agent',exact:true});
  await expect(coding.getByRole('region',{name:'Recent Coding work',exact:true})).toContainText('Review the setup script');
  await expect(coding).not.toContainText('Explain the recursion exercise');
  expect(detailRequests).toEqual([]);expect(feedLimits.length).toBeGreaterThan(0);expect(feedLimits.every(limit=>limit==='40')).toBe(true);
});

test('Agents work filters and task rows remain usable in short landscape without selecting a specialist',async({page})=>{
  await page.setViewportSize({width:844,height:390});
  await page.route('**/api/tasks?*',route=>route.fulfill({json:feed}));
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose an agent/}).click();
  const dialog=page.getByRole('dialog',{name:'Agents',exact:true});
  await dialog.getByRole('button',{name:'Recent work',exact:true}).click();
  const work=dialog.getByRole('region',{name:'Recent agent work',exact:true});
  await work.getByRole('combobox',{name:'Filter work by specialist',exact:true}).selectOption('general');
  const objective=work.getByText('Summarize my next steps',{exact:true});await objective.scrollIntoViewIfNeeded();await expect(objective).toBeInViewport();
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await dialog.getByRole('button',{name:'Specialists',exact:true}).click();
  await expect(dialog.getByRole('button',{name:/General orchestration/})).toHaveAttribute('aria-pressed','true');
  await expect(dialog.getByRole('button',{name:'Inspect Learning agent',exact:true})).toBeVisible();
});

test('opening agent work blocks duplicate navigation and keeps the task ledger after a failed read',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/tasks?*',route=>route.fulfill({json:feed}));
  let attempts=0,release:(()=>void)|undefined;
  const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/tasks/agent-coding-task',async route=>{attempts++;await held;return route.fulfill({status:503,json:{error:'Task evidence is temporarily unavailable'}});});
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose an agent/}).click();
  const dialog=page.getByRole('dialog',{name:'Agents',exact:true});
  await dialog.getByRole('button',{name:'Recent work',exact:true}).click();
  const open=dialog.getByRole('button',{name:'Open task: Review the setup script',exact:true});
  try {
    await open.click();await expect(open).toBeDisabled();
    await expect(dialog.getByRole('button',{name:'Specialists',exact:true})).toBeDisabled();
    await page.keyboard.press('Escape');await expect(dialog).toBeVisible();expect(attempts).toBe(1);
  } finally {release?.();}
  await expect(dialog.getByRole('alert').filter({hasText:'Task evidence is temporarily unavailable'})).toBeVisible();
  await expect(open).toBeEnabled();await expect(dialog).toContainText('Review the setup script');
  await open.click();await expect.poll(()=>attempts).toBe(2);await expect(open).toBeEnabled();
});

test('Agents opens the recorded execution of a real host fixture task',async({page})=>{
  await page.setViewportSize({width:1440,height:960});await page.goto('/');await pairBrowser(page);
  const objective='Open this actual task from Agents';
  await page.getByRole('textbox',{name:'Your objective',exact:true}).fill(objective);await page.getByRole('button',{name:'Send objective',exact:true}).click();
  await expect(page.locator('.message-assistant')).toContainText('A deterministic response for browser testing');
  await page.getByRole('button',{name:'Agents',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Agents',exact:true});
  await dialog.getByRole('button',{name:'Recent work',exact:true}).click();
  await dialog.getByRole('button',{name:`Open task: ${objective}`,exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('complementary',{name:'Task activity',exact:true})).toBeVisible();
  await expect(page.locator('.message-user')).toContainText(objective);
});
