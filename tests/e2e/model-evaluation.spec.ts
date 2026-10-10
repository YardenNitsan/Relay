import {expect,test} from '@playwright/test';
import {openCommands,pairBrowser} from './helpers';
import type {ModelProfile} from '../../shared/types';

// Presentation fixtures only. No model evaluation or actual inference occurs.
for(const width of [320,1440])test(`executable evaluation stays unavailable without an approved sandbox at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});let starts=0;
  const model:ModelProfile={id:'ollama/code-browser-fixture',name:'Coding browser fixture',provider:'ollama',runtime:'ollama',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32768,quantization:'Q4',sizeBytes:null,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
  await page.route(/\/api\/models(?:\?.*)?$/,route=>route.fulfill({json:{models:[model],providers:[]}}));
  await page.route('**/api/models/code-evaluations/status',route=>route.fulfill({json:{available:false,reason:'Pinned Node image is not installed; no automatic download.'}}));
  await page.route('**/api/models/code-evaluations',route=>{if(route.request().method()==='POST')starts++;return route.fulfill({json:[]});});
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose a model/}).click();const dialog=page.getByRole('dialog',{name:'Models & connections',exact:true});await dialog.getByText('Evaluate executable coding',{exact:true}).click();
  await expect(dialog.getByText('Pinned Node image is not installed; no automatic download.',{exact:true})).toBeVisible();await expect(dialog.getByRole('checkbox',{name:'Approve local compute and isolated execution of generated code',exact:true})).toBeDisabled();await expect(dialog.getByRole('button',{name:'Run executable evaluation',exact:true})).toBeDisabled();expect(starts).toBe(0);expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
});
test('evaluation requires compute consent and reports missing provenance without creating fake progress',async({page})=>{
  await page.setViewportSize({width:320,height:900});let starts=0;
  const model:ModelProfile={id:'ollama/evaluation-browser-fixture',name:'Evaluation browser fixture',provider:'ollama',runtime:'ollama',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32768,quantization:null,sizeBytes:null,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
  await page.route(/\/api\/models(?:\?.*)?$/,route=>route.fulfill({json:{models:[model],providers:[]}}));
  await page.route('**/api/models/evaluations',route=>{if(route.request().method()==='POST'){starts++;expect(route.request().postDataJSON()).toMatchObject({modelId:model.id,maxOutputTokens:2048,maxSeconds:600});return route.fulfill({status:409,json:{error:'Evaluation model artifact or runtime identity is unavailable. No evaluation was started.',code:'EVALUATION_IDENTITY'}});}return route.fulfill({json:[]});});
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose a model/}).click();
  const dialog=page.getByRole('dialog',{name:'Models & connections',exact:true});await dialog.getByText('Evaluate model capabilities',{exact:true}).click();const run=dialog.getByRole('button',{name:'Run capability evaluation',exact:true});await expect(run).toBeDisabled();expect(starts).toBe(0);
  await dialog.getByRole('checkbox',{name:'Use local compute for this evaluation',exact:true}).check();await run.click();await expect(dialog.getByRole('alert')).toContainText('No evaluation was started');expect(starts).toBe(1);await expect(dialog.getByRole('button',{name:'Stop evaluation',exact:true})).toHaveCount(0);await expect(dialog.getByText('cases passed on',{exact:false})).toHaveCount(0);
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
});

test('recorded automatic-placement report explains provenance and ranking exclusion',async({page})=>{
  const model:ModelProfile={id:'ollama/evaluation-browser-fixture',name:'Evaluation browser fixture',provider:'ollama',runtime:'ollama',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32768,quantization:'Q4',sizeBytes:null,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
  await page.route(/\/api\/models(?:\?.*)?$/,route=>route.fulfill({json:{models:[model],providers:[]}}));
  await page.route('**/api/models/evaluations',route=>route.fulfill({json:[{id:'presentation-fixture',taskId:'presentation-task',status:'completed',identity:{modelId:model.id,digest:'synthetic-browser-artifact',runtime:'ollama',runtimeVersion:'fixture-version',contextTokens:8192,gpuOffload:'runtime-auto',executionSettings:{maxOutputTokens:512,reasoning:'runtime-default'}},result:{passed:1,total:9,measuredAt:'2026-10-10T12:00:00Z',categories:{instructions:{passed:1,total:1}}}}]}));
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose a model/}).click();const dialog=page.getByRole('dialog',{name:'Models & connections',exact:true});await dialog.getByText('Evaluate model capabilities',{exact:true}).click();await dialog.getByText('Recorded evaluation configuration',{exact:true}).click();
  await expect(dialog.getByText('synthetic-browser-artifact',{exact:true})).toBeVisible();await expect(dialog.getByText('fixture-version',{exact:true})).toBeVisible();await expect(dialog.getByText('Actual GPU placement was not verified.',{exact:false})).toContainText('cannot influence Auto model ranking');
});
