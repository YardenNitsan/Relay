import { useQuery } from '@tanstack/react-query';
import { Cpu } from 'lucide-react';
import type { ActivityEvent, ModelProfile, TaskDetail, TaskRecord } from '../../shared/types';
import { api } from '../api';
import { mergeEvents } from '../realtime-state';
import { taskModelEvidence } from '../task-models';
import { isActive } from './ui';

export default function TaskModels({ task, events, models, onInspect }: { task?: TaskRecord; events: ActivityEvent[]; models: ModelProfile[]; onInspect: (id: string) => void }) {
  const detail = useQuery({ queryKey: ['task', task?.id ?? null], queryFn: ({ signal }) => api<TaskDetail>(`/tasks/${task!.id}`, { signal }), enabled: Boolean(task) });
  if (!task) return null;
  const evidence = taskModelEvidence(task.id, mergeEvents(detail.data?.events ?? [], events.filter(event => event.taskId === task.id), 1000), detail.data?.steps ?? []);
  const active = isActive(task.status);
  const label = (id: string) => { const model = models.find(item => item.id === id); return model ? `${model.name} (${model.provider})` : id; };
  const current = evidence.current;
  let description: string;
  if (active && current) description = `${current.stage === 'selected' ? 'Selected for this task' : 'Latest model activity'}: ${label(current.modelId)}`;
  else if (evidence.used.length) description = `Last task models: ${evidence.used.map(label).join(', ')}`;
  else if (active) description = detail.isError ? 'Model details are temporarily unavailable.' : 'The host has not reported a model selection yet.';
  else return null;
  return <div className="task-model-strip" aria-label="Actual task models"><Cpu size={14} aria-hidden="true" /><span>{description}</span><button className="text-button" onClick={() => onInspect(task.id)}>Execution details</button></div>;
}
