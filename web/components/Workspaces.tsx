import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, File, FolderOpen, Plus } from 'lucide-react';
import type { Workspace } from '../../shared/types';
import { api, downloadText, mutation } from '../api';
import { Empty, ErrorNotice, Loading, shortDate } from './ui';
import DeviceFolder from './DeviceFolder';
import Publication from './Publication';

interface FileDocument { path: string; content: string; sha256: string }

function FileEditor({ id, path, writable, onClose, onChanged }: { id: string; path: string; writable: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const query = useQuery({ queryKey: ['workspace-file', id, path], queryFn: ({ signal }) => api<FileDocument>(`/workspaces/${id}/file?path=${encodeURIComponent(path)}`, { signal }), staleTime: 0 });
  const [draft, setDraft] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<FileDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const document = baseline ?? query.data;
  const content = draft ?? document?.content ?? '';
  const dirty = document != null && content !== document.content;
  const save = async () => {
    if (!document || busy) return;
    setBusy(true); setError(null);
    try {
      const saved = await api<{ sha256: string }>(`/workspaces/${id}/file`, { method: 'PUT', body: { path, content, expectedHash: document.sha256 } });
      setBaseline({ path, content, sha256: saved.sha256 }); setDraft(null);
      await onChanged();
    } catch (caught) { setError(caught); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!document || busy) return;
    setBusy(true); setError(null);
    try { await api(`/workspaces/${id}/file`, { method: 'DELETE', body: { path, expectedHash: document.sha256 } }); await onChanged(); onClose(); }
    catch (caught) { setError(caught); }
    finally { setBusy(false); }
  };
  return <section className="workspace-editor" aria-label={`File: ${path}`}>
    <h4><File size={16} /><code>{path}</code></h4>
    {query.isPending && <Loading>Opening file...</Loading>}{query.isError && <ErrorNotice error={query.error} />}
    {document && <><label>File contents<textarea aria-label="File contents" value={content} readOnly={!writable} disabled={busy} spellCheck={false} rows={10} onChange={event => { if (!baseline) setBaseline(document); setDraft(event.target.value); setConfirmDiscard(false); }} /></label>
      <div className="workspace-file-actions"><button className="button" disabled={busy} onClick={() => downloadText(path.split('/').at(-1) ?? 'file.txt', document.content)}><Download size={15} />Download saved file</button>{writable && <><button className="button primary" disabled={busy || !dirty} onClick={() => { void save(); }}>{busy ? 'Working...' : 'Save changes'}</button><button className="button danger-button" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete file</button></>}</div>
      {dirty && <p className="hint">Unsaved changes. Saving checks that this file has not changed on the host.</p>}
      {confirmDelete && <div className="notice warning" role="group" aria-label="Confirm file deletion"><p>Delete <strong>{path}</strong> from this workspace on the host? This cannot be undone here.</p><div className="workspace-file-actions"><button className="button" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep file</button><button className="button danger-button" disabled={busy} onClick={() => { void remove(); }}>Confirm delete</button></div></div>}
    </>}
    {error != null && <ErrorNotice error={error} />}
    <button className="text-button" disabled={busy} onClick={() => { if (dirty) setConfirmDiscard(true); else onClose(); }}>Close file</button>
    {confirmDiscard && <div className="notice warning"><p>Discard your unsaved edits?</p><div className="workspace-file-actions"><button className="button" onClick={() => setConfirmDiscard(false)}>Keep editing</button><button className="button" onClick={onClose}>Discard edits</button></div></div>}
  </section>;
}

function WorkspaceFiles({ id, writable }: { id: string; writable: boolean }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['workspace-files', id], queryFn: ({ signal }) => api<{ files: string[] }>(`/workspaces/${id}/files`, { signal }) });
  const [limit, setLimit] = useState(60);
  const [opened, setOpened] = useState<string | null>(null);
  const changed = async () => { await Promise.all([client.invalidateQueries({ queryKey: ['workspace-files', id] }), client.invalidateQueries({ queryKey: ['workspace-file', id] }), client.invalidateQueries({ queryKey: ['workspaces'] })]); };
  if (query.isPending) return <Loading>Reading file list...</Loading>;
  if (query.isError) return <ErrorNotice error={query.error} />;
  return <>{opened ? <FileEditor key={opened} id={id} path={opened} writable={writable} onClose={() => setOpened(null)} onChanged={changed} /> : <><ul className="workspace-files">{query.data.files.slice(0, limit).map(path => <li key={path}><button className="workspace-file-link" onClick={() => setOpened(path)}><File size={14} /><code>{path}</code></button></li>)}</ul>{!query.data.files.length && <p className="muted small">No files yet. Attach text files from the conversation composer.</p>}{query.data.files.length > limit && <button className="text-button" onClick={() => setLimit(value => value + 100)}>Show next 100 files</button>}</>}</>;
}

export default function Workspaces({ selected, onSelect, owner = true, userId, canWriteShared = false }: { selected: string | null; onSelect: (id: string | null) => void; owner?: boolean; userId?: string; canWriteShared?: boolean }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['workspaces'], queryFn: ({ signal }) => api<Workspace[]>('/workspaces', { signal }) });
  const [name, setName] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const imported = (workspace: Workspace) => {
    client.setQueryData<Workspace[]>(['workspaces'], current => [...(current ?? []).filter(item => item.id !== workspace.id), workspace]);
    onSelect(workspace.id);
    void client.invalidateQueries({ queryKey: ['workspaces'] });
    void client.invalidateQueries({ queryKey: ['assistants'] });
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const workspace = await mutation<Workspace>('/workspaces', { name: name.trim(), ...(sourcePath.trim() ? { sourcePath: sourcePath.trim() } : { personal: true }) });
      client.setQueryData<Workspace[]>(['workspaces'], current => [...(current ?? []), workspace]);
      await client.invalidateQueries({ queryKey: ['workspaces'] });
      await client.invalidateQueries({ queryKey: ['assistants'] });
      onSelect(workspace.id); setName(''); setSourcePath('');
    } catch (caught) { setError(caught); }
    finally { setBusy(false); }
  };
  return <><div className="section-intro"><p>Your files, on this host.</p><p className="muted">Create a personal workspace and upload files from your device. Other accounts cannot open your personal workspace. The host owner controls storage; this is not end-to-end encrypted. Your agent permission mode does not restrict your own file management.</p></div>
    <div className="workspace-list"><button className={`workspace-choice ${selected == null ? 'selected' : ''}`} onClick={() => onSelect(null)}><span><strong>No workspace</strong><small>Conversation without file access</small></span>{selected == null && <Check size={17} />}</button>
      {query.data?.map(workspace => <article key={workspace.id} className="workspace-item"><button className={`workspace-choice ${selected === workspace.id ? 'selected' : ''}`} onClick={() => onSelect(workspace.id)}><FolderOpen size={19} /><span><strong>{workspace.name}</strong><small>{workspace.ownerUserId === userId ? 'Personal / ' : 'Shared / '}{workspace.fileCount} files / created {shortDate(workspace.createdAt)}</small></span>{selected === workspace.id && <Check size={17} />}</button>{workspace.sourcePath && <p className="small muted source-path">Copied from <code>{workspace.sourcePath}</code></p>}<button className="text-button" aria-expanded={inspect === workspace.id} onClick={() => setInspect(inspect === workspace.id ? null : workspace.id)}>{inspect === workspace.id ? 'Hide files' : 'Inspect files'}</button>{inspect === workspace.id && <WorkspaceFiles id={workspace.id} writable={workspace.ownerUserId === userId || owner || canWriteShared} />}</article>)}
    </div>{query.isPending && <Loading>Loading workspaces…</Loading>}{query.isError && <ErrorNotice error={query.error} retry={() => { void query.refetch(); }} />}{query.data?.length === 0 && <Empty title="Create your first workspace" icon={<FolderOpen size={24} />}><p>Start with an empty workspace, then attach your files.</p></Empty>}
    <form className="workspace-form" onSubmit={event => { void create(event); }}><h3><Plus size={17} />New personal workspace</h3><label>Name<input value={name} onChange={event => setName(event.target.value)} required maxLength={120} placeholder="Authentication investigation" disabled={busy} /></label>{owner && <label>Source directory <span className="muted">(optional)</span><input value={sourcePath} onChange={event => setSourcePath(event.target.value)} placeholder="Absolute path on this host" disabled={busy} spellCheck={false} /></label>}<p className="hint">{owner ? 'Leave the source empty for your own attached files. Importing creates a managed copy; the original is untouched.' : 'Files stay on this host in a workspace private to your account. Choose how independently agents work using the conversation permission control.'}</p><button className="button primary" type="submit" disabled={busy || !name.trim()}>{busy ? 'Creating workspace…' : sourcePath.trim() ? 'Import managed copy' : 'Create workspace'}</button>{error != null && <ErrorNotice error={error} />}</form>
    {owner&&query.data?.filter(workspace=>workspace.sourcePath&&workspace.id===selected).map(workspace=><Publication key={workspace.id} workspaceId={workspace.id}/>)}
    <DeviceFolder key={userId ?? 'anonymous'} userId={userId} onImported={imported} />
  </>;
}
