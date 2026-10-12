import {ArrowUpRight,MessageSquare,Trash2} from 'lucide-react';
import type {Conversation} from '../../../shared/types';
import type {HistoryMatch} from '../../../shared/history';

export type HistoryItem=Conversation|HistoryMatch;
const fullDate=(value:string)=>new Date(value).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'});
const dayKey=(value:string)=>new Date(value).toLocaleDateString([],{weekday:'long',month:'long',day:'numeric',year:'numeric'});

export function HistoryTimeline({items,selected,busy,onSelect,onDelete,deleteButtons}:{items:HistoryItem[];selected:string|null;busy:boolean;
  onSelect:(id:string,messageId?:string)=>void;onDelete:(conversation:Conversation)=>void;deleteButtons:Map<string,HTMLButtonElement>;
}){
  // Preserve the host's order and cursor boundaries; date headings only group
  // adjacent entries. Message matches retain their exact message identifiers.
  const groups:Array<{date:string;items:HistoryItem[]}>=[];
  for(const item of items){const date=dayKey(item.createdAt),previous=groups.at(-1);if(previous?.date===date)previous.items.push(item);else groups.push({date,items:[item]});}
  return <div className="history-timeline" aria-label="History results">{groups.map((group,index)=><section className="history-day" key={`${group.date}-${index}`}>
    <h4>{group.date}</h4><ul className="history-day-entries">{group.items.map(item=>'messageId' in item?
      <li key={item.messageId}><button className="history-item history-match" disabled={busy} onClick={()=>onSelect(item.conversationId,item.messageId)}><MessageSquare size={18} aria-hidden="true"/><span><strong dir="auto">{item.conversationTitle}</strong><small>{item.role==='user'?'You':'Relay'} <time dateTime={item.createdAt}>{fullDate(item.createdAt)}</time></small><span className="history-excerpt" dir="auto">{item.excerpt}</span></span><ArrowUpRight size={17} aria-hidden="true"/></button></li>:
      <li className="history-row" key={item.id}><button className={`history-item ${selected===item.id?'selected':''}`} aria-current={selected===item.id?'page':undefined} disabled={busy} onClick={()=>onSelect(item.id)}><span><strong dir="auto">{item.title}</strong><small>Created <time dateTime={item.createdAt}>{fullDate(item.createdAt)}</time><span aria-hidden="true"> · </span>Updated <time dateTime={item.updatedAt}>{fullDate(item.updatedAt)}</time></small>{selected===item.id&&<span className="history-current">Current conversation</span>}</span><ArrowUpRight size={17} aria-hidden="true"/></button><button ref={node=>{if(node)deleteButtons.set(item.id,node);else deleteButtons.delete(item.id);}} className="icon-button history-delete" aria-label="Delete conversation" title={`Delete ${item.title}`} disabled={busy} onClick={()=>onDelete(item)}><Trash2 size={18} aria-hidden="true"/></button></li>
    )}</ul>
  </section>)}</div>;
}
