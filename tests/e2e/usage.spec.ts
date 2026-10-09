import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { pairBrowser } from './helpers';

const report = { periodStart: '2026-10-09T00:00:00Z', periodEnd: '2026-10-10T00:00:00Z', truncated: true, models: [
  { modelId: 'ollama/local-model', provider: 'ollama', name: 'Local reasoning model', local: true, requests: 3, inputTokens: 1800, outputTokens: 400, unreportedCalls: 1, limits: null },
  { modelId: 'openai/gpt-test', provider: 'openai', name: 'GPT', local: false, requests: 2, inputTokens: 1200, outputTokens: 600, unreportedCalls: 0, limits: { observedAt: '2026-10-09T10:00:00Z', limits: [{ kind: 'tokens', remaining: 75000, limit: 100000, reset: '30s' }] } },
  { modelId: 'deepseek/deepseek-chat', provider: 'deepseek', name: 'DeepSeek', local: false, requests: 1, inputTokens: 800, outputTokens: 200, unreportedCalls: 0, limits: null },
] };

test('Usage drawer shows measured tokens and honest remaining limits on desktop and phone', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/usage', route => { requests++; return route.fulfill({ json: report }); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/'); await pairBrowser(page);
  expect(requests).toBe(0);
  const trigger = page.getByRole('button', { name: 'Usage', exact: true });
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: 'Usage', exact: true });
  await expect(drawer.getByText('5,000', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Reported totals are partial.', { exact: false })).toBeVisible();
  await expect(drawer.getByText('Showing the first 1,000 model records. Totals shown are partial.', { exact: true })).toBeVisible();
  await expect(drawer.getByText('No prepaid token limit', { exact: true })).toBeVisible();
  await expect(drawer.getByText('75,000', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Remaining tokens not reported by provider', { exact: true })).toBeVisible();
  expect(await drawer.evaluate(element => Math.round(element.getBoundingClientRect().right))).toBe(1440);
  expect(await drawer.locator('[role="progressbar"],progress').count()).toBe(0);
  expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'output/playwright/usage-desktop.png' });
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0); await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('dialog', { name: 'Navigate Relay' }).getByRole('button', { name: 'Usage', exact: true }).click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole('article', { name: 'DeepSeek usage' }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'output/playwright/usage-phone.png' });
  await drawer.getByRole('button', { name: 'Close Usage', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
});

test('Usage command handles unavailable and empty reports without inventing balances', async ({ page }) => {
  let unavailable = true;
  await page.route('**/api/usage', route => route.fulfill(unavailable ? { status: 503, json: { error: 'Usage is temporarily unavailable' } } : { json: { ...report, truncated: false, models: [] } }));
  await page.goto('/'); await pairBrowser(page);
  await page.getByRole('button', { name: 'Open command palette' }).click();
  await page.getByRole('combobox', { name: 'Search commands' }).fill('Usage');
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Usage', exact: true });
  await expect(drawer.getByRole('alert')).toContainText('Usage is temporarily unavailable');
  unavailable = false;
  await drawer.getByRole('button', { name: 'Try again' }).click();
  await expect(drawer.getByRole('heading', { name: 'No model usage today' })).toBeVisible();
  await drawer.getByRole('button', { name: 'Refresh usage' }).click();
  await expect(drawer.getByRole('heading', { name: 'No model usage today' })).toBeVisible();
});
