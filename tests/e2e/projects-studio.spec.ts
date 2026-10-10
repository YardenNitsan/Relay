import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {pairBrowser,projectIndex} from './helpers';

const sizes=[[320,740],[360,800],[390,844],[768,1024],[1024,768],[1440,960],[1920,1080],[2560,1080],[844,390]] as const;
for(const [width,height] of sizes)for(const theme of ['light','dark'] as const)test(`project inspector files and search at ${width}x${height} ${theme}`,async({page})=>{
  await page.addInitScript(value=>localStorage.setItem('relay:theme:v1',value),theme);
  await page.setViewportSize({width,height});await page.goto('/');await pairBrowser(page);
  const name='Customer operations / Billing and reconciliation';
  const path='src/features/billing/international/reconciliation-service.test.ts';
  // Real private fixture-host data, not an asserted medium application or LLM run.
  await page.evaluate(async({name,path})=>{
    const session=await(await fetch('/api/session')).json() as {csrfToken:string};
    const headers={'content-type':'application/json','x-relay-csrf':session.csrfToken};
    const response=await fetch('/api/workspaces',{method:'POST',headers,body:JSON.stringify({name,personal:true})});if(!response.ok)throw new Error('Project creation failed');
    const project=await response.json() as {id:string};
    const files=[[path,"// Verified invoice examples\nexport const currencies = ['ILS', 'USD', 'EUR'];\nexport const reconciliation = (amount: number) => Math.round(amount * 100);\n"],...Array.from({length:16},(_,index)=>[`src/modules/account-${index}/index.ts`,`export const account = ${index};\n`])];
    for(const [path,content] of files){const response=await fetch(`/api/workspaces/${project.id}/files`,{method:'POST',headers,body:JSON.stringify({path,content})});if(!response.ok)throw new Error('Project file fixture failed');}
  },{name,path});
  await page.reload();await page.getByRole('button',{name:/^(Choose workspace|Workspace)$/}).click();
  const dialog=await projectIndex(page);
  await dialog.getByRole('searchbox',{name:'Find a project',exact:true}).fill('Billing');
  await dialog.getByRole('button',{name:'Open '+name,exact:true}).click();
  if(width<=760)await expect(dialog.getByRole('region',{name:'Project inspector',exact:true})).toBeFocused();
  await dialog.getByRole('button',{name:'Use for conversation',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'In this conversation',exact:true})).toBeDisabled();
  const search=dialog.getByRole('searchbox',{name:'Search files',exact:true});await search.fill('international');
  await expect(dialog.locator('.project-file-list button')).toHaveCount(1);
  await dialog.getByRole('button',{name:path,exact:true}).click();
  const contents=dialog.getByRole('textbox',{name:'File contents',exact:true});await expect(contents).toHaveValue(/Verified invoice examples/);
  await expect(dialog.getByRole('heading',{name:path,exact:true})).toBeFocused();
  await expect(dialog.getByRole('button',{name:'Download saved file',exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeInViewport({ratio:1});
  await expect(dialog.getByRole('button',{name:'Close file',exact:true})).toBeInViewport({ratio:1});
  if(height<=500)expect((await dialog.locator('.project-editor-body').boundingBox())!.height).toBeGreaterThanOrEqual(160);
  expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:`output/playwright/projects-studio-${width}x${height}-${theme}.png`,animations:'disabled'});
  const download=dialog.getByRole('button',{name:'Download saved file',exact:true});
  await download.scrollIntoViewIfNeeded();await expect(download).toBeInViewport();
  if(width===1440&&theme==='light'){
    const projectSearch=dialog.getByRole('searchbox',{name:'Find a project',exact:true});await projectSearch.focus();
    await page.setViewportSize({width:390,height:844});
    await expect(dialog.getByRole('button',{name:'All projects',exact:true})).toBeFocused();
    await page.setViewportSize({width:1440,height:960});await expect(projectSearch).toBeFocused();
    await search.focus();await page.setViewportSize({width:1024,height:768});
    await expect(dialog.getByRole('heading',{name:path,exact:true})).toBeFocused();
    await page.setViewportSize({width:1440,height:960});
  }
  await dialog.getByRole('button',{name:'Close file',exact:true}).click();
  await expect(dialog.getByRole('button',{name:path,exact:true})).toBeFocused();
  await search.fill('no-such-path');await expect(dialog.getByText('No paths match this search.',{exact:true})).toBeVisible();
});

test('project index exposes loading, failed fetch and explicit empty recovery on a phone',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  let state:'loading'|'error'|'empty'='loading';
  // Controlled network states; no claim of a live production outage.
  await page.route('**/api/workspaces',async route=>{
    if(state==='loading')await held;
    if(state==='empty')await route.fulfill({json:[]});
    else await route.fulfill({status:503,json:{error:'Project listing temporarily unavailable'}});
  });
  try{
    await page.goto('/');await pairBrowser(page);
    await page.getByRole('button',{name:/^(Choose workspace|Workspace)$/}).click();
    const dialog=page.getByRole('dialog',{name:'Workspaces',exact:true});
    await expect(dialog.getByRole('status')).toContainText('Loading workspaces');
    await page.screenshot({path:'output/playwright/projects-loading-390.png',animations:'disabled'});
    state='error';release();
    await expect(dialog.getByRole('alert')).toContainText('Project listing temporarily unavailable');
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:'output/playwright/projects-error-390.png',animations:'disabled'});
    state='empty';await dialog.getByRole('button',{name:'Try again',exact:true}).click();
    await expect(dialog.getByText('Your first project starts here.',{exact:true})).toBeVisible();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:'output/playwright/projects-empty-390.png',animations:'disabled'});
    await dialog.getByRole('button',{name:'Create your first workspace',exact:true}).click();
    await expect(dialog.getByRole('heading',{name:'New workspace',exact:true})).toBeVisible();
  }finally{release();}
});
