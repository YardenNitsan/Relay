import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { pairBrowser } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await pairBrowser(page);
  await expect(page.getByText('Local service connected', { exact: true })).toBeVisible();
});

test('owner adds an allowed user, changes persisted grants, and revokes access', async ({ page }) => {
  await page.getByRole('button', { name: 'Access', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Access & remote connections' });
  await expect(dialog.getByText('Remote access is disabled. Local access works independently.')).toBeVisible();
  const email = `browser-${Date.now()}@example.test`;
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Policy acceptance');
  await dialog.getByRole('textbox', { name: 'Identity-provider email' }).fill(email);
  await dialog.getByRole('button', { name: 'Add allowed user', exact: true }).click();
  await expect(dialog.getByText(email, { exact: true })).toBeVisible();
  await dialog.getByText(email, { exact: true }).click();
  const editor = dialog.locator('details.access-user').filter({ hasText: email });
  await editor.getByLabel('Maximum computer access').selectOption('supervised');
  await editor.getByLabel('Calls per task').fill('6');
  await editor.getByRole('button', { name: 'Save user policy' }).click();
  await expect(dialog.getByText('User policy updated. Previous sessions and active work were revoked.')).toBeVisible();
  const stored = await page.evaluate(async (address) => {
    const response = await fetch('/api/admin/users');
    const users = await response.json() as { email: string; permissions: { maxAccess: string; maxCallsPerTask: number }; enabled: boolean }[];
    return users.find(user => user.email === address);
  }, email);
  expect(stored?.permissions).toMatchObject({ maxAccess: 'supervised', maxCallsPerTask: 6 });
  await editor.locator('summary').click();
  await editor.getByRole('button', { name: 'Revoke sessions & stop work' }).click();
  await expect(dialog.getByText('User sessions revoked and active work cancelled.')).toBeVisible();
  await editor.getByLabel('Account enabled').uncheck();
  await editor.getByRole('button', { name: 'Save user policy' }).click();
  await expect(editor.locator('summary').getByText('Disabled', { exact: true })).toBeVisible();
});

test('access modal is keyboard accessible and passes automated checks', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Access', exact: true });
  await trigger.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Access & remote connections' });
  await expect(dialog.getByRole('heading', { name: 'Add an allowed user' })).toBeVisible();
  await dialog.getByText('How to enable remote access', { exact: true }).click();
  await expect(dialog.getByText('RELAY_REMOTE_ENABLED=1', { exact: false })).toBeVisible();
  expect(await dialog.locator('.gateway-url').count()).toBe(0);
  const result = await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations).toEqual([]);
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
});

for (const width of [390, 320]) {
  test(`phone ${width}px keeps real approval controls usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: /Bring a project/ }).click();
    const name = `Phone approval ${width}-${Date.now()}`;
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByLabel('Computer access').selectOption('supervised');
    await page.getByRole('textbox', { name: 'Objective' }).fill('Create a notes file and verify the content');
    await page.getByRole('button', { name: 'Send objective' }).click();
    await page.getByRole('button', { name: 'Activity', exact: true }).click();
    const approval = page.getByRole('button', { name: 'Allow once', exact: true });
    await expect(approval).toBeVisible();
    const hostName = await page.evaluate(async () => (await (await fetch('/api/session')).json() as { hostName: string }).hostName);
    const card = page.locator('.approval');
    await expect(card.getByText(hostName, { exact: true })).toBeVisible();
    await expect(card.getByText(name, { exact: true })).toBeVisible();
    await expect(card.getByText('Worker', { exact: true })).toBeVisible();
    await expect(card.getByText('ollama/e2e-fixture', { exact: true })).toBeVisible();
    await expect(card.getByText('Create notes.txt', { exact: true })).toBeVisible();
    await expect(card.getByText('This exact mutating action requires task-controller approval', { exact: true })).toBeVisible();
    const bounds = await approval.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const result = await new AxeBuilder({ page }).include('.activity-panel').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(result.violations).toEqual([]);
    await page.screenshot({ path: `output/playwright/relay-approval-${width}.png` });
    if (width === 390) {
      for (const viewport of [{width:360,height:800},{width:430,height:932},{width:768,height:1024},{width:820,height:1180},{width:1024,height:768},{width:1280,height:800},{width:1440,height:1000},{width:1920,height:1080},{width:844,height:390},{width:390,height:420}]) {
        await page.setViewportSize(viewport);
        for (const action of ['Deny','Allow once','Allow for this task']) {
          const button = card.getByRole('button',{name:action,exact:true});
          await button.scrollIntoViewIfNeeded(); await expect(button).toBeInViewport();
          const box = await button.boundingBox(); expect(box?.height).toBeGreaterThanOrEqual(44);
        }
        expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (viewport.height <= 420) await page.screenshot({path:`output/playwright/approval-short-${viewport.width}x${viewport.height}.png`});
      }
      await page.setViewportSize({width,height:844});
    }
    await approval.click();
    await expect(page.getByRole('complementary', { name: 'Task activity' }).getByText('Completed', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('tab', { name: /^Changes/ }).click();
    await expect(page.getByLabel('Unified diff for notes.txt')).toContainText('+Verified fixture content');
    await page.getByRole('button', { name: 'Close activity' }).click();
    await expect(page.getByRole('button', { name: 'Activity', exact: true })).toBeFocused();
  });
}
