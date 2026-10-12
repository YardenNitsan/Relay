import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {openCommands,pairBrowser} from './helpers';

for(const width of [320,1440])test(`observed call timing stays readable at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  // Presentation fixture: these numbers are deliberately not a benchmark.
  await page.route('**/api/tasks/*/timing',route=>route.fulfill({json:{elapsedMs:2400,queueMs:50,executionAccountedMs:2300,approvalWaitMs:0,resourceWaitMs:0,modelCallWallMs:2000,toolWallMs:0,activeWaitKind:null,activeWaitElapsedMs:null,truncated:{calls:false,tools:false,checks:false},calls:[{id:'timing-fixture',durationMs:2000,loadDurationMs:null,loadWallMs:900,firstContentMs:1100,streamWallMs:1000,cleanupWallMs:100,firstTextEventMs:1150,generationTokensPerSecond:20}]}}));
  await page.goto('/');await pairBrowser(page);await page.getByRole('textbox',{name:'Objective'}).fill('Explain the timing view');await page.getByRole('button',{name:'Send objective'}).click();
  await expect(page.getByText('Completed',{exact:true}).first()).toBeVisible();await page.getByRole('button',{name:'Activity',exact:true}).click();
  const overview=page.getByRole('region',{name:'Execution overview'});await overview.getByText('Where the time went',{exact:true}).click();await overview.getByText('Model call measurements',{exact:true}).click();
  await expect(overview.getByText('First streamed content',{exact:true})).toBeVisible();await expect(overview.getByText('Verified model cleanup',{exact:true})).toBeVisible();
  await expect(overview).toContainText('not an exact internal first token');
  expect(await overview.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('owner can download a bounded diagnostic bundle from a phone',async({page})=>{
  await page.setViewportSize({width:320,height:740});
  await page.goto('/');await pairBrowser(page);await openCommands(page);
  await page.getByRole('option',{name:/Inspect this machine/}).click();
  await page.getByRole('button',{name:'Recovery',exact:true}).click();
  const pending=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export diagnostic bundle',exact:true}).click();
  const download=await pending;
  expect(download.suggestedFilename()).toBe('relay-diagnostics.json');
  const path=await download.path();expect(path).not.toBeNull();
  const bundle=JSON.parse(await readFile(path!,'utf8'));
  expect(bundle).toMatchObject({format:1,scope:'own_account',window:{days:7}});
  expect(bundle.tasks.length).toBeLessThanOrEqual(200);
  for(const task of bundle.tasks){
    expect(task).not.toHaveProperty('objective');expect(task).not.toHaveProperty('result');
    expect(task).not.toHaveProperty('options');expect(task).not.toHaveProperty('error');
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
