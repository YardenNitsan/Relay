import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, File, FolderOpen, Plus } from 'lucide-react';
import type { Workspace } from '../../shared/types';
import { api, mutation } from '../api';
import { Empty, ErrorNotice, Loading, shortDate } from './ui';

function WorkspaceFiles({ id }: { id: string }) {
  const query = useQuery({ queryKey: ['workspace-files', id], queryFn: ({ signal }) => api<{ files: string[] }>(`/workspaces/${id}/files`, { signal }) });
  const [limit, setLimit] = useState(60);
  if (query.isPending) return <Loading>Reading file list…</Loading>;
  if (query.isError) return <ErrorNotice error={query.error} />;
  return <><ul className="workspace-files">{query.data.files.slice(0, limit).map(path => <li key={path}><File size={13} /><code>{path}</code></li>)}</ul>{!query.data.files.length && <p className="muted small">No files yet. Attach text files from the conversation composer.</p>}{query.data.files.length > limit && <button className="text-button" onClick={() => setLimit(value => value + 100)}>Show next 100 files</button>}</>;
}

export default function Workspaces({ selected, onSelect, owner = true }: { selected: string | null; onSelect: (id: string | null) => void; owner?: boolean }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['workspaces'], queryFn: ({ signal }) => api<Workspace[]>('/workspaces', { signal }) });
  const [name, setName] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const workspace = await mutation<Workspace>('/workspaces', { name: name.trim(), ...(sourcePath.trim() ? { sourcePath: sourcePath.trim() } : {}) });
      await client.invalidateQueries({ queryKey: ['workspaces'] });
      onSelect(workspace.id); setName(''); setSourcePath('');
    } catch (caught) { setError(caught); }
    finally { setBusy(false); }
  };
  return <><div className="section-intro"><p>A safe place for the work.</p><p className="muted">Relay works in managed copies. Importing a directory leaves its original files untouched; secrets, links and generated trees are excluded.</p></div>
    <div className="workspace-list"><button className={`workspace-choice ${selected == null ? 'selected' : ''}`} onClick={() => onSelect(null)}><span><strong>No workspace</strong><small>Conversation without file access</small></span>{selected == null && <Check size={17} />}</button>
      {query.data?.map(workspace => <article key={workspace.id} className="workspace-item"><button className={`workspace-choice ${selected === workspace.id ? 'selected' : ''}`} onClick={() => onSelect(workspace.id)}><FolderOpen size={19} /><span><strong>{workspace.name}</strong><small>{workspace.fileCount} files / created {shortDate(workspace.createdAt)}</small></span>{selected === workspace.id && <Check size={17} />}</button>{workspace.sourcePath && <p className="small muted source-path">Copied from <code>{workspace.sourcePath}</code></p>}<button className="text-button" aria-expanded={inspect === workspace.id} onClick={() => setInspect(inspect === workspace.id ? null : workspace.id)}>{inspect === workspace.id ? 'Hide files' : 'Inspect files'}</button>{inspect === workspace.id && <WorkspaceFiles id={workspace.id} />}</article>)}
    </div>{query.isPending && <Loading>Loading workspaces…</Loading>}{query.isError && <ErrorNotice error={query.error} retry={() => { void query.refetch(); }} />}{query.data?.length === 0 && <Empty title="Create your first workspace" icon={<FolderOpen size={24} />}><p>Import a local project or start with an empty directory.</p></Empty>}
    {owner ? <form className="workspace-form" onSubmit={event => { void create(event); }}><h3><Plus size={17} />New managed workspace</h3><label>Name<input value={name} onChange={event => setName(event.target.value)} required maxLength={120} placeholder="Authentication investigation" disabled={busy} /></label><label>Source directory <span className="muted">(optional)</span><input value={sourcePath} onChange={event => setSourcePath(event.target.value)} placeholder="Absolute path on this host" disabled={busy} spellCheck={false} /></label><p className="hint">Leave the source empty to create a workspace for attached files. Imports may take a moment.</p><button className="button primary" type="submit" disabled={busy || !name.trim()}>{busy ? 'Creating workspace…' : sourcePath.trim() ? 'Import managed copy' : 'Create workspace'}</button>{error != null && <ErrorNotice error={error} />}</form> : <p className="hint">Only workspaces granted to your account appear here. The host owner manages imports.</p>}
  </>;
}
