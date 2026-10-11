import {expect,test} from '@playwright/test';
import {openCommands,pairBrowser} from './helpers';

for(const setup of [false,true])test(`Google ${setup?'setup':'disconnect'} acknowledgement releases dismissal before discovery finishes`,async({page})=>{
  let changed=false,refreshHeld=false,release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  const provider={id:'gemini',name:'Gemini',configured:true,connected:true,enabled:true,state:'available',error:null};
  await page.route(/\/api\/models(?:\?.*)?$/,async route=>{
    if(changed){refreshHeld=true;await held;}
    await route.fulfill({json:{models:[],providers:[provider]}});
  });
  await page.route('**/api/providers/gemini/google',route=>{
    if(route.request().method()==='DELETE'){changed=true;return route.fulfill({json:{revoked:true}});}
    return route.fulfill({json:{configured:true,connected:!setup&&!changed,quotaProject:'fixture-project',origins:['http://127.0.0.1:4319'],storage:'none'}});
  });
  await page.route('**/api/admin/google-oauth',route=>{
    if(route.request().method()==='PUT')changed=true;
    return route.fulfill({json:{configured:true,clientId:'fixture.apps.googleusercontent.com',quotaProject:'fixture-project',origins:['http://127.0.0.1:4319']}});
  });
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose a model/}).click();
  const dialog=page.getByRole('dialog',{name:'Models & connections',exact:true});
  await dialog.getByRole('button',{name:'Connections',exact:true}).click();
  const google=dialog.getByRole('region',{name:'Google connection for Gemini',exact:true});
  try{
    if(setup){
      await google.getByText('Host owner: configure Google sign-in',{exact:true}).click();
      const form=google.getByRole('form',{name:'Google sign-in application',exact:true});
      await form.getByLabel('Google OAuth client ID',{exact:true}).fill('fixture.apps.googleusercontent.com');
      await form.getByLabel('Google OAuth client secret',{exact:true}).fill('browser-fixture-secret');
      await form.getByLabel('Google quota project ID',{exact:true}).fill('fixture-project');
      await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Save Google application',exact:true}).click();
    }else await google.getByRole('button',{name:'Disconnect Google',exact:true}).click();
    await expect.poll(()=>refreshHeld).toBe(true);
    await expect(google.getByRole('status')).toContainText(setup?'Google application saved':'Google disconnected');
    await dialog.getByRole('button',{name:'Close Models & connections',exact:true}).click();
    await expect(dialog).toHaveCount(0,{timeout:3000});
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});
