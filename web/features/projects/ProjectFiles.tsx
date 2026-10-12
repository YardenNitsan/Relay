import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Download,File,FilePlus2} from 'lucide-react';
import type {Workspace} from '../../../shared/types';
import {api,downloadText} from '../../api';
import {ErrorNotice,Loading} from '../../components/ui';
import {useGuardedModalAction,useModalDraftGuard} from '../../components/modal-guard';
import NewProjectFile from './NewProjectFile';
import SourceContents from './SourceContents';

interface FileDocument { path: string; content: string; sha256: string }

type FileChange={path:string;content:string|null;sha256:string|null};
function FileEditor({ id, path, writable, onClose, prepare, onChanged }: { id: string; path: string; writable: boolean; onClose: () => void; prepare:()=>Promise<void>; onChanged: (change:FileChange) => void }) {
  const query = useQuery({ queryKey: ['workspace-file', id, path], queryFn: ({ signal }) => api<FileDocument>(`/workspaces/${id}/file?path=${encodeURIComponent(path)}`, { signal }), staleTime: 0 });
  const [draft, setDraft] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<FileDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const writing=useRef(false);
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
    if (!document || writing.current) return;
    writing.current=true;setBusy(true); setError(null);
    try {
      await prepare();
      const saved = await api<{ sha256: string }>(`/workspaces/${id}/file`, { method: 'PUT', body: { path, content, expectedHash: document.sha256 } });
      setBaseline({ path, content, sha256: saved.sha256 }); setDraft(null);
      onChanged({path,content,sha256:saved.sha256});
    } catch (caught) { setError(caught); }
    finally { writing.current=false;setBusy(false); }
  };
  const remove = async () => {
    if (!document || writing.current) return;
    writing.current=true;setBusy(true); setError(null);
    try { await prepare();await api(`/workspaces/${id}/file`, { method: 'DELETE', body: { path, expectedHash: document.sha256 } }); onChanged({path,content:null,sha256:null}); onClose(); }
    catch (caught) { setError(caught); }
    finally { writing.current=false;setBusy(false); }
  };
  return <section className="workspace-editor" aria-label={`File: ${path}`}>
    <div className="project-editor-body">
    <h4 ref={heading} tabIndex={-1}><File size={16} /><code>{path}</code></h4>
    {query.isPending && <Loading>Opening file...</Loading>}{query.isError && <ErrorNotice error={query.error} retry={()=>{void query.refetch();}} />}
    {document && <><SourceContents path={path} label="File contents" content={content} readOnly={!writable} busy={busy} onChange={value=>{if(!baseline)setBaseline(document);setDraft(value);}}/>
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
  const [creating,setCreating]=useState(false);
  const [filter,setFilter]=useState('');
  const request=useGuardedModalAction(),list=useRef<HTMLUListElement>(null),previous=useRef<string|null>(null),newButton=useRef<HTMLButtonElement>(null),search=useRef<HTMLInputElement>(null),wasCreating=useRef(false);
  useEffect(()=>{if(opened===null&&!creating){if(wasCreating.current)newButton.current?.focus();else if(previous.current){const button=Array.from(list.current?.querySelectorAll<HTMLButtonElement>('button')??[]).find(button=>button.dataset.path===previous.current);(button??search.current)?.focus();}}previous.current=opened;wasCreating.current=creating;},[opened,creating]);
  const prepare=async()=>{await Promise.all([client.cancelQueries({queryKey:['workspace-files',id]}),client.cancelQueries({queryKey:['workspace-file',id]}),client.cancelQueries({queryKey:['workspaces']})]);};
  const changed=(change:FileChange)=>{
    let count=0;
    client.setQueryData<{files:string[]}>(['workspace-files',id],current=>{const files=(current?.files??[]).filter(path=>path!==change.path);if(change.content!==null)files.push(change.path);files.sort();count=files.length;return {files};});
    if(change.content!==null&&change.sha256)client.setQueryData<FileDocument>(['workspace-file',id,change.path],{path:change.path,content:change.content,sha256:change.sha256});
    else client.removeQueries({queryKey:['workspace-file',id,change.path],exact:true});
    client.setQueryData<Workspace[]>(['workspaces'],current=>current?.map(workspace=>workspace.id===id?{...workspace,fileCount:count}:workspace));
    void client.invalidateQueries({queryKey:['workspace-files',id]});void client.invalidateQueries({queryKey:['workspaces']});
  };
  if (query.isPending) return <Loading>Reading file list...</Loading>;
  if (query.isError&&!query.data) return <ErrorNotice error={query.error} retry={()=>{void query.refetch();}} />;
  const filtered=query.data.files.filter(path=>path.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <div className="project-files" data-open={opened!==null||creating}>
    <section className="project-file-index" aria-label="Project files">{writable&&<button ref={newButton} className="button project-new-file-action" onClick={()=>request(()=>{setOpened(null);setCreating(true);})}><FilePlus2 size={16}/>New file</button>}<label className="project-search">Search files<input ref={search} type="search" value={filter} onChange={event=>{setFilter(event.target.value);setLimit(60);}} placeholder="Name or path"/></label><p className="project-file-count" aria-live="polite">{filtered.length} {filter?`of ${query.data.files.length} `:''}files</p>
      {query.isError&&<ErrorNotice error={query.error} retry={()=>{void query.refetch();}}/>}
      <ul className="project-file-list" ref={list}>{filtered.slice(0,limit).map(path=><li key={path}><button data-path={path} aria-current={opened===path?'page':undefined} onClick={()=>{if(path!==opened||creating)request(()=>{setCreating(false);setOpened(path);});}}><File size={14}/><code>{path}</code></button></li>)}</ul>
      {!query.data.files.length&&<p className="muted small">{writable?'Create a file here or attach files from the conversation composer.':'No files in this workspace yet.'}</p>}
      {filter&&!filtered.length&&<p className="muted small">No paths match this search.</p>}
      {filtered.length>limit&&<button className="text-button" onClick={()=>setLimit(value=>value+100)}>Show next 100 files</button>}
    </section>
    <div className="project-file-document">{creating?<NewProjectFile id={id} prepare={prepare} onCancel={()=>setCreating(false)} onCreated={file=>{changed(file);setCreating(false);setOpened(file.path);}}/>:opened?<FileEditor key={opened} id={id} path={opened} writable={writable} onClose={()=>setOpened(null)} prepare={prepare} onChanged={changed}/>:<div className="project-file-prompt"><File size={28}/><h4>A clear view of the source.</h4><p>Choose a file to read{writable?', edit or download': ' or download'} its saved contents. Changes are checked against the host before saving.</p></div>}</div>
  </div>;
}
