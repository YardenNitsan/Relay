import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { pairBrowser } from './helpers';
import { historyConversationId, historyMessageId, historyTaskId } from '../../scripts/history-fixture';

test('all conversations and messages remain reachable beyond recent API limits', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/'); await pairBrowser(page);
  await page.getByRole('button', { name: 'Open conversation history' }).click();
  const dialog = page.getByRole('dialog', { name: 'Conversations', exact: true });
  await expect(dialog.locator('.history-item')).toHaveCount(40);
  await page.screenshot({ path: 'output/playwright/history-desktop-dark.png' });
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.getByText('Page 2', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.getByText('Page 3', { exact: true })).toBeVisible();
  // Earlier suite cases create real conversations. Keep verifying pagination
  // without assuming the archived fixture always remains on the third page.
  const archived=dialog.getByRole('button', { name: /Long history browser fixture/ });
  for(let number=4;number<=10&&await archived.count()===0;number++){
    await expect(dialog.getByRole('button',{name:'Next',exact:true})).toBeEnabled();
    await dialog.getByRole('button',{name:'Next',exact:true}).click();
    await expect(dialog.getByText(`Page ${number}`,{exact:true})).toBeVisible();
  }
  await archived.click();
  const savedMessages = page.locator('.message[id^="message-"]');
  await expect(savedMessages).toHaveCount(80);
  await expect(page.getByText('Saved history message 224.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Earlier messages', exact: true }).click();
  await expect(page.getByText('Saved history message 65.', { exact: false })).toBeVisible();
  await expect(savedMessages).toHaveCount(80);
  await page.getByRole('button', { name: 'Earlier messages', exact: true }).click();
  await expect(page.getByText('Archive sentinel:', { exact: false })).toBeVisible();
  // Id-less execution receipts are presentation, not additional saved messages.
  await expect(savedMessages).toHaveCount(65);
  await expect(page.getByRole('button', { name: 'Earlier messages', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /Execution record/ }).click();
  await expect(page.getByRole('combobox', { name: 'Task', exact: true })).toHaveValue(historyTaskId);
  await expect(page.getByRole('complementary', { name: 'Task activity' }).getByText('Cancelled', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close activity', exact: true }).click();
  await page.getByRole('button', { name: 'Newer messages', exact: true }).click();
  await expect(page.getByText('Saved history message 65.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Return to latest', exact: true }).first().click();
  await expect(page.getByText('Saved history message 224.', { exact: false })).toBeVisible();
  await expect(savedMessages).toHaveCount(80);
});

test('phone full-text search opens an old exact message and survives reload', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/'); await pairBrowser(page);
  await page.getByRole('button', { name: 'Open conversation history' }).click();
  const dialog = page.getByRole('dialog', { name: 'Conversations', exact: true });
  await dialog.getByLabel('Search in', { exact: true }).selectOption('messages');
  await dialog.getByLabel('Search history', { exact: true }).fill('"Archive sentinel"');
  await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(dialog.locator('.history-item')).toHaveCount(1);
  await expect(dialog.getByText('Archive sentinel:', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'output/playwright/history-search-phone.png' });
  await dialog.getByRole('button', { name: /Long history browser fixture/ }).click();
  await expect(page).toHaveURL(new RegExp(`conversation=${historyConversationId}&message=${historyMessageId}`));
  await expect(page.locator(`#message-${historyMessageId}`)).toBeFocused();
  await page.reload();
  await expect(page.locator(`#message-${historyMessageId}`)).toBeVisible();
  await expect(page.locator('.message[id^="message-"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Execution record/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'output/playwright/history-message-phone.png' });
  await page.getByRole('button', { name: 'Return to latest', exact: true }).first().click();
  await expect(page).not.toHaveURL(/message=/);
  await expect(page.getByText('Saved history message 224.', { exact: false })).toBeVisible();
});
