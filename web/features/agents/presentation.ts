import {BookOpen,CalendarDays,Code2,Compass,Files,Globe,Landmark,ListTodo,Mail,Monitor,type LucideIcon} from 'lucide-react';
import type {AssistantAvailability,AssistantId} from '../../../shared/assistants';
export const agentIcons:Record<AssistantId,LucideIcon>={email:Mail,calendar:CalendarDays,research:Compass,coding:Code2,files:Files,personal:ListTodo,browser:Globe,finance:Landmark,learning:BookOpen,computer:Monitor};
export const toolLabels:Record<string,string>={file_list:'List managed files',file_read:'Read managed files',file_search:'Search managed files',file_write:'Write managed files',file_delete:'Delete managed files',host_list:'List host files',host_read:'Read host text files',host_write:'Write host text files',host_delete:'Delete host text files',git_status:'Inspect changes',git_diff:'Compare changes',terminal:'Isolated terminal',http_get:'Read public web pages',mcp_call:'Approved MCP tools',personal_tasks:'Personal task lists',gmail_search:'Search Gmail',gmail_read:'Read Gmail messages',calendar_events:'Read calendar events',calendar_freebusy:'Check calendar availability'};
export function capabilityLabel(agent:AssistantAvailability){
  if(!agent.available)return 'Unavailable';
  if(agent.status==='connection_required')return 'Requires connection';
  if(!agent.tools.length)return 'Conversation ready';
  return agent.status==='limited'?'Available with limits':'Tools available to request';
}
export function matchesSearch(agent:AssistantAvailability,query:string){
  const content=[agent.name,agent.description,...agent.tools.flatMap(tool=>[tool,toolLabels[tool]??tool])].join(' ').toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every(term=>content.includes(term));
}
