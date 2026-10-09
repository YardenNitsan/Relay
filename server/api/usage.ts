import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {ModelProfile,ProviderId} from '../../shared/types.js';
import type {ProviderLimitSnapshot,UsageReport} from '../../shared/usage.js';
import type {Principal,User} from '../auth/policy.js';
import type {Store} from '../db/store.js';
import type {Providers} from '../providers/index.js';
interface UsageGateway {listModels():Promise<ModelProfile[]>;rateLimits?():Array<ProviderLimitSnapshot&{modelId:string;provider:ProviderId}>;}
export async function buildUsageReport(store:Store,user:User,gateway:UsageGateway,now=new Date()):Promise<UsageReport>{
  const start=new Date(now);start.setUTCHours(0,0,0,0);
  const periodStart=start.toISOString(),periodEnd=now.toISOString();
  const allowed=new Set(user.permissions.providers);
  const [catalog,rows]=await Promise.all([gateway.listModels(),store.db.query(`
    SELECT model_id,COUNT(*) AS requests,COALESCE(SUM(input_tokens),0) AS input_tokens,
      COALESCE(SUM(output_tokens),0) AS output_tokens,
      COUNT(*) FILTER (WHERE input_tokens IS NULL OR output_tokens IS NULL) AS unreported_calls
    FROM (
      SELECT m.model_id,m.input_tokens,m.output_tokens FROM model_calls m JOIN tasks t ON t.id=m.task_id
      WHERE t.user_id=$1 AND m.started_at >= $2 AND m.started_at <= $3
      UNION ALL
      SELECT model_id,input_tokens,output_tokens FROM inference_requests
      WHERE user_id=$1 AND created_at >= $2 AND created_at <= $3
    ) usage GROUP BY model_id ORDER BY model_id LIMIT 1001`,[user.id,periodStart,periodEnd])]);
  const observations=new Map((gateway.rateLimits?.()??[]).map(item=>[item.modelId,item]));
  const models=new Map<string,UsageReport['models'][number]>();
  for(const model of catalog.filter(model=>allowed.has(model.provider)).slice(0,1000))models.set(model.id,{modelId:model.id,provider:model.provider,name:model.name,local:model.local,requests:0,inputTokens:0,outputTokens:0,unreportedCalls:0,limits:observations.get(model.id)??null});
  for(const row of rows.slice(0,1000)){
    const id=String(row.model_id),provider=id.split('/')[0] as ProviderId;if(!allowed.has(provider))continue;
    const model=models.get(id)??{modelId:id,provider,name:id.slice(provider.length+1),local:provider==='ollama'||provider==='lmstudio',requests:0,inputTokens:0,outputTokens:0,unreportedCalls:0,limits:observations.get(id)??null};
    model.requests=Number(row.requests);model.inputTokens=Number(row.input_tokens);model.outputTokens=Number(row.output_tokens);model.unreportedCalls=Number(row.unreported_calls);models.set(id,model);
  }
  return {periodStart,periodEnd,truncated:rows.length>1000||catalog.filter(model=>allowed.has(model.provider)).length>1000||models.size>1000,models:[...models.values()].sort((a,b)=>b.requests-a.requests||a.name.localeCompare(b.name)).slice(0,1000)};
}
export function registerUsageRoutes(app:FastifyInstance,store:Store,providers:Providers,principal:(request:FastifyRequest)=>Principal){
  app.get('/api/usage',async request=>{const user=principal(request).user;return buildUsageReport(store,user,await providers.forUser(user.id));});
}
