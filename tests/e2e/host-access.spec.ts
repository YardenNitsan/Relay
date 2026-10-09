import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { pairBrowser } from './helpers';

test('local owner explicitly acknowledges real host file access before sending an objective', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/'); await pairBrowser(page);
  const access = page.getByRole('combobox', { name: 'Computer access', exact: true });
  const send = page.getByRole('button', { name: 'Send objective', exact: true });
  await page.getByRole('combobox', { name: 'Compute depth', exact: true }).selectOption('fast');
  await page.getByRole('textbox', { name: 'Your objective', exact: true }).fill('Explain host file permissions without using any tools.');
  await access.selectOption('supervised');
  await expect(access).toHaveValue('supervised');
  await access.selectOption('unrestricted');
  const confirmation = page.getByRole('region', { name: 'Confirm host file access', exact: true });
  await expect(confirmation).toBeVisible();
  await expect(access).toHaveValue('supervised');
  await expect(send).toBeDisabled();
  await expect(confirmation).toContainText('real host files');
  await expect(confirmation).toContainText('without per-action approval');
  await expect(confirmation).toContainText('Commands remain isolated');
  await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(access).toHaveValue('supervised');
  await expect(access).toBeFocused();

  await access.selectOption('unrestricted');
  const enable = confirmation.getByRole('button', { name: 'Enable host access', exact: true });
  await enable.scrollIntoViewIfNeeded();
  expect((await enable.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'output/playwright/host-access-confirmation-phone.png' });
  await enable.click();
  await expect(access).toHaveValue('unrestricted');
  await expect(confirmation).toHaveCount(0);
  await expect(page.locator('.scope-note')).toContainText('real files');
  await expect(page.locator('.scope-note')).not.toContainText('Choose a workspace to enable file tools.');
  await send.click();
  await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  const id = new URL(page.url()).searchParams.get('conversation');
  const detail = await (await page.request.get(`/api/conversations/${id}`)).json();
  expect(detail.tasks).toHaveLength(1);
  expect(detail.tasks[0].options).toMatchObject({ access: 'unrestricted', hostAccessConfirmed: true, workspaceId: null });

  await access.selectOption('read_only');
  await page.getByRole('textbox', { name: 'Your objective', exact: true }).fill('Explain why file permissions remain separate from model selection.');
  await send.click();
  await expect(page.getByText('Completed', { exact: true })).toHaveCount(2, { timeout: 20_000 });
  const after = await (await page.request.get(`/api/conversations/${id}`)).json();
  const readOnly = after.tasks.find((task: { options: { access: string } }) => task.options.access === 'read_only');
  expect(readOnly.options.hostAccessConfirmed).toBe(false);
});

test('remote account presentation cannot enable the owner host file mode', async ({ page }) => {
  await page.goto('/'); await pairBrowser(page);
  // This fixture checks client presentation only. Backend identity/authorization
  // rejection is covered by native API tests, not by this intercepted session.
  await page.route('**/api/session', async route => {
    const response = await route.fetch();
    const session = await response.json();
    await route.fulfill({ response, json: { ...session, remote: true, user: { ...session.user, role: 'chat', permissions: { ...session.user.permissions, maxAccess: 'read_only' } } } });
  });
  await page.reload();
  const access = page.getByRole('combobox', { name: 'Computer access', exact: true });
  await expect(access).toHaveValue('read_only');
  await expect(access.locator('option[value="unrestricted"]')).toHaveJSProperty('disabled', true);
  await expect(page.getByRole('region', { name: 'Confirm host file access', exact: true })).toHaveCount(0);
});
