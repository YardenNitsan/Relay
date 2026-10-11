import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { ModelProfile, ProviderStatus, TaskOptions } from '../../shared/types';
import { pairBrowser } from './helpers';

// Catalog fixtures exercise presentation and submitted options only. They are
// explicitly labelled and never used as evidence of live provider access.
const profile = (id: string, provider: ModelProfile['provider'], name: string): ModelProfile => ({
  id, provider, name, runtime: id, local: provider === 'ollama',
  capabilities: { tools: true, vision: false, reasoning: true, structured: true },
  contextWindow: 128_000, quantization: null, sizeBytes: null, state: 'available',
  details: {}, tokensPerSecond: null, inputPricePerMillion: null, outputPricePerMillion: null,
});
const models: ModelProfile[] = [
  { ...profile('openai/catalog-test', 'openai', 'GPT catalog fixture'), reasoning: { levels: ['none', 'low', 'medium', 'high'], source: 'Synthetic browser fixture' } },
  profile('anthropic/catalog-test', 'anthropic', 'Claude unknown-control fixture'),
  profile('ollama/catalog-test', 'ollama', 'Local catalog fixture'),
];
const providers: ProviderStatus[] = [
  { id: 'openai', name: 'OpenAI', connected: true, configured: true, error: null },
  { id: 'anthropic', name: 'Anthropic', connected: true, configured: true, error: null },
  { id: 'ollama', name: 'Ollama', connected: true, configured: true, error: null },
  { id: 'gemini', name: 'Gemini', connected: false, configured: true, error: 'Synthetic unavailable fixture' },
];

async function setup(page: Page) {
  await page.route('**/api/models', route => route.fulfill({ json: { models, providers } }));
  const submitted: TaskOptions[] = [];
  await page.route('**/api/conversations/start', async route => {
    submitted.push(route.request().postDataJSON().options as TaskOptions);
    await route.fulfill({ status: 503, json: { error: 'Catalog fixture does not execute inference.' } });
  });
  await page.goto('/'); await pairBrowser(page);
  await page.getByRole('textbox', { name: 'Objective' }).fill('Preserve my unsent objective');
  return submitted;
}

for(const policy of ['quality','economy'] as const)test(`Auto ${policy} keeps phone sharing and budget unchanged`,async({page})=>{
  await page.setViewportSize({width:320,height:640});
  const submitted=await setup(page);
  await page.getByRole('button',{name:'Choose model',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Choose model',exact:true});
  await dialog.getByRole('button',{name:'Auto',exact:true}).click();
  await dialog.getByRole('radio',{name:policy==='quality'?'Quality':'Economy',exact:true}).check();
  await expect(dialog.getByRole('radio',{name:'Keep it local',exact:true})).toBeChecked();
  await page.screenshot({path:`output/playwright/model-policy-${policy}-320.png`});
  await dialog.getByRole('button',{name:'Use Auto',exact:true}).click();
  await expect(page.getByRole('button',{name:'Choose model',exact:true})).toContainText(policy==='quality'?'Quality':'Economy');
  const label=page.getByRole('button',{name:'Choose model',exact:true}).locator('span');
  expect(await label.evaluate(element=>element.clientWidth>=element.scrollWidth)).toBe(true);
  await page.getByRole('button',{name:'Send objective',exact:true}).click();
  await expect.poll(()=>submitted.length).toBe(1);
  expect(submitted[0]).toMatchObject({autoPolicy:policy,modelId:null,cloudPolicy:'local_only',budget:{maxCostUsd:null,localOnly:true}});
});

for (const size of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }, { width: 844, height: 390 }]) {
  test(`provider, model and reasoning selection at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    const submitted = await setup(page);
    const trigger = page.getByRole('button', { name: 'Choose model', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Choose model' });
    if ([320, 1440].includes(size.width)) await page.screenshot({ animations: 'disabled', path: `output/playwright/model-picker-providers-${size.width}.png` });
    await dialog.getByRole('button', { name: 'OpenAI · GPT', exact: true }).click();
    await dialog.getByRole('searchbox', { name: 'Search models' }).fill('openai/catalog-test');
    await expect(dialog.getByRole('button', { name: 'GPT catalog fixture', exact: true })).toBeVisible();
    await dialog.getByRole('searchbox', { name: 'Search models' }).fill('GPT catalog');
    await dialog.getByRole('button', { name: 'GPT catalog fixture', exact: true }).click();
    await dialog.getByRole('radio', { name: 'Low', exact: true }).check();
    await expect(dialog.getByRole('button', { name: 'Use model', exact: true })).toBeDisabled();
    await dialog.getByRole('radio', { name: 'Ask before sharing', exact: true }).check();
    await expect(dialog).toContainText('Pricing unavailable');
    await page.screenshot({ animations: 'disabled', path: `output/playwright/model-picker-${size.width}x${size.height}.png` });
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    if ([320, 1440].includes(size.width)) {
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    }
    await dialog.getByRole('button', { name: 'Use model and ask before sharing', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toContainText('GPT catalog fixture');
    await expect(page.getByRole('textbox', { name: 'Objective' })).toHaveValue('Preserve my unsent objective');
    expect(submitted).toHaveLength(0);
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    expect(submitted).toHaveLength(0);
    await page.getByRole('button', { name: 'Send objective', exact: true }).click();
    await expect.poll(() => submitted.length).toBe(1);
    expect(submitted[0]).toMatchObject({ modelId: 'openai/catalog-test', modelSelection: 'required', reasoning: 'low', cloudPolicy: 'ask', budget: { localOnly: false, maxCostUsd: null } });
  });
}

test('unknown reasoning is honest, disconnected providers stay unavailable, and cancel preserves privacy', async ({ page }) => {
  const submitted = await setup(page);
  await page.getByRole('button', { name: 'Choose model', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose model' });
  await dialog.getByRole('button', { name: 'Google · Gemini', exact: true }).click();
  await expect(dialog).toContainText('No available models');
  await dialog.getByRole('button', { name: 'All providers', exact: true }).click();
  await dialog.getByRole('button', { name: 'Anthropic · Claude', exact: true }).click();
  await dialog.getByRole('button', { name: 'Claude unknown-control fixture', exact: true }).click();
  await expect(dialog).toContainText('Reasoning controls are not verified for this model');
  await expect(dialog.getByRole('radio', { name: 'High', exact: true })).toHaveCount(0);
  await dialog.getByRole('radio', { name: 'Allow for this objective', exact: true }).check();
  await page.keyboard.press('Escape');
  expect(submitted).toHaveLength(0);
  await page.getByRole('button', { name: 'Send objective', exact: true }).click();
  await expect.poll(() => submitted.length).toBe(1);
  expect(submitted[0]).toMatchObject({ modelId: null, cloudPolicy: 'local_only', budget: { localOnly: true } });
});

test('Auto includes connected cloud models only after explicit sharing selection', async ({ page }) => {
  const submitted = await setup(page);
  await page.getByRole('button', { name: 'Choose model', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose model' });
  await dialog.getByRole('button', { name: 'Auto', exact: true }).click();
  await expect(dialog.getByRole('radio', { name: 'Keep it local', exact: true })).toBeChecked();
  await dialog.getByRole('radio', { name: 'Ask before sharing', exact: true }).check();
  await dialog.getByRole('button', { name: 'Use Auto and ask before sharing', exact: true }).click();
  expect(submitted).toHaveLength(0);
  await page.getByRole('button', { name: 'Send objective', exact: true }).click();
  await expect.poll(() => submitted.length).toBe(1);
  expect(submitted[0]).toMatchObject({ modelId: null, reasoning: 'auto', cloudPolicy: 'ask', budget: { localOnly: false, maxCostUsd: null } });
});

test('dark provider overview and keyboard reasoning controls remain accessible', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('relay:theme:v1', 'dark'));
  await page.setViewportSize({ width: 390, height: 844 });
  const submitted = await setup(page);
  await page.getByRole('button', { name: 'Choose model', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose model' });
  await expect(dialog.getByRole('heading', { name: 'The right model for your work' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'OpenAI · GPT', exact: true })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'output/playwright/model-picker-providers-dark-390.png' });
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ animations: 'disabled', path: 'output/playwright/model-picker-providers-dark-1440.png' });
  await dialog.getByRole('button', { name: 'OpenAI · GPT', exact: true }).click();
  await dialog.getByRole('button', { name: 'GPT catalog fixture', exact: true }).click();
  await dialog.getByRole('radio', { name: 'Auto', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('radio', { name: 'Provider default', exact: true })).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('radio', { name: 'Off', exact: true })).toBeChecked();
  await dialog.getByRole('radio', { name: 'Ask before sharing', exact: true }).check();
  await page.screenshot({ animations: 'disabled', path: 'output/playwright/model-picker-reasoning-dark-1440.png' });
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(submitted).toHaveLength(0);
});
