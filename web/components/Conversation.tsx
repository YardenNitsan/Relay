import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUpRight, Check, Copy, GitBranch, Layers, ShieldCheck } from 'lucide-react';
import type { ConversationDetail, ModelProfile, TaskRecord } from '../../shared/types';
import Markdown from './Markdown';
import { ConversationSkeleton, ErrorNotice, isActive, Status } from './ui';

function CopyResponse({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return <><button className="text-button response-copy" onClick={() => { void navigator.clipboard.writeText(content).then(() => setCopied(true)).catch(setError); }}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy response'}</button>{error != null && <ErrorNotice error={error} />}</>;
}

function TaskReceipt({ task, onInspect, stream }: { task: TaskRecord; onInspect: (id: string) => void; stream?: string }) {
  const active = isActive(task.status);
  return <div className={`task-receipt ${active ? 'receipt-active' : ''}`}><div className="receipt-line"><span className="receipt-node"><GitBranch size={14} /></span><button className="receipt-button" onClick={() => onInspect(task.id)}><Status status={task.status} /><span>{active ? 'Inspect live activity' : 'Execution record'}</span><ArrowUpRight size={13} /></button></div>{task.error && <div className="receipt-error"><p>{task.error}</p><button className="text-button" onClick={() => onInspect(task.id)}>Inspect task details</button></div>}{active && <div className="stream-response">{stream ? <Markdown content={stream} /> : <div className="working-indicator" role="status"><span /><p>{task.status === 'waiting_for_approval' ? 'Waiting for your approval. Open activity to review the action.' : 'The task is in progress. Activity will appear as work executes.'}</p></div>}</div>}{['paused', 'waiting_for_user'].includes(task.status) && <p className="receipt-pause">Work is preserved. Inspect the record before resuming.</p>}</div>;
}

export default function Conversation({ detail, loading, error, onRetry, streams, models, onInspect, onModels, onWorkspace }: { detail?: ConversationDetail; loading: boolean; error: unknown; onRetry: () => void; streams: Record<string, { text: string }>; models: ModelProfile[]; onInspect: (id: string) => void; onModels: () => void; onWorkspace: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [messageLimit, setMessageLimit] = useState(80);
  const messageCount = detail?.messages.length ?? 0;
  const streamingLength = Object.values(streams).reduce((sum, item) => sum + item.text.length, 0);
  const lastTaskStatus = detail?.tasks.at(-1)?.status;
  useEffect(() => {
    if (follow && messageCount > 0 && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messageCount, streamingLength, follow, lastTaskStatus]);
  useEffect(() => { setFollow(true); setMessageLimit(80); if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [detail?.conversation.id]);
  const taskMap = new Map(detail?.tasks.map(task => [task.id, task]));
  const hasConversation = Boolean(detail?.messages.length);
  return <div className="conversation-scroll" ref={scrollRef} onScroll={event => { const element = event.currentTarget; setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 100); }} aria-label="Conversation">
    <div className={`conversation-content ${!hasConversation && !loading && error == null ? 'conversation-empty' : ''}`}>
      {loading ? <ConversationSkeleton /> : error != null ? <ErrorNotice error={error} retry={onRetry} /> : !hasConversation ? <section className="welcome"><div className="relay-emblem" aria-hidden="true"><span /><span /><span /></div><h1>What should we<br />work on?</h1><p className="welcome-description">A question, a project, a problem to solve.<br className="desktop-break" /> Start with an objective. Follow the work as it happens.</p><div className="welcome-actions"><button onClick={onWorkspace}><span className="welcome-action-icon"><GitBranch size={20} /></span><span><strong>Bring a project</strong><small>Work in a managed copy</small></span><ArrowUpRight size={16} /></button><button onClick={onModels}><span className="welcome-action-icon"><Layers size={20} /></span><span><strong>{models.length ? 'Models & providers' : 'Connect your first model'}</strong><small>{models.length ? `${models.length} discovered model${models.length === 1 ? '' : 's'}` : 'Local runtimes or optional cloud'}</small></span><ArrowUpRight size={16} /></button></div><div className="welcome-assurance"><ShieldCheck size={15} /><span>Local by default. Access stays in your control.</span></div></section> : <>
        {messageCount > messageLimit && <button className="button older-messages" onClick={() => setMessageLimit(value => value + 80)}>Load earlier messages ({messageCount - messageLimit})</button>}
        {detail!.messages.slice(-messageLimit).map(message => {
          const task = message.taskId ? taskMap.get(message.taskId) : undefined;
          return <article className={`message message-${message.role}`} key={message.id} aria-label={message.role === 'user' ? 'Your message' : 'Relay response'}><div className="message-label">{message.role === 'user' ? 'You' : <><span className="mini-mark" />Relay</>}</div>{message.role === 'user' ? <div className="user-message">{message.content}</div> : <><Markdown content={message.content} /><CopyResponse content={message.content} /></>}{message.role === 'user' && task && <TaskReceipt task={task} onInspect={onInspect} stream={streams[task.id]?.text} />}</article>;
        })}
      </>}
    </div>{hasConversation && !follow && <button className="jump-latest" onClick={() => { setFollow(true); if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }}><ArrowDown size={14} />Jump to latest</button>}
  </div>;
}
