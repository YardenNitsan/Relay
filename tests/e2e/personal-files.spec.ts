import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { pairBrowser } from './helpers';

for (const width of [320, 1440]) {
  test(`personal files and agent autonomy are separate from shared host grants at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/'); await pairBrowser(page);
    const personalId = 'personal-workspace-fixture';
    const documents = new Map<string, { content: string; sha256: string }>();
    let created = false;
    let conflict = true;
    let savedBody: unknown;
    const workspaces = () => [
      { id: 'shared-fixture', name: 'Shared reference', ownerUserId: null, sourcePath: null, fileCount: 0, createdAt: new Date().toISOString() },
      ...(created ? [{ id: personalId, name: 'Conversation attachments', ownerUserId: 'personal-user-fixture', sourcePath: null, fileCount: documents.size, createdAt: new Date().toISOString() }] : []),
    ];
    // Explicit UI contract fixtures. Backend tests separately enforce real account
    // isolation and capability checks; these fixtures do not claim live remote login.
    await page.route('**/api/session', async route => {
      const response = await route.fetch(); const session = await response.json();
      await route.fulfill({ response, json: { ...session, remote: true, user: { ...session.user, id: 'personal-user-fixture', role: 'chat', permissions: { ...session.user.permissions, maxAccess: 'read_only', workspaceIds: ['shared-fixture'] } } } });
    });
    await page.route('**/api/workspaces**', async route => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === '/api/workspaces') {
        if (method === 'POST') { created = true; await route.fulfill({ json: workspaces()[1] }); }
        else await route.fulfill({ json: workspaces() });
        return;
      }
      if (url.pathname.endsWith('/files')) {
        if (method === 'POST') { const body = route.request().postDataJSON(); documents.set(body.path, { content: body.content, sha256: 'a'.repeat(64) }); await route.fulfill({ json: { path: body.path } }); }
        else await route.fulfill({ json: { files: [...documents.keys()] } });
        return;
      }
      if (url.pathname.endsWith('/file')) {
        if (method === 'GET') { const path = url.searchParams.get('path')!; await route.fulfill({ json: { path, ...documents.get(path) } }); }
        else {
          const body = route.request().postDataJSON();
          if (method === 'PUT' && conflict) { conflict = false; await route.fulfill({ status: 409, json: { error: 'The file changed on the host. Reload before saving.' } }); return; }
          savedBody = body;
          if (method === 'DELETE') documents.delete(body.path);
          else documents.set(body.path, { content: body.content, sha256: 'b'.repeat(64) });
          await route.fulfill({ json: { path: body.path, sha256: method === 'DELETE' ? null : 'b'.repeat(64) } });
        }
        return;
      }
      await route.continue();
    });
    await page.reload();
    const access = page.getByRole('combobox', { name: 'Computer access', exact: true });
    await expect(page.getByRole('button', { name: 'Attach files', exact: true })).toBeEnabled();
    await expect(access.locator('option[value="workspace"]')).not.toHaveAttribute('disabled');
    await page.getByLabel('File attachments', { exact: true }).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('My private notes') });
    await expect(page.getByRole('textbox', { name: 'Your objective', exact: true })).toHaveValue(/Attached file:/);
    await expect(access.locator('option[value="workspace"]')).not.toHaveAttribute('disabled');
    await access.selectOption('workspace');
    await expect(access).toHaveValue('workspace');
    await expect(access.locator('option[value="unrestricted"]')).toHaveAttribute('disabled', '');
    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Workspaces', exact: true });
    await expect(dialog.getByRole('heading', { name: 'New personal workspace', exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Source directory', { exact: false })).toHaveCount(0);
    const personal = dialog.locator('article.workspace-item').filter({ hasText: 'Conversation attachments' });
    await personal.getByRole('button', { name: 'Inspect files', exact: true }).click();
    await personal.getByRole('button', { name: /attachments\/.*notes.txt/ }).click();
    const editor = personal.getByRole('region', { name: /File: attachments/ });
    await expect(editor.getByLabel('File contents', { exact: true })).toHaveValue('My private notes');
    await editor.getByLabel('File contents', { exact: true }).fill('Updated private notes');
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText('The file changed');
    await expect(editor.getByLabel('File contents', { exact: true })).toHaveValue('Updated private notes');
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(editor.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    expect(savedBody).toMatchObject({ content: 'Updated private notes', expectedHash: 'a'.repeat(64) });
    const download = page.waitForEvent('download');
    await editor.getByRole('button', { name: 'Download saved file', exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/notes.txt$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `output/playwright/personal-files-${width}.png` });
    await editor.getByRole('button', { name: 'Delete file', exact: true }).click();
    await editor.getByRole('button', { name: 'Keep file', exact: true }).click();
    expect(documents.size).toBe(1);
    await editor.getByRole('button', { name: 'Delete file', exact: true }).click();
    await editor.getByRole('button', { name: 'Confirm delete', exact: true }).click();
    await expect(personal.getByText('No files yet.', { exact: false })).toBeVisible();
    expect(savedBody).toMatchObject({ expectedHash: 'b'.repeat(64) });
    await dialog.getByRole('button', { name: /Shared reference/ }).click();
    await page.keyboard.press('Escape');
    await expect(access).toHaveValue('read_only');
    await expect(access.locator('option[value="workspace"]')).toHaveAttribute('disabled', '');
    await expect(page.getByRole('button', { name: 'Attach files', exact: true })).toBeDisabled();
  });
}
