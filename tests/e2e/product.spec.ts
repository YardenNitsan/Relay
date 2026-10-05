import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('heading',{name:/What should we/})).toBeVisible();
  await expect(page.getByText('Local service connected',{exact:true})).toBeVisible();
});
test('conversation streams, persists on reload, and exposes the real execution record',async({page})=>{
  await page.getByRole('textbox',{name:'Objective'}).fill('Explain the execution model');
  await page.getByRole('button',{name:'Send objective'}).click();
  await expect(page.getByText('A deterministic response for browser testing.',{exact:false})).toBeVisible();
  await expect(page.getByText('Completed',{exact:true}).first()).toBeVisible({timeout:20000});
  const url=page.url();expect(url).toContain('conversation=');
  await page.reload();await expect(page.getByText('A deterministic response for browser testing.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Activity',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Behind the work'})).toBeVisible();
  await page.getByRole('tab',{name:'Verification'}).click();
  await expect(page.getByText(/no objective external verification/)).toBeVisible();
});
test('supervised file write waits for approval and displays an actual diff',async({page})=>{
  await page.getByRole('button',{name:/Bring a project/}).click();
  await page.getByRole('textbox',{name:'Name',exact:true}).fill('Browser acceptance');
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();
  await expect(page.getByText('Browser acceptance',{exact:true}).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByLabel('Computer access').selectOption('supervised');
  await page.getByRole('textbox',{name:'Objective'}).fill('Create a notes file and verify the content');
  await page.getByRole('button',{name:'Send objective'}).click();
  await page.getByRole('button',{name:'Activity',exact:true}).click();
  await expect(page.getByRole('button',{name:'Allow once',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Allow once',exact:true}).click();
  await expect(page.getByText('Completed',{exact:true}).first()).toBeVisible({timeout:20000});
  await page.getByRole('tab',{name:/^Changes/}).click();
  await expect(page.getByLabel('Unified diff for notes.txt')).toContainText('+Verified fixture content');
});
test('emergency stop is immediate and stays latched until owner resumes',async({page})=>{
  await page.getByRole('textbox',{name:'Objective'}).fill('Give a slow response');
  await page.getByRole('button',{name:'Send objective'}).click();
  await page.getByRole('button',{name:'Stop all',exact:true}).click();
  await expect(page.getByRole('button',{name:'Stopped',exact:true})).toBeDisabled();
  await page.reload();await expect(page.getByRole('button',{name:'Stopped',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Resume Relay'}).click();
  await expect(page.getByRole('button',{name:'Stop all',exact:true})).toBeEnabled();
});
test('keyboard command palette restores focus and the main page passes automated accessibility checks',async({page})=>{
  await page.getByRole('button',{name:'Open command palette'}).focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Open command palette'})).toBeFocused();
  const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
});
for(const viewport of [{width:1920,height:1080},{width:1440,height:900},{width:1024,height:768},{width:820,height:1180},{width:768,height:650},{width:390,height:844},{width:320,height:640},{width:844,height:390}]) {
  test(`responsive controls and sheets ${viewport.width}x${viewport.height}`,async({page})=>{
    await page.setViewportSize(viewport);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await expect(page.getByRole('textbox',{name:'Objective'})).toBeVisible();
    await page.getByRole('button',{name:'Open command palette'}).click();
    await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
    const themeButton=page.getByRole('button',{name:/Switch to dark theme/});
    if(await themeButton.isVisible())await themeButton.click();
    else {
      await page.getByRole('button',{name:'Open command palette'}).click();
      await page.getByRole('option',{name:/Switch to dark theme/}).click();
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    await page.screenshot({path:`output/playwright/relay-${viewport.width}x${viewport.height}.png`,fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  });
}
