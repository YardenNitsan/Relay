import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { pairBrowser } from './helpers';

for (const [providerId, providerName] of [['openai', 'OpenAI'], ['xai', 'Grok (xAI)'], ['deepseek', 'DeepSeek']] as const) {
test(`shared-host user manages only their permitted ${providerName} connection on a narrow phone`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/'); await pairBrowser(page);
  // Session/provider responses exercise client contracts. Real cross-user key
  // isolation and cloud routing are independently covered by backend tests.
  let configured = false;
  let saved: unknown;
  await page.route('**/api/session', async route => {
    const response = await route.fetch(); const session = await response.json();
    await route.fulfill({ response, json: { ...session, remote: true, hostName: 'Studio workstation', user: { ...session.user, name: 'Alex Rivera', email: 'alex@example.test', role: 'chat', permissions: { ...session.user.permissions, providers: ['ollama', providerId], maxAccess: 'read_only', dailyCloudBudgetUsd: 5 } } } });
  });
  await page.route('**/api/models*', async route => {
    const response = await route.fetch(); const catalog = await response.json();
    await route.fulfill({ response, json: { ...catalog, providers: [
      { id: 'ollama', name: 'Shared local runtime', configured: true, connected: true, enabled: true, state: 'ready', error: null },
      { id: providerId, name: providerName, configured, connected: configured, enabled: true, state: configured ? 'ready' : 'not_configured', secretStorage: configured ? 'session' : undefined, error: null },
    ] } });
  });
  await page.route(`**/api/providers/${providerId}/key`, async route => {
    if (route.request().method() === 'POST') { saved = route.request().postDataJSON(); configured = true; }
    if (route.request().method() === 'DELETE') configured = false;
    await route.fulfill({ json: { saved: configured, storage: 'session' } });
  });
  await page.reload();
  await expect(page.getByText('Connected to Studio workstation', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const navigation = page.getByRole('dialog', { name: 'Navigate Relay', exact: true });
  await expect(navigation.getByText('Alex Rivera', { exact: true })).toBeVisible();
  await expect(navigation.getByText('alex@example.test', { exact: true })).toBeVisible();
  await expect(navigation.getByText('Studio workstation', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'output/playwright/shared-host-navigation-phone.png' });
  await navigation.getByRole('button', { name: 'Models & providers', exact: true }).click();
  const models = page.getByRole('dialog', { name: 'Models & connections', exact: true });
  await expect(models.getByRole('heading', { name: 'Your cloud connections', exact: true })).toBeVisible();
  await expect(models.getByText(/Local models and tools run on Studio workstation/)).toBeVisible();
  await expect(models.getByRole('article', { name: 'Shared local runtime connection', exact: true })).toHaveCount(0);
  await expect(models.getByRole('article', { name: 'Anthropic connection', exact: true })).toHaveCount(0);
  const provider = models.getByRole('article', { name: `${providerName} connection`, exact: true });
  await provider.getByText('Connect provider', { exact: true }).click();
  await provider.getByLabel('API key', { exact: true }).fill('relay-browser-fixture-key');
  await provider.getByRole('button', { name: 'Save credential', exact: true }).click();
  await expect.poll(() => saved).toEqual({ key: 'relay-browser-fixture-key', persist: false });
  await expect(provider.getByLabel('API key', { exact: true })).toHaveValue('');
  await expect(provider.getByRole('button', { name: 'Remove credential', exact: true })).toBeVisible();
  await expect(provider).toContainText('your Relay account');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `output/playwright/shared-host-${providerId}-providers-phone.png` });
  await provider.getByRole('button', { name: 'Remove credential', exact: true }).click();
  await expect(provider.getByText('Connect provider', { exact: true })).toBeVisible();
  await expect(provider.getByRole('button', { name: 'Remove credential', exact: true })).toHaveCount(0);

  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 1000 }, { width: 844, height: 390 }, { width: 390, height: 420 }]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: viewport.width === 1440 ? 'dark' : 'light', reducedMotion: 'reduce' });
    if (viewport.width === 1440) {
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
      await page.getByRole('button', { name: 'Models', exact: true }).click();
    }
    await expect(models.getByRole('heading', { name: 'Your cloud connections', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/playwright/shared-host-${providerId}-providers-${viewport.width}x${viewport.height}.png` });
  }
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Your objective', exact: true }).fill('A draft on a short phone viewport');
  await page.getByRole('button', { name: 'Execution options', exact: true }).click();
  await page.getByRole('combobox', { name: 'Cloud sharing', exact: true }).selectOption('allow');
  await page.getByRole('combobox', { name: 'Computer access', exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'output/playwright/shared-host-short-phone-composer.png' });
});
}

test('a pending remote account sees an approval explanation and can retry without owner pairing', async ({ page }) => {
  let pending = true;
  await page.route('**/api/session', async route => {
    await route.fulfill({ status: 403, json: { code: pending ? 'REMOTE_PENDING' : 'REMOTE_DENIED', error: pending ? 'Your access request is waiting for the host owner.' : 'This account is disabled.' } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Waiting for host approval', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check approval', exact: true })).toBeVisible();
  await expect(page.getByLabel('One-use pairing token')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'output/playwright/shared-host-pending-phone.png' });
  pending = false;
  await page.getByRole('button', { name: 'Check approval', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Access is disabled', exact: true })).toBeVisible();
  await expect(page.getByLabel('One-use pairing token')).toHaveCount(0);
});

test('owner saves the remote gateway settings and reviews a pending account with personal billing permission', async ({ page }) => {
  await page.goto('/'); await pairBrowser(page);
  const email = `approval-browser-${Date.now()}@example.test`;
  // Only the pending presentation is injected; configuration, account changes
  // and their persisted grants use the real authenticated backend.
  let pending = true;
  await page.route('**/api/admin/users', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch(); const users = await response.json();
    await route.fulfill({ response, json: users.map((user: { email: string }) => user.email === email && pending ? { ...user, enabled: false, registrationStatus: 'pending', accessRequestedAt: '2026-10-09T10:00:00Z' } : user) });
  });
  await page.getByRole('button', { name: 'Access', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Access & remote connections', exact: true });
  await dialog.getByText('How to enable remote access', { exact: true }).click();
  const setup = dialog.getByRole('form', { name: 'Remote gateway configuration', exact: true });
  await setup.getByLabel('Public Relay URL', { exact: true }).fill('https://relay.example.com');
  await setup.getByLabel('Cloudflare Access team URL', { exact: true }).fill('https://relay-team.cloudflareaccess.com');
  await setup.getByLabel('Application audience', { exact: true }).fill('a'.repeat(64));
  await setup.getByRole('combobox', { name: 'New accounts', exact: true }).selectOption('approval');
  await setup.getByRole('button', { name: 'Save gateway configuration', exact: true }).click();
  await expect(setup.getByRole('status')).toContainText('Gateway configuration saved');
  const storedConfig = await (await page.request.get('/api/admin/remote')).json();
  expect(storedConfig.savedConfig).toMatchObject({ publicOrigin: 'https://relay.example.com', issuer: 'https://relay-team.cloudflareaccess.com', audience: 'a'.repeat(64), registration: 'approval' });
  expect(storedConfig.enabled).toBe(false);
  expect(storedConfig.restartRequired).toBe(true);
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Pending browser account');
  await dialog.getByRole('textbox', { name: 'Identity-provider email', exact: true }).fill(email);
  await dialog.getByRole('button', { name: 'Add allowed user', exact: true }).click();
  const editor = dialog.locator('details.access-user').filter({ hasText: email });
  await expect(editor.locator('summary').getByText('Pending', { exact: true })).toBeVisible();
  await editor.locator('summary').click();
  await editor.getByLabel('OpenAI', { exact: true }).check();
  await expect(editor.getByLabel('Grok (xAI)', { exact: true })).not.toBeChecked();
  await expect(editor.getByLabel('DeepSeek', { exact: true })).not.toBeChecked();
  await editor.getByLabel('Grok (xAI)', { exact: true }).check();
  await editor.getByLabel('DeepSeek', { exact: true }).check();
  await editor.getByLabel('Allow personal API use without a dollar cap', { exact: true }).check();
  await editor.getByLabel('Allow external model clients', { exact: true }).check();
  pending = false;
  await editor.getByRole('button', { name: 'Approve account', exact: true }).click();
  await expect(editor.locator('summary').getByText('Available', { exact: true })).toBeVisible();
  const users = await (await page.request.get('/api/admin/users')).json();
  const user = users.find((record: { email: string }) => record.email === email);
  expect(user.enabled).toBe(true);
  expect(user.registrationStatus).toBe('approved');
  expect(user.permissions.allowUnpricedCloud).toBe(true);
  expect(user.permissions.externalModelAccess).toBe(true);
  expect(user.permissions.providers).toContain('openai');
  expect(user.permissions.providers).toEqual(expect.arrayContaining(['xai','deepseek']));
  // The TLS LAN listener is not running in this fixture host. Exercise its
  // one-time delivery UI contract without representing this as live pairing.
  await page.route(`**/api/admin/users/${user.id}/lan-invitation`, route => route.fulfill({ json: { token: 'explicit-browser-invitation-fixture', expiresAt: new Date(Date.now() + 300_000).toISOString() } }));
  await editor.locator('summary').click();
  await editor.getByRole('button', { name: 'Create LAN invitation', exact: true }).click();
  await expect(editor.getByLabel('LAN invitation code', { exact: true })).toHaveValue('explicit-browser-invitation-fixture');
  await editor.getByRole('button', { name: 'Hide invitation', exact: true }).click();
  await expect(editor.getByLabel('LAN invitation code', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await setup.scrollIntoViewIfNeeded();
  expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'output/playwright/shared-host-setup-phone.png' });
});

test('remote sign-out redirects only after the host successfully closes the session', async ({ page }) => {
  await page.goto('/'); await pairBrowser(page);
  await page.route('**/api/session', async route => { const response = await route.fetch(); const session = await response.json(); await route.fulfill({ response, json: { ...session, remote: true, user: { ...session.user, role: 'chat' } } }); });
  let fail = true;
  await page.route('**/api/session/logout', route => route.fulfill(fail ? { status: 503, json: { error: 'Session service is temporarily unavailable.' } } : { json: { closed: true } }));
  await page.route('**/cdn-cgi/access/logout', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Signed out</title><p>Signed out fixture</p>' }));
  await page.reload();
  await page.getByRole('button', { name: 'Account and host', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Navigate Relay', exact: true });
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Session service is temporarily unavailable.');
  await expect(page).not.toHaveURL(/cdn-cgi/);
  fail = false;
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/cdn-cgi\/access\/logout$/);
});
