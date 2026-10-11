import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {openCommands,pairBrowser} from './helpers';

const model={id:'ollama/focus-fixture',name:'Focus fixture',provider:'ollama',runtime:'ollama',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32768,quantization:null,sizeBytes:null,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};

test('model inspection keeps keyboard focus visible across compact transitions and filtering',async({page})=>{
  await page.setViewportSize({width:1440,height:960});
  await page.route(/\/api\/models(?:\?.*)?$/,route=>route.fulfill({json:{models:[model],providers:[]}}));
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose a model/}).click();
  const dialog=page.getByRole('dialog',{name:'Models & connections',exact:true});
  const inspect=dialog.getByRole('button',{name:`Inspect ${model.name}`,exact:true});
  await inspect.focus();await page.keyboard.press('Enter');
  const title=dialog.getByRole('heading',{name:model.name,exact:true});await expect(title).toBeFocused();
  const search=dialog.getByRole('searchbox',{name:'Find a model',exact:true});
  await search.focus();await page.setViewportSize({width:320,height:740});await expect(title).toBeFocused();
  await dialog.getByRole('button',{name:'All models',exact:true}).click();await expect(inspect).toBeFocused();
  await search.fill('no matching model');await expect(inspect).toHaveCount(0);
  await search.fill('');await expect(inspect).toBeVisible();
  await dialog.getByLabel('Model location',{exact:true}).selectOption('cloud');await expect(inspect).toHaveCount(0);
  await dialog.getByLabel('Model location',{exact:true}).selectOption('local');await expect(inspect).toBeVisible();
  await dialog.getByRole('button',{name:'Connections',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Provider connections',exact:true})).toBeFocused();
  await dialog.getByRole('button',{name:'Model catalog',exact:true}).click();await expect(inspect).toBeFocused();
});

test('compact model discovery exposes loading and empty states without invented models',async({page})=>{
  await page.setViewportSize({width:320,height:740});
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(/\/api\/models(?:\?.*)?$/,async route=>{await held;await route.fulfill({json:{models:[],providers:[]}});});
  await page.goto('/');await pairBrowser(page);await openCommands(page);await page.getByRole('option',{name:/Choose a model/}).click();
  const dialog=page.getByRole('dialog',{name:'Models & connections',exact:true});
  try{
    await expect(dialog.getByRole('status')).toContainText('Discovering models');
    await page.screenshot({path:'output/playwright/model-studio-loading-320.png',animations:'disabled'});
    release();await expect(dialog.getByText('No models available',{exact:true})).toBeVisible();
    await page.screenshot({path:'output/playwright/model-studio-empty-320.png',animations:'disabled'});
    expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});
