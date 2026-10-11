import { expect, test } from '@playwright/test';
import {chooseExecutionOption, openCommands, pairBrowser } from './helpers';

test('completion alert is generic, opt-in for system delivery and not replayed after reload', async ({ page }) => {
  // Browser notification fixture; this does not claim native OS delivery.
  await page.addInitScript(() => {
    const sent: Array<{ title: string; body: string }> = [];
    class FixtureNotification {
      static permission = 'default';
      static async requestPermission() { this.permission = 'granted'; return 'granted'; }
      onclick: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor(title: string, options: { body: string }) { sent.push({ title, body: options.body }); }
      close() { this.onclose?.(); }
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: FixtureNotification });
    Object.defineProperty(window, 'relayNotificationFixture', { get: () => sent });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  });
  await page.goto('/'); await pairBrowser(page);
  await openCommands(page);
  await page.getByRole('option', { name: /Task notifications/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Task notifications', exact: true });
  await dialog.getByRole('button', { name: 'Enable system notifications', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Turn off system notifications', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await chooseExecutionOption(page,'Compute depth','fast');
  await page.getByRole('textbox', { name: 'Your objective', exact: true }).fill('Private notification test content.');
  await page.getByRole('button', { name: 'Send objective', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Task completion notification', exact: true })).toContainText('Task complete. Your result is ready.');
  const sent = await page.evaluate(() => (window as unknown as { relayNotificationFixture: Array<{ title: string; body: string }> }).relayNotificationFixture);
  expect(sent).toHaveLength(1);
  expect(sent[0].title).toBe('Relay task complete');
  expect(JSON.stringify(sent)).not.toContain('Private notification test content');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Your objective', exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Task completion notification', exact: true })).toHaveCount(0);
});

test('a narrow phone without notifications keeps a clear in-app fallback', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'Notification', { configurable: true, value: undefined }));
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/'); await pairBrowser(page);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('dialog', { name: 'Navigate Relay', exact: true }).getByRole('button', { name: 'Task notifications', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Task notifications', exact: true });
  await expect(dialog.getByText('System notifications are unavailable', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Enable system notifications', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'output/playwright/notifications-phone.png', animations: 'disabled' });
});
