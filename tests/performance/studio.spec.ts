import {test,expect,type Page} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {cpus,totalmem} from 'node:os';
import {pairBrowser} from '../e2e/helpers';
import {performanceConversationId,performanceResponse} from '../../scripts/performance-fixture';

interface LabState {readyMs:number|null;historyTwoFrameMs:number|null;keys:number[];longTasks:number[];events:Array<{name:string;duration:number}>}
declare global {interface Window {relayLab:LabState}}

async function instrument(page:Page){
  await page.addInitScript(()=>{
    const state:LabState={readyMs:null,historyTwoFrameMs:null,keys:[],longTasks:[],events:[]};window.relayLab=state;
    const observe=(type:string,callback:(entry:PerformanceEntry)=>void)=>{
      if(PerformanceObserver.supportedEntryTypes.includes(type))new PerformanceObserver(list=>list.getEntries().forEach(callback)).observe({type,buffered:true,...(type==='event'?{durationThreshold:16}:{})});
    };
    observe('longtask',entry=>state.longTasks.push(entry.duration));
    observe('event',entry=>state.events.push({name:entry.name,duration:entry.duration}));
    document.addEventListener('keydown',event=>{
      if((event.target as HTMLElement)?.id!=='objective')return;
      const start=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>state.keys.push(performance.now()-start)));
    },true);
    document.addEventListener('click',event=>{
      if((event.target as Element)?.closest('button')?.getAttribute('aria-label')!=='Open conversation history')return;
      const start=performance.now();
      const historyObserver=new MutationObserver(()=>{
        if(!document.querySelector('dialog[open] .history-item'))return;
        historyObserver.disconnect();requestAnimationFrame(()=>requestAnimationFrame(()=>{state.historyTwoFrameMs=performance.now()-start;}));
      });historyObserver.observe(document,{subtree:true,childList:true});
    },true);
    const observer=new MutationObserver(()=>{
      if(state.readyMs!==null||document.querySelectorAll('.message-assistant').length!==20||!document.querySelector('#objective'))return;
      state.readyMs=-1;observer.disconnect();
      requestAnimationFrame(()=>requestAnimationFrame(()=>{state.readyMs=performance.now();}));
    });observer.observe(document,{subtree:true,childList:true});
  });
}
const stats=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:values,median:sorted[Math.floor(sorted.length/2)]??null,min:sorted[0]??null,max:sorted.at(-1)??null};};

for(const profile of [{name:'desktop',width:1440,height:1000,cpu:1,latency:0},{name:'phone-layout',width:390,height:844,cpu:4,latency:80}])test(`${profile.name} authenticated long-conversation laboratory`,async({page,browser},testInfo)=>{
  const label=process.env.RELAY_PERFORMANCE_LABEL??'baseline';if(!/^[a-zA-Z0-9_-]{1,48}$/.test(label))throw new Error('Invalid performance label');
  const folder=`output/performance/${label}`;await mkdir(folder,{recursive:true});
  const samples:Array<Record<string,unknown>>=[];const failures:string[]=[];
  const report={testedAt:new Date().toISOString(),scope:'Local synthetic laboratory; not field INP, physical Android, live inference or remote gateway acceptance',commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),buildIndexSha256:createHash('sha256').update(await readFile('dist/index.html')).digest('hex'),browser:browser.version(),platform:process.platform,node:process.version,host:{cpu:cpus()[0]?.model??null,logicalProcessors:cpus().length,ramBytes:totalmem()},profile,network:{latencyMs:profile.latency,downloadBytesPerSecond:profile.latency?1_250_000:-1,uploadBytesPerSecond:profile.latency?250_000:-1},fixture:{messages:40,assistantResponses:20,responseBytes:Buffer.byteLength(performanceResponse),responseSha256:createHash('sha256').update(performanceResponse).digest('hex')},samples,failures,summary:{} as Record<string,unknown>};
  try{
    await page.setViewportSize({width:profile.width,height:profile.height});await page.goto('/');await pairBrowser(page);
    await instrument(page);const cdp=await page.context().newCDPSession(page);
    await cdp.send('Network.enable');await cdp.send('Emulation.setCPUThrottlingRate',{rate:profile.cpu});
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:profile.latency,downloadThroughput:report.network.downloadBytesPerSecond,uploadThroughput:report.network.uploadBytesPerSecond});
    await cdp.send('Profiler.enable');await cdp.send('Performance.enable');
    for(let repeat=0;repeat<3;repeat++)for(const cache of ['cold','warm']){
      if(cache==='cold')await cdp.send('Network.clearBrowserCache');
      await page.goto(`/?conversation=${performanceConversationId}`);
      await expect.poll(()=>page.evaluate(()=>window.relayLab.readyMs),{timeout:60_000}).toBeGreaterThan(0);
      await expect(page.locator('.message-assistant')).toHaveCount(20);
      await expect(page.locator('.message-assistant').last().getByRole('button',{name:'Copy response',exact:true})).toBeInViewport();
      const draft=page.getByRole('textbox',{name:'Your objective',exact:true});await draft.fill('');await draft.pressSequentially('Preserve this draft while I inspect history.',{delay:35});
      await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      const historyStart=await page.evaluate(()=>performance.now());
      await page.getByRole('button',{name:'Open conversation history',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'Conversations',exact:true});await expect(dialog.locator('.history-item').first()).toBeVisible();
      await expect.poll(()=>page.evaluate(()=>window.relayLab.historyTwoFrameMs)).toBeGreaterThan(0);
      const historyVisibleMs=await page.evaluate(start=>performance.now()-start,historyStart);
      await dialog.getByRole('button',{name:'Close Conversations',exact:true}).click();await expect(draft).toHaveValue('Preserve this draft while I inspect history.');
      const measured=await page.evaluate(()=>({state:window.relayLab,paint:performance.getEntriesByType('paint').map(entry=>({name:entry.name,startTime:entry.startTime})),resources:performance.getEntriesByType('resource').filter(entry=>new URL(entry.name).pathname.startsWith('/assets/')).map(entry=>{const value=entry as PerformanceResourceTiming;return {path:new URL(value.name).pathname,transferSize:value.transferSize,decodedBodySize:value.decodedBodySize,duration:value.duration};}),domNodes:document.querySelectorAll('*').length}));
      const {metrics}=await cdp.send('Performance.getMetrics');
      samples.push({repeat,cache,...measured,historyVisibleMs,typingTwoFrameMs:stats(measured.state.keys),browserMetrics:metrics.filter(metric=>['JSHeapUsedSize','JSHeapTotalSize','Nodes','LayoutDuration','RecalcStyleDuration','ScriptDuration','TaskDuration'].includes(metric.name))});
    }
    for(const cache of ['cold','warm'])report.summary[cache]=stats(samples.filter(sample=>sample.cache===cache).map(sample=>(sample.state as LabState).readyMs!));
    expect(samples).toHaveLength(6);
    // A separate diagnostic navigation keeps profiler overhead out of repetitions.
    await cdp.send('Profiler.start');await page.reload();
    await expect.poll(()=>page.evaluate(()=>window.relayLab.readyMs),{timeout:60_000}).toBeGreaterThan(0);
    await page.getByRole('textbox',{name:'Your objective',exact:true}).pressSequentially(' Profiling typing.',{delay:35});
    const {profile:cpuProfile}=await cdp.send('Profiler.stop');await writeFile(`${folder}/${profile.name}.cpuprofile`,JSON.stringify(cpuProfile));await page.screenshot({path:`${folder}/${profile.name}.png`});
  }catch(error){failures.push(error instanceof Error?error.message:String(error));throw error;}
  finally{const path=`${folder}/${profile.name}.json`;await writeFile(path,JSON.stringify(report,null,2)+'\n');await testInfo.attach('performance report',{path,contentType:'application/json'});}
});
