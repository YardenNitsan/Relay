import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {pairBrowser,openCommands} from './helpers';
import type {HardwareSnapshot} from '../../shared/types';

const snapshot:HardwareSnapshot={sampledAt:new Date().toISOString(),platform:'test',architecture:'x64',memoryArchitecture:'unknown',cpu:{name:'Browser telemetry fixture',physicalCores:4,logicalCores:8,utilization:null},memory:{totalBytes:8*1024**3,availableBytes:4*1024**3,swapTotalBytes:null,swapUsedBytes:null},gpus:[],storage:null,warnings:['Deterministic browser fixture; native telemetry is verified separately.']};

test('unavailable hardware measurements remain truthful and have valid accessibility semantics',async({page})=>{
  // This case verifies unknown-value semantics, not native telemetry discovery.
  // Waiting on the runner's WMI/GPU probes made the supposedly controlled state
  // depend on OS latency before the accessibility assertion could execute.
  await page.route('**/api/hardware',route=>route.fulfill({status:200,json:snapshot}));
  await page.goto('/');await pairBrowser(page);await openCommands(page);
  await page.getByRole('option',{name:/Inspect this machine/}).click();
  const block=page.locator('.meter-block').filter({hasText:'Swap / pagefile in use'});
  await expect(block).toContainText('Unavailable');
  expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
});

for(const width of [320,390,1440])test(`owner cleanup preview stays explicit at ${width}px`,async({page})=>{
  // Native telemetry is unrelated to the real retention API exercised here.
  await page.route('**/api/hardware',route=>route.fulfill({status:200,json:snapshot}));
  await page.setViewportSize({width,height:900});await page.goto('/');await pairBrowser(page);
  await openCommands(page);await page.getByRole('option',{name:/Inspect this machine/}).click();
  await page.getByText('Data retention',{exact:true}).click();
  const preview=page.getByRole('button',{name:'Preview cleanup',exact:true});await expect(preview).toBeDisabled();
  await page.getByLabel('Expired sessions, invitations and unused client tokens').check();
  await preview.click();
  const region=page.getByRole('region',{name:'Cleanup preview'});await expect(region).toBeVisible();await expect(region).toBeFocused();
  await expect(page.getByRole('button',{name:'Apply reviewed cleanup',exact:true})).toBeDisabled();
  await page.getByLabel('Older than (days)').fill('30');await expect(region).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:`output/playwright/retention-${width}.png`});
});
