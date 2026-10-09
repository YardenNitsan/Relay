import { expect, test } from '@playwright/test';
import { pairBrowser } from './helpers';

test('opening and explicitly refreshing the model manager request fresh local discovery', async ({ page }) => {
  await page.goto('/'); await pairBrowser(page);
  const freshDiscovery = () => page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/models' && url.searchParams.get('refreshLocal') === '1';
  });
  for (let opening = 0; opening < 2; opening++) {
    const request = freshDiscovery();
    await page.getByRole('button', { name: 'Models', exact: true }).click();
    await request;
    const dialog = page.getByRole('dialog', { name: 'Models & connections', exact: true });
    await expect(dialog.getByRole('heading', { name: 'Deterministic test model', exact: true })).toBeVisible();
    const refresh = dialog.getByRole('button', { name: 'Refresh models', exact: true });
    await expect(refresh).toBeEnabled();
    const manual = freshDiscovery();
    await refresh.click();
    await manual;
    await expect(refresh).toBeEnabled();
    await page.keyboard.press('Escape');
  }
});
