import {expect,test} from '@playwright/test';
import {pairBrowser} from './helpers';

test('activity recovery joins one session renewal and keeps its draft',async({page})=>{
  await page.goto('/');await pairBrowser(page);
  const draft=page.getByRole('textbox',{name:'Your objective',exact:true});await draft.fill('Keep this draft during explicit recovery.');
  let interrupt=true,calls=0,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/events?*',route=>interrupt?route.abort():route.continue());
  await page.route('**/api/session',async route=>{calls++;await held;await route.continue();});
  try{
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await page.getByRole('button',{name:'Reconnect activity',exact:true}).click();
    await expect(page.getByRole('button',{name:'Reconnecting…',exact:true})).toBeDisabled();
    await expect.poll(()=>calls).toBe(1);interrupt=false;release();
    await expect(page.getByText('Local service connected',{exact:true})).toBeVisible();
    await expect(draft).toHaveValue('Keep this draft during explicit recovery.');
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});

test('phone network interruption preserves editable draft and reconnects activity',async({page,context})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await pairBrowser(page);
  await expect(page.getByText('Local service connected',{exact:true})).toBeVisible();
  const draft=page.getByRole('textbox',{name:'Your objective',exact:true});await draft.fill('Keep this phone draft while the connection changes.');
  try{
    await context.setOffline(true);
    await expect(page.getByText('Offline — your draft stays here',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Send objective',exact:true})).toBeDisabled();
    await draft.fill('An edited draft made while offline.');
    await context.setOffline(false);
    await expect(page.getByText('Local service connected',{exact:true})).toBeVisible();
    await expect(draft).toHaveValue('An edited draft made while offline.');
    await expect(page.getByRole('button',{name:'Send objective',exact:true})).toBeEnabled();
  }finally{await context.setOffline(false);}
});

for(const storageAvailable of [true,false])test(`returning to the phone page renews activity without resetting the draft (storage ${storageAvailable?'available':'blocked'})`,async({page})=>{
  if(!storageAvailable)await page.addInitScript(()=>{
    const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
    Storage.prototype.getItem=function(key){if(key==='relay:event-cursor:v1')throw new DOMException('Storage denied','SecurityError');return get.call(this,key);};
    Storage.prototype.setItem=function(key,value){if(key==='relay:event-cursor:v1')throw new DOMException('Storage denied','SecurityError');set.call(this,key,value);};
  });
  const streams:string[]=[];page.on('request',request=>{if(new URL(request.url()).pathname==='/api/events')streams.push(request.url());});
  await page.setViewportSize({width:390,height:844});await page.goto('/');await pairBrowser(page);
  const draft=page.getByRole('textbox',{name:'Your objective',exact:true});await draft.fill('Say hello for the activity replay test.');
  await page.getByRole('button',{name:'Send objective',exact:true}).click();
  await expect(page.getByText('Completed',{exact:true}).first()).toBeVisible();
  await expect(page.locator('.message-assistant .response-copy')).toBeVisible();
  if(storageAvailable)await expect.poll(()=>page.evaluate(()=>Number(sessionStorage.getItem('relay:event-cursor:v1')??0))).toBeGreaterThan(0);
  const saved=storageAvailable?await page.evaluate(()=>Number(sessionStorage.getItem('relay:event-cursor:v1')??0)):0;
  if(storageAvailable)expect(saved).toBeGreaterThan(0);
  await draft.fill('This second draft must survive returning to the app.');const before=streams.length;
  // Deterministic lifecycle simulation; this does not claim physical Android acceptance.
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(()=>streams.length).toBeGreaterThan(before);
  const cursor=Number(new URL(streams.at(-1)!).searchParams.get('after'));expect(cursor).toBeGreaterThan(0);expect(cursor).toBeGreaterThanOrEqual(saved);
  await expect(page.getByText('Local service connected',{exact:true})).toBeVisible();
  await expect(draft).toHaveValue('This second draft must survive returning to the app.');
  await expect(page.locator('.message-assistant .response-copy')).toHaveCount(1);
});
