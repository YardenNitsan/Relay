import Fastify from 'fastify';
import {afterEach,expect,it,vi} from 'vitest';
import {calibrationRoutes} from '../server/api/calibration.js';
const {start}=vi.hoisted(()=>({start:vi.fn()}));
vi.mock('../server/models/code-evaluation-start.js',()=>({startCodeEvaluation:start}));
afterEach(()=>vi.resetAllMocks());
function fixture(){
  const app=Fastify({connectionTimeout:10000}),timeout=vi.fn();let raw:import('node:http').IncomingMessage;
  app.addHook('onRequest',async request=>{raw=request.raw;request.raw.socket.setTimeout=timeout;});
  // No DB/provider method is exercised: this tests the real route's transport lifecycle.
  calibrationRoutes(app,{} as never,{tools:{codeEvaluationStatus(){},codeEvaluationPreflight(){},codeEvaluationVerify(){}}} as never,{} as never,()=>({user:{id:'owner'}} as never));
  return {app,timeout,raw:()=>raw};
}
it('gives authenticated code preflight a bounded allowance and restores the socket timeout',async()=>{
  const f=fixture();start.mockImplementation(async(...args)=>{expect(args[6].signal).toBeInstanceOf(AbortSignal);expect(args[6].signal.aborted).toBe(false);return {taskId:'fixture'};});
  try{const response=await f.app.inject({method:'POST',url:'/api/models/code-evaluations',payload:{confirmed:true}});expect(response.statusCode).toBe(200);expect(f.timeout.mock.calls.map(call=>call[0])).toEqual([60000,10000]);}finally{await f.app.close();}
});
it('passes client disconnect cancellation into preflight and removes its listener',async()=>{
  const f=fixture();start.mockImplementation(async(...args)=>{f.raw().emit('aborted');args[6].signal.throwIfAborted();return {taskId:'must-not-start'};});
  try{const response=await f.app.inject({method:'POST',url:'/api/models/code-evaluations',payload:{confirmed:true}});expect(response.statusCode).toBeGreaterThanOrEqual(400);expect(start.mock.calls[0][6].signal.aborted).toBe(true);expect(f.raw().listenerCount('aborted')).toBe(0);}finally{await f.app.close();}
});
