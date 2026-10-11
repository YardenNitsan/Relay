import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {openCommands,pairBrowser} from './helpers';
import type {ModelProfile} from '../../shared/types';

const local:ModelProfile={id:'ollama/studio-fixture',name:'Local Studio model',provider:'ollama',runtime:'ollama',local:true,capabilities:{tools:true,vision:false,reasoning:true,structured:true},contextWindow:32768,quantization:'Q4_K_M',sizeBytes:6*1024**3,state:'available',details:{},tokensPerSecond:19.2,inputPricePerMillion:null,outputPricePerMillion:null};
const cloud:ModelProfile={...local,id:'openai/studio-cloud',name:'Cloud Studio model with a deliberately long descriptive name',provider:'openai',runtime:'openai',local:false,quantization:null,sizeBytes:null,tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:12};

for(const [width,height] of [[320,740],[360,800],[390,844],[412,915],[768,1024],[844,390],[1024,768],[1440,960],[1920,1080],[2560,1440]])for(const theme of ['light','dark'])test(`Model Studio catalog and evidence at ${width} ${theme}`,async({page})=>{
  await page.setViewportSize({width,height});let mutations=0;
  await page.addInitScript(value=>localStorage.setItem('relay:theme:v1',value),theme);
  await page.route(/\/api\/models(?:\?.*)?$/,route=>route.fulfill({json:{models:[local,cloud],providers:[]}}));
  await page.route('**/api/models/**',route=>{if(route.request().method()==='POST')mutations++;return route.fallback();});
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose a model/}).click();
  const dialog=page.getByRole('dialog',{name:'Models & connections',exact:true});
  await expect(dialog).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  await expect(dialog.getByText(local.name,{exact:true}).first()).toBeVisible();
  await page.screenshot({path:`output/playwright/model-studio-catalog-${width}-${theme}.png`,animations:'disabled'});
  await dialog.getByRole('button',{name:`Inspect ${local.name}`,exact:true}).click();
  await expect(dialog.getByRole('heading',{name:local.name,exact:true})).toBeVisible();
  await expect(dialog.getByText('19.2 tok/s',{exact:false})).toBeVisible();
  await expect(dialog.getByText('Advertised capabilities',{exact:true})).toBeVisible();
  const back=dialog.getByRole('button',{name:'All models',exact:true});if(await back.isVisible())await back.click();
  await dialog.getByRole('button',{name:`Inspect ${cloud.name}`,exact:true}).click();
  await expect(dialog.getByRole('heading',{name:cloud.name,exact:true})).toBeVisible();
  await expect(dialog.getByText(cloud.id,{exact:true})).toBeVisible();
  await expect(dialog.getByText('Input price unknown',{exact:true})).toBeVisible();
  await expect(dialog.getByText('$12 / million output tokens',{exact:true})).toBeVisible();
  expect(mutations).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:`output/playwright/model-studio-${width}-${theme}.png`,animations:'disabled'});
  await dialog.getByRole('button',{name:'Connections',exact:true}).click();
  await expect(dialog.getByText('Your account currently permits local models only.',{exact:false})).toBeVisible();
  await dialog.getByRole('button',{name:'Model catalog',exact:true}).click();
  expect(mutations).toBe(0);
});
