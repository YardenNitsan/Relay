import {expect,test,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {openProjectChooser,pairBrowser,projectIndex} from './helpers';

async function sourceProject(page:Page,width:number,content='export const ready = false;\r\n// retained newline\r\n',measure=false){
  await page.setViewportSize({width,height:900});await page.goto('/');await pairBrowser(page);
  const id=await page.evaluate(async content=>{
    const {csrfToken}=await(await fetch('/api/session')).json();
    const headers={'content-type':'application/json','x-relay-csrf':csrfToken};
    const response=await fetch('/api/workspaces',{method:'POST',headers,body:JSON.stringify({name:'Source editor',personal:true})});
    if(!response.ok)throw new Error('Workspace setup failed');const {id}=await response.json();
    const created=await fetch(`/api/workspaces/${id}/file`,{method:'PUT',headers,body:JSON.stringify({path:'src/ready.ts',content,expectedHash:null})});
    if(!created.ok)throw new Error('Source setup failed');return id as string;
  },content);
  await page.reload();await openProjectChooser(page);const dialog=await projectIndex(page);
  await dialog.getByRole('button',{name:'Open Source editor',exact:true}).click();
  const file=dialog.getByRole('button',{name:'src/ready.ts',exact:true});
  if(measure)await file.evaluate(button=>button.addEventListener('click',()=>{
    performance.mark('source-open');
    const observer=new MutationObserver(()=>{
      if(!document.querySelector('.source-code .cm-content .cm-line'))return;
      observer.disconnect();requestAnimationFrame(()=>requestAnimationFrame(()=>performance.measure('source-ready','source-open')));
    });observer.observe(document.body,{childList:true,subtree:true});
  },{once:true}));
  await file.click();
  const editor=dialog.getByRole('textbox',{name:'File contents',exact:true});
  return {id,dialog,editor};
}

for(const width of [320,1440])test(`source editing preserves CRLF, search, undo and keyboard exit at ${width}px`,async({page})=>{
  const {id,dialog,editor}=await sourceProject(page,width);
  await expect(dialog.getByText('TypeScript · CRLF',{exact:true})).toBeVisible();
  await expect(editor).toHaveAttribute('contenteditable','true');
  await editor.focus();await page.keyboard.press('Tab');await expect(editor).not.toBeFocused();
  await dialog.getByRole('button',{name:'Find in file',exact:true}).click();
  const find=dialog.getByRole('searchbox',{name:'Find in file',exact:true});await find.fill('false');
  await dialog.getByRole('button',{name:'Next match',exact:true}).click();
  await page.keyboard.insertText('true');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();
  expect(await page.evaluate(async id=>(await(await fetch(`/api/workspaces/${id}/file?path=src/ready.ts`)).json()).content,id)).toBe('export const ready = true;\r\n// retained newline\r\n');
  await dialog.getByRole('button',{name:'Undo edit',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeEnabled();
  await dialog.getByRole('button',{name:'Redo edit',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:'Wrap lines',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Wrap lines',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:`output/playwright/code-editor-${width}.png`,animations:'disabled'});
});

test('mixed line endings require an explicit edit decision and preserve the saved original',async({page})=>{
  const {id,dialog}=await sourceProject(page,390,'first\r\nsecond\nthird');
  await expect(dialog.getByText(/This file uses mixed line endings/)).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();
  expect(await page.evaluate(async id=>(await(await fetch(`/api/workspaces/${id}/file?path=src/ready.ts`)).json()).content,id)).toBe('first\r\nsecond\nthird');
  await dialog.getByRole('button',{name:'Edit with LF line endings',exact:true}).click();
  await expect(dialog.getByRole('textbox',{name:'File contents',exact:true})).toHaveAttribute('contenteditable','true');
  await dialog.getByRole('button',{name:'Close file',exact:true}).click();
  const warning=page.getByRole('dialog',{name:'Unsaved changes',exact:true});await expect(warning).toBeVisible();
  await warning.getByRole('button',{name:'Keep editing',exact:true}).click();
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();
  expect(await page.evaluate(async id=>(await(await fetch(`/api/workspaces/${id}/file?path=src/ready.ts`)).json()).content,id)).toBe('first\nsecond\nthird');
});

test('source saving freezes edits, retains draft on a real conflict and keeps landscape controls reachable',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('relay:theme:v1','dark'));
  const {id,dialog,editor}=await sourceProject(page,844,'export const old = true;');
  await page.setViewportSize({width:844,height:390});
  await editor.fill('export const draft = true;');
  // A real second writer changes the hash after this editor read it.
  await page.evaluate(async id=>{
    const {csrfToken}=await(await fetch('/api/session')).json();
    const file=await(await fetch(`/api/workspaces/${id}/file?path=src/ready.ts`)).json();
    const response=await fetch(`/api/workspaces/${id}/file`,{method:'PUT',headers:{'content-type':'application/json','x-relay-csrf':csrfToken},body:JSON.stringify({path:'src/ready.ts',content:'export const elsewhere = true;',expectedHash:file.sha256})});
    if(!response.ok)throw new Error('Concurrent edit setup failed');
  },id);
  let release=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/workspaces/${id}/file`,async route=>{if(route.request().method()==='PUT'){await held;}await route.continue();});
  try{
    await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
    await expect(editor).toHaveAttribute('contenteditable','false');
    await expect(dialog.getByRole('button',{name:'Undo edit',exact:true})).toBeDisabled();
    await editor.focus();await page.keyboard.press('ControlOrMeta+z');await page.keyboard.insertText('blocked');
    await expect(editor).toContainText('export const draft = true;');
    await expect(dialog.getByRole('button',{name:'Close file',exact:true})).toBeInViewport({ratio:1});
    release();await expect(dialog.getByRole('alert')).toContainText(/changed/i);
    await expect(editor).toHaveAttribute('contenteditable','true');await expect(editor).toContainText('export const draft = true;');
    expect(await page.evaluate(async id=>(await(await fetch(`/api/workspaces/${id}/file?path=src/ready.ts`)).json()).content,id)).toBe('export const elsewhere = true;');
    expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:'output/playwright/code-editor-landscape-dark.png',animations:'disabled'});
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});

test('a shared read-only source supports inspection and search without editing controls',async({page})=>{
  const {id,dialog}=await sourceProject(page,390);
  await dialog.getByRole('button',{name:'Close Workspaces',exact:true}).click();
  // Explicit presentation-only read-only account fixture; backend authority is
  // tested separately. No request is made as this invented account.
  await page.route('**/api/session',async route=>{const response=await route.fetch(),session=await response.json();await route.fulfill({response,json:{...session,remote:true,user:{...session.user,id:'source-read-only',role:'chat',permissions:{...session.user.permissions,maxAccess:'read_only',workspaceIds:[id]}}}});});
  await page.reload();await openProjectChooser(page);await projectIndex(page);
  await dialog.getByRole('button',{name:'Open Source editor',exact:true}).click();await dialog.getByRole('button',{name:'src/ready.ts',exact:true}).click();
  const editor=dialog.getByRole('textbox',{name:'File contents',exact:true});await expect(editor).toHaveAttribute('contenteditable','false');
  await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Delete file',exact:true})).toHaveCount(0);
  await editor.focus();await page.keyboard.insertText('blocked');await expect(editor).toContainText('export const ready = false;');
  await dialog.getByRole('button',{name:'Find in file',exact:true}).click();await dialog.getByRole('searchbox',{name:'Find in file',exact:true}).fill('retained');
  await dialog.getByRole('button',{name:'Next match',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Match selected');
});

test('large source uses a bounded viewport and preserves the whole file after editing its last line',async({page},info)=>{
  const source=Array.from({length:2000},(_,index)=>`export const entry${index} = ${index}; // source fixture\n`).join('');
  const started=Date.now();const {id,dialog,editor}=await sourceProject(page,390,source,true);
  await expect(editor).toHaveAttribute('contenteditable','true');
  await expect.poll(()=>page.evaluate(()=>performance.getEntriesByName('source-ready').length)).toBe(1);
  const observations={scope:'Single synthetic browser lab. Browser readiness is actual file click to editor DOM plus two animation frames; driver elapsed additionally includes pairing/API setup. Neither is field INP, exact paint or physical-phone acceptance.',bytes:Buffer.byteLength(source),lines:2001,driverElapsedMs:Date.now()-started,browserReadyMs:await page.evaluate(()=>performance.getEntriesByName('source-ready')[0].duration),renderedLines:await editor.locator('.cm-line').count()};
  expect(observations.renderedLines).toBeLessThan(200);
  await editor.focus();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.insertText('// final');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();
  expect(await page.evaluate(async id=>(await(await fetch(`/api/workspaces/${id}/file?path=src/ready.ts`)).json()).content,id)).toBe(source+'// final');
  await info.attach('source-rendering-observation',{body:JSON.stringify(observations,null,2),contentType:'application/json'});
  await mkdir('output/performance',{recursive:true});await writeFile('output/performance/source-editor.json',JSON.stringify(observations,null,2));
});

for(const [saved,pasted] of [['\r\n','\n'],['\n','\r\n']] as const)test(`pasting ${JSON.stringify(pasted)} keeps the file's ${JSON.stringify(saved)} convention and undo`,async({page})=>{
  const original=`const original = true;${saved}`;
  const {id,dialog,editor}=await sourceProject(page,390,original);
  await editor.focus();await page.keyboard.press('ControlOrMeta+End');
  await editor.evaluate((element,pasted)=>{const clipboardData=new DataTransfer();clipboardData.setData('text/plain',`// pasted${pasted}// next${pasted}`);element.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));},pasted);
  await expect(dialog.getByText(/This file uses mixed line endings/)).toHaveCount(0);
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();
  expect(await page.evaluate(async id=>(await(await fetch(`/api/workspaces/${id}/file?path=src/ready.ts`)).json()).content,id)).toBe(original+`// pasted${saved}// next${saved}`);
  await dialog.getByRole('button',{name:'Undo edit',exact:true}).click();await expect(editor).not.toContainText('pasted');
});

test('empty keyboard search and language changes retain one search interface and the draft',async({page})=>{
  const {dialog,editor}=await sourceProject(page,390);
  await editor.focus();await page.keyboard.press('F3');
  const find=dialog.getByRole('searchbox',{name:'Find in file',exact:true});await expect(find).toBeFocused();
  await page.keyboard.press('Enter');await expect(dialog.locator('.cm-search')).toHaveCount(0);await expect(find).toBeFocused();
  await dialog.getByRole('button',{name:'Close file',exact:true}).click();
  await dialog.getByRole('button',{name:'New file',exact:true}).click();
  const path=dialog.getByRole('textbox',{name:'Relative file path',exact:true});await path.fill('new.ts');
  const content=dialog.getByRole('textbox',{name:'New file contents',exact:true});await content.fill('// retained draft');
  await dialog.getByRole('button',{name:'Wrap lines',exact:true}).click();await dialog.getByRole('button',{name:'Find in file',exact:true}).click();await find.fill('retained');
  await path.fill('new.py');await expect(content).toContainText('// retained draft');
  await expect(dialog.getByRole('button',{name:'Wrap lines',exact:true})).toHaveAttribute('aria-pressed','true');await expect(content).toHaveClass(/cm-lineWrapping/);
  await dialog.getByRole('button',{name:'Next match',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Match selected');
  await dialog.getByRole('button',{name:'Create file',exact:true}).click();await expect(dialog.getByRole('heading',{name:'new.py',exact:true})).toBeFocused();
  await expect(dialog.getByRole('textbox',{name:'File contents',exact:true})).toContainText('// retained draft');
});

test('an untouched file refresh can change its newline convention without collapsing logical lines',async({page})=>{
  const {id,dialog,editor}=await sourceProject(page,390);
  await expect(editor).toHaveAttribute('contenteditable','true');
  await page.evaluate(async id=>{
    const {csrfToken}=await(await fetch('/api/session')).json();
    const file=await(await fetch(`/api/workspaces/${id}/file?path=src/ready.ts`)).json();
    const response=await fetch(`/api/workspaces/${id}/file`,{method:'PUT',headers:{'content-type':'application/json','x-relay-csrf':csrfToken},body:JSON.stringify({path:'src/ready.ts',content:'// updated\n// two\n',expectedHash:file.sha256})});
    if(!response.ok)throw new Error('Source refresh setup failed');
  },id);
  await page.clock.install();await page.clock.fastForward(11_000);
  const refreshed=page.waitForResponse(response=>response.url().includes(`/workspaces/${id}/file?`)&&response.request().method()==='GET');
  await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));await refreshed;
  await expect(editor).toContainText('// updated');await expect(dialog.getByText('TypeScript · LF',{exact:true})).toBeVisible();
  await expect(editor.locator('.cm-line')).toHaveCount(3);
  await editor.focus();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.insertText('// third');await page.keyboard.press('Enter');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();
  expect(await page.evaluate(async id=>(await(await fetch(`/api/workspaces/${id}/file?path=src/ready.ts`)).json()).content,id)).toBe('// updated\n// two\n// third\n');
});
