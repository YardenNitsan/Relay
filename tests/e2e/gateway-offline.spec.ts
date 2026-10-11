import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {offlinePage} from '../../deploy/cloudflare/offline-page';

for(const colorScheme of ['light','dark'] as const)test(`protected gateway recovery document is usable at320px in ${colorScheme}`,async({page})=>{
  await page.setViewportSize({width:320,height:640});await page.emulateMedia({colorScheme});
  const response=offlinePage(),body=await response.text();
  await page.route('**/*',route=>route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body}));
  await page.goto('/');await expect(page.getByRole('heading',{name:'Your Relay host is unavailable'})).toBeVisible();
  const retry=page.getByRole('link',{name:'Try again'});await retry.focus();await expect(retry).toBeFocused();
  expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:`output/playwright/gateway-offline-320-${colorScheme}.png`});
});
