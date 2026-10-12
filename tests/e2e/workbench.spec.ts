import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type {TaskDetail,TaskStep} from '../../shared/types';
import {openProjectChooser,toggleExecutionOptions,chooseExecutionOption,pairBrowser} from './helpers';

for(const width of [390,1440])for(const theme of ['light','dark'] as const) {
  test(`Workbench separates recorded output, checks and receipts at ${width}px in ${theme}`,async({page})=>{
    await page.addInitScript(value=>localStorage.setItem('relay:theme:v1',value),theme);
    await page.setViewportSize({width,height:900});await page.goto('/');await pairBrowser(page);
    await page.getByRole('textbox',{name:'Objective'}).fill('Explain the execution model');
    await page.getByRole('button',{name:'Send objective'}).click();
    await expect(page.getByText('Completed',{exact:true}).first()).toBeVisible();
    await page.getByRole('button',{name:'Activity',exact:true}).click();
    const workbench=page.getByRole('complementary',{name:'Task activity'});
    await expect(workbench.getByRole('heading',{name:'Execution Workbench'})).toBeVisible();
    await expect(workbench.locator('.workbench-objective')).toContainText('Explain the execution model');
    await workbench.locator('.workflow-agent > details > summary').first().click();
    await expect(workbench.getByText('Agent output is a model response.',{exact:false})).toBeVisible();
    await expect(workbench.getByText('No independent checks recorded')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:`output/playwright/workbench-${width}-${theme}.png`});
    await workbench.getByRole('tab',{name:'Work log',exact:true}).click();
    await expect(workbench.locator('.event-row').first()).toBeVisible();
    await workbench.getByRole('tab',{name:'Verification',exact:true}).click();
    await expect(workbench.getByText('Evidence is scoped to the checks that actually ran.',{exact:false})).toBeVisible();
    if(width===1440) {
      await page.getByRole('textbox',{name:'Objective'}).fill('Preserve my next objective while resizing.');
      await page.setViewportSize({width:390,height:700});
      await expect(workbench.getByRole('button',{name:'Close activity',exact:true})).toBeFocused();
      await expect(page.getByRole('textbox',{name:'Objective'})).toBeHidden();
    }
    await workbench.getByRole('button',{name:'Close activity',exact:true}).click();
    await expect(page.getByRole('button',{name:'Activity',exact:true})).toBeFocused();
    if(width===1440)await expect(page.getByRole('textbox',{name:'Objective'})).toHaveValue('Preserve my next objective while resizing.');
  });
}

test('Workbench shows branching dependencies and long model names without implying parallel execution',async({page})=>{
  // Presentation fixture only. This is not multi-agent execution acceptance.
  // Install before TaskModels primes the shared task-query cache. A late route
  // depends on stale-time/refetch timing and can leave the original graph cached.
  const pendingRoutes=new Set<Promise<void>>();
  await page.route(/\/api\/tasks\/[^/]+$/,async route=>{
    const work=(async()=>{
      const response=await route.fetch();const data=await response.json() as TaskDetail;
      const step=(id:string,title:string,dependencies:string[],status:TaskStep['status']):TaskStep=>({id,title,dependencies,status,taskId:data.task.id,role:'coder',modelId:'local/a-very-long-model-name-with-a-large-context-window-and-quantization-details',output:status==='completed'?'Reported work. Independent verification remains separate.':null});
      data.steps=[step('review','Review both implementations',['backend','frontend'],'pending'),step('backend','Implement backend',['plan'],'completed'),step('frontend','Implement frontend',['plan'],'running'),step('plan','Inspect repository',[],'completed')];
      await route.fulfill({response,json:data});
    })();
    pendingRoutes.add(work);try{await work;}finally{pendingRoutes.delete(work);}
  });
  try{
  await page.setViewportSize({width:1024,height:900});await page.goto('/');await pairBrowser(page);
  await page.getByRole('textbox',{name:'Objective'}).fill('Explain the execution model');
  await page.getByRole('button',{name:'Send objective'}).click();
  await expect(page.getByText('Completed',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'Activity',exact:true}).click();
  const graph=page.getByRole('list',{name:'Agent steps',exact:true});
  await expect(graph.getByRole('list',{name:'Dependency level 2'}).locator(':scope > li')).toHaveCount(2);
  await expect(page.getByText('Agents in the same level can still execute one at a time.',{exact:false})).toBeVisible();
  for(const node of await page.locator('.workflow-agent').all())expect(await node.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.screenshot({path:'output/playwright/workbench-branching-1024.png'});
  }finally{
    // Keep interception registered while overlapping fetch/fulfill handlers finish.
    // In Playwright 1.63, unrouteAll(wait) clears the client route list first;
    // one completed handler can then auto-continue another still-fetching route.
    while(pendingRoutes.size)await Promise.all([...pendingRoutes]);
    await page.unrouteAll({behavior:'wait'});
  }
});

test('responsive navigation retains keyboard focus when the rail changes to the phone menu',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await page.goto('/');await pairBrowser(page);
  await page.getByRole('navigation',{name:'Relay studio'}).getByRole('button',{name:'Projects',exact:true}).focus();
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('button',{name:'Open navigation',exact:true})).toBeFocused();
  await page.setViewportSize({width:1440,height:900});
  await expect(page.getByRole('navigation',{name:'Relay studio'}).getByRole('button',{name:'Open navigation',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Open execution workbench',exact:true}).click();
  await page.getByRole('button',{name:'Focus workbench',exact:true}).focus();
  await page.setViewportSize({width:844,height:390});
  await expect(page.getByRole('button',{name:'Close activity',exact:true})).toBeFocused();
});

test('long objective context leaves approval controls reachable in short landscape',async({page})=>{
  await page.setViewportSize({width:844,height:390});await page.goto('/');await pairBrowser(page);
  await page.getByRole('textbox',{name:'Objective'}).fill('Explain the execution model');
  await page.getByRole('button',{name:'Send objective'}).click();
  await expect(page.getByText('Completed',{exact:true}).first()).toBeVisible();
  await openProjectChooser(page);
  await page.getByRole('dialog',{name:'Workspaces',exact:true}).getByRole('button',{name:'New workspace',exact:true}).click();
  await page.getByRole('textbox',{name:'Name',exact:true}).fill('Landscape approval');
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();
  await expect(page.getByRole('region',{name:'Project inspector',exact:true}).getByRole('heading',{name:'Landscape approval',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await chooseExecutionOption(page,'Computer access','supervised');
  // Long objectives still obey real context admission; provision enough context for this UI scenario.
  await toggleExecutionOptions(page);
  await page.getByLabel('Context token budget',{exact:true}).fill('16384');
  await toggleExecutionOptions(page);
  await page.getByRole('textbox',{name:'Objective'}).fill(`Create a notes file and verify the content. ${'Keep the existing project safe. '.repeat(60)}`);
  await page.getByRole('button',{name:'Send objective'}).click();
  await page.getByRole('button',{name:'Activity',exact:true}).click();
  await expect(page.getByRole('button',{name:'Allow once',exact:true})).toBeVisible();
  await page.locator('.workbench-objective > summary').click();
  const deny=page.getByRole('button',{name:'Deny',exact:true});await deny.scrollIntoViewIfNeeded();
  const bounds=(await deny.boundingBox())!;expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(390);
  const body=await page.locator('.inspector-body').boundingBox();expect(body!.height).toBeGreaterThan(80);
  await page.screenshot({path:'output/playwright/workbench-landscape-approval.png'});
  await deny.click();await expect(page.getByRole('button',{name:'Allow once',exact:true})).toHaveCount(0);
});
