import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {toggleExecutionOptions,openCommands,pairBrowser} from './helpers';

// Consent controls only: connection metadata is mocked; no mailbox is queried.
for(const width of [320,390,1440])test(`Workspace task consent is explicit and preserves local-only boundaries at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await page.goto('/');await pairBrowser(page);
 let privateReads=0,submitted:Record<string,unknown>|undefined;
 await page.route('**/api/integrations/google-workspace**',route=>{if(route.request().method()!=='GET')privateReads++;return route.fulfill({json:{configured:true,connected:true,readOnly:true,storage:'os-keyring',scopes:[]}});});
 await toggleExecutionOptions(page);
 const mail=page.getByRole('checkbox',{name:'Allow Gmail search and message reads'}),calendar=page.getByRole('checkbox',{name:'Allow primary-calendar events and availability reads'});
 await expect(mail).toBeEnabled();await expect(mail).not.toBeChecked();await expect(calendar).not.toBeChecked();
 await page.getByRole('combobox',{name:'Cloud sharing',exact:true}).selectOption('allow');await expect(mail).toBeDisabled();await expect(calendar).toBeDisabled();await expect(page.getByRole('combobox',{name:'Cloud sharing',exact:true})).toHaveValue('allow');
 await page.getByRole('combobox',{name:'Cloud sharing',exact:true}).selectOption('local_only');await mail.check();await expect(calendar).toBeEnabled();
 await expect(page.getByText('This conversation and later tasks stay local-only',{exact:false})).toBeVisible();
 await page.getByRole('combobox',{name:'Public web requests',exact:true}).selectOption('ask');await expect(calendar).toBeDisabled();await expect(mail).toBeChecked();await page.getByRole('combobox',{name:'Public web requests',exact:true}).selectOption('deny');await calendar.check();
 expect(privateReads).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.route('**/api/conversations/start',route=>{submitted=route.request().postDataJSON();return route.fulfill({status:409,json:{error:'Fixture intercepted task; no inference started.'}});});
 await toggleExecutionOptions(page);await page.getByRole('textbox',{name:'Objective'}).fill('Read my selected account items.');await page.getByRole('button',{name:'Send objective'}).click();
 await expect.poll(()=>submitted).toBeTruthy();expect(submitted?.options).toMatchObject({googleWorkspace:{mail:true,calendar:true},cloudPolicy:'local_only',access:'read_only',budget:{localOnly:true},network:{mode:'deny'}});expect(privateReads).toBe(0);
});

// Browser interaction fixtures only: no real Google account, consent or API reads.
for(const width of [320,1440])test(`Google reads require explicit action and remain plain text at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto('/');await pairBrowser(page);
  let connected=true,reads=0;const requests:Array<{path:string;body:unknown}>=[];
  await page.route('**/api/integrations/google-workspace**',route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();
    if(path.endsWith('/google-workspace')){if(method==='DELETE'){connected=false;return route.fulfill({json:{revoked:true}});}return route.fulfill({json:{configured:true,connected,readOnly:true,storage:'os-keyring',scopes:[]}});}
    reads++;requests.push({path,body:route.request().postDataJSON()});
    if(path.endsWith('/mail/search'))return route.fulfill({json:{messages:[{id:'fixture-message',threadId:'thread',snippet:'A synthetic email preview.',headers:{from:'Fixture sender',subject:'<script>not executable</script>'}}],nextPageToken:null,limited:false,untrusted:true}});
    if(path.endsWith('/mail/read'))return route.fulfill({json:{id:'fixture-message',headers:{subject:'Fixture message'},text:'<img src=x onerror=alert(1)>\nSynthetic plain-text body.',bodyUnavailable:false,truncated:false,attachmentsExcluded:true,untrusted:true}});
    if(path.endsWith('/calendar/events'))return route.fulfill({json:{calendarId:'primary',events:[{id:'event',status:'confirmed',summary:'Synthetic meeting',description:'Review notes',location:'Local office',start:{date:null,dateTime:'2026-10-10T12:00:00Z',timeZone:'UTC'},end:{date:null,dateTime:'2026-10-10T13:00:00Z',timeZone:'UTC'}}],nextPageToken:null,limited:false,untrusted:true}});
    return route.fulfill({json:{calendars:[{id:'primary',available:false,busy:null}],untrusted:true}});
  });
  await openCommands(page);await page.getByRole('option',{name:/Google Workspace/}).click();
  const dialog=page.getByRole('dialog',{name:'Google Workspace',exact:true});await expect(dialog.getByText('Connected for read-only access.',{exact:true})).toBeVisible();expect(reads).toBe(0);
  await dialog.getByLabel('Gmail search',{exact:true}).fill('subject:fixture');await dialog.getByRole('button',{name:'Search mail',exact:true}).click();
  await expect(dialog.getByText('<script>not executable</script>',{exact:true})).toBeVisible();expect(reads).toBe(1);
  await dialog.getByRole('button',{name:'Read message',exact:true}).click();await expect(dialog.getByText('<img src=x onerror=alert(1)>',{exact:false})).toBeVisible();expect(await dialog.locator('img').count()).toBe(0);
  await dialog.getByRole('button',{name:'Close Google Workspace',exact:true}).click();await openCommands(page);await page.getByRole('option',{name:/Google Workspace/}).click();
  await expect(dialog.getByText('Connected for read-only access.',{exact:true})).toBeVisible();await expect(dialog.getByText('Synthetic plain-text body.',{exact:false})).toHaveCount(0);await expect(dialog.getByLabel('Gmail search',{exact:true})).toHaveValue('');expect(reads).toBe(2);
  await dialog.getByRole('button',{name:'Calendar',exact:true}).click();expect(reads).toBe(2);
  await dialog.getByRole('button',{name:'Read events',exact:true}).click();await expect(dialog.getByText('Synthetic meeting',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Check availability',exact:true}).click();await expect(dialog.getByText('Availability could not be verified.',{exact:true})).toBeVisible();
  expect(requests[0].body).toEqual({query:'subject:fixture',maxResults:10});expect(requests[1].body).toEqual({id:'fixture-message'});
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await dialog.getByRole('button',{name:'Disconnect account',exact:true}).click();await expect(dialog.getByText('Google Workspace disconnected.',{exact:true})).toBeVisible();await expect(dialog.getByText('Synthetic meeting',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toMatch(/Synthetic plain-text|subject:fixture/);
});

test('Workspace OAuth setup requires separate project acknowledgement and validates redirect destination',async({page})=>{
  await page.setViewportSize({width:320,height:900});await page.goto('/');await pairBrowser(page);let configured=false,saved:unknown;
  await page.route('**/api/integrations/google-workspace',route=>route.fulfill({json:{configured,connected:false,readOnly:true,storage:'none',scopes:[]}}));
  await page.route('**/api/admin/google-workspace',route=>{if(route.request().method()==='PUT'){configured=true;saved=route.request().postDataJSON();}return route.fulfill({json:{configured,clientId:null,origins:['http://127.0.0.1:4319'],callbackPath:'/?relay_workspace=1',readOnly:true,scopes:[],separateProjectAcknowledged:configured}});});
  await page.route('**/api/integrations/google-workspace/start',route=>route.fulfill({json:{url:'https://unexpected.example.test/oauth'}}));
  await openCommands(page);await page.getByRole('option',{name:/Google Workspace/}).click();
  const dialog=page.getByRole('dialog',{name:'Google Workspace',exact:true});await dialog.getByText('Owner setup',{exact:true}).click();
  await dialog.getByLabel('Workspace OAuth client ID',{exact:true}).fill('workspace-fixture.apps.googleusercontent.com');await dialog.getByLabel('Workspace OAuth client secret',{exact:true}).fill('workspace-ui-fixture-secret');
  await expect(dialog.getByRole('button',{name:'Save Workspace application',exact:true})).toBeDisabled();await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Save Workspace application',exact:true}).click();
  await expect(dialog.getByText('Workspace application saved. Each account must connect separately.',{exact:true})).toBeVisible();expect(saved).toEqual({clientId:'workspace-fixture.apps.googleusercontent.com',clientSecret:'workspace-ui-fixture-secret',separateProjectAccepted:true});await expect(dialog.getByLabel('Workspace OAuth client secret',{exact:true})).toHaveValue('');
  await dialog.getByRole('button',{name:'Connect Google account',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('invalid Google sign-in address');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const denied of [false,true])test(`Workspace callback ${denied?'denial':'success'} clears sensitive URL and exchanges once`,async({page})=>{
  await page.goto('/');await pairBrowser(page);let calls=0;
  await page.route('**/api/integrations/google-workspace/complete',route=>{calls++;expect(route.request().postDataJSON()).toEqual(denied?{state:'workspace-state-fixture',error:'access_denied'}:{state:'workspace-state-fixture',code:'workspace-code-fixture'});return route.fulfill(denied?{status:400,json:{error:'Google Workspace consent was denied.'}}:{json:{configured:true,connected:true,readOnly:true,storage:'os-keyring',scopes:[]}});});
  await page.goto(`/?relay_workspace=1&state=workspace-state-fixture&${denied?'error=access_denied':'code=workspace-code-fixture'}&scope=private-workspace-scope`);
  const result=page.getByRole(denied?'alert':'status',{name:'Google Workspace sign-in result',exact:true});await expect(result).toContainText(denied?'consent was denied':'Google Workspace connected');expect(calls).toBe(1);await expect(page).toHaveURL('http://127.0.0.1:4319/');expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toMatch(/workspace-code-fixture|workspace-state-fixture|private-workspace-scope/);
});
