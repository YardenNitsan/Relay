import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { pairBrowser } from './helpers';

for (const denied of [false, true]) {
  test(`Google return ${denied ? 'denial' : 'success'} scrubs authorization parameters and exchanges once`, async ({ page }) => {
    await page.goto('/'); await pairBrowser(page);
    let calls = 0; let payload: unknown;
    await page.route('**/api/providers/gemini/google/complete', route => {
      calls++; payload = route.request().postDataJSON();
      expect(route.request().headers()['x-relay-csrf']).toBeTruthy();
      return route.fulfill(denied ? { status: 400, json: { error: 'Google connection was not authorized.', code: 'GOOGLE_DENIED' } } : { json: { configured: true, connected: true, quotaProject: 'browser-fixture', origins: ['http://127.0.0.1:4319'], storage: 'os-keyring' } });
    });
    await page.goto(denied ? '/?relay_google=1&state=browser-state-fixture&error=access_denied&scope=private-scope-fixture' : '/?relay_google=1&state=browser-state-fixture&code=browser-code-fixture&scope=private-scope-fixture');
    const result = page.getByRole(denied ? 'alert' : 'status', { name: 'Google sign-in result', exact: true });
    await expect(result).toContainText(denied ? 'Google connection was not authorized' : 'Google authorization saved');
    await expect(page).toHaveURL('http://127.0.0.1:4319/');
    expect(calls).toBe(1);
    expect(payload).toEqual(denied ? { state: 'browser-state-fixture', error: 'access_denied' } : { state: 'browser-state-fixture', code: 'browser-code-fixture' });
    expect(await page.locator('body').innerText()).not.toContain('browser-state-fixture');
    expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toMatch(/browser-code-fixture|browser-state-fixture|private-scope-fixture/);
    await result.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(result).toHaveCount(0);
  });
}

test('Google application setup is explicit, responsive and rejects an unexpected sign-in destination', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/'); await pairBrowser(page);
  let configured = false; let saved: unknown;
  await page.route('**/api/models*', async route => {
    const response = await route.fetch(); const catalog = await response.json();
    await route.fulfill({ response, json: { ...catalog, providers: [{ id: 'gemini', name: 'Gemini', configured: false, connected: false, enabled: true, state: 'not_configured', error: null }] } });
  });
  await page.route('**/api/providers/gemini/google', route => route.fulfill({ json: { configured, connected: false, quotaProject: configured ? 'relay-browser-fixture' : null, origins: ['http://127.0.0.1:4319'], storage: 'none' } }));
  await page.route('**/api/admin/google-oauth', route => {
    if (route.request().method() === 'PUT') { saved = route.request().postDataJSON(); configured = true; }
    return route.fulfill({ json: { configured, clientId: configured ? 'fixture.apps.googleusercontent.com' : null, quotaProject: configured ? 'relay-browser-fixture' : null, origins: ['http://127.0.0.1:4319'] } });
  });
  await page.route('**/api/providers/gemini/google/start', route => route.fulfill({ json: { url: 'https://unexpected.example.test/oauth' } }));
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('dialog', { name: 'Navigate Relay', exact: true }).getByRole('button', { name: 'Models & providers', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Models & connections', exact: true });
  await dialog.getByRole('button', { name: 'Connections', exact: true }).click();
  const google = dialog.getByRole('region', { name: 'Google connection for Gemini', exact: true });
  await expect(google.getByText('The host owner needs to configure', { exact: false })).toBeVisible();
  await google.getByText('Host owner: configure Google sign-in', { exact: true }).click();
  const setup = google.getByRole('form', { name: 'Google sign-in application', exact: true });
  await setup.getByLabel('Google OAuth client ID', { exact: true }).fill('fixture.apps.googleusercontent.com');
  await setup.getByLabel('Google OAuth client secret', { exact: true }).fill('explicit-ui-fixture-secret');
  await setup.getByLabel('Google quota project ID', { exact: true }).fill('relay-browser-fixture');
  await expect(setup.getByRole('button', { name: 'Save Google application', exact: true })).toBeDisabled();
  await setup.getByRole('checkbox').check();
  await setup.getByRole('button', { name: 'Save Google application', exact: true }).click();
  await expect(google.getByRole('status')).toContainText('Google application saved');
  expect(saved).toEqual({ clientId: 'fixture.apps.googleusercontent.com', clientSecret: 'explicit-ui-fixture-secret', quotaProject: 'relay-browser-fixture', sharedQuotaAccepted: true });
  await expect(setup.getByLabel('Google OAuth client secret', { exact: true })).toHaveValue('');
  await google.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(google.getByRole('alert')).toContainText('invalid Google sign-in address');
  await expect(page).toHaveURL('http://127.0.0.1:4319/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'output/playwright/google-setup-phone.png' });
});
