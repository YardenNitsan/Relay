import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {pairBrowser} from './helpers';

test.use({hasTouch:true,isMobile:true});
test('phone conversation separates authors and preserves Hebrew direction in dark mode',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({colorScheme:'dark'});
  await page.goto('/');await pairBrowser(page);
  const objective='הסבר איך המערכת עובדת ושמור את ההודעה שלי בנפרד מהתשובה.';
  await page.getByRole('textbox',{name:'Your objective',exact:true}).fill(objective);
  await page.getByRole('button',{name:'Send objective',exact:true}).click();
  const mine=page.getByRole('article',{name:'Your message',exact:true});
  const response=page.getByRole('article',{name:'Relay response',exact:true});
  await expect(mine).toContainText(objective);
  await expect(mine.locator('.user-message')).toHaveCSS('direction','rtl');
  await expect(response).toContainText('A deterministic response for browser testing.');
  await expect(response.getByText('Completed',{exact:true})).toBeVisible();
  await expect(mine).not.toContainText('A deterministic response for browser testing.');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:'output/playwright/conversation-studio-populated-dark-390.png'});
});
test('workspace navigation clears unconfirmed host access without granting it',async({page})=>{
  await page.goto('/');await pairBrowser(page);
  await page.getByRole('textbox',{name:'Your objective',exact:true}).fill('Keep my draft and read-only permissions.');
  await page.getByRole('button',{name:'Execution options',exact:true}).click();
  await page.getByRole('combobox',{name:'Computer access',exact:true}).selectOption('unrestricted');
  await expect(page.getByRole('region',{name:'Confirm host file access'})).toBeVisible();
  await page.getByRole('button',{name:'Choose workspace',exact:true}).click();
  await page.getByRole('button',{name:'Close Workspaces',exact:true}).click();
  await expect(page.getByRole('button',{name:'Send objective',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Execution options',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Computer access',exact:true})).toHaveValue('read_only');
  await expect(page.getByRole('region',{name:'Confirm host file access'})).toHaveCount(0);
});
test('invalid execution limits stay visible and focused until corrected',async({page})=>{
  await page.goto('/');await pairBrowser(page);
  await page.getByRole('button',{name:'Execution options',exact:true}).click();
  const maximum=page.getByRole('spinbutton',{name:'Maximum calls',exact:true});
  await maximum.fill('0');
  await page.getByRole('button',{name:'Close Execution options',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Execution options',exact:true})).toBeVisible();
  await expect(maximum).toBeFocused();
  await maximum.fill('8');
  await page.getByRole('button',{name:'Close Execution options',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Execution options',exact:true})).toHaveCount(0);
});
test('workspace preparation blocks settings navigation until the mutation resolves',async({page})=>{
  await page.goto('/');await pairBrowser(page);
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/workspaces',async route=>{
    if(route.request().method()!=='POST'){await route.continue();return;}
    await pending;await route.continue();
  });
  try{
    await page.getByRole('button',{name:'Execution options',exact:true}).click();
    const access=page.getByRole('combobox',{name:'Computer access',exact:true});
    await access.selectOption('supervised');
    await expect(page.getByRole('button',{name:'Choose workspace',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Close Execution options',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Execution options',exact:true})).toContainText('Wait for the current operation');
    release();await expect(access).toHaveValue('supervised');
    await page.getByRole('button',{name:'Close Execution options',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Execution options',exact:true})).toHaveCount(0);
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});
test('visible viewport resize preserves phone draft and reachable settings controls',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>{
    const viewport=Object.assign(new EventTarget(),{height:844,offsetTop:0,scale:1});
    Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
  });
  await page.goto('/');await pairBrowser(page);
  const editor=page.getByRole('textbox',{name:'Your objective',exact:true});await editor.fill('Keep this draft while the keyboard changes the viewport.');
  await page.evaluate(()=>{Object.assign(window.visualViewport!,{height:380,offsetTop:0});window.visualViewport!.dispatchEvent(new Event('resize'));});
  await expect.poll(async()=>Math.round((await page.locator('.studio-frame').boundingBox())!.height)).toBe(380);
  const send=await page.getByRole('button',{name:'Send objective',exact:true}).boundingBox();expect(send!.y+send!.height).toBeLessThanOrEqual(380);
  await page.getByRole('button',{name:'Execution options',exact:true}).click();
  const close=page.getByRole('button',{name:'Close Execution options',exact:true});const box=await close.boundingBox();expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(380);
  await close.click();await page.evaluate(()=>{Object.assign(window.visualViewport!,{height:844});window.visualViewport!.dispatchEvent(new Event('resize'));});
  await expect.poll(async()=>Math.round((await page.locator('.studio-frame').boundingBox())!.height)).toBe(844);
  await expect(editor).toHaveValue('Keep this draft while the keyboard changes the viewport.');
});
for(const width of [320,360,390,412,768])test(`touch composer preserves reading space and multiline drafts at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.goto('/');await pairBrowser(page);
  let sent=0;page.on('request',request=>{if(request.method()==='POST'&&/\/api\/conversations(?:\/start|\/[^/]+\/messages)$/.test(new URL(request.url()).pathname))sent++;});
  const editor=page.getByRole('textbox',{name:'Your objective',exact:true});
  await editor.fill('First line\nSecond line\nThird line');await editor.press('Enter');await editor.pressSequentially('Fourth line');
  await expect(editor).toHaveValue('First line\nSecond line\nThird line\nFourth line');expect(sent).toBe(0);
  expect((await page.locator('.composer-area').boundingBox())!.height).toBeLessThanOrEqual(250);
  await page.getByRole('button',{name:'Execution options',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'Execution options',exact:true});await expect(settings).toBeVisible();
  await expect(settings.getByRole('combobox',{name:'Computer access',exact:true})).toHaveValue('read_only');
  await settings.getByRole('combobox',{name:'Compute depth',exact:true}).selectOption('fast');
  await settings.getByRole('button',{name:'Close Execution options',exact:true}).click();
  await expect(page.getByRole('button',{name:'Execution options',exact:true})).toBeFocused();
  await expect(editor).toHaveValue('First line\nSecond line\nThird line\nFourth line');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:`output/playwright/conversation-studio-${width}.png`});
});
