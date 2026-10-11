import {expect,test} from '@playwright/test';
import {openCommands,pairBrowser} from './helpers';
import type {ModelProfile} from '../../shared/types';

for(const coding of [false,true])test(`reopening ${coding?'coding':'capability'} evaluation recovers its active task and cancel control`,async({page})=>{
  const model:ModelProfile={id:'ollama/recovery-fixture',name:'Recovery fixture',provider:'ollama',runtime:'ollama',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32768,quantization:null,sizeBytes:null,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
  let cancelled=false,starts=0;
  const endpoint=coding?'code-evaluations':'evaluations';
  const record={id:'fixture-report',taskId:'fixture-active-task',status:'running',identity:coding?{model:{modelId:model.id},sandbox:{imageId:'fixture-image',toolchainVersion:'fixture-node',harnessDigest:'fixture-harness'}}:{modelId:model.id},result:null};
  await page.route(/\/api\/models(?:\?.*)?$/,route=>route.fulfill({json:{models:[model],providers:[]}}));
  await page.route(`**/api/models/${endpoint}`,route=>{if(route.request().method()==='POST')starts++;return route.fulfill({json:[{...record,status:cancelled?'cancelled':'running'}]});});
  await page.route('**/api/models/code-evaluations/status',route=>route.fulfill({json:{available:true,reason:'Browser fixture only'}}));
  await page.route('**/api/tasks/fixture-active-task',route=>route.fulfill({json:{task:{status:cancelled?'cancelled':'executing'}}}));
  await page.route('**/api/tasks/fixture-active-task/cancel',route=>{cancelled=true;return route.fulfill({json:{ok:true}});});
  await page.goto('/');await pairBrowser(page);
  const reopen=async()=>{await openCommands(page);await page.getByRole('option',{name:/Choose a model/}).click();};
  await reopen();const dialog=page.getByRole('dialog',{name:'Models & connections',exact:true});
  await dialog.getByRole('button',{name:'Close Models & connections',exact:true}).click();
  await reopen();
  const inspect=dialog.getByRole('button',{name:`Inspect ${model.name}`,exact:true});await inspect.click();
  await dialog.getByText(coding?'Evaluate executable coding':'Evaluate model capabilities',{exact:true}).click();
  const stop=dialog.getByRole('button',{name:coding?'Stop coding evaluation':'Stop evaluation',exact:true});
  await expect(stop).toBeVisible();expect(starts).toBe(0);
  await stop.click();await expect.poll(()=>cancelled).toBe(true);await expect(stop).toHaveCount(0);
});

for(const coding of [false,true])test(`${coding?'coding':'capability'} evaluation waits for history before permitting another run`,async({page})=>{
  const model={id:'ollama/history-fixture',name:'History fixture',provider:'ollama',runtime:'ollama',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32768,quantization:null,sizeBytes:null,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(/\/api\/models(?:\?.*)?$/,route=>route.fulfill({json:{models:[model],providers:[]}}));
  await page.route(`**/api/models/${coding?'code-evaluations':'evaluations'}`,async route=>{await held;await route.fulfill({json:[]});});
  await page.route('**/api/models/code-evaluations/status',route=>route.fulfill({json:{available:true,reason:'Browser fixture only'}}));
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose a model/}).click();
  const dialog=page.getByRole('dialog',{name:'Models & connections',exact:true});
  const inspect=dialog.getByRole('button',{name:`Inspect ${model.name}`,exact:true});await inspect.click();
  try{
    await dialog.getByText(coding?'Evaluate executable coding':'Evaluate model capabilities',{exact:true}).click();
    await dialog.getByRole('checkbox',{name:coding?'Approve local compute and isolated execution of generated code':'Use local compute for this evaluation',exact:true}).check();
    const run=dialog.getByRole('button',{name:coding?'Run executable evaluation':'Run capability evaluation',exact:true});
    await expect(run).toBeDisabled();release();await expect(run).toBeEnabled();
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});
