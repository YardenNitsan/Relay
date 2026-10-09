import { expect, test } from '@playwright/test';
import { pairBrowser } from './helpers';

test('device folder copy uses explicit import, review and apply without leaving the workspace dialog', async ({ page }) => {
  // A browser API test fixture, not a claim of native OS folder-picker acceptance.
  // Workspace storage and file updates use the real authenticated fixture backend.
  await page.addInitScript(() => {
    const files = new Map([['notes.txt', 'Device original']]);
    const file = (name: string) => ({ kind: 'file', name,
      async getFile() { const bytes = new TextEncoder().encode(files.get(name) ?? ''); return { size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }; },
      async createWritable() { let content = ''; return { async write(value: string) { content = value; }, async close() { files.set(name, content); }, async abort() {} }; },
    });
    const root = { kind: 'directory', name: 'Device folder fixture',
      async *values() { for (const name of files.keys()) yield file(name); },
      async getDirectoryHandle() { throw new DOMException('Not found', 'NotFoundError'); },
      async getFileHandle(name: string, options?: { create?: boolean }) { if (!files.has(name) && !options?.create) throw new DOMException('Not found', 'NotFoundError'); if (!files.has(name)) files.set(name, ''); return file(name); },
      async removeEntry(name: string) { files.delete(name); },
      async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; },
    };
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => root });
    Object.defineProperty(window, 'relayDeviceFixtureText', { get: () => files.get('notes.txt') });
  });
  await page.goto('/'); await pairBrowser(page);
  await page.getByRole('button', { name: 'Choose workspace', exact: true }).click();
  const workspaces = page.getByRole('dialog', { name: 'Workspaces', exact: true });
  await workspaces.getByRole('button', { name: 'Choose device folder', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review folder upload', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(workspaces).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Review folder upload', exact: true })).toHaveCount(0);
  await workspaces.getByRole('button', { name: 'Choose device folder', exact: true }).click();
  await page.getByRole('dialog', { name: 'Review folder upload', exact: true }).getByRole('button', { name: 'Upload managed copy', exact: true }).click();
  await expect(workspaces.getByRole('status')).toContainText('Copied 1 files');
  const imported = workspaces.locator('article.workspace-item').filter({ hasText: 'Device folder fixture' });
  await imported.getByRole('button', { name: 'Inspect files', exact: true }).click();
  await imported.getByRole('button', { name: 'notes.txt', exact: true }).click();
  await imported.getByLabel('File contents', { exact: true }).fill('Reviewed host change');
  await imported.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(imported.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { relayDeviceFixtureText: string }).relayDeviceFixtureText)).toBe('Device original');
  await workspaces.getByRole('button', { name: 'Review device changes', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review device changes', exact: true });
  await expect(review.getByRole('button', { name: 'Apply selected changes (0)', exact: true })).toBeDisabled();
  await review.getByText('Compare contents', { exact: true }).click();
  await expect(review.getByText('Reviewed host change', { exact: true })).toBeVisible();
  await review.getByRole('checkbox', { name: 'Modify notes.txt', exact: true }).check();
  await page.screenshot({ path: 'output/playwright/device-folder-review.png' });
  await review.getByRole('button', { name: 'Apply selected changes (1)', exact: true }).click();
  await expect(review.getByRole('status')).toContainText('Applied 1 reviewed changes');
  expect(await page.evaluate(() => (window as unknown as { relayDeviceFixtureText: string }).relayDeviceFixtureText)).toBe('Reviewed host change');
  await page.keyboard.press('Escape');
  await expect(workspaces).toBeVisible();
  await workspaces.getByRole('button', { name: 'Disconnect folder', exact: true }).click();
  await expect(workspaces.getByRole('button', { name: 'Choose device folder', exact: true })).toBeVisible();
});

test('unsupported phone browsers receive a usable upload and download alternative', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }));
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/'); await pairBrowser(page);
  await page.getByRole('button', { name: 'Choose workspace', exact: true }).click();
  const workspaces = page.getByRole('dialog', { name: 'Workspaces', exact: true });
  await workspaces.getByText('Folder connections are not supported', { exact: false }).scrollIntoViewIfNeeded();
  await expect(workspaces.getByText('Folder connections are not supported', { exact: false })).toBeVisible();
  await expect(workspaces.getByRole('button', { name: 'Choose device folder', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'output/playwright/device-folder-phone-fallback.png' });
});
