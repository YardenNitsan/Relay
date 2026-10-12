import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('connection retry waits for one session renewal and keeps errors recoverable',async({page})=>{
  let calls=0,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/session',async route=>{
    calls++;if(calls>1)await held;
    await route.fulfill({status:403,json:{code:'REMOTE_PENDING',error:'Waiting for owner approval.'}});
  });
  try{
    await page.goto('/');const check=page.getByRole('button',{name:'Check approval',exact:true});await expect(check).toBeVisible();
    const before=calls;await check.click();
    await expect(page.getByRole('button',{name:'Checking connection…',exact:true})).toBeDisabled();
    await expect.poll(()=>calls).toBe(before+1);release();
    await expect(check).toBeEnabled();await expect(page.getByRole('heading',{name:'Waiting for host approval',exact:true})).toBeVisible();
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});

for(const [width,height,theme] of [[320,640,'light'],[390,844,'dark'],[844,390,'light'],[1440,1000,'dark']] as const){
  test(`connection entry stays readable and reachable at ${width}px ${theme}`,async({page})=>{
    await page.setViewportSize({width,height});
    await page.addInitScript(theme=>localStorage.setItem('relay:theme:v1',theme),theme);
    await page.route('**/api/session',route=>route.fulfill({status:401,json:{code:'PAIRING_REQUIRED',error:'Pair this browser.'}}));
    await page.goto('/');
    await expect(page.getByRole('heading',{name:'Connect this browser'})).toBeVisible();
    const token=page.getByLabel('One-use pairing token',{exact:true});
    await token.fill('presentation-fixture-only');
    await expect(token).toHaveAttribute('type','password');
    await page.getByRole('button',{name:'Show pairing code',exact:true}).click();
    await expect(token).toHaveAttribute('type','text');
    await expect(token).toHaveValue('presentation-fixture-only');
    await page.getByRole('button',{name:'Hide pairing code',exact:true}).click();
    await expect(token).toHaveAttribute('type','password');
    await expect(page.getByRole('region',{name:'Connection boundary'})).toContainText('The host coordinates execution');
    await page.getByText('Get a pairing token',{exact:true}).click();
    await expect(page.getByText('node launch.mjs --pair',{exact:true})).toBeVisible();
    const submit=page.getByRole('button',{name:'Pair this browser',exact:true});
    await submit.scrollIntoViewIfNeeded();
    expect(await submit.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:`output/playwright/connection-studio-${width}-${theme}.png`,animations:'disabled'});
  });
}

test('pairing exchanges once, clears the secret, and reports an expired invitation',async({page})=>{
  await page.route('**/api/session',route=>route.fulfill({status:401,json:{code:'LAN_PAIRING_REQUIRED',error:'Invitation required.'}}));
  let calls=0,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/session/pair',async route=>{
    calls++;expect(route.request().postDataJSON()).toEqual({token:'fixture-invitation'});
    await held;await route.fulfill({status:401,json:{code:'LAN_PAIRING_REQUIRED',error:'This invitation expired. Ask for another invitation.'}});
  });
  try{
    await page.goto('/');const input=page.getByLabel('One-use invitation code',{exact:true});
    await input.fill('fixture-invitation');await page.getByRole('button',{name:'Show pairing code',exact:true}).click();
    await page.getByRole('button',{name:'Pair this browser',exact:true}).click();
    await expect(input).toHaveValue('');await expect(input).toBeDisabled();await expect(input).toHaveAttribute('type','password');
    await expect(page.getByRole('button',{name:'Pairing browser…'})).toBeDisabled();
    release();await expect(page.getByRole('alert')).toContainText('This invitation expired');
    await expect(input).toBeEnabled();expect(calls).toBe(1);
    expect(await page.evaluate(()=>[...Object.values(localStorage),...Object.values(sessionStorage)].some(value=>String(value).includes('fixture-invitation')))).toBe(false);
    expect(page.url()).not.toContain('fixture-invitation');
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});

for(const [code,status,title] of [['REMOTE_PENDING',403,'Waiting for host approval'],['REMOTE_DENIED',403,'Access is disabled'],['HOST_UNAVAILABLE',503,'The host is unavailable']] as const){
  test(`connection explains ${code} without offering unauthorized pairing`,async({page})=>{
    await page.setViewportSize({width:360,height:740});
    await page.route('**/api/session',route=>route.fulfill({status,json:{code,error:'Fixture connection state.'}}));
    await page.goto('/');await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
    await expect(page.getByLabel('One-use pairing token',{exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:code==='REMOTE_PENDING'?'Check approval':'Try connecting again',exact:true})).toBeVisible();
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  });
}
