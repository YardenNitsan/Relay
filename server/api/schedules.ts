import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import type {Principal} from '../auth/policy.js';
import type {ScheduleService} from '../scheduling/service.js';
const params=z.object({id:z.string().uuid()});
export function scheduleRoutes(app:FastifyInstance,service:ScheduleService,owner:(request:FastifyRequest)=>Principal){
  app.get('/api/schedules',async request=>service.list(owner(request)));
  app.post('/api/schedules',async request=>service.create(owner(request),request.body));
  app.get('/api/schedules/:id/runs',async request=>service.runs(owner(request),params.parse(request.params).id));
  app.post('/api/schedules/:id/enabled',async request=>service.setEnabled(owner(request),params.parse(request.params).id,request.body));
  app.post('/api/schedules/:id/archive',async request=>{const actor=owner(request);z.object({confirmed:z.literal(true)}).strict().parse(request.body);await service.archive(actor,params.parse(request.params).id);return {ok:true};});
}
