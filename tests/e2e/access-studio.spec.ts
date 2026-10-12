import {expect,test,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {openCommands,pairBrowser} from './helpers';
const permissions={providers:['ollama'],workspaceIds:[],maxAccess:'read_only',maxConcurrentTasks:1,maxCallsPerTask:4,maxSecondsPerTask:120,dailyCloudBudgetUsd:0,networkOrigins:[],maxNetworkAccess:'deny',mcpServerIds:[]};
const owner={id:'owner',name:'Local owner',email:null,role:'owner',enabled:true,permissions,createdAt:'2026-01-01T00:00:00Z',lastActiveAt:null,registrationStatus:'approved'};
const guest={...owner,id:'studio-guest',name:'Shared account',email:'shared@example.test',role:'chat'};
const pending={...guest,id:'studio-request',name:'Pending account',email:'pending@example.test',enabled:false,registrationStatus:'pending'};
const gateway={enabled:false,configured:false,listening:false,publicOrigin:null,hostName:'Browser fixture host',gatewayPort:4318,authentication:'Cloudflare Access signed application identity',requiresSetup:true,localAccessIndependent:true,savedConfig:null,registration:'invited',restartRequired:false,environmentOverride:false};
async function openAccess(page:Page){
  await page.route('**/api/admin/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(route.request().method()!=='GET')return route.fulfill({status:409,json:{error:'No unconfigured mutation is allowed in this browser fixture'}});
    if(path.endsWith('/users'))return route.fulfill({json:[owner,guest,pending]});
    if(path.endsWith('/sessions'))return route.fulfill({json:[{id:'local-session',userId:'owner',remote:false,userAgent:'Local fixture browser',createdAt:'2026-01-01T00:00:00Z',lastActiveAt:'2026-01-01T01:00:00Z',expiresAt:'2099-01-01T00:00:00Z'},{id:'remote-session',userId:guest.id,remote:true,userAgent:'Remote fixture browser',createdAt:'2026-01-01T00:00:00Z',lastActiveAt:'2026-01-01T01:00:00Z',expiresAt:'2099-01-01T00:00:00Z'}]});
    if(path.endsWith('/tasks'))return route.fulfill({json:[]});
    if(path.endsWith('/remote'))return route.fulfill({json:gateway});
    if(path.endsWith('/lan'))return route.fulfill({json:{configured:false,listening:false,origin:null,error:null}});
    return route.fallback();
  });
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Manage access/}).click();
  return page.getByRole('dialog',{name:'Access & remote connections',exact:true});
}
for(const [width,height] of [[320,740],[360,800],[390,844],[412,915],[844,390],[1440,960]])for(const theme of ['light','dark'])test(`Access Studio honest gateways, people and sessions at ${width} ${theme}`,async({page})=>{
  await page.setViewportSize({width,height});await page.addInitScript(value=>localStorage.setItem('relay:theme:v1',value),theme);
  const dialog=await openAccess(page),nav=dialog.getByRole('navigation',{name:'Access sections',exact:true});
  await expect(dialog.getByText('Remote access is disabled. Local access works independently.',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Enable remote access',exact:true})).toHaveCount(0);
  await page.screenshot({path:`output/playwright/access-studio-gateways-${width}-${theme}.png`,animations:'disabled'});
  await nav.getByRole('button',{name:'People',exact:true}).click();await expect(dialog.getByRole('searchbox',{name:'Search people',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Inspect Local owner',exact:true}).click();await expect(dialog).toContainText('cannot be disabled here');await expect(dialog.getByRole('button',{name:'Save user policy',exact:true})).toHaveCount(0);
  if(width<900)await dialog.getByRole('button',{name:'All people',exact:true}).click();
  await dialog.getByRole('button',{name:'Inspect Shared account',exact:true}).click();await expect(dialog.getByRole('combobox',{name:'Maximum computer access',exact:true})).toHaveValue('read_only');
  await expect(dialog).toContainText('They never grant your credentials or billing account.');
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await page.screenshot({path:`output/playwright/access-studio-person-${width}-${theme}.png`,animations:'disabled'});
  await nav.getByRole('button',{name:'Browser sessions',exact:true}).click();await expect(dialog.getByText('Local fixture browser',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:/Revoke .* session/})).toHaveCount(1);
  await nav.getByRole('button',{name:'Active work',exact:true}).click();await expect(dialog.getByRole('button',{name:'Stop remote work',exact:true})).toBeDisabled();await expect(dialog.getByText('No active tasks reported.',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
});
test('Access Studio guards policy drafts and blocked saves without changing account scope',async({page})=>{
  await page.setViewportSize({width:390,height:844});const dialog=await openAccess(page),nav=dialog.getByRole('navigation',{name:'Access sections',exact:true});
  await nav.getByRole('button',{name:'People',exact:true}).click();await dialog.getByRole('button',{name:'Inspect Shared account',exact:true}).click();await dialog.getByLabel('Calls per task',{exact:true}).fill('6');
  await nav.getByRole('button',{name:'Gateways',exact:true}).click();const guard=page.getByRole('dialog',{name:'Unsaved changes',exact:true});await expect(guard).toBeVisible();await guard.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(dialog.getByLabel('Calls per task',{exact:true})).toHaveValue('6');
  let release:(()=>void)|undefined;const held=new Promise<void>(resolve=>{release=resolve;});let changes=0;
  await page.route(`**/api/admin/users/${guest.id}`,async route=>{changes++;expect(route.request().postDataJSON()).toMatchObject({enabled:true,permissions:{maxCallsPerTask:6,maxAccess:'read_only',providers:['ollama'],workspaceIds:[]}});await held;return route.fulfill({status:503,json:{error:'Policy update unavailable'}});});
  try{
    await dialog.getByRole('button',{name:'Save user policy',exact:true}).click();await expect(nav.getByRole('button',{name:'Gateways',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(dialog).toBeVisible();expect(changes).toBe(1);
    release?.();await expect(dialog.getByRole('alert')).toContainText('Policy update unavailable');await expect(dialog.getByLabel('Calls per task',{exact:true})).toHaveValue('6');
    await nav.getByRole('button',{name:'Gateways',exact:true}).click();await guard.getByRole('button',{name:'Discard edits',exact:true}).click();await nav.getByRole('button',{name:'People',exact:true}).click();await dialog.getByRole('button',{name:'Inspect Shared account',exact:true}).click();await expect(dialog.getByLabel('Calls per task',{exact:true})).toHaveValue('4');
  }finally{release?.();await page.unrouteAll({behavior:'wait'});}
});

test('Access Studio acknowledges complete policy saves independently of a failed catalog refresh',async({page})=>{
  const dialog=await openAccess(page),nav=dialog.getByRole('navigation',{name:'Access sections',exact:true});
  const savedPermissions={...permissions,mcpServerIds:['saved-unavailable-server'],externalModelAccess:true,allowUnpricedCloud:true,networkOrigins:['https://example.test'],maxNetworkAccess:'ask'};
  let saved=false,posts=0;
  await page.route('**/api/admin/users',route=>route.fulfill(saved?{status:503,json:{error:'Catalog refresh unavailable'}}:{json:[owner,{...guest,permissions:savedPermissions},pending]}));
  await page.route(`**/api/admin/users/${guest.id}`,route=>{posts++;expect(route.request().postDataJSON()).toEqual({enabled:true,permissions:{...savedPermissions,maxCallsPerTask:6}});saved=true;return route.fulfill({json:{...guest,permissions:{...savedPermissions,maxCallsPerTask:6}}});});
  await dialog.getByRole('button',{name:'Refresh access information',exact:true}).click();
  await nav.getByRole('button',{name:'People',exact:true}).click();await dialog.getByRole('button',{name:'Inspect Shared account',exact:true}).click();
  await expect(dialog.getByLabel('Allow external model clients',{exact:true})).toBeChecked();
  await dialog.getByLabel('Calls per task',{exact:true}).fill('6');await dialog.getByRole('button',{name:'Save user policy',exact:true}).click();
  await expect(dialog.getByRole('status')).toContainText('User policy updated');await expect(dialog.getByRole('button',{name:'Save user policy',exact:true})).toBeEnabled();
  await expect(dialog.getByLabel('Calls per task',{exact:true})).toHaveValue('6');await expect(dialog.getByText('Unsaved policy changes',{exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Inspect Shared account',exact:true})).toBeVisible();await expect(dialog.getByRole('alert')).toContainText('Catalog refresh unavailable');expect(posts).toBe(1);
  await nav.getByRole('button',{name:'Gateways',exact:true}).click();await expect(page.getByRole('dialog',{name:'Unsaved changes',exact:true})).toHaveCount(0);
});

test('Access Studio preserves gateway drafts across refresh and guards pending configuration',async({page})=>{
  await page.setViewportSize({width:390,height:844});const dialog=await openAccess(page),nav=dialog.getByRole('navigation',{name:'Access sections',exact:true});
  await dialog.getByText('How to enable remote access',{exact:true}).click();const form=dialog.getByRole('form',{name:'Remote gateway configuration',exact:true});
  await form.getByLabel('Public Relay URL',{exact:true}).fill('https://relay.example.test');await form.getByLabel('Cloudflare Access team URL',{exact:true}).fill('https://team.cloudflareaccess.com');await form.getByLabel('Application audience',{exact:true}).fill('audience-fixture');
  await dialog.getByRole('button',{name:'Refresh access information',exact:true}).click();await expect(form.getByLabel('Public Relay URL',{exact:true})).toHaveValue('https://relay.example.test');
  await nav.getByRole('button',{name:'People',exact:true}).click();const guard=page.getByRole('dialog',{name:'Unsaved changes',exact:true});await expect(guard).toBeVisible();await guard.getByRole('button',{name:'Keep editing',exact:true}).click();
  let release:(()=>void)|undefined;const held=new Promise<void>(resolve=>{release=resolve;});let posts=0;
  await page.route('**/api/admin/remote/config',async route=>{posts++;const config=route.request().postDataJSON();expect(config).toEqual({publicOrigin:'https://relay.example.test',issuer:'https://team.cloudflareaccess.com',audience:'audience-fixture',registration:'invited'});await held;return route.fulfill({json:{...gateway,savedConfig:config,restartRequired:true}});});
  try{
    await form.getByRole('button',{name:'Save gateway configuration',exact:true}).click();await expect(nav.getByRole('button',{name:'People',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(dialog).toBeVisible();expect(posts).toBe(1);
    release?.();await expect(form.getByRole('status')).toContainText('Gateway configuration saved');await expect(form.getByRole('button',{name:'Save gateway configuration',exact:true})).toBeEnabled();
    await nav.getByRole('button',{name:'People',exact:true}).click();await expect(guard).toHaveCount(0);await expect(dialog.getByRole('searchbox',{name:'Search people',exact:true})).toBeVisible();
  }finally{release?.();await page.unrouteAll({behavior:'wait'});}
});

test('Access Studio keeps acknowledged session revocation when refresh fails and protects local owner',async({page})=>{
  const dialog=await openAccess(page),nav=dialog.getByRole('navigation',{name:'Access sections',exact:true});await nav.getByRole('button',{name:'Browser sessions',exact:true}).click();
  await expect(dialog.getByText('Remote fixture browser',{exact:true})).toBeVisible();let posts=0;
  await page.route('**/api/admin/sessions',route=>route.fulfill({status:503,json:{error:'Session refresh unavailable'}}));
  await page.route('**/api/admin/sessions/remote-session/revoke',route=>{posts++;return route.fulfill({json:{revoked:true}});});
  await dialog.getByRole('button',{name:'Revoke Shared account session',exact:true}).click();await expect(dialog.getByText('Browser session revoked.',{exact:true})).toBeVisible();
  await expect(dialog.getByText('Remote fixture browser',{exact:true})).toHaveCount(0);await expect(dialog.getByText('Local fixture browser',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:/Revoke .* session/})).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toContainText('Session refresh unavailable');await expect(nav.getByRole('button',{name:'People',exact:true})).toBeEnabled();expect(posts).toBe(1);
  await expect(dialog.getByRole('heading',{name:'Browser sessions',exact:true})).toBeFocused();
});

test('Access Studio discards phone policy review and restores filtered list focus',async({page})=>{
  await page.setViewportSize({width:1440,height:960});const dialog=await openAccess(page);await dialog.getByRole('button',{name:'People',exact:true}).click();await dialog.getByRole('button',{name:'Inspect Shared account',exact:true}).click();await dialog.getByLabel('Calls per task',{exact:true}).fill('6');
  const search=dialog.getByRole('searchbox',{name:'Search people',exact:true});await search.fill('Pending');await dialog.getByLabel('Calls per task',{exact:true}).focus();await page.setViewportSize({width:390,height:844});
  await dialog.getByRole('button',{name:'All people',exact:true}).click();await page.getByRole('dialog',{name:'Unsaved changes',exact:true}).getByRole('button',{name:'Discard edits',exact:true}).click();
  await expect(search).toBeFocused();await expect(search).toHaveValue('Pending');await search.fill('');await dialog.getByRole('button',{name:'Inspect Shared account',exact:true}).click();await expect(dialog.getByLabel('Calls per task',{exact:true})).toHaveValue('4');
  await dialog.getByRole('button',{name:'All people',exact:true}).click();await dialog.getByRole('button',{name:'Add allowed user',exact:true}).click();await expect(page.getByRole('dialog',{name:'Unsaved changes',exact:true})).toHaveCount(0);
});
