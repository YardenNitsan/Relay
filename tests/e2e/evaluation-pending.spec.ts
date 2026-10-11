import {expect,test} from '@playwright/test';
import {openCommands,pairBrowser} from './helpers';

test('pending coding admission cannot be detached by switching inspected models',async({page})=>{
  await page.setViewportSize({width:1440,height:960});
  const model={id:'ollama/pending-fixture',name:'Pending fixture',provider:'ollama',runtime:'ollama',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32768,quantization:null,sizeBytes:null,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
  let requested=false,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(/\/api\/models(?:\?.*)?$/,route=>route.fulfill({json:{models:[model,{...model,id:'ollama/other',name:'Other fixture'}],providers:[]}}));
  await page.route('**/api/models/evaluations/active?*',route=>route.fulfill({json:{task:null}}));
  await page.route('**/api/models/code-evaluations',async route=>{
    if(route.request().method()==='POST'){requested=true;await held;await route.fulfill({json:{taskId:'pending-task'}});}
    else await route.fulfill({json:[]});
  });
  await page.route('**/api/models/code-evaluations/status',route=>route.fulfill({json:{available:true,reason:'Browser fixture only'}}));
  await page.route('**/api/tasks/pending-task',route=>route.fulfill({json:{task:{status:'created'}}}));
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose a model/}).click();
  const dialog=page.getByRole('dialog',{name:'Models & connections',exact:true});
  await dialog.getByText('Evaluate executable coding',{exact:true}).click();
  await dialog.getByRole('checkbox',{name:'Approve local compute and isolated execution of generated code',exact:true}).check();
  try{
    await dialog.getByRole('button',{name:'Run executable evaluation',exact:true}).click();await expect.poll(()=>requested).toBe(true);
    await dialog.getByRole('button',{name:'Inspect Other fixture',exact:true}).click();
    await expect(dialog.getByRole('heading',{name:model.name,exact:true})).toBeVisible();
    await expect(dialog.getByRole('status').filter({hasText:'Wait for the current operation'})).toBeVisible();
    await dialog.getByRole('button',{name:'Close Models & connections',exact:true}).click();await expect(dialog).toBeVisible();
    release();await expect(dialog.getByRole('button',{name:'Stop coding evaluation',exact:true})).toBeVisible();
    await page.screenshot({path:'output/playwright/model-studio-active-evaluation.png',animations:'disabled'});
    await dialog.getByRole('button',{name:'Inspect Other fixture',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Other fixture',exact:true})).toBeVisible();
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});
