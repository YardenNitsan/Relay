import {expect,test} from '@playwright/test';
import {issuePairingToken,openCommands,pairBrowser} from './helpers';

test('notification permission has one pending request across closing and reopening settings',async({page})=>{
  await page.addInitScript(()=>{
    let calls=0,finish!:(value:NotificationPermission)=>void;
    class HeldNotification {static permission:NotificationPermission='default';static requestPermission(){calls++;return new Promise<NotificationPermission>(resolve=>{finish=value=>{HeldNotification.permission=value;resolve(value);};});}}
    Object.defineProperty(window,'Notification',{configurable:true,value:HeldNotification});
    Object.defineProperty(window,'permissionFixture',{value:{calls:()=>calls,finish:(value:NotificationPermission)=>finish(value)}});
  });
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Task notifications/}).click();
  let dialog=page.getByRole('dialog',{name:'Task notifications',exact:true});await dialog.getByRole('button',{name:'Enable system notifications',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Waiting for browser permission',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');await openCommands(page);await page.getByRole('option',{name:/Task notifications/}).click();dialog=page.getByRole('dialog',{name:'Task notifications',exact:true});
  await expect(dialog.getByRole('button',{name:'Waiting for browser permission',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>(window as unknown as {permissionFixture:{calls:()=>number}}).permissionFixture.calls())).toBe(1);
  await page.evaluate(()=>(window as unknown as {permissionFixture:{finish:(value:NotificationPermission)=>void}}).permissionFixture.finish('granted'));
  await expect(dialog.getByRole('button',{name:'Turn off system notifications',exact:true})).toBeEnabled();
});

test('a permission rejection after account revocation cannot publish a stale notice',async({page})=>{
  await page.addInitScript(()=>{
    let reject!:(reason:Error)=>void;
    class HeldNotification {static permission='default';static requestPermission(){return new Promise<NotificationPermission>((_resolve,fail)=>{reject=fail;});}}
    Object.defineProperty(window,'Notification',{configurable:true,value:HeldNotification});Object.defineProperty(window,'rejectPermission',{value:()=>reject(new Error('Permission interrupted'))});
  });
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Task notifications/}).click();
  await page.getByRole('button',{name:'Enable system notifications',exact:true}).click();await page.keyboard.press('Escape');
  await page.route('**/api/usage',route=>route.fulfill({status:401,json:{error:'Fixture account revoked',code:'PAIRING_REQUIRED'}}));
  await openCommands(page);await page.getByRole('option',{name:/^Usage/}).click();await expect(page.getByRole('heading',{name:'Connect this browser',exact:true})).toBeVisible();
  // Re-pair in the same mounted app, then let the old browser prompt reject.
  await page.unrouteAll({behavior:'wait'});await page.getByLabel('One-use pairing token',{exact:true}).fill(await issuePairingToken());await page.getByRole('button',{name:'Pair this browser',exact:true}).click();
  await expect(page.getByText('Local service connected',{exact:true})).toBeVisible();
  await page.evaluate(async()=>{(window as unknown as {rejectPermission:()=>void}).rejectPermission();await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
  await expect(page.getByText('This browser could not enable system notifications. In-app completion alerts remain available.',{exact:true})).toHaveCount(0);
});
