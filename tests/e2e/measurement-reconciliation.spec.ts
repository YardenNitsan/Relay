import {expect,test} from '@playwright/test';
import {openCommands,pairBrowser} from './helpers';

const model={id:'ollama/reconciliation-fixture',name:'Reconciliation fixture',provider:'ollama',runtime:'ollama',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32768,quantization:null,sizeBytes:null,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};

for(const status of ['paused','waiting_for_user'])test(`unfinished ${status} calibration keeps cancellation reachable and blocks another start`,async({page})=>{
  let cancelled=false;
  await page.route(/\/api\/models(?:\?.*)?$/,route=>route.fulfill({json:{models:[model],providers:[]}}));
  await page.route('**/api/models/calibrations',route=>route.fulfill({json:[{taskId:'parked-calibration',modelId:model.id,status:cancelled?'cancelled':status,contextTokens:4096,createdAt:new Date().toISOString(),error:null,measurement:null}]}));
  await page.route('**/api/tasks/parked-calibration/cancel',route=>{cancelled=true;return route.fulfill({json:{cancelled:true}});});
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose a model/}).click();
  const dialog=page.getByRole('dialog',{name:'Models & connections',exact:true});await dialog.getByText('Measure local performance',{exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Stop calibration',exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Run task-fit probes',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:'Stop calibration',exact:true}).click();
  await expect.poll(()=>cancelled).toBe(true);await expect(dialog.getByRole('button',{name:'Run calibration',exact:true})).toBeEnabled();
});

for(const coding of [false,true])test(`${coding?'coding':'capability'} admission reconciles a lost response without retrying the mutation`,async({page})=>{
  let admitted=false,starts=0;
  await page.route(/\/api\/models(?:\?.*)?$/,route=>route.fulfill({json:{models:[model],providers:[]}}));
  await page.route('**/api/models/evaluations/active?*',route=>route.fulfill({json:{task:admitted?{taskId:'lost-response-task',status:'created'}:null}}));
  await page.route(`**/api/models/${coding?'code-evaluations':'evaluations'}`,route=>{
    if(route.request().method()==='POST'){starts++;admitted=true;return route.fulfill({status:502,json:{error:'Response lost after admission'}});}
    return route.fulfill({json:[]});
  });
  await page.route('**/api/models/code-evaluations/status',route=>route.fulfill({json:{available:true,reason:'Browser fixture only'}}));
  await page.route('**/api/tasks/lost-response-task',route=>route.fulfill({json:{task:{status:'created'}}}));
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose a model/}).click();
  const dialog=page.getByRole('dialog',{name:'Models & connections',exact:true});
  await dialog.getByText(coding?'Evaluate executable coding':'Evaluate model capabilities',{exact:true}).click();
  await dialog.getByRole('checkbox',{name:coding?'Approve local compute and isolated execution of generated code':'Use local compute for this evaluation',exact:true}).check();
  await dialog.getByRole('button',{name:coding?'Run executable evaluation':'Run capability evaluation',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Response lost after admission');
  await expect(dialog.getByRole('button',{name:coding?'Stop coding evaluation':'Stop evaluation',exact:true})).toBeVisible();
  expect(starts).toBe(1);await page.unrouteAll({behavior:'wait'});
});

test('acknowledged calibration can be left while history refresh is pending',async({page})=>{
  let admitted=false,refreshHeld=false,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(/\/api\/models(?:\?.*)?$/,route=>route.fulfill({json:{models:[model],providers:[]}}));
  await page.route('**/api/models/calibrations',async route=>{
    if(route.request().method()==='POST'){admitted=true;await route.fulfill({json:{taskId:'calibration-task'}});return;}
    if(admitted){refreshHeld=true;await held;}
    await route.fulfill({json:[]});
  });
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose a model/}).click();
  const dialog=page.getByRole('dialog',{name:'Models & connections',exact:true});await dialog.getByText('Measure local performance',{exact:true}).click();
  try{
    await dialog.getByRole('button',{name:'Run calibration',exact:true}).click();await expect.poll(()=>refreshHeld).toBe(true);
    await expect(dialog.getByRole('button',{name:/^(Run calibration|Updating)/})).toBeDisabled();
    await dialog.getByRole('button',{name:'Close Models & connections',exact:true}).click();await expect(dialog).toHaveCount(0,{timeout:3000});
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});
