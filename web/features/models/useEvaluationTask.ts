import {useCallback,useEffect} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import type {TaskStatus} from '../../../shared/types';
import {api} from '../../api';

const terminal=new Set<TaskStatus>(['completed','failed','cancelled']);
interface Options {modelId:string;protocol:'relay-capability-eval-v2'|'relay-code-eval-v1';open:boolean;started:string|null;reportedTaskId?:string;historyKey:string;setStarted:(id:string|null)=>void}
export function useEvaluationTask({modelId,protocol,open,started,reportedTaskId,historyKey,setStarted}:Options){
  const client=useQueryClient();
  const active=useQuery({queryKey:['active-model-evaluation',modelId,protocol],enabled:open,
    queryFn:({signal})=>api<{task:{taskId:string;status:TaskStatus}|null}>(`/models/evaluations/active?${new URLSearchParams({modelId,protocol})}`,{signal}),
    refetchOnMount:'always',refetchInterval:query=>query.state.data?.task?2000:false});
  const taskId=started??active.data?.task?.taskId??reportedTaskId??null;
  const task=useQuery({queryKey:['model-evaluation-task',taskId],enabled:open&&!!taskId,
    queryFn:({signal})=>api<{task:{status:TaskStatus}}>(`/tasks/${taskId}`,{signal}),
    refetchInterval:query=>terminal.has(query.state.data?.task.status??'created')?false:2000});
  const running=!!taskId&&(!task.data||!terminal.has(task.data.task.status));
  useEffect(()=>{
    if(taskId&&task.data&&!running){
      setStarted(null);
      void client.invalidateQueries({queryKey:[historyKey]});
      void client.invalidateQueries({queryKey:['active-model-evaluation',modelId,protocol]});
    }
  },[taskId,task.data,running,client,historyKey,modelId,protocol,setStarted]);
  const refresh=useCallback(()=>{
    void client.invalidateQueries({queryKey:[historyKey]});
    void client.invalidateQueries({queryKey:['active-model-evaluation',modelId,protocol]});
    if(taskId)void client.invalidateQueries({queryKey:['model-evaluation-task',taskId]});
  },[client,historyKey,modelId,protocol,taskId]);
  return {taskId,task,running,refresh,error:active.error??task.error,unresolved:active.isPending||active.isFetching||active.isError};
}
