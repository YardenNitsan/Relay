import {expect,test} from '@playwright/test';
import {openCommands,pairBrowser} from './helpers';

for(const coding of [false,true])test(`queued ${coding?'coding':'capability'} evaluation is recoverable before a report exists`,async({page})=>{
  const model={id:'ollama/queued-fixture',name:'Queued fixture',provider:'ollama',runtime:'ollama',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32768,quantization:null,sizeBytes:null,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
  const protocol=coding?'relay-code-eval-v1':'relay-capability-eval-v2';
  let cancelled=false,starts=0;
  await page.route(/\/api\/models(?:\?.*)?$/,route=>route.fulfill({json:{models:[model],providers:[]}}));
  await page.route(`**/api/models/${coding?'code-evaluations':'evaluations'}`,route=>{if(route.request().method()==='POST')starts++;return route.fulfill({json:[]});});
  await page.route('**/api/models/evaluations/active?*',route=>{
    const url=new URL(route.request().url());
    expect(url.searchParams.get('modelId')).toBe(model.id);expect(url.searchParams.get('protocol')).toBe(protocol);
    return route.fulfill({json:{task:cancelled?null:{taskId:'queued-evaluation',status:'created'}}});
  });
  await page.route('**/api/models/code-evaluations/status',route=>route.fulfill({json:{available:true,reason:'Browser fixture only'}}));
  await page.route('**/api/tasks/queued-evaluation',route=>route.fulfill({json:{task:{status:cancelled?'cancelled':'created'}}}));
  await page.route('**/api/tasks/queued-evaluation/cancel',route=>{cancelled=true;return route.fulfill({json:{ok:true}});});
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose a model/}).click();
  const dialog=page.getByRole('dialog',{name:'Models & connections',exact:true});
  await dialog.getByRole('button',{name:`Inspect ${model.name}`,exact:true}).click();
  await dialog.getByText(coding?'Evaluate executable coding':'Evaluate model capabilities',{exact:true}).click();
  const stop=dialog.getByRole('button',{name:coding?'Stop coding evaluation':'Stop evaluation',exact:true});
  await expect(stop).toBeVisible();expect(starts).toBe(0);
  await stop.click();await expect.poll(()=>cancelled).toBe(true);await expect(stop).toHaveCount(0);
  await page.unrouteAll({behavior:'wait'});
});
