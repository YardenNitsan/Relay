import {expect,test} from '@playwright/test';
import {pairBrowser} from './helpers';

test('balanced auto shows factual review progress then only the answer prose',async({page})=>{
  await page.goto('/');await pairBrowser(page);
  await page.getByLabel('Compute depth').selectOption('balanced');
  await page.getByRole('combobox',{name:'Model',exact:true}).selectOption('');
  await page.getByRole('textbox',{name:'Objective'}).fill('hello how are you today?');
  await page.getByRole('button',{name:'Send objective'}).click();
  await expect(page.getByText('Checking the answer.',{exact:true})).toBeVisible();
  await expect(page.getByText('Completed',{exact:true}).first()).toBeVisible();
  const reply=page.getByRole('article',{name:'Relay response'});
  await expect(reply).toHaveCount(1);
  await expect(reply).toContainText('A deterministic response for browser testing.');
  await expect(page.getByText('Checking the answer.',{exact:true})).toHaveCount(0);
  await expect(reply).not.toContainText('REVIEW:');
  await page.reload();await expect(reply).toHaveCount(1);
  await expect(reply).not.toContainText('objective is fulfilled');
});
