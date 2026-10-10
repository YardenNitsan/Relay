import {Check,ChevronDown,CircleAlert,ListTree,Terminal} from 'lucide-react';
import type {ActivityEvent} from '../../../shared/types';
import {downloadText} from '../../api';
import {humanize,time} from '../../components/ui';

export default function EventRow({ event }: { event: ActivityEvent }) {
  const summary = [event.data.summary, event.data.message, event.data.tool, event.data.name, event.data.title, event.data.modelId].find(value => typeof value === 'string');
  const important = /FAILED|DENIED|ERROR/.test(event.type);
  const Icon = important ? CircleAlert : /TOOL|COMMAND/.test(event.type) ? Terminal : /COMPLETED|RESULT/.test(event.type) ? Check : ListTree;
  const payload = JSON.stringify(event.data, null, 2);
  return <details className={`event-row ${important ? 'event-error' : ''}`}><summary><span className="event-node"><Icon size={13} /></span><span className="event-text"><strong>{humanize(event.type)}</strong>{summary && <span>{String(summary).slice(0, 160)}</span>}</span><time dateTime={event.createdAt}>{time(event.createdAt)}</time><ChevronDown size={13} className="disclosure-chevron" /></summary><div className="event-detail"><pre className="bounded-output">{payload.slice(0, 10_000)}</pre>{payload.length > 10_000 && <button className="text-button" onClick={() => downloadText(`relay-event-${event.id}.json`, payload)}>Download complete event</button>}<span className="small muted">Event {event.id}</span></div></details>;
}
