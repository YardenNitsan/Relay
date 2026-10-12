import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { openCommands, pairBrowser } from './helpers';

test('owner creates a client credential once, inspects metadata and revokes it on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await pairBrowser(page);
  await openCommands(page);
  await page.getByRole('option', { name: /Connect an external client/ }).click();
  const dialog = page.getByRole('dialog', { name: 'External clients', exact: true });
  const label = `Browser client ${Date.now()}`;
  await dialog.getByRole('button', { name: 'New client token', exact: true }).click();
  await dialog.getByLabel('Application label', { exact: true }).fill(label);
  await dialog.getByLabel('Expires in days', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: 'Create token', exact: true }).click();
  const revealed = dialog.getByLabel('New API token', { exact: true });
  await expect(revealed).toBeVisible();
  const value = await revealed.inputValue();
  expect(value.length > 20).toBe(true);
  expect(await page.evaluate(token => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(stored => String(stored).includes(token)), value)).toBe(false);
  const stored = await (await page.request.get('/api/inference/tokens')).json();
  expect(stored.tokens.some((token: { label: string }) => token.label === label)).toBe(true);
  expect(stored.tokens.every((token: Record<string, unknown>) => !('token' in token))).toBe(true);
  await dialog.getByRole('button', { name: 'Done, hide token', exact: true }).click();
  await expect(revealed).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'output/playwright/external-clients-phone.png' });
  await dialog.getByRole('button', { name: `Revoke ${label} token`, exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Client token revoked.');
  await expect(dialog.getByRole('article', { name: `${label} token`, exact: true })).toHaveCount(0);
  const after = await (await page.request.get('/api/inference/tokens')).json();
  expect(after.tokens.some((token: { label: string }) => token.label === label)).toBe(false);
});

test('a remote account without an external-client grant does not request or offer tokens', async ({ page }) => {
  await page.goto('/'); await pairBrowser(page);
  await page.route('**/api/session', async route => { const response = await route.fetch(); const session = await response.json(); await route.fulfill({ response, json: { ...session, remote: true, connection: 'remote', user: { ...session.user, role: 'chat', permissions: { ...session.user.permissions, externalModelAccess: false } } } }); });
  let tokenRequests = 0;
  await page.route('**/api/inference/tokens', route => { tokenRequests++; return route.fulfill({ status: 403, json: { code: 'FORBIDDEN', error: 'External model access is not granted.' } }); });
  await page.reload(); await openCommands(page);
  await page.getByRole('option', { name: /Connect an external client/ }).click();
  const dialog = page.getByRole('dialog', { name: 'External clients', exact: true });
  await expect(dialog.getByRole('heading', { name: 'External client access needs a grant', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create token', exact: true })).toHaveCount(0);
  expect(tokenRequests).toBe(0);
});
