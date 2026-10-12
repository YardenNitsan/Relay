import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { expect, type Cookie, type Page } from '@playwright/test';

// Ordinary UI scenarios share one legitimately paired session in worker memory.
// Re-pairing every fresh browser context would exercise the production brute-force
// limit rather than the feature under test. Dedicated pairing tests stay isolated.
let ownerCookies: Cookie[] | null = null;
let previousScenarioAt = 0;

export async function openExecutionOptions(page:Page){
  const dialog=page.getByRole('dialog',{name:'Execution options',exact:true});
  if(!await dialog.isVisible())await page.getByRole('button',{name:'Execution options',exact:true}).click();
  await expect(dialog).toBeVisible();return dialog;
}
export async function closeExecutionOptions(page:Page){
  const dialog=page.getByRole('dialog',{name:'Execution options',exact:true});
  await dialog.getByRole('button',{name:'Close Execution options',exact:true}).click();await expect(dialog).toHaveCount(0);
}
export async function toggleExecutionOptions(page:Page){
  if(await page.getByRole('dialog',{name:'Execution options',exact:true}).isVisible())await closeExecutionOptions(page);
  else await openExecutionOptions(page);
}
export async function chooseExecutionOption(page:Page,label:'Compute depth'|'Computer access',value:string){
  const dialog=await openExecutionOptions(page),select=dialog.getByRole('combobox',{name:label,exact:true});
  await select.selectOption(value);await expect(select).toHaveValue(value);await closeExecutionOptions(page);
}
export async function openProjectChooser(page:Page){
  const dialog=await openExecutionOptions(page);
  await dialog.getByRole('button',{name:/^(Choose workspace|Workspace)$/}).click();
  await expect(page.getByRole('dialog',{name:'Workspaces',exact:true})).toBeVisible();
}

export async function issuePairingToken(): Promise<string> {
  await promisify(execFile)(process.execPath, ['--import', 'tsx', 'server/auth/pair-cli.ts', '--data-dir', '.e2e-data/host']);
  const delivery = JSON.parse(await readFile(resolve('.e2e-data/host/auth/owner-pairing.json'), 'utf8')) as { token: string };
  return delivery.token;
}

export async function pairBrowser(page: Page) {
  // The browser contexts are isolated; the fixture host is shared. Clear only
  // its disposable workspace catalog so preceding scenarios cannot exhaust
  // the real per-account quota. Files remain in the temporary fixture until
  // server teardown; saved history is intentionally retained for history tests.
  const fixture = JSON.parse(await readFile(resolve('.e2e-data/host/fixture-workspace-root.json'), 'utf8')) as { root: string };
  const root = resolve(fixture.root);
  if (dirname(root) !== resolve(tmpdir()) || !/^relay-e2e-[\w-]+$/.test(basename(root))) throw new Error('Unexpected browser fixture directory');
  await unlink(join(root, 'workspaces.json')).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  // This one-host suite runs much faster than interactive use. Pace scenario
  // admission (not UI assertions) to retain the real local API rate limiter.
  // The limiter is shared by source IP across sessions: 4s admitted ~15 cases/min
  // and exceeded 300 API requests/min in the full suite. 8s leaves headroom
  // for polling, reloads and multi-action scenarios without weakening production.
  const remaining = 8000 - (Date.now() - previousScenarioAt);
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  previousScenarioAt = Date.now();
  await expect(page.getByRole('heading', { name: 'Connect this browser' })).toBeVisible();
  if (ownerCookies) {
    await page.context().addCookies(ownerCookies);
    await page.reload();
    await expect(page.getByText('Local service connected', { exact: true })).toBeVisible();
    await page.getByRole('button',{name:'Conversation',exact:true}).click();
    return;
  }
  const token = await issuePairingToken();
  await page.getByLabel('One-use pairing token').fill(token);
  await page.getByRole('button', { name: 'Pair this browser', exact: true }).click();
  await expect(page.getByText('Local service connected', { exact: true })).toBeVisible();
  ownerCookies = await page.context().cookies();
  await page.getByRole('button',{name:'Conversation',exact:true}).click();
}

export async function openCommands(page: Page) {
  const trigger = page.getByRole('button', { name: 'Open command palette', exact: true });
  const navigation = page.getByRole('button', { name: 'Open navigation', exact: true });
  // Reload can resolve before React restores the authenticated application.
  // Wait for an actual navigation control before choosing its responsive layout.
  await expect(trigger.or(navigation).first()).toBeVisible();
  if (await trigger.isVisible()) await trigger.click();
  else {
    await navigation.click();
    await page.getByRole('button', { name: /Command palette/ }).click();
  }
}

export async function projectIndex(page:Page){
  const dialog=page.getByRole('dialog',{name:'Workspaces',exact:true});
  await expect(dialog.getByRole('button',{name:'New workspace',exact:true})).toBeVisible();
  const back=dialog.getByRole('button',{name:'All projects',exact:true});
  if(await back.isVisible())await back.click();
  return dialog;
}
