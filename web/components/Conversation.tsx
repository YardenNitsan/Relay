import { Fragment, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpRight, Check, Copy, GitBranch } from 'lucide-react';
import type { ActivityEvent, ConversationDetail, ModelProfile, TaskRecord } from '../../shared/types';
import {taskProgress} from '../task-progress';
import type { MessagePage } from '../../shared/history';
import { api } from '../api';
import Markdown from './Markdown';
import Welcome from './Welcome';
import { ConversationSkeleton, ErrorNotice, isActive, Loading, Status } from './ui';

function CopyResponse({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return <><button className="text-button response-copy" onClick={() => { void navigator.clipboard.writeText(content).then(() => setCopied(true)).catch(setError); }}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy response'}</button>{error != null && <ErrorNotice error={error} />}</>;
}

function TaskReceipt({ task, onInspect, stream, events }: { task: TaskRecord; onInspect: (id: string) => void; stream?: string; events:ActivityEvent[] }) {
  const active = isActive(task.status);
  return <div className={`task-receipt ${active ? 'receipt-active' : ''}`}><div className="receipt-line"><span className="receipt-node"><GitBranch size={14} /></span><button className="receipt-button" onClick={() => onInspect(task.id)}><Status status={task.status} /><span>{active ? 'Inspect live activity' : 'Execution record'}</span><ArrowUpRight size={13} /></button></div>{task.error && <div className="receipt-error"><p>{task.error}</p><button className="text-button" onClick={() => onInspect(task.id)}>Inspect task details</button></div>}{active && <div className="stream-response"><p className="small muted" role="status">{taskProgress(task, events)}</p>{stream ? <Markdown content={stream} /> : <div className="working-indicator" role="status"><span /><p>{task.status === 'waiting_for_approval' ? 'Waiting for your approval. Open activity to review the action.' : 'The task is in progress. Activity will appear as work executes.'}</p></div>}</div>}{['paused', 'waiting_for_user'].includes(task.status) && <p className="receipt-pause">Work is preserved. Inspect the record before resuming.</p>}</div>;
}

type PageAnchor = { before?: string; after?: string; beforeId?: string; around?: string };

export default function Conversation({ detail, loading, error, onRetry, streams, events, models, onInspect, onModels, onWorkspace, onDraft, focusMessageId, onReturnLatest }: { detail?: ConversationDetail; loading: boolean; error: unknown; onRetry: () => void; streams: Record<string, { text: string }>; events: ActivityEvent[]; models: ModelProfile[]; onInspect: (id: string, task?: TaskRecord) => void; onModels: () => void; onWorkspace: () => void; onDraft: (text: string) => void; focusMessageId: string | null; onReturnLatest: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousScrollTop = useRef(0);
  const [follow, setFollow] = useState(!focusMessageId);
  const [historyNavHidden, setHistoryNavHidden] = useState(false);
  const [anchor, setAnchor] = useState<PageAnchor | null>(() => focusMessageId ? { around: focusMessageId } : null);
  const parameters = new URLSearchParams({ limit: '80', ...anchor });
  const history = useQuery({ queryKey: ['history-messages', detail?.conversation.id, anchor], queryFn: ({ signal }) => api<MessagePage>(`/history/conversations/${detail!.conversation.id}/messages?${parameters}`, { signal }), enabled: Boolean(detail && anchor), staleTime: 30_000 });
  const messageCount = detail?.messages.length ?? 0;
  const hasMessages = messageCount > 0;
  const messages = anchor ? history.data?.items ?? [] : detail?.messages.slice(-80) ?? [];
  const streamingLength = Object.values(streams).reduce((sum, item) => sum + item.text.length, 0);
  const lastTaskStatus = detail?.tasks.at(-1)?.status;
  useEffect(() => {
    if (!anchor && follow && messageCount > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      previousScrollTop.current = scrollRef.current.scrollTop;
    }
  }, [messageCount, streamingLength, follow, lastTaskStatus, anchor]);
  useEffect(() => {
    const scroller = scrollRef.current, content = contentRef.current;
    if (anchor || !follow || !hasMessages || !scroller || !content) return;
    let frame = 0;
    const pinAfterLayout = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        scroller.scrollTop = scroller.scrollHeight;
        previousScrollTop.current = scroller.scrollTop;
      });
    };
    // Fonts, formatted content and the visible viewport can resize after the
    // last data update. Follow those changes only while reading the latest.
    const observer = new ResizeObserver(pinAfterLayout);
    observer.observe(scroller);
    observer.observe(content);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [anchor, follow, hasMessages]);
  useEffect(() => { setAnchor(focusMessageId ? { around: focusMessageId } : null); setFollow(!focusMessageId); }, [focusMessageId]);
  useEffect(() => {
    if (!anchor || !history.data || !scrollRef.current) return;
    scrollRef.current.scrollTop = 0;
    if (anchor.around) {
      const target = document.getElementById(`message-${anchor.around}`);
      if (history.data.items.length > 1) target?.scrollIntoView({ block: 'center' });
      target?.focus({ preventScroll: true });
    }
  }, [history.data, anchor]);
  const taskMap = new Map([...(detail?.tasks ?? []), ...(history.data?.tasks ?? [])].map(task => [task.id, task]));
  const answeredTasks=new Set(messages.filter(message=>message.role==='assistant').map(message=>message.taskId));
  const navigate = (next: PageAnchor) => { setFollow(false); setAnchor(next); };
  const latest = () => { setAnchor(null); setFollow(true); onReturnLatest(); };
  const earlier = anchor ? history.data?.olderCursor : messages.length === 80 ? messages[0]?.id : null;
  const newer = anchor ? history.data?.newerCursor : null;
  const hasConversation = Boolean(detail?.messages.length);
  return <div className="conversation-scroll" ref={scrollRef} onScroll={event => {
    const element = event.currentTarget;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
    // A queued scroll event after reflow can report a larger bottom gap without
    // the reader moving up. Keep observing layout until they actually do.
    if (nearBottom || element.scrollTop < previousScrollTop.current) setFollow(nearBottom);
    previousScrollTop.current = element.scrollTop;
    setHistoryNavHidden(element.scrollTop > 140);
  }} aria-label="Conversation">
    <div ref={contentRef} className={`conversation-content ${!hasConversation && !loading && error == null ? 'conversation-empty' : ''}`}>
      {loading ? <ConversationSkeleton /> : error != null ? <ErrorNotice error={error} retry={onRetry} /> : !hasConversation ? <Welcome modelCount={models.length} onModels={onModels} onWorkspace={onWorkspace} onDraft={onDraft} /> : <>
        {(anchor || earlier) && <nav className="message-pagination" aria-label="Conversation pages"><div><span className="small muted">{anchor ? 'Reading saved history' : 'Latest messages'}</span>{anchor && <button className="text-button" onClick={latest}>Return to latest<ArrowDown size={14} /></button>}</div><div><button className="button" disabled={!earlier || history.isFetching} onClick={() => { if (earlier) navigate(anchor ? { before: earlier } : { beforeId: earlier }); }}><ArrowUp size={14} />Earlier messages</button>{anchor && <button className="button" disabled={!newer || history.isFetching} onClick={() => { if (newer) navigate({ after: newer }); }}>Newer messages<ArrowDown size={14} /></button>}</div></nav>}
        {anchor && history.isPending ? <Loading>Opening saved messages…</Loading> : anchor && history.isError ? <ErrorNotice error={history.error} retry={() => { void history.refetch(); }} /> : <>
        {anchor && !messages.length && <p className="history-boundary" role="status">You have reached the beginning of this conversation.</p>}
        {messages.map(message => {
          const task = message.taskId ? taskMap.get(message.taskId) : undefined;
          return <Fragment key={message.id}><article id={`message-${message.id}`} tabIndex={-1} className={`message message-${message.role} ${anchor?.around === message.id ? 'message-found' : ''}`} aria-label={message.role === 'user' ? 'Your message' : 'Relay response'}><div className="message-label">{message.role === 'user' ? 'You' : <><span className="mini-mark" />Relay</>}</div>{message.role === 'user' ? <div className="user-message" dir="auto">{message.content}</div> : <>{task&&<TaskReceipt task={task} onInspect={id=>onInspect(id,task)} events={events}/>}<Markdown content={message.content} /><CopyResponse content={message.content} /></>}</article>{message.role==='user'&&task&&!answeredTasks.has(task.id)&&<article className="message message-assistant" aria-label="Relay response"><div className="message-label"><span className="mini-mark"/>Relay</div><TaskReceipt task={task} onInspect={id=>onInspect(id,task)} stream={streams[task.id]?.text} events={events}/></article>}</Fragment>;
        })}
        </>}
      </>}
    </div>{hasConversation && (anchor ? historyNavHidden : !follow) && <button className="jump-latest" onClick={latest}><ArrowDown size={14} />{anchor ? 'Return to latest' : 'Jump to latest'}</button>}
  </div>;
}
