import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { pairBrowser } from './helpers';

test('phone calibration records supplied counters truthfully and cancels through the task controller', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await pairBrowser(page);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Models & providers', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Models & connections' });
  await dialog.getByRole('button', { name: /^Inspect / }).first().click();
  await dialog.getByText('Measure local performance', { exact: true }).click();
  const sample = dialog.locator('.calibration');
  await sample.getByRole('button', { name: 'Run calibration', exact: true }).click();
  await expect(sample.getByText('Completed', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(sample.locator('dl')).toContainText('Generated tokens');
  await expect(sample.locator('dl')).toContainText('60');
  // The explicit fixture supplies token counts, not measured wall-clock throughput.
  await expect(sample.locator('dl')).not.toContainText('tok/s');
  const records = await page.evaluate(async () => (await (await fetch('/api/models/calibrations')).json()) as { taskId: string; status: string; measurement: { outputTokens?: number } | null }[]);
  expect(records[0]).toMatchObject({ status: 'completed', measurement: { outputTokens: 60 } });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'output/playwright/calibration-phone.png' });
  await sample.getByRole('button', { name: 'Run calibration', exact: true }).click();
  await sample.getByRole('button', { name: 'Stop calibration', exact: true }).click();
  await expect(sample.getByText('Cancelled', { exact: true })).toBeVisible({ timeout: 15_000 });
  const cancelled = await page.evaluate(async () => (await (await fetch('/api/models/calibrations')).json())[0]);
  expect(cancelled.status).toBe('cancelled'); expect(cancelled.taskId).not.toBe(records[0].taskId);
});
