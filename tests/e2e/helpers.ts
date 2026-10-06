import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, type Cookie, type Page } from '@playwright/test';

// Ordinary UI scenarios share one legitimately paired session in worker memory.
// Re-pairing every fresh browser context would exercise the production brute-force
// limit rather than the feature under test. Dedicated pairing tests stay isolated.
let ownerCookies: Cookie[] | null = null;
let previousScenarioAt = 0;

export async function issuePairingToken(): Promise<string> {
  await promisify(execFile)(process.execPath, ['--import', 'tsx', 'server/auth/pair-cli.ts', '--data-dir', '.e2e-data/host']);
  const delivery = JSON.parse(await readFile(resolve('.e2e-data/host/auth/owner-pairing.json'), 'utf8')) as { token: string };
  return delivery.token;
}

export async function pairBrowser(page: Page) {
  // This one-host suite runs much faster than interactive use. Pace scenario
  // admission (not UI assertions) to retain the real local API rate limiter.
  const remaining = 4000 - (Date.now() - previousScenarioAt);
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  previousScenarioAt = Date.now();
  await expect(page.getByRole('heading', { name: 'Connect this browser' })).toBeVisible();
  if (ownerCookies) {
    await page.context().addCookies(ownerCookies);
    await page.reload();
    await expect(page.getByText('Local service connected', { exact: true })).toBeVisible();
    return;
  }
  const token = await issuePairingToken();
  await page.getByLabel('One-use pairing token').fill(token);
  await page.getByRole('button', { name: 'Pair this browser', exact: true }).click();
  await expect(page.getByText('Local service connected', { exact: true })).toBeVisible();
  ownerCookies = await page.context().cookies();
}

export async function openCommands(page: Page) {
  const trigger = page.getByRole('button', { name: 'Open command palette', exact: true });
  if (await trigger.isVisible()) await trigger.click();
  else {
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.getByRole('button', { name: /Command palette/ }).click();
  }
}
