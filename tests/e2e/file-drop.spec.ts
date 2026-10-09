import { expect, test } from '@playwright/test';
import { pairBrowser } from './helpers';

test('dropping text files prepares one private workspace and rejects unsupported content honestly', async ({ page }) => {
  await page.goto('/'); await pairBrowser(page);
  const before = await (await page.request.get('/api/workspaces')).json();
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(['First note'], 'first.txt', { type: 'text/plain' }));
    data.items.add(new File(['Second note'], 'second.md', { type: 'text/markdown' }));
    return data;
  });
  const chat = page.locator('main#main');
  await chat.dispatchEvent('dragenter', { dataTransfer: transfer });
  await expect(page.getByText('Drop files to attach', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Your objective', exact: true }).dispatchEvent('dragenter', { dataTransfer: transfer });
  await page.getByRole('textbox', { name: 'Your objective', exact: true }).dispatchEvent('dragleave', { dataTransfer: transfer });
  await expect(page.getByText('Drop files to attach', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Drop files to attach', { exact: true })).toHaveCount(0);
  await chat.dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.getByRole('textbox', { name: 'Your objective', exact: true })).toHaveValue(/first.txt[\s\S]*second.md/);
  await expect(page.getByRole('button', { name: 'Attach files', exact: true })).toBeEnabled();
  const after = await (await page.request.get('/api/workspaces')).json();
  expect(after).toHaveLength(before.length + 1);
  const workspace = after.find((item: { id: string }) => !before.some((old: { id: string }) => old.id === item.id));
  expect(workspace.ownerUserId).toBeTruthy();
  const files = await (await page.request.get(`/api/workspaces/${workspace.id}/files`)).json();
  expect(files.files).toHaveLength(2);
  const pdf = await page.evaluateHandle(() => { const data = new DataTransfer(); data.items.add(new File(['Legacy document'], 'report.doc', { type: 'application/msword' })); return data; });
  await chat.dispatchEvent('drop', { dataTransfer: pdf });
  await expect(page.getByRole('alert')).toContainText('Legacy .doc files are not supported');
  await expect(page.getByLabel('File attachments', { exact: true })).not.toHaveAttribute('accept');
  await expect(page).toHaveURL('http://127.0.0.1:4319/');
  const unchanged = await (await page.request.get(`/api/workspaces/${workspace.id}/files`)).json();
  expect(unchanged.files).toEqual(files.files);
});
