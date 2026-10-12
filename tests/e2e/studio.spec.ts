import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {pairBrowser} from './helpers';

for(const width of [390,1440])for(const theme of ['light','dark'] as const) {
  test(`Dispatch navigation preserves work and host context at ${width}px in ${theme}`,async({page})=>{
    await page.addInitScript(value=>localStorage.setItem('relay:theme:v1',value),theme);
    await page.setViewportSize({width,height:900});await page.goto('/');await pairBrowser(page);
    const draft=page.getByRole('textbox',{name:'Objective'});await draft.fill('Keep this objective while I inspect a project.');
    const navigation=page.getByRole('navigation',{name:'Relay navigation'});
    await expect(navigation).toBeVisible();
    await navigation.getByRole('button',{name:'Projects',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Workspaces',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');await expect(draft).toHaveValue('Keep this objective while I inspect a project.');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:`output/playwright/dispatch-conversation-${width}-${theme}.png`});
  });
}

test('Studio welcome adapts to the remaining pane when Workbench opens',async({page})=>{
  await page.setViewportSize({width:701,height:900});await page.goto('/');await pairBrowser(page);
  await page.getByRole('button',{name:'Open execution workbench',exact:true}).click();
  await expect(page.getByRole('complementary',{name:'Task activity'})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Objective'})).toBeHidden();
  await expect(page.getByRole('button',{name:'Close activity',exact:true})).toBeFocused();
  await page.setViewportSize({width:1024,height:900});
  await expect(page.getByRole('textbox',{name:'Objective'})).toBeVisible();
  for(const button of await page.locator('.studio-starting-points button, .studio-connections button').all()) {
    expect(await button.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  }
  expect(await page.locator('.conversation-main').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.screenshot({path:'output/playwright/studio-split-1024.png'});
  await page.getByRole('button',{name:'Close activity',exact:true}).click();
  await expect(page.getByRole('button',{name:'Activity',exact:true})).toBeFocused();
});
