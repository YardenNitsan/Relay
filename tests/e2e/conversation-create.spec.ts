import { expect, test } from '@playwright/test';
import {chooseExecutionOption, pairBrowser } from './helpers';

test('a rejected first objective retries into exactly one conversation', async ({ page }) => {
  await page.goto('/'); await pairBrowser(page);
  const title = `Single conversation ${Date.now()}`;
  let rejected = false;
  await page.route('**/api/conversations/**', async route => {
    if (route.request().method() === 'POST' && /\/(messages|start)$/.test(route.request().url()) && !rejected) {
      rejected = true;
      await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ code: 'USER_TASK_QUOTA', error: 'Wait and retry this objective.' }) });
    } else await route.continue();
  });
  await page.getByRole('textbox', { name: 'Your objective' }).fill(title);
  await page.getByRole('button', { name: 'Send objective', exact: true }).click();
  await expect(page.getByText('Wait and retry this objective.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Send objective', exact: true }).click();
  await expect(page).toHaveURL(/conversation=/);
  const saved = await page.request.get('/api/conversations');
  expect((await saved.json()).filter((item: { title: string }) => item.title === title)).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('article', { name: 'Your message', exact: true })).toHaveCount(1);
});

test('a lost first-message response survives reload without duplicating the chat or objective', async ({ page }) => {
  await page.goto('/'); await pairBrowser(page);
  const title = `Recovered request ${Date.now()}`;
  await chooseExecutionOption(page,'Compute depth','fast');
  let lost = false;
  await page.route('**/api/conversations/start', async route => {
    if (!lost) { lost = true; await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('textbox', { name: 'Your objective' }).fill(title);
  await page.getByRole('button', { name: 'Send objective', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send objective', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Your objective' })).toHaveValue(title);
  await page.getByRole('button', { name: 'Send objective', exact: true }).click();
  await expect(page).toHaveURL(/conversation=/);
  const saved = await page.request.get('/api/conversations');
  expect((await saved.json()).filter((item: { title: string }) => item.title === title)).toHaveLength(1);
  const id = new URL(page.url()).searchParams.get('conversation');
  const detail = await (await page.request.get(`/api/conversations/${id}`)).json();
  expect(detail.tasks).toHaveLength(1);
  expect(detail.tasks[0].options.depth).toBe('fast');
  expect(detail.messages.filter((item: { role: string }) => item.role === 'user')).toHaveLength(1);
});

test('switching drafts during a pending send preserves the new unsent text and navigation', async ({ page }) => {
  await page.goto('/'); await pairBrowser(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let arrived!: () => void;
  const started = new Promise<void>(resolve => { arrived = resolve; });
  await page.route('**/api/conversations/start', async route => { arrived(); await gate; await route.continue(); });
  const objective = page.getByRole('textbox', { name: 'Your objective' });
  await objective.fill('First delayed objective');
  await page.getByRole('button', { name: 'Send objective', exact: true }).click();
  await started;
  // Going to history and opening its New action remounts the draft only when
  // leaving a saved conversation. A page-visible selected fixture does that.
  await page.getByRole('button', { name: 'Open conversation history' }).click();
  await page.locator('.history-item').first().click();
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await objective.fill('Keep this second unsent draft');
  await page.getByRole('button', { name: 'Send objective', exact: true }).click();
  await expect(page.getByText(/Another objective is still being sent/)).toBeVisible();
  await expect(objective).toHaveValue('Keep this second unsent draft');
  const response = page.waitForResponse(item => item.url().endsWith('/api/conversations/start'));
  release(); await response;
  await expect(page).not.toHaveURL(/conversation=/);
  await expect(objective).toHaveValue('Keep this second unsent draft');
  await page.reload();
  await expect(objective).toHaveValue('Keep this second unsent draft');
});
