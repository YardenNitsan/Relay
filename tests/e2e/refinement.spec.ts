import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { issuePairingToken, pairBrowser } from './helpers';

test('phone navigation exposes real destinations and every composer control remains reachable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  await pairBrowser(page);
  await expect(page.getByText('Local service connected', { exact: true })).toBeVisible();
  const navigation = page.getByRole('button', { name: 'Open navigation', exact: true });
  await navigation.click();
  const dialog = page.getByRole('dialog', { name: 'Navigate Relay' });
  await expect(dialog.getByRole('button', { name: 'Models & providers', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Models & providers', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Models & connections' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(navigation).toBeFocused();
  await expect(page.getByLabel('Compute depth')).toBeVisible();
  await page.getByLabel('Compute depth').selectOption('deep');
  await expect(page.getByLabel('Compute depth')).toHaveValue('deep');
  for (const target of [navigation, page.getByRole('button', { name: 'Stop all', exact: true }), page.getByRole('button', { name: 'Attach files' }), page.getByRole('button', { name: 'Execution options' }), page.getByRole('button', { name: 'Send objective' }), page.getByLabel('Computer access'), page.getByRole('button', { name: 'Choose workspace', exact: true })]) {
    const box = await target.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Objective' })).toBeVisible();
  await page.screenshot({ path: 'output/playwright/refinement-phone-light.png' });
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('conversation loading has a stable skeleton and failed loading offers recovery', async ({ page }) => {
  await page.goto('/');
  await pairBrowser(page);
  await expect(page.getByText('Local service connected', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Objective' }).fill('Explain the execution model');
  await page.getByRole('button', { name: 'Send objective' }).click();
  await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
  let fail = true;
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/conversations/*', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    await held;
    if (fail) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Conversation storage is temporarily unavailable.' }) });
    else await route.continue();
  });
  await page.reload();
  await expect(page.getByRole('status', { name: 'Opening conversation' })).toBeVisible();
  expect(await page.locator('.conversation-skeleton [aria-hidden="true"]').count()).toBeGreaterThan(0);
  release();
  await expect(page.getByRole('alert')).toContainText('Conversation storage is temporarily unavailable.');
  fail = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('A deterministic response for browser testing.', { exact: false })).toBeVisible();
});

test('reduced motion keeps dialogs immediate and keyboard focus contained', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await pairBrowser(page);
  await expect(page.getByText('Local service connected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open command palette' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  for (let index = 0; index < 5; index++) await page.keyboard.press('Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open command palette' })).toBeFocused();
});

test('a desktop command that opens another dialog restores focus to a visible navigation control', async ({ page }) => {
  await page.goto('/');
  await pairBrowser(page);
  const trigger = page.getByRole('button', { name: 'Open command palette', exact: true });
  await trigger.click();
  await page.getByRole('option', { name: 'Choose a model Models and provider connections' }).click();
  await expect(page.getByRole('dialog', { name: 'Models & connections' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('pairing gates private data, masks the token and persists only the authenticated session', async ({ page }) => {
  const protectedRequests: string[] = [];
  page.on('request', request => { if (/\/api\/(models|conversations|hardware|workspaces|admin)/.test(request.url())) protectedRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Connect this browser' })).toBeVisible();
  expect(protectedRequests).toEqual([]);
  const input = page.getByLabel('One-use pairing token');
  await expect(input).toHaveAttribute('type', 'password');
  await expect(input).toHaveAttribute('autocomplete', 'off');
  await page.screenshot({ path: 'output/playwright/refinement-pairing.png' });
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await input.fill('intentionally-invalid-fixture-token');
  await page.getByRole('button', { name: 'Pair this browser', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(input).toHaveValue('');
  const token = await issuePairingToken();
  await input.fill(token);
  await page.getByRole('button', { name: 'Pair this browser', exact: true }).click();
  await expect(page.getByText('Local service connected', { exact: true })).toBeVisible();
  expect(await page.evaluate(value => `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}${location.href}`.includes(value), token)).toBe(false);
  await page.reload();
  await expect(page.getByText('Local service connected', { exact: true })).toBeVisible();
});

test('resource policy remains usable when hardware telemetry is unavailable', async ({ page }) => {
  await page.route('**/api/hardware',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Telemetry is temporarily unavailable.'})}));
  await page.goto('/');await pairBrowser(page);
  await page.getByRole('button',{name:'Machine',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'This machine'});
  await expect(dialog.getByRole('alert')).toContainText('Telemetry is temporarily unavailable.');
  const profile=dialog.getByLabel('Resource profile');
  await expect(profile).toHaveValue('safe');
  await profile.selectOption('balanced');
  try {
    await dialog.getByRole('button',{name:'Save resource policy',exact:true}).click();
    await expect(dialog.getByText('Applied: Balanced',{exact:true})).toBeVisible();
    await expect(dialog.getByRole('alert')).toContainText('Telemetry is temporarily unavailable.');
    await expect(dialog.getByRole('button',{name:'Save resource policy',exact:true})).toBeDisabled();
    expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:'output/playwright/hardware-unavailable.png'});
  } finally {
    await profile.selectOption('safe');
    await dialog.getByRole('button',{name:'Save resource policy',exact:true}).click();
    await expect(dialog.getByText('Applied: Safe',{exact:true})).toBeVisible();
  }
});

test('resource policy distinguishes drafts, rejected changes and persisted host policy', async ({ page }) => {
  await page.goto('/');
  await pairBrowser(page);
  await page.getByRole('button', { name: 'Machine', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'This machine' });
  const profile = dialog.getByLabel('Resource profile');
  const save = dialog.getByRole('button', { name: 'Save resource policy', exact: true });
  await expect(profile).toHaveValue('safe');
  await expect(save).toBeDisabled();
  await expect(dialog.getByText('Applied: Safe', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Resident allocation is unavailable in the deterministic browser fixture.', { exact: true })).toBeVisible();
  await profile.selectOption('balanced');
  await expect(dialog.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Applied: Safe', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Resource policy saved', { exact: true })).toHaveCount(0);
  const failSave = '**/api/hardware/policy';
  await page.route(failSave, route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Policy storage is temporarily unavailable.' }) })
    : route.continue());
  await save.click();
  await expect(dialog.getByRole('alert')).toContainText('Policy storage is temporarily unavailable.');
  await expect(dialog.getByText('Applied: Safe', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Resource policy saved', { exact: true })).toHaveCount(0);
  await page.unroute(failSave);
  await save.click();
  await expect(dialog.getByText('Resource policy saved', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Applied: Balanced', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Machine', exact: true }).click();
  await expect(profile).toHaveValue('balanced');
  await expect(dialog.getByText('Applied: Balanced', { exact: true })).toBeVisible();
  await profile.selectOption('custom');
  const reserve = dialog.getByLabel('RAM reserve (GiB)', { exact: true });
  await reserve.fill('1');
  await save.click();
  expect(await reserve.evaluate((element: HTMLInputElement) => element.validity.rangeUnderflow)).toBe(true);
  await expect(reserve).toBeFocused();
  await expect(dialog.getByText('Applied: Balanced', { exact: true })).toBeVisible();
  await reserve.fill('5');
  await save.click();
  await expect(dialog.getByText('Applied: Custom', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Resource policy saved', { exact: true })).toBeVisible();
  const stored = await page.evaluate(async () => (await (await fetch('/api/hardware/policy')).json() as { policy: { profile: string; ramReserveGiB: number } }).policy);
  expect(stored).toMatchObject({ profile: 'custom', ramReserveGiB: 5 });
  await page.setViewportSize({ width: 820, height: 1180 });
  await dialog.locator('.modal-content').evaluate(element => { element.scrollTop = 0; });
  await dialog.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: 'output/playwright/refinement-resources-tablet.png' });
  expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await profile.selectOption('safe');
  await save.click();
  await expect(dialog.getByText('Applied: Safe', { exact: true })).toBeVisible();
});

test('conversation remains readable in both themes, with factual activity available beside it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await pairBrowser(page);
  await page.getByRole('textbox', { name: 'Objective' }).fill('Explain the execution model');
  await page.getByRole('button', { name: 'Send objective' }).click();
  await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Behind the work' })).toBeVisible();
  await page.screenshot({ path: 'output/playwright/refinement-conversation-light.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Relay home', exact: true })).toHaveCSS('color', 'rgb(231, 237, 244)');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'output/playwright/refinement-conversation-dark.png', animations: 'disabled' });
});

test('revoking the active owner session clears private UI and stops polling until pairing again', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Connect this browser' })).toBeVisible();
  await page.getByLabel('One-use pairing token').fill(await issuePairingToken());
  await page.getByRole('button', { name: 'Pair this browser', exact: true }).click();
  await expect(page.getByText('Local service connected', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Objective' }).fill('Explain the execution model');
  await page.getByRole('button', { name: 'Send objective' }).click();
  await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
  const cookie = (await page.context().cookies()).find(item => item.name === 'relay_local');
  expect(cookie).toBeDefined();
  const sessionId = createHash('sha256').update(cookie!.value).digest('hex');
  const revoked = await page.evaluate(async id => {
    const session = await (await fetch('/api/session')).json() as { csrfToken: string };
    const response = await fetch(`/api/admin/sessions/${id}/revoke`, { method: 'POST', headers: { 'x-relay-csrf': session.csrfToken } });
    return response.status;
  }, sessionId);
  expect(revoked).toBe(200);
  await page.clock.install();
  await page.getByRole('button', { name: 'Machine', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect this browser' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Objective' })).toHaveCount(0);
  await expect(page.getByText('A deterministic response for browser testing.', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const laterRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/')) laterRequests.push(new URL(request.url()).pathname); });
  await page.clock.fastForward(30_000);
  expect(laterRequests).toEqual([]);
  await page.getByLabel('One-use pairing token').fill(await issuePairingToken());
  await page.getByRole('button', { name: 'Pair this browser', exact: true }).click();
  await expect(page.getByText('Local service connected', { exact: true })).toBeVisible();
  await expect(page.getByText('A deterministic response for browser testing.', { exact: false })).toBeVisible();
});
