import { createHash, randomUUID } from 'node:crypto';
import type { Approval, ModelMessage, ModelProfile, ProviderGateway, TaskRecord, TaskStep, ToolContext, ToolDefinition, ToolRequest, ToolResult, ToolDecision } from '../../shared/types.js';
import type { User } from '../auth/policy.js';
import { AppError, checkSignal, publicError } from '../core/errors.js';
import { row, Store } from '../db/store.js';
import { buildContext } from './context.js';
import { actionCheckKey } from './checks.js';
import { buildGraph, readySteps, terminalStates } from './lifecycle.js';
import { LocalLease } from './lease.js';
import { hardwareAdmission, selectModel, type Admit } from './router.js';

export interface ExecutionTools {
  definitions():ToolDefinition[];decide(context:ToolContext,request:ToolRequest):ToolDecision;
  execute(context:ToolContext,request:ToolRequest):Promise<ToolResult>;stopAll():Promise<void>;
  changes(taskId:string):Promise<{checkpointId:string;path:string}[]>;
}
export class Engine {
  private running=new Map<string,{controller:AbortController;promise:Promise<void>;userId:string}>();
  private queue:string[]=[];
  private lease=new LocalLease();
  private draining=false;
  private closed=false;
  private stopping=false;
  private approvalSignals=new Map<string,()=>void>();
  private taskGrants=new Map<string,Set<string>>();
  constructor(readonly store:Store,readonly gateway:ProviderGateway,readonly tools:ExecutionTools,private options:{admit?:Admit}={}) {}
  isStopped() {return this.stopping||this.closed;}
  enqueue(taskId:string) { if(!this.queue.includes(taskId)&&!this.running.has(taskId)){this.queue.push(taskId);void this.drain();} }
  approvalChanged(id:string) {this.approvalSignals.get(id)?.();}
  async initialize() {this.stopping=(await this.store.control()).stopped;await this.store.recover();}
  private async drain() {
    if(this.draining||this.closed||this.stopping)return;
    this.draining=true;
    try {
      if((await this.store.control()).stopped)return;
      // Owner first; at most one active task per remote user. A shared local lease bounds GPU work.
      const pending=await Promise.all(this.queue.map(id=>this.store.task(id)));
      pending.sort((a,b)=>(a.userId==='owner'?-1:0)-(b.userId==='owner'?-1:0));
      for(const task of pending) {
        if(this.running.size>=3||this.closed||this.stopping)break;
        if([...this.running.values()].some(run=>run.userId===task.userId)&&task.userId!=='owner')continue;
        this.queue=this.queue.filter(id=>id!==task.id);
        const controller=new AbortController();
        const promise=this.run(task.id,controller).catch(async error=>{
          const latest=await this.store.task(task.id);
          if(!terminalStates.includes(latest.status)&&latest.status!=='paused') {
            const cancelled=controller.signal.aborted&&!['time_budget','shutdown'].includes(String(controller.signal.reason));
            await this.store.transition(task.id,cancelled?'cancelled':'paused',{error:publicError(error)});
          }
        }).finally(()=>{this.running.delete(task.id);this.taskGrants.delete(task.id);void this.drain();});
        this.running.set(task.id,{controller,promise,userId:task.userId});
      }
    } finally {this.draining=false;}
  }
  private async run(id:string,controller:AbortController) {
    const task=await this.store.task(id);
    const user=row<User>((await this.store.db.query('SELECT * FROM users WHERE id=$1',[task.userId]))[0]);
    if(!user.enabled)throw new AppError('USER_DISABLED','Account disabled',403);
    const timer=setTimeout(()=>controller.abort('time_budget'),task.options.budget.maxSeconds*1000);timer.unref();
    try {
      const signal=controller.signal;
      let steps=await this.store.steps(id);
      if(!steps.length) {
        await this.store.transition(id,'analyzing');
        await this.store.append(id,'TASK_ANALYZED',{depth:task.options.depth,workspace:task.options.workspaceId,cloudPolicy:task.options.cloudPolicy??'local_only',strategy:task.options.depth==='fast'?'Single worker':'Bounded specialist graph'});
        await this.store.transition(id,'planning');
        steps=buildGraph(id,task.options.depth);
        if(steps.length>task.options.budget.maxCalls)throw new AppError('PLAN_BUDGET','This depth needs more model calls than the selected budget. Choose a lighter depth or increase the budget.');
        await this.store.saveGraph(steps);
        await this.store.transition(id,'executing');
      } else if(task.status==='paused') await this.store.transition(id,'executing');
      while(steps.some(s=>s.status!=='completed')) {
        checkSignal(signal);
        const ready=readySteps(steps);if(!ready.length)throw new AppError('GRAPH_BLOCKED','No graph step can make progress. Review failed dependencies.');
        // Only independent read-only analysis runs concurrently. Worker mutations remain sequential.
        await Promise.all(ready.map(step=>this.runStep(task,user,step,signal)));
        steps=await this.store.steps(id);
      }
      checkSignal(signal);
      if(!(await this.isAuthorized(task,user)))throw new AppError('REVOKED','The user policy or execution grant was revoked',403);
      await this.store.transition(id,'verifying');
      const evidence=await this.store.verification(id);
      const failures=await this.store.unresolvedChecks(id);
      const review=steps.find(s=>s.role==='reviewer');
      const result=steps.find(s=>s.role==='worker')?.output??'';
      if(!result.trim())throw new AppError('EMPTY_RESULT','The model did not produce a usable answer.');
      if(failures.length||review?.output?.includes('REVIEW: REVISE')) {
        await this.store.transition(id,'waiting_for_user',{error:'The review or objective checks found unfinished work. Inspect the evidence before continuing.'});
        await this.store.db.query('UPDATE tasks SET result=$1 WHERE id=$2',[result,id]);return;
      }
      if(!evidence.length) await this.store.verify(id,'response','Response generated; no objective external verification was available for this task.',true,{objectiveVerification:false,claim:'generation_only'});
      if(review) await this.store.verify(id,'model_review','Independent review completed; this is a model assessment, not an executed test.',true,{objectiveVerification:false,modelId:review.modelId});
      await this.store.complete(id,result);
    } finally {clearTimeout(timer);}
  }
  private async runStep(task:TaskRecord,user:User,step:TaskStep,signal:AbortSignal) {
    const excluded=new Set<string>();
    const admit=this.options.admit??hardwareAdmission;
    let selected=await selectModel(this.gateway,task,user,step.role,admit,excluded);
    step.modelId=selected.model.id;
    await this.store.append(task.id,'MODEL_SELECTED',{stepId:step.id,modelId:selected.model.id,reasons:selected.reasons});
    const agentId=await this.store.startAgent(step,selected.model.id);
    const details=await this.store.conversation(task.conversationId,user.id);
    const findings=(await this.store.steps(task.id)).filter(s=>step.dependencies.includes(s.id)&&s.output).map(s=>`${s.role}: ${s.output}`);
    let context=await this.store.stepContext(step.id)??buildContext(step.role,task.objective,details.messages.filter(m=>m.taskId!==task.id),findings,task.options.contextTokens);
    // A crash between saving proposals and starting a tool must not automatically
    // replay those proposals. Supply explicit interruption receipts for the model.
    for(const message of [...context]) {
      if(message.role!=='assistant'||!message.toolCalls?.length)continue;
      for(const request of message.toolCalls) {
        if(context.some(receipt=>receipt.role==='tool'&&receipt.toolCallId===request.id))continue;
        const content='This proposal was interrupted before a completed tool receipt was recorded. It was not automatically replayed. Inspect current state and propose the action again if it is still necessary.';
        context.push({role:'tool',toolCallId:request.id,content});
        await this.store.verify(task.id,'tool_interrupted',`${request.name}: proposal interrupted`,false,{tool:request.name},actionCheckKey(task.options.workspaceId,request));
      }
    }
    await this.store.saveContext(step.id,context);
    const defs=task.options.workspaceId?this.tools.definitions().filter(d=>step.role==='worker'||/read|list|search|status|diff/.test(d.name)):[];
    for(let turn=0;turn<task.options.budget.maxIterations;turn++) {
      checkSignal(signal);
      if(!(await this.isAuthorized(task,user)))throw new AppError('REVOKED','The user policy or execution grant was revoked',403);
      const model=selected.model;
      let release:()=>void=()=>{};
      if(model.local) {await this.store.append(task.id,'MODEL_QUEUED',{modelId:model.id,stepId:step.id});release=await this.lease.acquire(signal);}
      let callId:string|null=null;
      let answer='';const requests:ToolRequest[]=[];
      let providerData:ModelMessage['providerData'];
      let inputTokens:number|null=null;let outputTokens:number|null=null;
      try {
        checkSignal(signal);
        let execution=selected.admission.execution;
        if(model.local) {
          const admission=await admit(model,task.options.contextTokens);
          if(!admission.allowed)throw new AppError('RESOURCE_PRESSURE',admission.reasons.join('; '),409);
          execution=admission.execution;
        } else await this.authorizeCloud(task,agentId,model,context,signal);
        const reserve=this.estimateCost(task,model);
        callId=await this.store.startCall(task.id,agentId,model.id,context,{cloud:!model.local,amountUsd:reserve,provider:model.provider,sessionVersion:user.sessionVersion});
        await this.store.saveContext(step.id,context);
        let buffer='';let lastFlush=0;let done=false;
        for await(const chunk of this.gateway.stream({model,messages:context,tools:defs,contextTokens:task.options.contextTokens,maxOutputTokens:Math.min(2048,Math.floor(task.options.contextTokens/3)),signal,execution})) {
          checkSignal(signal);
          if(chunk.type==='text') {
            answer+=chunk.text;buffer+=chunk.text;
            if(answer.length>120000)throw new AppError('OUTPUT_LIMIT','The response exceeded the output limit.');
            if(Date.now()-lastFlush>80) {await this.store.append(task.id,'MODEL_TEXT',{text:buffer,stepId:step.id,role:step.role,modelId:model.id,callId});buffer='';lastFlush=Date.now();}
          } else if(chunk.type==='tool_call')requests.push(chunk.call);
          else if(chunk.type==='continuation')providerData=chunk.providerData;
          else if(chunk.type==='usage') {inputTokens=chunk.inputTokens;outputTokens=chunk.outputTokens;}
          else if(chunk.type==='done')done=true;
        }
        if(buffer)await this.store.append(task.id,'MODEL_TEXT',{text:buffer,stepId:step.id,role:step.role,modelId:model.id,callId});
        if(!done)throw new AppError('INCOMPLETE_STREAM','Provider disconnected before completing the response.');
        const cost=model.local?0:inputTokens!==null&&outputTokens!==null&&model.inputPricePerMillion!==null&&model.outputPricePerMillion!==null?(inputTokens*model.inputPricePerMillion+outputTokens*model.outputPricePerMillion)/1e6:null;
        const charge=await this.store.finishCall(callId,inputTokens,outputTokens,cost);
        await this.store.append(task.id,'MODEL_CALL_COMPLETED',{callId,agentId,modelId:model.id,inputTokens,outputTokens,...charge});
      } catch(error) {
        if(callId)await this.store.finishCall(callId,inputTokens,outputTokens,null,publicError(error));
        if(signal.aborted)throw error;
        // No tool side effects are replayed: rerouting happens before processing this response's proposals.
        excluded.add(model.id);
        await this.store.append(task.id,'MODEL_CALL_FAILED',{modelId:model.id,error:publicError(error),partialOutputDiscarded:!!answer});
        if(excluded.size>=3)throw error;
        try {selected=await selectModel(this.gateway,task,user,step.role,admit,excluded);}
        catch {throw error;}
        await this.store.append(task.id,'MODEL_REROUTED',{from:model.id,to:selected.model.id,reason:publicError(error)});
        context=context.map(message=>{const {providerData:_private,...plain}=message;return plain;});
        continue;
      } finally {release();}
      if(!requests.length) {
        context.push({role:'assistant',content:answer,...(providerData?{providerData}:{})});
        await this.store.saveContext(step.id,context);
        await this.store.finishAgent(step,agentId,answer);return;
      }
      if(requests.length>8||new Set(requests.map(r=>r.id)).size!==requests.length)throw new AppError('INVALID_TOOLS','Provider proposed duplicate or excessive tool calls.');
      context.push({role:'assistant',content:answer,toolCalls:requests,...(providerData?{providerData}:{})});
      await this.store.saveContext(step.id,context);
      for(const request of requests) {
        checkSignal(signal);
        await this.executeTool(task,user,agentId,step.id,context,request,defs.map(d=>d.name),signal);
      }
      const contextBytes=Buffer.byteLength(JSON.stringify(context))+Buffer.byteLength(JSON.stringify(defs));
      if(contextBytes>task.options.contextTokens*3)throw new AppError('CONTEXT_BUDGET','Tool context reached its safety limit. The task is paused with tool receipts preserved.');
    }
    throw new AppError('ITERATION_BUDGET','Agent iteration budget reached. Inspect partial work before resuming.');
  }
  private async isAuthorized(task:TaskRecord,user:User) {
    const control=await this.store.control();
    const current=(await this.store.db.query('SELECT enabled,session_version FROM users WHERE id=$1',[user.id]))[0];
    return !control.stopped&&control.generation===task.stopGeneration&&current?.enabled===true&&current.session_version===user.sessionVersion;
  }
  private estimateCost(task:TaskRecord,model:ModelProfile):number|null {
    if(model.local)return 0;
    if(model.inputPricePerMillion===null||model.outputPricePerMillion===null)return null;
    return (task.options.contextTokens*model.inputPricePerMillion+Math.min(2048,Math.floor(task.options.contextTokens/3))*model.outputPricePerMillion)/1e6;
  }
  private async authorizeCloud(task:TaskRecord,agentId:string,model:ModelProfile,context:ModelMessage[],signal:AbortSignal) {
    if(task.options.budget.localOnly||!task.options.cloudPolicy||task.options.cloudPolicy==='local_only')throw new AppError('EGRESS_DENIED','Cloud data transmission is not authorized',403);
    const content=JSON.stringify(context);
    if(/\b(?:sk-[a-zA-Z0-9_-]{16,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(content))throw new AppError('SECRET_DETECTED','Credential-like content was detected. Cloud transmission is blocked.');
    if(task.options.cloudPolicy==='ask') {
      const args={provider:model.provider,model:model.name,contextBytes:Buffer.byteLength(content),contextSha256:createHash('sha256').update(content).digest('hex'),workspaceId:task.options.workspaceId};
      const approval=await this.store.createApproval(task.id,randomUUID(),'cloud_egress',args,'Send this context to the selected cloud provider. Provider retention terms apply.');
      const decision=await this.waitApproval(task,approval,signal);
      await this.store.audit(task.id,'CLOUD_EGRESS_DECISION',{agentId,...args,decision});
      if(decision==='denied')throw new AppError('EGRESS_DENIED','Cloud transmission was denied',403);
    }
  }
  private async executeTool(task:TaskRecord,user:User,agentId:string,stepId:string,messages:ModelMessage[],request:ToolRequest,allowedTools:string[],signal:AbortSignal):Promise<void> {
    checkSignal(signal);
    if(!(await this.isAuthorized(task,user)))throw new AppError('REVOKED','The user policy or execution grant was revoked',403);
    const invocationId=randomUUID();
    const checkKey=actionCheckKey(task.options.workspaceId,request);
    const receipt=(content:string):ModelMessage=>({role:'tool',toolCallId:request.id,content:content.slice(0,Math.max(500,Math.floor(task.options.contextTokens/4)))});
    const scope=JSON.stringify([request.name,request.arguments]);
    const grants=this.taskGrants.get(task.id)??new Set<string>();this.taskGrants.set(task.id,grants);
    const context:ToolContext={taskId:task.id,agentId,workspaceId:task.options.workspaceId,access:task.options.access,allowedTools,signal,approved:grants.has(scope)};
    let decision=this.tools.decide(context,request);
    await this.store.append(task.id,'TOOL_REQUESTED',{toolCallId:invocationId,agentId,tool:request.name,arguments:request.arguments});
    if(decision.decision==='approval') {
      const approval=await this.store.createApproval(task.id,invocationId,request.name,request.arguments,decision.reason);
      const answer=await this.waitApproval(task,approval,signal);
      context.approved=answer!=='denied';
      if(answer==='allow_task')grants.add(scope);
      decision=answer==='denied'?{...decision,decision:'deny',reason:'User denied this action'}:this.tools.decide(context,request);
    }
    await this.store.db.query('INSERT INTO permission_decisions(id,task_id,tool_call_id,decision,reason) VALUES ($1,$2,$3,$4,$5)',[randomUUID(),task.id,invocationId,decision.decision,decision.reason]);
    await this.store.audit(task.id,'TOOL_POLICY',{toolCallId:invocationId,agentId,tool:request.name,decision:decision.decision,reason:decision.reason});
    if(decision.decision!=='allow') {
      await this.store.verify(task.id,'tool_denied',`${request.name}: ${decision.reason}`,false,{toolCallId:invocationId,tool:request.name},checkKey);
      messages.push(receipt(`Tool denied: ${decision.reason}`));await this.store.saveContext(stepId,messages);return;
    }
    checkSignal(signal);
    if(!(await this.isAuthorized(task,user)))throw new AppError('REVOKED','The user policy or execution grant was revoked',403);
    await this.store.db.query("INSERT INTO tool_calls(id,task_id,agent_id,name,arguments,status) VALUES ($1,$2,$3,$4,$5,'running')",[invocationId,task.id,agentId,request.name,JSON.stringify(request.arguments)]);
    await this.store.append(task.id,'TOOL_STARTED',{toolCallId:invocationId,agentId,tool:request.name});
    let executed=false;
    try {
      const result=await this.tools.execute(context,request);
      executed=true;
      for(const evidence of result.evidence)await this.store.verify(task.id,evidence.kind,evidence.summary,evidence.passed,{...evidence.details,toolCallId:invocationId},checkKey);
      const passed=result.evidence.length>0&&result.evidence.every(evidence=>evidence.passed);
      await this.store.verify(task.id,'tool_outcome',`${request.name}: ${passed?'checks passed':'unverified or failed checks'}`,passed,{toolCallId:invocationId,tool:request.name},checkKey);
      if(result.artifact)await this.store.db.query('INSERT INTO artifacts(id,task_id,name,path,mime) VALUES ($1,$2,$3,$4,$5)',[randomUUID(),task.id,result.artifact.name,result.artifact.path,result.artifact.mime]);
      const completed=[...messages,receipt(result.content)];
      await this.store.finishTool(invocationId,stepId,completed,'completed',result.content);
      messages.push(completed[completed.length-1]);
      await this.store.append(task.id,'TOOL_COMPLETED',{toolCallId:invocationId,agentId,tool:request.name,output:result.content.slice(0,16000)});
    } catch(error) {
      const message=publicError(error);
      if(executed||signal.aborted) {
        await this.store.db.query("UPDATE tool_calls SET status='uncertain',result=$1,finished_at=now() WHERE id=$2 AND status='running'",[message,invocationId]);
        throw error;
      }
      await this.store.verify(task.id,'tool_failed',`${request.name}: ${message}`,false,{toolCallId:invocationId,tool:request.name},checkKey);
      const completed=[...messages,receipt(`Tool failed: ${message}`)];
      await this.store.finishTool(invocationId,stepId,completed,'failed',message);
      messages.push(completed[completed.length-1]);
      await this.store.append(task.id,'TOOL_FAILED',{toolCallId:invocationId,tool:request.name,error:message});
    }
  }
  private async waitApproval(task:TaskRecord,approval:Approval,signal:AbortSignal):Promise<Approval['status']> {
    const latest=await this.store.task(task.id);
    if(latest.status==='executing')await this.store.transition(task.id,'waiting_for_approval');
    while(true) {
      checkSignal(signal);
      const found=(await this.store.approvals(task.id)).find(a=>a.id===approval.id);
      if(!found||found.status!=='pending') {
        if((await this.store.task(task.id)).status==='waiting_for_approval')await this.store.transition(task.id,'executing');
        return found?.status??'denied';
      }
      await new Promise<void>(resolve=>{
        const done=()=>{clearTimeout(timer);this.approvalSignals.delete(approval.id);signal.removeEventListener('abort',done);resolve();};
        const timer=setTimeout(done,1000);this.approvalSignals.set(approval.id,done);signal.addEventListener('abort',done,{once:true});
        if(signal.aborted)done();
      });
    }
  }
  async cancel(id:string) {
    this.queue=this.queue.filter(task=>task!==id);
    const running=this.running.get(id);running?.controller.abort('cancelled');
    if(running)await running.promise;
    const current=await this.store.task(id);
    if(!terminalStates.includes(current.status))await this.store.transition(id,'cancelled');
    await this.store.db.query("UPDATE approvals SET status='denied' WHERE task_id=$1 AND status='pending'",[id]);
  }
  async stopAll() {
    this.stopping=true;await this.store.setStopped(true);
    for(const run of this.running.values())run.controller.abort('emergency_stop');
    await this.tools.stopAll();
    await Promise.all([...this.running.values()].map(run=>run.promise));
    const ids=(await this.store.db.query("SELECT id FROM tasks WHERE status NOT IN ('completed','failed','cancelled')")).map(r=>String(r.id));
    this.queue=[];for(const id of ids)await this.cancel(id);
  }
  async resumeScheduling() {await this.store.setStopped(false);this.stopping=false;void this.drain();}
  async resume(id:string,expectedSessionVersion?:number) {
    if(this.closed||this.stopping)throw new AppError('STOPPED','Resume global scheduling first',409);
    const previous=this.running.get(id);
    if(previous) {
      const task=await this.store.task(id);
      if(task.status!=='paused'&&task.status!=='waiting_for_user')throw new AppError('NOT_PAUSED','This task is not paused',409);
      await previous.promise;
    }
    const resumed=await this.store.resumeTask(id,expectedSessionVersion);
    this.enqueue(id);return resumed;
  }
  async cancelUser(userId:string) {
    const tasks=await this.store.db.query("SELECT id FROM tasks WHERE user_id=$1 AND status NOT IN ('completed','cancelled','failed')",[userId]);
    for(const task of tasks)await this.cancel(String(task.id));
  }
  async shutdown() {
    this.closed=true;
    for(const run of this.running.values())run.controller.abort('shutdown');
    await this.tools.stopAll();await Promise.all([...this.running.values()].map(run=>run.promise));
    for(const id of this.queue) {
      const task=await this.store.task(id);
      if(!terminalStates.includes(task.status)&&task.status!=='paused')await this.store.transition(id,'paused',{error:'Host shut down before this task started. Resume when ready.'});
    }
    this.queue=[];
  }
}
