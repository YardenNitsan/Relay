import {expect,test,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {openCommands,pairBrowser} from './helpers';

const grant={id:'fixture-client-grant',label:'Research workstation — תחנת עבודה',createdAt:'2026-05-10T10:00:00Z',expiresAt:'2099-05-10T10:00:00Z',lastUsedAt:null};
const access={enabled:true,tokens:[grant],endpoints:{local:'http://127.0.0.1:4315/v1',lan:'https://relay.example.invalid/v1'}};
async function openClients(page:Page){await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Connect an external client/}).click();return page.getByRole('dialog',{name:'External clients',exact:true});}
async function creation(page:Page){const dialog=page.getByRole('dialog',{name:'External clients',exact:true});await dialog.getByRole('button',{name:'New client token',exact:true}).click();await expect(dialog.getByRole('form',{name:'Create client token',exact:true})).toBeVisible();return dialog;}

// Synthetic token metadata exercises presentation only. clients.spec.ts retains
// real token issuance, account scoping, metadata-only reads and revocation.
for(const [width,height,theme] of [[320,740,'light'],[390,844,'dark'],[844,390,'light'],[1440,1000,'dark']] as const)test(`client grants remain readable at ${width}px ${theme}`,async({page})=>{
  await page.setViewportSize({width,height});await page.addInitScript(theme=>localStorage.setItem('relay:theme:v1',theme),theme);
  await page.route('**/api/inference/tokens',route=>route.fulfill({json:access}));
  const dialog=await openClients(page);
  await expect(dialog.getByRole('article',{name:`${grant.label} token`,exact:true})).toBeVisible();
  await expect(dialog.getByText(grant.label,{exact:true})).toHaveAttribute('dir','auto');
  expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:`output/playwright/clients-studio-${width}-${theme}.png`});
  await dialog.getByRole('button',{name:'New client token',exact:true}).click();
  await expect(dialog.getByLabel('Application label',{exact:true})).toBeFocused();
  await expect(dialog.getByRole('article',{name:`${grant.label} token`,exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Cancel creation',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'New client token',exact:true})).toBeFocused();
});

test('client creation draft survives guarded dismissal',async({page})=>{
  await page.route('**/api/inference/tokens',route=>route.fulfill({json:access}));
  await openClients(page);const dialog=await creation(page);
  await dialog.getByLabel('Application label',{exact:true}).fill('Keep this unsaved client');
  await dialog.getByRole('button',{name:'Close External clients',exact:true}).click();
  const guard=page.getByRole('dialog',{name:'Unsaved changes',exact:true});await expect(guard).toBeVisible();
  await guard.getByRole('button',{name:'Keep editing',exact:true}).click();
  await expect(dialog.getByLabel('Application label',{exact:true})).toHaveValue('Keep this unsaved client');
});

test('acknowledged revocation removes the grant before background refresh finishes',async({page})=>{
  let revoked=false,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/inference/tokens',async route=>{if(revoked){await held;await route.fulfill({status:503,json:{error:'Grant refresh unavailable'}});}else await route.fulfill({json:access});});
  await page.route(`**/api/inference/tokens/${grant.id}`,async route=>{expect(route.request().method()).toBe('DELETE');revoked=true;await route.fulfill({json:{revoked:true}});});
  try{
    const dialog=await openClients(page);await dialog.getByRole('button',{name:`Revoke ${grant.label} token`,exact:true}).click();
    await expect(dialog.getByRole('article',{name:`${grant.label} token`,exact:true})).toHaveCount(0);
    await expect(dialog.getByRole('status')).toContainText('Client token revoked.');
    await expect(dialog.getByRole('button',{name:'New client token',exact:true})).toBeEnabled();
    release();await expect(dialog.getByRole('alert')).toContainText('Grant refresh unavailable');
    await expect(dialog.getByRole('article',{name:`${grant.label} token`,exact:true})).toHaveCount(0);
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});

test('one-time token receipt survives refresh failure and is never persisted',async({page})=>{
  const secret='synthetic-browser-test-secret-not-a-credential';let issued=false;
  await page.route('**/api/inference/tokens',async route=>{
    if(route.request().method()==='POST'){expect(route.request().postDataJSON()).toEqual({label:'Receipt client',expiresInDays:2});issued=true;await route.fulfill({json:{id:'receipt-fixture',token:secret,expiresAt:grant.expiresAt}});}
    else if(issued)await route.fulfill({status:503,json:{error:'Saved grant refresh unavailable'}});
    else await route.fulfill({json:access});
  });
  await openClients(page);const dialog=await creation(page);
  await dialog.getByLabel('Application label',{exact:true}).fill('Receipt client');await dialog.getByLabel('Expires in days',{exact:true}).fill('2');
  await dialog.getByRole('button',{name:'Create token',exact:true}).click();
  const receipt=dialog.getByRole('region',{name:'New client token',exact:true});
  await expect(receipt.getByLabel('New API token',{exact:true})).toHaveValue(secret);
  await expect(dialog.getByRole('alert')).toContainText('Saved grant refresh unavailable');
  await expect(receipt.getByLabel('New API token',{exact:true})).toHaveAttribute('type','password');
  expect(await page.evaluate(value=>[...Object.values(localStorage),...Object.values(sessionStorage)].some(entry=>String(entry).includes(value)),secret)).toBe(false);
  await expect(receipt).toContainText('cannot be shown again');
  await dialog.getByRole('button',{name:'Done, hide token',exact:true}).click();
  await expect(dialog.getByLabel('New API token',{exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('article',{name:'Receipt client token',exact:true})).toBeVisible();
});

test('client issuance blocks dismissal and duplicate requests until its acknowledgement',async({page})=>{
  let attempts=0,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/inference/tokens',async route=>{
    if(route.request().method()==='POST'){attempts++;await held;await route.fulfill({json:{id:'pending-receipt',token:'synthetic-pending-receipt',expiresAt:grant.expiresAt}});}
    else await route.fulfill({json:access});
  });
  try{
    await openClients(page);const dialog=await creation(page);
    await dialog.getByLabel('Application label',{exact:true}).fill('Pending client');
    await dialog.getByRole('button',{name:'Create token',exact:true}).click();
    await expect(dialog.getByLabel('Application label',{exact:true})).toBeDisabled();
    await dialog.getByRole('button',{name:'Close External clients',exact:true}).click();
    await expect(dialog.getByText('Wait for the current operation to finish before leaving this view.',{exact:true})).toBeVisible();
    expect(attempts).toBe(1);release();
    await expect(dialog.getByLabel('New API token',{exact:true})).toHaveValue('synthetic-pending-receipt');
    await expect(dialog.getByRole('button',{name:'Done, hide token',exact:true})).toBeEnabled();
    expect(attempts).toBe(1);
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});

test('revoking the last grant with inference disabled restores focus to the grant heading',async({page})=>{
  let revoked=false;
  await page.route('**/api/inference/tokens',route=>route.fulfill({json:{...access,enabled:false,tokens:revoked?[]:[grant]}}));
  await page.route(`**/api/inference/tokens/${grant.id}`,route=>{expect(route.request().method()).toBe('DELETE');revoked=true;return route.fulfill({json:{revoked:true}});});
  const dialog=await openClients(page);await expect(dialog.getByRole('button',{name:'New client token',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:`Revoke ${grant.label} token`,exact:true}).click();
  await expect(dialog.getByRole('article',{name:`${grant.label} token`,exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('heading',{name:'Your client grants',exact:true})).toBeFocused();
});

for(const clipboard of ['unavailable','denied'] as const)test(`client receipt permits manual copying when clipboard is ${clipboard}`,async({page})=>{
  await page.addInitScript(mode=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:mode==='unavailable'?undefined:{writeText:async()=>{throw new DOMException('Clipboard permission denied','NotAllowedError');}}}),clipboard);
  const secret='synthetic-manual-copy-token';
  await page.route('**/api/inference/tokens',route=>route.fulfill({json:route.request().method()==='POST'?{id:'manual-receipt',token:secret,expiresAt:grant.expiresAt}:access}));
  await openClients(page);const dialog=await creation(page);
  await dialog.getByLabel('Application label',{exact:true}).fill('Manual copy client');await dialog.getByRole('button',{name:'Create token',exact:true}).click();
  const field=dialog.getByLabel('New API token',{exact:true});await expect(field).toHaveAttribute('type','password');
  await dialog.getByRole('button',{name:'Copy token',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Choose Show token');
  const show=dialog.getByRole('button',{name:'Show token',exact:true});expect((await show.boundingBox())!.height).toBeGreaterThanOrEqual(44);await show.click();
  await expect(field).toHaveAttribute('type','text');await field.focus();
  expect(await field.evaluate(input=>({start:(input as HTMLInputElement).selectionStart,end:(input as HTMLInputElement).selectionEnd}))).toEqual({start:0,end:secret.length});
  expect(page.url()).not.toContain(secret);
  expect(await page.evaluate(value=>[...Object.values(localStorage),...Object.values(sessionStorage)].some(entry=>String(entry).includes(value)),secret)).toBe(false);
  await dialog.getByRole('button',{name:'Hide token',exact:true}).click();await expect(field).toHaveAttribute('type','password');
  await show.click();await dialog.getByRole('button',{name:'Done, hide token',exact:true}).click();
  await creation(page);await dialog.getByLabel('Application label',{exact:true}).fill('Second manual client');await dialog.getByRole('button',{name:'Create token',exact:true}).click();
  await expect(field).toHaveAttribute('type','password');
});
