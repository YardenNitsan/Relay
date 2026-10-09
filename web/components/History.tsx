import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ArrowUpRight, History as HistoryIcon, MessageSquare, Plus, Search } from 'lucide-react';
import type { Conversation } from '../../shared/types';
import type { HistoryMatch, HistoryPage } from '../../shared/history';
import { api } from '../api';
import { Empty, ErrorNotice, Loading } from './ui';

const shortDate = (value: string) => new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

export default function History({ selected, onSelect, onNew }: { selected: string | null; onSelect: (conversationId: string, messageId?: string) => void; onNew: () => void }) {
  const [draft, setDraft] = useState('');
  const [criteria, setCriteria] = useState<{ scope: 'conversations' | 'messages'; q: string }>({ scope: 'conversations', q: '' });
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1];
  const parameters = new URLSearchParams({ limit: '40' });
  if (criteria.q) parameters.set('q', criteria.q);
  if (cursor) parameters.set('before', cursor);
  const path = criteria.scope === 'conversations' ? 'conversations' : 'search';
  const searchable = criteria.scope === 'conversations' || Boolean(criteria.q);
  const query = useQuery({ queryKey: ['history', criteria.scope, criteria.q, cursor], queryFn: ({ signal }) => api<HistoryPage<Conversation | HistoryMatch>>(`/history/${path}?${parameters}`, { signal }), enabled: searchable, staleTime: 0 });
  const update = (scope: 'conversations' | 'messages', q: string) => { setCriteria({ scope, q }); setCursors([null]); };
  return <>
    <div className="history-heading"><p className="muted small">Browse every saved conversation, or find a message by its words.</p><button className="button" onClick={onNew}><Plus size={16} />New</button></div>
    <form className="history-search" onSubmit={event => { event.preventDefault(); update(criteria.scope, draft.trim()); }}>
      <label className="search-field"><Search size={16} /><input autoFocus type="search" aria-label="Search history" placeholder={criteria.scope === 'conversations' ? 'Search conversation titles…' : 'Search saved message content…'} value={draft} maxLength={240} onChange={event => setDraft(event.target.value)} /></label>
      <label className="sr-only" htmlFor="history-search-scope">Search in</label><select id="history-search-scope" value={criteria.scope} onChange={event => update(event.target.value as 'conversations' | 'messages', draft.trim())}><option value="conversations">Conversation titles</option><option value="messages">Message content</option></select>
      <button className="button" type="submit">Search</button>
    </form>
    <p className="hint history-search-hint">{criteria.scope === 'messages' ? 'Searches all your saved messages on this host. Use quotes for a phrase, OR for alternatives, or - to exclude a word.' : 'Newest conversations first. Updates do not change page order.'}</p>
    {criteria.q && <div className="history-filter"><span>Results for <strong>{criteria.q}</strong></span><button className="text-button" onClick={() => { setDraft(''); update(criteria.scope, ''); }}>Clear search</button></div>}
    {!searchable ? <Empty title="Find a past message" icon={<MessageSquare size={26} />}><p>Enter words from a conversation to search beyond recent history.</p></Empty> : query.isPending ? <Loading>Loading history…</Loading> : query.isError ? <ErrorNotice error={query.error} retry={() => { void query.refetch(); }} /> : query.data?.items.length ? <>
      <div className="history-list" aria-label="History results">{query.data.items.map(item => 'messageId' in item ? <button key={item.messageId} className="history-item history-match" onClick={() => onSelect(item.conversationId, item.messageId)}><MessageSquare size={16} /><span><strong>{item.conversationTitle}</strong><small>{item.role === 'user' ? 'You' : 'Relay'} · {shortDate(item.createdAt)}</small><span className="history-excerpt">{item.excerpt}</span></span><ArrowUpRight size={14} /></button> : <button key={item.id} className={`history-item ${selected === item.id ? 'selected' : ''}`} onClick={() => onSelect(item.id)}><HistoryIcon size={16} /><span><strong>{item.title}</strong><small>Created {shortDate(item.createdAt)} · Updated {shortDate(item.updatedAt)}</small></span><ArrowUpRight size={14} /></button>)}</div>
      <nav className="history-pagination" aria-label="History pages"><button className="button" disabled={cursors.length === 1} onClick={() => setCursors(values => values.slice(0, -1))}><ArrowLeft size={15} />Previous</button><span className="small muted" aria-live="polite">Page {cursors.length}</span><button className="button" disabled={!query.data.nextCursor} onClick={() => { const next = query.data?.nextCursor; if (next) setCursors(values => [...values, next]); }}>Next<ArrowRight size={15} /></button></nav>
    </> : <Empty title={criteria.q ? 'No matching history' : 'A fresh page'} icon={<HistoryIcon size={26} />}><p>{criteria.q ? 'Try fewer words or switch between titles and message content.' : 'Your conversations and execution records will stay here.'}</p></Empty>}
  </>;
}
