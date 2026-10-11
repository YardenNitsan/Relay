import {expect,test} from '@playwright/test';
import {openCommands,pairBrowser} from './helpers';

test('provider credential draft survives navigation and pending save protects dismissal',async({page})=>{
  await page.setViewportSize({width:320,height:740});
  await page.route(/\/api\/models(?:\?.*)?$/,route=>route.fulfill({json:{models:[],providers:[{id:'openai',name:'OpenAI',configured:false,connected:false,enabled:true,error:null}]}}));
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/providers/openai/key',async route=>{await held;await route.fulfill({json:{saved:true,storage:'session'}});});
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose a model/}).click();
  const dialog=page.getByRole('dialog',{name:'Models & connections',exact:true});
  const connections=dialog.getByRole('button',{name:'Connections',exact:true});await connections.click();
  await dialog.getByText('Connect provider',{exact:true}).click();const input=dialog.getByLabel('API key',{exact:true});
  await input.fill('browser-only-secret-draft');
  const catalog=dialog.getByRole('button',{name:'Model catalog',exact:true});
  await catalog.click();await connections.click();await expect(input).toHaveValue('browser-only-secret-draft');
  await dialog.getByRole('button',{name:'Close Models & connections',exact:true}).click();
  const guard=page.getByRole('dialog',{name:/Unsaved (file )?changes/,exact:true});
  await expect(guard).toBeVisible();await guard.getByRole('button',{name:'Keep editing',exact:true}).click();
  await expect(input).toHaveValue('browser-only-secret-draft');
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('browser-only-secret-draft');
  try{
    await dialog.getByRole('button',{name:'Save credential',exact:true}).click();
    await dialog.getByRole('button',{name:'Close Models & connections',exact:true}).click();
    await expect(dialog.getByRole('status').filter({hasText:'Wait for the current operation'})).toBeVisible();
    release();await expect(input).toHaveValue('');
    await expect(dialog.getByText('Your credential is available',{exact:false})).toBeVisible();
    await dialog.getByRole('button',{name:'Close Models & connections',exact:true}).click();await expect(dialog).toHaveCount(0);
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});

test('model catalog remains inspectable after a failed refresh without starting compute',async({page})=>{
  let failed=false,mutations=0;
  const model={id:'ollama/cached-fixture',name:'Cached model evidence',provider:'ollama',runtime:'ollama',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:8192,quantization:null,sizeBytes:null,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
  await page.route(/\/api\/models(?:\?.*)?$/,route=>route.fulfill(failed?{status:503,json:{error:'Discovery temporarily unavailable'}}:{json:{models:[model],providers:[]}}));
  await page.route('**/api/models/**',route=>{if(route.request().method()==='POST')mutations++;return route.fallback();});
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose a model/}).click();
  const dialog=page.getByRole('dialog',{name:'Models & connections',exact:true});
  await dialog.getByRole('button',{name:`Inspect ${model.name}`,exact:true}).click();
  failed=true;await dialog.getByRole('button',{name:'Refresh models',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Discovery temporarily unavailable',{timeout:15000});
  await expect(dialog.getByRole('heading',{name:model.name,exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Use model',exact:true})).toBeEnabled();expect(mutations).toBe(0);
  await page.screenshot({path:'output/playwright/model-studio-refresh-error.png',animations:'disabled'});
});
