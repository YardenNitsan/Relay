import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import {z} from 'zod';
import type {Principal} from '../auth/policy';
import type {Workspace} from '../../shared/types';
import type {Store} from '../db/store';
import type {Engine} from '../orchestration/engine';
import type {ToolBroker} from '../tools';
import {AppError} from '../core/errors';

async function bounded<T>(request:FastifyRequest,reply:FastifyReply,operation:(signal:AbortSignal)=>Promise<T>){
  const controller=new AbortController(),socket=request.raw.socket,previousTimeout=socket.timeout??0;
  socket.setTimeout?.(65_000);const timer=setTimeout(()=>controller.abort('integration_deadline'),60_000);timer.unref();
  const disconnected=()=>{if(!reply.raw.writableFinished)controller.abort('client_disconnected');};reply.raw.on('close',disconnected);
  try{return await operation(controller.signal);}finally{clearTimeout(timer);reply.raw.off('close',disconnected);if(!socket.destroyed)socket.setTimeout?.(previousTimeout);}
}
export function branchIntegrationRoutes(app:FastifyInstance,store:Store,engine:Engine,broker:ToolBroker,owner:(request:FastifyRequest)=>Principal,access:(p:Principal,id:string,write?:boolean)=>Promise<Workspace>){
  const context=async(request:FastifyRequest)=>{
    const actor=owner(request),{id}=z.object({id:z.uuid()}).parse(request.params),child=await access(actor,id,true);
    const parentId=child.git?.parentWorkspaceId;if(!parentId)throw new AppError('BRANCH_PARENT','This workspace has no recorded parent branch',409);
    const authorize=async()=>{
      const current=await access(actor,id,true);await access(actor,parentId,true);
      if(current.git?.parentWorkspaceId!==parentId||(await store.db.query('SELECT role FROM users WHERE id=$1',[actor.user.id]))[0]?.role!=='owner')throw new AppError('REVOKED','Owner or branch authority changed during review',403);
    };
    await authorize();return {actor,id,parentId,authorize};
  };
  const prefix='/api/workspaces/:id/integration';
  app.get(`${prefix}/preview`,async request=>{const c=await context(request);return broker.reviewBranch(c.id,c.parentId,c.authorize);});
  app.get(`${prefix}/file`,async request=>{const c=await context(request);const {path,digest}=z.object({path:z.string().min(1).max(512),digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(request.query);return broker.branchFile(c.id,c.parentId,path,digest,c.authorize);});
  app.get(prefix,async request=>{const c=await context(request);return broker.branchIntegrations(c.id,c.parentId,c.authorize);});
  app.get(`${prefix}/:checkpointId`,async request=>{const c=await context(request);const {checkpointId}=z.object({checkpointId:z.uuid()}).parse(request.params);return broker.branchIntegration(c.id,c.parentId,checkpointId,c.authorize);});
  app.post(prefix,async(request,reply)=>{
    const c=await context(request);const body=z.object({digest:z.string().regex(/^[a-f0-9]{64}$/),paths:z.array(z.string().min(1).max(512)).min(1).max(20),confirmed:z.literal(true)}).strict().parse(request.body);
    const result=await bounded(request,reply,signal=>engine.mutateWorkspaces([c.id,c.parentId],()=>broker.integrateBranch(c.id,c.parentId,body.digest,body.paths,c.authorize,signal)));
    await store.audit(null,'BRANCH_INTEGRATED',{workspaceId:c.id,parentWorkspaceId:c.parentId,checkpointId:result.id,userId:c.actor.user.id,files:result.paths.length});return result;
  });
  app.post(`${prefix}/:checkpointId/rollback`,async(request,reply)=>{
    const c=await context(request),{checkpointId}=z.object({checkpointId:z.uuid()}).parse(request.params);z.object({confirmed:z.literal(true)}).strict().parse(request.body);
    const result=await bounded(request,reply,signal=>engine.mutateWorkspaces([c.id,c.parentId],()=>broker.revertBranch(c.id,c.parentId,checkpointId,c.authorize,signal)));
    await store.audit(null,'BRANCH_INTEGRATION_REVERTED',{workspaceId:c.id,parentWorkspaceId:c.parentId,checkpointId:result.id,revertsCheckpointId:checkpointId,userId:c.actor.user.id});return result;
  });
  app.post(`${prefix}/:checkpointId/reconcile`,async request=>{
    const c=await context(request),{checkpointId}=z.object({checkpointId:z.uuid()}).parse(request.params);z.object({confirmed:z.literal(true)}).strict().parse(request.body);
    const result=await engine.mutateWorkspaces([c.id,c.parentId],()=>broker.reconcileBranch(c.id,c.parentId,checkpointId,c.authorize));
    await store.audit(null,'BRANCH_INTEGRATION_RECONCILED',{workspaceId:c.id,parentWorkspaceId:c.parentId,checkpointId,state:result.state,userId:c.actor.user.id});return result;
  });
}
