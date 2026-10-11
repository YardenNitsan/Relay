import type { FastifyInstance,FastifyRequest } from 'fastify';
import {z} from 'zod';
import type {TaskStatus} from '../../shared/types.js';
import type { Store } from '../db/store.js';
import type { Engine } from '../orchestration/engine.js';
import type { Providers } from '../providers/index.js';
import { calibrationHistory,calibrationInput,startCalibration } from '../models/calibration.js';
import {startModelEvaluation} from '../models/evaluation-start.js';
import {EvaluationStore} from '../models/evaluation-store.js';
import {CodeEvaluationStore} from '../models/code-evaluation-store.js';
import {startCodeEvaluation,type CodeEvaluationTools} from '../models/code-evaluation-start.js';
import {AppError} from '../core/errors.js';
import type {Principal} from '../auth/policy.js';
import {Sessions} from '../auth/sessions.js';
import {evaluationProtocol} from '../models/evaluation.js';
import {codeEvaluationProtocol} from '../models/code-evaluation.js';
import {terminalStates} from '../orchestration/lifecycle.js';

const activeEvaluationInput=z.object({modelId:z.string().min(1).max(200),protocol:z.enum([evaluationProtocol,codeEvaluationProtocol])}).strict();

export function calibrationRoutes(app:FastifyInstance,store:Store,engine:Engine,providers:Providers,owner:(request:FastifyRequest)=>Principal) {
  const evaluations=new EvaluationStore(store);
  const codeEvaluations=new CodeEvaluationStore(store);
  const sessions=new Sessions(store);
  const codeTools=()=>{if(!engine.tools.codeEvaluationStatus||!engine.tools.codeEvaluationPreflight||!engine.tools.codeEvaluationVerify)throw new AppError('EVALUATION_SANDBOX','The approved executable evaluation sandbox is unavailable.',409);return engine.tools as typeof engine.tools&CodeEvaluationTools;};
  app.get('/api/models/code-evaluations/status',async request=>{owner(request);if(!engine.tools.codeEvaluationStatus)return {available:false,reason:'The approved executable evaluation sandbox is unavailable.'};return engine.tools.codeEvaluationStatus();});
  app.get('/api/models/code-evaluations',async request=>{const {user}=owner(request);return codeEvaluations.history({userId:user.id,sessionVersion:user.sessionVersion});});
  app.post('/api/models/code-evaluations',async(request,reply)=>{
    const principal=owner(request),controller=new AbortController(),socket=request.raw.socket,previousTimeout=socket.timeout??10000;
    // Only the authenticated bounded preflight gets a longer socket allowance.
    // Its independent 45s deadline/cancellation must settle before task creation.
    socket.setTimeout?.(60000);
    const disconnected=()=>controller.abort(new Error('Evaluation request disconnected.'));
    const closed=()=>{if(!reply.raw.writableFinished)disconnected();};
    request.raw.once('aborted',disconnected);reply.raw.once('close',closed);
    try{return await startCodeEvaluation(store,engine,providers,codeTools(),principal,request.body,{admit:(model,context)=>providers.admitModel(model,context),signal:controller.signal});}
    finally{request.raw.off('aborted',disconnected);reply.raw.off('close',closed);if(!socket.destroyed)socket.setTimeout?.(previousTimeout);}
  });
  app.get('/api/models/evaluations/active',async request=>{
    const principal=owner(request),input=activeEvaluationInput.parse(request.query);
    if(!await sessions.live(principal))throw new AppError('SESSION_REVOKED','This session is no longer authorized',401);
    await codeEvaluations.owner({userId:principal.user.id,sessionVersion:principal.user.sessionVersion});
    // Report rows begin only once execution starts. Recover from durable task
    // admission instead, including queued/paused work outside report history.
    const task=(await store.db.query<{id:string;status:TaskStatus}>(
      `SELECT t.id,t.status FROM model_calibrations c JOIN tasks t ON t.id=c.task_id
       WHERE t.user_id=$1 AND c.model_id=$2 AND c.protocol=$3 AND NOT (t.status=ANY($4::text[]))
       ORDER BY t.created_at ASC,t.id ASC LIMIT 1`,
      [principal.user.id,input.modelId,input.protocol,terminalStates],
    ))[0];
    return {task:task?{taskId:task.id,status:task.status}:null};
  });
  app.get('/api/models/evaluations',async request=>{const {user}=owner(request);return evaluations.history({userId:user.id,sessionVersion:user.sessionVersion});});
  app.post('/api/models/evaluations',async request=>{const principal=owner(request);return startModelEvaluation(store,engine,providers,principal,request.body,{admit:(model,context)=>providers.admitModel(model,context)});});
  app.get('/api/models/calibrations',async request=>{owner(request);return calibrationHistory(store);});
  app.post('/api/models/calibrations',async request=>{owner(request);const input=calibrationInput.parse(request.body);return startCalibration(store,engine,providers,input.modelId,input.contextTokens,input.protocol);});
}
