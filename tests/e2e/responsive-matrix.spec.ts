import { expect, test, type Page } from '@playwright/test';
import { openCommands, pairBrowser } from './helpers';

const viewports = [
  { width: 320, height: 740 }, { width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 932 },
  { width: 768, height: 1024 }, { width: 820, height: 1180 }, { width: 1024, height: 768 }, { width: 1280, height: 800 },
  { width: 1440, height: 1000 }, { width: 1920, height: 1080 }, { width: 844, height: 390 }, { width: 390, height: 420 },
];
async function command(page: Page, search: string) {
  await openCommands(page);
  await page.getByRole('combobox', { name: 'Search commands' }).fill(search);
  await page.keyboard.press('Enter');
}

test('all provider connections, specialist details and Usage remain reachable across the responsive matrix', async ({ page }) => {
  test.setTimeout(120_000);
  // Explicit UI fixtures exercise all seven connection rows without configuring
  // real accounts. Backend grants and credential isolation have separate tests.
  const providers = [['ollama','Ollama'],['lmstudio','LM Studio'],['openai','OpenAI'],['anthropic','Anthropic'],['gemini','Gemini'],['xai','Grok (xAI)'],['deepseek','DeepSeek']];
  await page.route('**/api/models*', route => route.fulfill({ json: { models: [], providers: providers.map(([id,name]) => ({ id, name, configured: false, connected: false, enabled: true, state: 'unconfigured', error: null })) } }));
  await page.route('**/api/usage', route => route.fulfill({ json: { periodStart: '2026-10-09T00:00:00Z', periodEnd: '2026-10-10T00:00:00Z', truncated: false, models: [{ modelId:'deepseek/long-model-name-to-check-wrapping-at-narrow-widths',provider:'deepseek',name:'DeepSeek with a deliberately descriptive model name',local:false,requests:14,inputTokens:123456789,outputTokens:98765432,unreportedCalls:0,limits:null }] } }));
  await page.emulateMedia({ reducedMotion:'reduce' });
  await page.goto('/'); await pairBrowser(page);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await command(page, 'Choose an agent');
    const agents = page.getByRole('dialog', { name:'Agents',exact:true });
    await expect(agents.getByRole('article')).toHaveCount(10);
    const computer = agents.getByRole('article', { name:'Computer agent',exact:true });
    await computer.getByText(/Tools this role can request/).click();
    const select = computer.getByRole('button', { name:'Use Computer agent',exact:true });
    await select.scrollIntoViewIfNeeded(); await expect(select).toBeInViewport();
    expect(await agents.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    if ([360,820,1920].includes(viewport.width)) await page.screenshot({ path:`output/playwright/matrix-agents-${viewport.width}.png` });
    await page.keyboard.press('Escape');
    await command(page,'Choose a model');
    const models = page.getByRole('dialog',{name:'Models & connections',exact:true});
    await expect(models.getByRole('article')).toHaveCount(7);
    for (const name of ['OpenAI','Anthropic','Gemini','Grok (xAI)','DeepSeek']) {
      const row = models.getByRole('article',{name:`${name} connection`,exact:true});
      await row.getByText('Connect provider',{exact:true}).click();
      const input = row.getByLabel('API key',{exact:true});
      await input.scrollIntoViewIfNeeded(); await expect(input).toBeInViewport();
      expect(await models.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    if ([360,820,1920].includes(viewport.width)) await page.screenshot({path:`output/playwright/matrix-providers-${viewport.width}.png`});
    await models.getByRole('button',{name:'Close Models & connections',exact:true}).click();
    await command(page,'Usage');
    const usage = page.getByRole('dialog',{name:'Usage',exact:true});
    await expect(usage.getByText('222,222,221',{exact:true})).toBeVisible();
    await usage.getByText('Remaining tokens not reported by provider',{exact:true}).scrollIntoViewIfNeeded();
    expect(await usage.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if ([360,820,1920].includes(viewport.width)) await page.screenshot({path:`output/playwright/matrix-usage-${viewport.width}.png`});
    await usage.getByRole('button',{name:'Close Usage',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Your objective',exact:true})).toBeVisible();
  }
});
