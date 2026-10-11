import { expect, test } from '@playwright/test';
import { pdfFixture, docxFixture } from '../helpers/documents';
import { openProjectChooser, pairBrowser } from './helpers';

for (const width of [320, 1440]) {
  test(`PDF and Word attachments create inspectable text copies at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/'); await pairBrowser(page);
    const before = await (await page.request.get('/api/workspaces')).json();
    const pdf = pdfFixture('A real PDF extraction for Relay.');
    const word = docxFixture('A real Word extraction for Relay.');
    await page.getByLabel('File attachments', { exact: true }).setInputFiles([
      { name: 'report.pdf', mimeType: 'application/pdf', buffer: pdf },
      { name: 'notes.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: word },
    ]);
    await expect(page.getByRole('textbox', { name: 'Your objective', exact: true })).toHaveValue(/report.pdf[\s\S]*notes.docx/, { timeout: 20_000 });
    await expect(page.getByText('Document imported as text.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Attach files', exact: true })).toBeEnabled();
    const after = await (await page.request.get('/api/workspaces')).json();
    const workspace = after.find((item: { id: string }) => !before.some((old: { id: string }) => old.id === item.id));
    expect(workspace.ownerUserId).toBeTruthy();
    const listing = await (await page.request.get(`/api/workspaces/${workspace.id}/files`)).json();
    expect(listing.files).toHaveLength(2);
    expect(listing.files.every((path: string) => path.endsWith('.txt'))).toBe(true);
    for (const path of listing.files) {
      const result = await page.request.get(`/api/workspaces/${workspace.id}/file?path=${encodeURIComponent(path)}`);
      expect(result.ok()).toBe(true);
      expect((await result.json()).content).toContain(path.includes('report') ? 'A real PDF extraction' : 'A real Word extraction');
    }
    await openProjectChooser(page);
    const dialog = page.getByRole('dialog', { name: 'Workspaces', exact: true });
    const item = dialog.getByRole('region', { name: 'Project inspector', exact: true });
    await item.getByRole('button', { name: /attachments\/.*report.*\.txt/ }).click();
    await expect(item.getByLabel('File contents', { exact: true })).toHaveValue(/A real PDF extraction/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/playwright/document-attachments-${width}.png`, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.getByLabel('File attachments', { exact: true }).setInputFiles({ name: 'damaged.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Not a PDF document') });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Your objective', exact: true })).not.toHaveValue(/damaged.pdf/);
    const unchanged = await (await page.request.get(`/api/workspaces/${workspace.id}/files`)).json();
    expect(unchanged.files).toEqual(listing.files);
  });
}
