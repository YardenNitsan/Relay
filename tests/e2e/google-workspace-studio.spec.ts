import {expect,test,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {openCommands,pairBrowser} from './helpers';

const disconnected={configured:true,connected:false,readOnly:true,storage:'none',scopes:[]};
const configuration={configured:true,clientId:'saved.apps.googleusercontent.com',origins:['http://127.0.0.1:4319'],callbackPath:'/?relay_workspace=1'};
async function openWorkspace(page:Page){
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Google Workspace/}).click();
  return page.getByRole('dialog',{name:'Google Workspace',exact:true});
}
async function fillSetup(page:Page){
  const dialog=page.getByRole('dialog',{name:'Google Workspace',exact:true});
  await dialog.getByText('Owner setup',{exact:true}).click();
  await dialog.getByLabel('Workspace OAuth client ID',{exact:true}).fill('workspace-fixture.apps.googleusercontent.com');
  await dialog.getByLabel('Workspace OAuth client secret',{exact:true}).fill('synthetic-workspace-secret');
  await dialog.getByRole('checkbox',{name:'This OAuth client belongs to a separate Google Cloud project from Gemini.',exact:true}).check();
  return dialog;
}

test('Workspace guard keeps setup credentials until dismissal is confirmed',async({page})=>{
  await page.route('**/api/integrations/google-workspace',route=>route.fulfill({json:disconnected}));
  await page.route('**/api/admin/google-workspace',route=>route.fulfill({json:configuration}));
  await openWorkspace(page);const dialog=await fillSetup(page);
  await dialog.getByRole('button',{name:'Close Google Workspace',exact:true}).click();
  const guard=page.getByRole('dialog',{name:'Unsaved changes',exact:true});await expect(guard).toBeVisible();
  await guard.getByRole('button',{name:'Keep editing',exact:true}).click();
  await expect(dialog.getByLabel('Workspace OAuth client secret',{exact:true})).toHaveValue('synthetic-workspace-secret');
  await dialog.getByText('Owner setup',{exact:true}).click();await expect(guard).toBeVisible();
  await guard.getByRole('button',{name:'Discard edits',exact:true}).click();
  await dialog.getByText('Owner setup',{exact:true}).click();
  await expect(dialog.getByLabel('Workspace OAuth client secret',{exact:true})).toHaveValue('');
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('synthetic-workspace-secret');
});

test('Workspace guard blocks dismissal while application save is pending',async({page})=>{
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/integrations/google-workspace',route=>route.fulfill({json:disconnected}));
  await page.route('**/api/admin/google-workspace',async route=>{if(route.request().method()==='PUT'){await held;await route.fulfill({status:503,json:{error:'Application save unavailable'}});}else await route.fulfill({json:configuration});});
  try{
    await openWorkspace(page);const dialog=await fillSetup(page);
    await dialog.getByRole('button',{name:'Save Workspace application',exact:true}).click();
    await dialog.getByRole('button',{name:'Close Google Workspace',exact:true}).click();
    await expect(dialog.getByText('Wait for the current operation to finish before leaving this view.',{exact:true})).toBeVisible();
    release();await expect(dialog.getByRole('alert')).toContainText('Application save unavailable');
    await expect(dialog.getByLabel('Workspace OAuth client secret',{exact:true})).toHaveValue('synthetic-workspace-secret');
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});

test('Workspace acknowledgement releases setup without waiting for background refresh',async({page})=>{
  let saved=false,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/integrations/google-workspace',async route=>{if(saved)await held;await route.fulfill({json:disconnected});});
  await page.route('**/api/admin/google-workspace',async route=>{
    if(route.request().method()==='PUT'){expect(route.request().postDataJSON()).toEqual({clientId:'workspace-fixture.apps.googleusercontent.com',clientSecret:'synthetic-workspace-secret',separateProjectAccepted:true});saved=true;}
    else if(saved)await held;
    await route.fulfill({json:configuration});
  });
  try{
    await openWorkspace(page);const dialog=await fillSetup(page);
    await dialog.getByRole('button',{name:'Save Workspace application',exact:true}).click();
    await expect(dialog.getByText('Workspace application saved. Each account must connect separately.',{exact:true})).toBeVisible();
    await expect(dialog.getByLabel('Workspace OAuth client secret',{exact:true})).toHaveValue('');
    await expect(dialog.getByLabel('Workspace OAuth client secret',{exact:true})).toBeEnabled();
    await dialog.getByRole('button',{name:'Close Google Workspace',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('dialog',{name:'Unsaved changes',exact:true})).toHaveCount(0);
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});

test('Workspace guard keeps a pending account connection visible and rejects an unsafe redirect',async({page})=>{
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/integrations/google-workspace',route=>route.fulfill({json:disconnected}));
  await page.route('**/api/integrations/google-workspace/start',async route=>{expect(route.request().postDataJSON()).toEqual({origin:'http://127.0.0.1:4319'});await held;await route.fulfill({json:{url:'https://accounts.google.com.evil.test/o/oauth2/v2/auth'}});});
  try{
    const dialog=await openWorkspace(page);await dialog.getByRole('button',{name:'Connect Google account',exact:true}).click();
    await dialog.getByRole('button',{name:'Close Google Workspace',exact:true}).click();
    await expect(dialog.getByText('Wait for the current operation to finish before leaving this view.',{exact:true})).toBeVisible();
    release();await expect(dialog.getByRole('alert')).toContainText('invalid Google sign-in address');
    await expect(dialog.getByRole('button',{name:'Connect Google account',exact:true})).toBeEnabled();
    expect(new URL(page.url()).host).toBe('127.0.0.1:4319');
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});

// Presentation fixtures only. No real Google account or provider read is used.
for(const [width,height,theme] of [[320,740,'light'],[390,844,'dark'],[844,390,'light'],[1440,1000,'dark']] as const){
  test(`Workspace reading uses one focused phone pane at ${width}px ${theme}`,async({page})=>{
    await page.setViewportSize({width,height});await page.addInitScript(theme=>localStorage.setItem('relay:theme:v1',theme),theme);
    let reads=0;
    await page.route('**/api/integrations/google-workspace',route=>route.fulfill({json:{...disconnected,connected:true,storage:'os-keyring'}}));
    await page.route('**/api/integrations/google-workspace/mail/search',route=>{reads++;expect(route.request().postDataJSON()).toEqual({query:'subject:fixture',maxResults:10});return route.fulfill({json:{messages:[{id:'fixture-mail',headers:{subject:'הודעה לקריאה ממוקדת',from:'Fixture sender'},snippet:'Plain-text preview.'}],limited:false}});});
    await page.route('**/api/integrations/google-workspace/mail/read',route=>{reads++;expect(route.request().postDataJSON()).toEqual({id:'fixture-mail'});return route.fulfill({json:{id:'fixture-mail',headers:{subject:'הודעה לקריאה ממוקדת',from:'Fixture sender'},text:'<img src=x onerror=alert(1)>\nA plain-text message.\n'+'Long readable content. '.repeat(60),bodyUnavailable:false,truncated:true}});});
    const dialog=await openWorkspace(page);expect(reads).toBe(0);
    await dialog.getByLabel('Gmail search',{exact:true}).fill('subject:fixture');await dialog.getByRole('button',{name:'Search mail',exact:true}).click();
    const read=dialog.getByRole('button',{name:'Read message',exact:true});await read.click();
    const reader=dialog.getByRole('region',{name:'Selected mail message',exact:true});
    await expect(reader.getByRole('heading',{name:'הודעה לקריאה ממוקדת',exact:true})).toBeFocused();
    await expect(reader.getByRole('heading')).toHaveAttribute('dir','auto');
    await expect(reader.getByText('This message exceeded the read limit; only part is shown.',{exact:true})).toBeVisible();
    await expect(reader.locator('img')).toHaveCount(0);expect(reads).toBe(2);
    if(width<900)await expect(dialog.getByLabel('Gmail search',{exact:true})).toBeHidden();
    expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:`output/playwright/google-workspace-studio-${width}-${theme}.png`,animations:'disabled'});
    await reader.getByRole('button',{name:'Back to mail results',exact:true}).click();await expect(read).toBeFocused();
    await expect(dialog.getByLabel('Gmail search',{exact:true})).toHaveValue('subject:fixture');
  });
}

test('Workspace refresh errors preserve loaded connection and private reading until disconnect',async({page})=>{
  let fail=false,disconnectedAccount=false;
  await page.route('**/api/integrations/google-workspace',route=>{
    if(route.request().method()==='DELETE'){disconnectedAccount=true;return route.fulfill({json:{revoked:false}});}
    return route.fulfill(fail?{status:503,json:{error:'Connection refresh unavailable'}}:{json:{...disconnected,connected:!disconnectedAccount,storage:'os-keyring'}});
  });
  await page.route('**/api/integrations/google-workspace/mail/search',route=>route.fulfill({json:{messages:[{id:'retained',headers:{subject:'Retained preview'},snippet:'Cached private preview.'}],limited:false}}));
  const dialog=await openWorkspace(page);await dialog.getByRole('button',{name:'Search mail',exact:true}).click();
  await expect(dialog.getByText('Retained preview',{exact:true})).toBeVisible();
  fail=true;await dialog.getByRole('button',{name:'Refresh Google Workspace connection',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Connection refresh unavailable');
  await expect(dialog.getByText('Showing the last loaded connection state.',{exact:true})).toBeVisible();
  await expect(dialog.getByText('Retained preview',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Disconnect account',exact:true}).click();
  await expect(dialog.getByText('Relay removed its credential. Google-side revocation was not confirmed; review your Google account permissions.',{exact:true})).toBeVisible();
  await expect(dialog.getByText('Retained preview',{exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Connect Google account',exact:true})).toBeEnabled();
});

test('Workspace authorized Google redirect does not trigger its pending-operation unload guard',async({page})=>{
  let prompts=0;page.on('dialog',async dialog=>{prompts++;await dialog.dismiss();});
  await page.route('**/api/integrations/google-workspace',route=>route.fulfill({json:disconnected}));
  await page.route('**/api/integrations/google-workspace/start',route=>route.fulfill({json:{url:'https://accounts.google.com/o/oauth2/v2/auth?fixture=1'}}));
  await page.route('https://accounts.google.com/o/oauth2/v2/auth?fixture=1',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Intercepted Google redirect</title><p>No real OAuth request.</p>'}));
  const dialog=await openWorkspace(page);await dialog.getByRole('button',{name:'Connect Google account',exact:true}).click();
  await expect(page).toHaveTitle('Intercepted Google redirect');expect(prompts).toBe(0);
});
