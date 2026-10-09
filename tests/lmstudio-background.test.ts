import {describe,it,expect,vi} from 'vitest';
import {startLmStudioBackground,lmStudioEnvironment} from '../server/host/lmstudio-background.js';
describe('LM Studio background startup',()=>{
  it('does not hand provider keys or runtime exposure settings to subprocesses',()=>{
    expect(lmStudioEnvironment({Path:'trusted-path',SystemRoot:'C:/Windows',OPENAI_API_KEY:'secret',ANTHROPIC_API_KEY:'secret',LMS_SERVER_HOST:'0.0.0.0',NODE_OPTIONS:'injected'})).toEqual({Path:'trusted-path',SystemRoot:'C:/Windows',LMS_SERVER_HOST:'127.0.0.1'});
  });
  it('reuses an active server without changing its settings or loading models',async()=>{
    const run=vi.fn();expect(await startLmStudioBackground({probe:async()=>true,run})).toMatchObject({state:'running'});expect(run).not.toHaveBeenCalled();
  });
  it('starts only the installed daemon and loopback server using fixed arguments',async()=>{
    const run=vi.fn(async()=>{}),probe=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await startLmStudioBackground({probe,run,find:async()=>'/trusted/lms',headless:async()=>true})).toMatchObject({state:'started'});
    expect(run.mock.calls).toEqual([['/trusted/lms',['daemon','up','--json']],['/trusted/lms',['server','start','--bind','127.0.0.1','--port','1234']]]);
  });
  it('does not download software, guess commands, or start an absent CLI',async()=>{
    const run=vi.fn();expect(await startLmStudioBackground({probe:async()=>false,run,find:async()=>null})).toMatchObject({state:'unavailable'});expect(run).not.toHaveBeenCalled();
  });
  it('leaves a responding unknown listener alone',async()=>{
    const run=vi.fn();expect(await startLmStudioBackground({probe:async()=>null,run})).toMatchObject({state:'unavailable'});expect(run).not.toHaveBeenCalled();
  });
  it('respects opt-out and custom endpoints without starting another service',async()=>{
    const run=vi.fn();expect(await startLmStudioBackground({env:{RELAY_LMSTUDIO_AUTOSTART:'0'},run})).toMatchObject({state:'disabled'});
    expect(await startLmStudioBackground({env:{RELAY_LMSTUDIO_URL:'http://localhost:4567'},run})).toMatchObject({state:'disabled'});expect(run).not.toHaveBeenCalled();
  });
  it('reports failed startup without failing Relay or leaking subprocess output',async()=>{
    const result=await startLmStudioBackground({probe:async()=>false,find:async()=>'/trusted/lms',headless:async()=>true,run:async()=>{throw new Error('secret output');}});
    expect(result.state).toBe('unavailable');expect(JSON.stringify(result)).not.toContain('secret output');
  });
  it('never wakes the desktop app when only the desktop CLI is installed',async()=>{
    const run=vi.fn();const result=await startLmStudioBackground({probe:async()=>false,find:async()=>'/trusted/lms',headless:async()=>false,run});
    expect(result).toMatchObject({state:'unavailable',message:expect.stringContaining('will not launch')});expect(run).not.toHaveBeenCalled();
  });
});
