import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { pairBrowser } from './helpers';

for (const size of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }, { width: 2560, height: 1440 }, { width: 844, height: 390 }]) {
  test(`objective and advanced controls remain usable at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/'); await pairBrowser(page);
    const objective = page.getByRole('textbox', { name: 'Objective' });
    await objective.fill('Keep my existing draft.');
    await page.getByRole('button', { name: 'Break down a problem' }).click();
    await expect(objective).toHaveValue(/Keep my existing draft\.[\s\S]*Break this problem/);
    await expect(objective).toBeFocused();
    expect(new URL(page.url()).searchParams.has('conversation')).toBe(false);
    await page.getByRole('button', { name: 'Execution options' }).click();
    await expect(page.getByRole('heading', { name: 'Advanced controls' })).toBeVisible();
    await page.getByLabel('Maximum calls', { exact: true }).fill('8');
    await expect(page.getByLabel('Active time limit (seconds)', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Overall time limit (seconds)', { exact: true })).toHaveValue('86400');
    await page.getByLabel('Overall time limit (seconds)', { exact: true }).fill('600');
    await expect(page.getByText('Whole-task approval and resource waits do not spend active time.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Execution options' }).click();
    await expect(page.getByLabel('Maximum calls', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Execution options' }).click();
    await expect(page.getByLabel('Maximum calls', { exact: true })).toHaveValue('8');
    await expect(page.getByLabel('Overall time limit (seconds)', { exact: true })).toHaveValue('600');
    await page.getByRole('button', { name: 'Execution options' }).click();
    await page.getByText('About these permissions', { exact: true }).click();
    await expect(page.getByText('Read authorized managed files. No modifications or commands.', { exact: false })).toBeVisible();
    await page.getByText('About these permissions', { exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/playwright/evolution-${size.width}x${size.height}.png` });
    if ([320, 1440].includes(size.width)) {
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    }
  });
}

test('execution overview distinguishes completion from recorded evidence', async ({ page }) => {
  await page.goto('/'); await pairBrowser(page);
  await page.getByRole('textbox', { name: 'Objective' }).fill('Explain the execution model');
  await page.getByRole('button', { name: 'Send objective' }).click();
  await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  const overview = page.getByRole('region', { name: 'Execution overview' });
  await expect(overview).toContainText('No independent checks recorded');
  await expect(overview.getByRole('list', { name: 'Agent steps' })).toBeVisible();
  await expect(overview).toContainText('ollama/e2e-fixture');
  await expect(overview.getByText('Overall deadline:', {exact:false})).toContainText('Includes queue, approval and offline time.');
  await page.screenshot({ path: 'output/playwright/evolution-execution.png' });
});

test('short landscape conversations follow results and can return from older content', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/'); await pairBrowser(page);
  await page.getByRole('textbox', { name: 'Objective' }).fill(`Explain the execution model. ${'Context for the task. '.repeat(150)}`);
  await page.getByRole('button', { name: 'Send objective' }).click();
  await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
  const scroller = page.locator('.conversation-scroll');
  await expect.poll(() => scroller.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(5);
  await scroller.evaluate(el => { el.scrollTop = 0; });
  await page.getByRole('button', { name: 'Jump to latest' }).click();
  await expect.poll(() => scroller.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(5);
});
