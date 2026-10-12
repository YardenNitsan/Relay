import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {toggleExecutionOptions, pairBrowser, openCommands } from './helpers';
import { catalogTool } from '../../server/mcp/schema';

const endpoint = 'https://example.com/browser-test-mcp';
const contract = catalogTool({ name: 'lookup_document', description: 'Explicit browser fixture. Untrusted markup stays text: <img src=x onerror=alert(1)>', inputSchema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] } });
async function openMcp(page: Page) {
  await openCommands(page);
  await page.getByRole('combobox', { name: 'Search commands' }).fill('Manage MCP');
  await page.getByRole('option', { name: /Manage MCP tools/ }).click();
  return page.getByRole('dialog', { name: 'MCP tools', exact: true });
}

test('phone owner reviews an untrusted catalog, pins disabled tools, enables explicitly and persists the server', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  // Discovery transport is explicitly a browser fixture. Configuration, ownership,
  // persistence and task admission use the real test host API and database.
  let fail = true;
  await page.route('**/api/mcp/discover', async route => {
    expect(route.request().postDataJSON()).toEqual({ url: endpoint });
    if (fail) { fail = false; await route.fulfill({ status: 503, json: { error: 'Explicit fixture: discovery unavailable.' } }); }
    else await route.fulfill({ json: { tools: [contract] } });
  });
  await page.goto('/'); await pairBrowser(page);
  const dialog = await openMcp(page);
  await dialog.getByRole('button', { name: 'Review a new server', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Server endpoint', exact: true }).fill(endpoint);
  await dialog.getByRole('button', { name: 'Discover tools', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('discovery unavailable');
  await dialog.getByRole('button', { name: 'Discover tools', exact: true }).click();
  await expect(dialog.getByText(contract.description, { exact: true })).toBeVisible();
  expect(await dialog.locator('.mcp-contract img').count()).toBe(0);
  await dialog.getByRole('textbox', { name: 'Connection name', exact: true }).fill('Browser MCP fixture');
  await expect(dialog.getByRole('button', { name: 'Save selected tools as disabled' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'lookup_document', exact: true }).check();
  await dialog.getByText('Inspect schema and fingerprint', { exact: true }).click();
  await expect(dialog.locator('.mcp-contract pre')).toContainText('topic');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'output/playwright/mcp-review-phone.png' });
  await dialog.getByRole('button', { name: 'Save selected tools as disabled' }).click();
  await expect(dialog.getByRole('region', { name: 'MCP connection inspector', exact: true }).getByText('Disabled · 1 pinned tool', { exact: true })).toBeVisible();
  const stored = await page.evaluate(async () => (await (await fetch('/api/mcp/servers')).json()).servers as { id: string; enabled: boolean; tools: unknown[] }[]);
  expect(stored).toHaveLength(1); expect(stored[0].enabled).toBe(false); expect(stored[0].tools).toEqual([contract]);
  await dialog.getByRole('button', { name: 'Enable server', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'MCP connection inspector', exact: true }).getByText('Enabled · 1 pinned tool', { exact: true })).toBeVisible();
  await page.reload();
  const reopened = await openMcp(page);
  await expect(reopened.getByText('Enabled · 1 pinned tool', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'output/playwright/mcp-saved-phone.png' });
  await page.keyboard.press('Escape');
  await toggleExecutionOptions(page);
  await page.getByRole('checkbox', { name: /Browser MCP fixture/ }).check();
  await expect(page.getByText("in this task's network policy before sending.", { exact: false })).toBeVisible();
  await page.getByRole('combobox', { name: 'Public web requests' }).selectOption('ask');
  await page.getByRole('textbox', { name: 'Allowed HTTPS origins' }).fill('https://example.com');
  await expect(page.locator('.mcp-scope-gap')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'output/playwright/mcp-task-phone.png' });
  const access = page.getByRole('combobox', { name: 'Computer access' });
  await access.scrollIntoViewIfNeeded();
  const accessBounds = await access.boundingBox();
  expect(accessBounds!.y).toBeGreaterThanOrEqual(0); expect(accessBounds!.y + accessBounds!.height).toBeLessThanOrEqual(844);
  await toggleExecutionOptions(page);
  await page.getByRole('textbox', { name: /objective/i }).fill('Explain this explicit browser fixture without invoking external tools');
  await page.getByRole('button', { name: 'Send objective', exact: true }).click();
  await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
  const options = await page.evaluate(async () => {
    const id = new URL(location.href).searchParams.get('conversation');
    return (await (await fetch(`/api/conversations/${id}`)).json()).tasks[0].options;
  });
  expect(options.mcpServerIds).toEqual([stored[0].id]);
  expect(options.network).toEqual({ mode: 'ask', allowedOrigins: ['https://example.com'] });
});

test('remote-user MCP grants persist independently of network permission', async ({ page }) => {
  await page.goto('/'); await pairBrowser(page);
  // Independent setup through the authenticated API; this test does not depend
  // on the preceding browser context or the network discovery fixture.
  const setup = await page.evaluate(async server => {
    const session = await (await fetch('/api/session')).json();
    const response = await fetch('/api/mcp/servers', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-relay-csrf': session.csrfToken }, body: JSON.stringify({ servers: [server] }) });
    return response.status;
  }, { id: 'browser-grant-fixture', name: 'Browser MCP fixture', url: endpoint, enabled: true, tools: [contract] });
  expect(setup).toBe(200);
  await openCommands(page);await page.getByRole('option',{name:/^Manage access/}).click();
  const dialog = page.getByRole('dialog', { name: 'Access & remote connections' });
  const email = `mcp-browser-${Date.now()}@example.test`;
  await dialog.getByRole('button', { name: 'People', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add allowed user', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('MCP grant fixture');
  await dialog.getByRole('textbox', { name: 'Identity-provider email' }).fill(email);
  await dialog.getByRole('button', { name: 'Add allowed user', exact: true }).click();
  const editor = dialog.getByRole('article', { name: 'MCP grant fixture account policy', exact: true });
  await expect(editor.getByText(email, { exact: true })).toBeVisible();
  await editor.getByRole('checkbox', { name: /Browser MCP fixture/ }).check();
  await editor.getByRole('button', { name: 'Save user policy', exact: true }).click();
  await expect(dialog.getByText('User policy updated. Previous sessions and active work were revoked.')).toBeVisible();
  const permissions = await page.evaluate(async address => (await (await fetch('/api/admin/users')).json()).find((user: { email: string }) => user.email === address).permissions, email);
  expect(permissions.mcpServerIds).toEqual(['browser-grant-fixture']);
  // These optional fields are omitted for a new account. The backend's
  // authorizeOptions and the editor both interpret omission as deny/no origins.
  expect(permissions.maxNetworkAccess ?? 'deny').toBe('deny');
  expect(permissions.networkOrigins ?? []).toEqual([]);
  await expect(editor.getByRole('combobox', { name: 'Public web requests' })).toHaveValue('deny');
  await expect(editor.getByRole('textbox', { name: 'Allowed HTTPS origins' })).toHaveCount(0);
});
