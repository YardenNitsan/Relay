import { expect, test } from '@playwright/test';
import { pairBrowser } from './helpers';

for (const access of ['supervised', 'workspace']) {
  test(`phone can choose ${access} for own files before submitting a prompt`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto('/'); await pairBrowser(page);
    // The backend suite separately tests genuine remote-user authorization.
    // This account presentation fixture keeps real workspace/task persistence.
    await page.route('**/api/session', async route => {
      const response = await route.fetch(); const session = await response.json();
      await route.fulfill({ response, json: { ...session, remote: true, user: { ...session.user, role: 'chat', permissions: { ...session.user.permissions, maxAccess: 'read_only', workspaceIds: [] } } } });
    });
    await page.reload();
    const permission = page.getByRole('combobox', { name: 'Computer access', exact: true });
    await expect(permission.locator(`option[value="${access}"]`)).not.toHaveAttribute('disabled');
    await permission.selectOption(access);
    await expect(permission).toHaveValue(access);
    await expect(page.getByRole('button', { name: 'My files Your files', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Attach files', exact: true })).toBeEnabled();
    await expect(permission.locator('option[value="unrestricted"]')).toHaveAttribute('disabled', '');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/playwright/permission-${access}-phone.png` });
    await page.getByRole('combobox', { name: 'Compute depth', exact: true }).selectOption('fast');
    await page.getByRole('textbox', { name: 'Your objective', exact: true }).fill('Explain this private file scope.');
    const response = page.waitForResponse(value => value.url().endsWith('/api/conversations/start') && value.request().method() === 'POST');
    await page.getByRole('button', { name: 'Send objective', exact: true }).click();
    const created = await (await response).json();
    expect(created.task.options.access).toBe(access);
    expect(created.task.options.workspaceId).toBeTruthy();
  });
}
