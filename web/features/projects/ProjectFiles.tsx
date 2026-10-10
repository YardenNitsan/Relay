import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Download,File} from 'lucide-react';
import {api,downloadText} from '../../api';
import {ErrorNotice,Loading} from '../../components/ui';
import {useGuardedModalAction,useModalDraftGuard} from '../../components/modal-guard';

interface FileDocument { path: string; content: string; sha256: string }

function FileEditor({ id, path, writable, onClose, onChanged }: { id: string; path: string; writable: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const query = useQuery({ queryKey: ['workspace-file', id, path], queryFn: ({ signal }) => api<FileDocument>(`/workspaces/${id}/file?path=${encodeURIComponent(path)}`, { signal }), staleTime: 0 });
  const [draft, setDraft] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<FileDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const requestAction=useGuardedModalAction();
  const heading=useRef<HTMLHeadingElement>(null);
  const keepFile=useRef<HTMLButtonElement>(null);
  const document = baseline ?? query.data;
  const content = draft ?? document?.content ?? '';
  const dirty = document != null && content !== document.content;
  useModalDraftGuard({dirty,busy,label:path});
  const ready=document!=null;
  useEffect(()=>{if(ready)heading.current?.focus();},[ready]);
  useEffect(()=>{if(confirmDelete)keepFile.current?.focus();},[confirmDelete]);
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
    <div className="project-editor-body">
    <h4 ref={heading} tabIndex={-1}><File size={16} /><code>{path}</code></h4>
    {query.isPending && <Loading>Opening file...</Loading>}{query.isError && <ErrorNotice error={query.error} retry={()=>{void query.refetch();}} />}
    {document && <><label>File contents<textarea aria-label="File contents" value={content} readOnly={!writable} disabled={busy} spellCheck={false} rows={10} onChange={event => { if (!baseline) setBaseline(document); setDraft(event.target.value); }} /></label>
      {dirty && <p className="hint">Unsaved changes. Saving checks that this file has not changed on the host.</p>}
      {confirmDelete && <div className="notice warning" role="group" aria-label="Confirm file deletion"><p>Delete <strong>{path}</strong> from this workspace on the host? This cannot be undone here.</p><div className="workspace-file-actions"><button ref={keepFile} className="button" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep file</button><button className="button danger-button" disabled={busy} onClick={() => { void remove(); }}>Confirm delete</button></div></div>}
    </>}
    {error != null && <ErrorNotice error={error} />}
    </div>
    <footer className="project-editor-actions">
      {document && <><button className="button" disabled={busy} onClick={() => downloadText(path.split('/').at(-1) ?? 'file.txt', document.content)}><Download size={15} />Download saved file</button>{writable && <><button className="button primary" disabled={busy || !dirty} onClick={() => { void save(); }}>{busy ? 'Working...' : 'Save changes'}</button><button className="button danger-button" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete file</button></>}</>}
      <button className="button" disabled={busy} onClick={() => requestAction(onClose)}>Close file</button>
    </footer>
  </section>;
}

export default function ProjectFiles({ id, writable }: { id: string; writable: boolean }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['workspace-files', id], queryFn: ({ signal }) => api<{ files: string[] }>(`/workspaces/${id}/files`, { signal }) });
  const [limit, setLimit] = useState(60);
  const [opened, setOpened] = useState<string | null>(null);
  const [filter,setFilter]=useState('');
  const request=useGuardedModalAction(),list=useRef<HTMLUListElement>(null),previous=useRef<string|null>(null);
  useEffect(()=>{if(opened===null&&previous.current){const button=Array.from(list.current?.querySelectorAll<HTMLButtonElement>('button')??[]).find(button=>button.dataset.path===previous.current);button?.focus();}previous.current=opened;},[opened]);
  const changed = async () => { await Promise.all([client.invalidateQueries({ queryKey: ['workspace-files', id] }), client.invalidateQueries({ queryKey: ['workspace-file', id] }), client.invalidateQueries({ queryKey: ['workspaces'] })]); };
  if (query.isPending) return <Loading>Reading file list...</Loading>;
  if (query.isError&&!query.data) return <ErrorNotice error={query.error} retry={()=>{void query.refetch();}} />;
  const filtered=query.data.files.filter(path=>path.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <div className="project-files" data-open={opened!==null}>
    <section className="project-file-index" aria-label="Project files"><label className="project-search">Search files<input type="search" value={filter} onChange={event=>{setFilter(event.target.value);setLimit(60);}} placeholder="Name or path"/></label><p className="project-file-count" aria-live="polite">{filtered.length} {filter?`of ${query.data.files.length} `:''}files</p>
      {query.isError&&<ErrorNotice error={query.error} retry={()=>{void query.refetch();}}/>}
      <ul className="project-file-list" ref={list}>{filtered.slice(0,limit).map(path=><li key={path}><button data-path={path} aria-current={opened===path?'page':undefined} onClick={()=>{if(path!==opened)request(()=>setOpened(path));}}><File size={14}/><code>{path}</code></button></li>)}</ul>
      {!query.data.files.length&&<p className="muted small">No files yet. Attach text files from the conversation composer.</p>}
      {filter&&!filtered.length&&<p className="muted small">No paths match this search.</p>}
      {filtered.length>limit&&<button className="text-button" onClick={()=>setLimit(value=>value+100)}>Show next 100 files</button>}
    </section>
    <div className="project-file-document">{opened?<FileEditor key={opened} id={id} path={opened} writable={writable} onClose={()=>setOpened(null)} onChanged={changed}/>:<div className="project-file-prompt"><File size={28}/><h4>A clear view of the source.</h4><p>Choose a file to read{writable?', edit or download': ' or download'} its saved contents. Changes are checked against the host before saving.</p></div>}</div>
  </div>;
}
