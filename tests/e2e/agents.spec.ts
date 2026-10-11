import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {toggleExecutionOptions,chooseExecutionOption,openExecutionOptions,closeExecutionOptions, pairBrowser } from './helpers';

test('specialists retain separate model and permission controls and persist on the objective', async ({ page }) => {
  await page.goto('/'); await pairBrowser(page);
  await page.getByRole('button', { name: 'Choose agent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Agents', exact: true });
  await expect(dialog.getByRole('article')).toHaveCount(10);
  const email = dialog.getByRole('article', { name: 'Email agent', exact: true });
  await expect(email).toContainText('Requires connection');
  await expect(email).toContainText(/mail|connect/i);
  await expect(email.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Use Learning agent', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose agent', exact: true })).toContainText('Learning');
  await expect(page.getByRole('button', { name: 'Choose model', exact: true })).toContainText('Auto');
  await openExecutionOptions(page);
  await expect(page.getByRole('combobox', { name: 'Computer access', exact: true })).toHaveValue('read_only');
  await expect(page.getByRole('combobox', { name: 'Token efficiency', exact: true })).toHaveValue('efficient');
  await page.getByRole('combobox', { name: 'Token efficiency', exact: true }).selectOption('standard');
  await page.getByRole('spinbutton', { name: 'Maximum output tokens per model call', exact: true }).fill('1024');
  await toggleExecutionOptions(page);
  await chooseExecutionOption(page,'Compute depth','fast');
  await page.getByRole('textbox', { name: 'Your objective', exact: true }).fill('Explain recursion with a short example.');
  const response = page.waitForResponse(value => value.url().endsWith('/api/conversations/start') && value.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send objective', exact: true }).click();
  const created = await (await response).json();
  expect(created.task.options.assistantId).toBe('learning');
  expect(created.task.options.access).toBe('read_only');
  expect(created.task.options.modelId).toBeNull();
  expect(created.task.options.efficiency).toBe('standard');
  expect(created.task.options.budget.maxOutputTokens).toBe(1024);
  await expect(page.locator('[aria-label="Actual task models"]')).toContainText('Deterministic test model (ollama)');
  const persisted = await (await page.request.get(`/api/conversations/${created.task.conversationId}`)).json();
  expect(persisted.tasks.find((task: { id: string }) => task.id === created.task.id).options.assistantId).toBe('learning');
  await page.getByRole('button', { name: 'Choose agent', exact: true }).click();
  await dialog.getByRole('button', { name: /General orchestration/ }).click();
  await expect(page.getByRole('button', { name: 'Choose agent', exact: true })).toContainText('General');
  await page.reload();
  await expect(page.locator('[aria-label="Actual task models"]')).toContainText('Deterministic test model (ollama)');
});

test('specialist capability details remain usable across phone, tablet and desktop layouts', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto('/'); await pairBrowser(page);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('dialog', { name: 'Navigate Relay', exact: true }).getByRole('button', { name: 'Agents', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Agents', exact: true });
  const browser = dialog.getByRole('article', { name: 'Browser agent', exact: true });
  await browser.locator('summary').filter({ hasText: /Tools this role can request|Tools and setup/ }).click();
  await expect(browser).toContainText(/browser|public/i);
  await browser.getByRole('button', { name: 'Use Browser agent', exact: true }).scrollIntoViewIfNeeded();
  expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 1000 }, { width: 844, height: 390 }, { width: 390, height: 420 }]) {
    await page.setViewportSize(viewport);
    await dialog.getByRole('button', { name: /General orchestration/ }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/playwright/agents-${viewport.width}x${viewport.height}.png` });
  }
  await browser.getByRole('button', { name: 'Use Browser agent', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose agent', exact: true })).toContainText('Browser');
});

test('LAN invitation pairing does not disclose the local owner pairing workflow', async ({ page }) => {
  await page.route('**/api/session', route => route.fulfill({ status: 401, json: { code: 'LAN_PAIRING_REQUIRED', error: 'Enter an invitation from the host owner.' } }));
  let exchange: unknown;
  await page.route('**/api/session/pair', route => { exchange = route.request().postDataJSON(); return route.fulfill({ status: 401, json: { code: 'LAN_PAIRING_REQUIRED', error: 'This invitation expired. Ask the owner for a new code.' } }); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Join this host', exact: true })).toBeVisible();
  await expect(page.getByText('Get a pairing token', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/npm run pair/)).toHaveCount(0);
  await page.getByLabel('One-use invitation code', { exact: true }).fill('browser-test-invitation');
  await page.getByRole('button', { name: 'Pair this browser', exact: true }).click();
  expect(exchange).toEqual({ token: 'browser-test-invitation' });
  await expect(page.getByRole('alert')).toContainText('This invitation expired');
  await expect(page.getByLabel('One-use invitation code', { exact: true })).toHaveValue('');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'output/playwright/lan-invitation-phone.png' });
});

test('a read-only account activates Computer with private files without increasing computer permission', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await pairBrowser(page);
  // Account presentation fixture only; actual account authorization is tested by
  // backend remote API cases. Workspace creation and task persistence are real.
  await page.route('**/api/session', async route => {
    const response = await route.fetch(); const session = await response.json();
    await route.fulfill({ response, json: { ...session, remote: true, user: { ...session.user, role: 'chat', permissions: { ...session.user.permissions, maxAccess: 'read_only', workspaceIds: [] } } } });
  });
  let fail = true; let creationBody: unknown;
  await page.route('**/api/workspaces', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    creationBody = route.request().postDataJSON();
    if (fail) return route.fulfill({ status: 503, json: { error: 'Workspace preparation temporarily unavailable.' } });
    await route.continue();
  });
  await page.reload();
  await page.getByRole('button', { name: 'Choose agent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Agents', exact: true });
  const computer = dialog.getByRole('article', { name: 'Computer agent', exact: true });
  await computer.getByRole('button', { name: 'Use Computer agent', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Workspace preparation temporarily unavailable');
  await expect(dialog).toBeVisible();
  fail = false;
  await computer.getByRole('button', { name: 'Use Computer agent', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(creationBody).toEqual({ name: 'Computer files', personal: true });
  await expect(page.getByRole('button', { name: 'Choose agent', exact: true })).toContainText('Computer');
  await openExecutionOptions(page);
  await expect(page.getByRole('combobox', { name: 'Computer access', exact: true })).toHaveValue('read_only');
  await expect(page.getByRole('combobox', { name: 'Computer access', exact: true }).locator('option[value="unrestricted"]')).toHaveAttribute('disabled', '');
  await closeExecutionOptions(page);
  await expect(page.getByRole('button', { name: 'Computer files Your files', exact: true })).toBeVisible();
  await chooseExecutionOption(page,'Compute depth','fast');
  await page.getByRole('textbox', { name: 'Your objective', exact: true }).fill('Explain what my selected file scope allows.');
  const response = page.waitForResponse(value => value.url().endsWith('/api/conversations/start') && value.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send objective', exact: true }).click();
  const created = await (await response).json();
  expect(created.task.options).toMatchObject({ assistantId: 'computer', access: 'read_only', modelId: null });
  expect(created.task.options.workspaceId).toBeTruthy();
  const spaces = await (await page.request.get('/api/workspaces')).json();
  const space = spaces.find((item: { id: string }) => item.id === created.task.options.workspaceId);
  expect(space).toMatchObject({ name: 'Computer files', sourcePath: null, fileCount: 0 });
  expect(space.ownerUserId).toBeTruthy();
});
