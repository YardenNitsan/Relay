import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {createPatch} from 'diff';
import type {Publication as Review,PublicationSummary} from '../../shared/publication';
import {api,downloadText} from '../api';
import {ErrorNotice,Loading} from './ui';
import '../styles/publication.css';

export default function Publication({workspaceId}:{workspaceId:string}){
  const client=useQueryClient(),[open,setOpen]=useState(false),[review,setReview]=useState<Review|null>(null),[approved,setApproved]=useState(false),[file,setFile]=useState(0),[notice,setNotice]=useState('');
  const heading=useRef<HTMLHeadingElement>(null);
  const history=useQuery({queryKey:['publications',workspaceId],queryFn:({signal})=>api<PublicationSummary[]>(`/workspaces/${workspaceId}/publications`,{signal}),enabled:open});
  const show=(value:Review)=>{setReview(value);setApproved(false);setFile(0);};
  useEffect(()=>{if(review)heading.current?.focus();},[review]);
  const preview=useMutation({mutationFn:()=>api<Review>(`/workspaces/${workspaceId}/publications/preview`,{method:'POST',body:{}}),onSuccess:show});
  const inspect=useMutation({mutationFn:(id:string)=>api<Review>(`/publications/${id}`),onSuccess:show});
  const rollback=useMutation({mutationFn:(id:string)=>api<Review>(`/publications/${id}/rollback-preview`,{method:'POST',body:{}}),onSuccess:show});
  const refresh=async()=>{await client.invalidateQueries({queryKey:['publications',workspaceId]});};
  const apply=useMutation({mutationFn:async()=>{if(!review||!approved)throw new Error('Review and approve the exact changes first.');return api<Review>(`/publications/${review.id}/apply`,{method:'POST',body:{digest:review.digest,confirmed:true}});},onSuccess:async value=>{show(value);setNotice(value.direction==='publish'?'Reviewed changes were published.':'Reviewed rollback completed.');await refresh();},onError:async()=>{if(review)try{show(await api<Review>(`/publications/${review.id}`));}catch{/* Preserve the original failure and last reviewed content. */}await refresh();}});
  const resolve=useMutation({mutationFn:async()=>{if(!review||!approved)throw new Error('Approve verification of this receipt first.');return api<Review>(`/publications/${review.id}/reconcile`,{method:'POST',body:{digest:review.digest,confirmed:true}});},onSuccess:async value=>{show(value);setNotice('Consistent file hashes verified. Recovery receipt closed without writing source files.');await refresh();}});
  const busy=preview.isPending||inspect.isPending||rollback.isPending||apply.isPending||resolve.isPending,entry=review?.entries[file];
  const patch=entry?createPatch(entry.path,entry.before,entry.after,'reviewed original','approved replacement',{context:3,timeout:50,maxEditLength:20000}):null;
  const uncertain=review&&['applying','uncertain'].includes(review.status);
  const begin=(operation:()=>void)=>{setNotice('');preview.reset();inspect.reset();rollback.reset();apply.reset();resolve.reset();operation();};
  return <section className="publication" aria-label="Original project publication"><button type="button" className="text-button" aria-expanded={open} disabled={busy} onClick={()=>setOpen(!open)}>{open?'Hide publication':'Review publication to original'}</button>{open&&<div className="publication-body">
    <p className="hint">Existing files only, up to 20 files and 2 MiB of reviewed text. Relay checks every original hash and preserves unrelated files. Stop project tasks and external editors before publishing. File changes are not an atomic batch.</p>
    <button type="button" className="button" disabled={busy} onClick={()=>begin(()=>preview.mutate())}>Prepare publication review</button>
    {history.isPending&&<Loading>Reading publication history...</Loading>}
    {!!history.data?.length&&<details><summary>Saved reviews and recovery receipts ({history.data.length})</summary><ul>{history.data.map(item=><li key={item.id}><button type="button" className="text-button" disabled={busy} onClick={()=>begin(()=>inspect.mutate(item.id))}>{item.direction==='rollback'?'Rollback':'Publication'} / {item.status==='rolled_back'?'restored or unchanged':item.status} / {item.files} files / {new Date(item.createdAt).toLocaleString()}</button></li>)}</ul></details>}
    {review&&<div className="publication-review"><h4 ref={heading} tabIndex={-1}>{review.direction==='rollback'?'Review rollback':'Review original project changes'}</h4><p>Destination: <code className="publication-path">{review.sourcePath}</code></p><p className="hint">Review {review.id}. Status: {review.status==='rolled_back'?'restored or unchanged':review.status}. {review.completed.length} of {review.entries.length} writes recorded. {review.status==='preview'?`Approval expires ${new Date(review.expiresAt).toLocaleTimeString()}.`:''}</p>
      <label className="field-label">Reviewed file<select value={file} disabled={busy} onChange={event=>setFile(Number(event.target.value))}>{review.entries.map((change,index)=><option key={change.path} value={index}>{change.path}</option>)}</select></label>
      {entry&&<><pre className="bounded-output publication-patch">{patch??'Diff exceeded its comparison budget. Inspect the exact before and after contents below.'}</pre><details><summary>Inspect exact before and after contents</summary><p className="hint">Before / SHA-256 {entry.beforeHash}</p><pre className="bounded-output">{entry.before}</pre><p className="hint">After / SHA-256 {entry.afterHash}</p><pre className="bounded-output">{entry.after}</pre></details><button type="button" className="text-button" onClick={()=>downloadText(`relay-review-${review.id}.json`,JSON.stringify(review,null,2))}>Download exact review</button></>}
      {review.error&&<ErrorNotice error={review.error}/>}
      {review.status==='preview'&&<><p className="hint">Only these frozen contents are approved. Later managed edits are excluded. A conflict stops publication; an interrupted write may require manual recovery.</p><label className="check-label"><input type="checkbox" checked={approved} disabled={busy} onChange={event=>setApproved(event.target.checked)}/>I approve these exact changes to the original files</label><button type="button" className="button danger-button" disabled={!approved||busy} onClick={()=>begin(()=>apply.mutate())}>{busy?'Applying reviewed changes...':review.direction==='rollback'?'Apply approved rollback':'Publish approved changes'}</button></>}
      {(review.status==='completed'||uncertain)&&review.direction==='publish'&&<button type="button" className="button" disabled={busy} onClick={()=>begin(()=>rollback.mutate(review.id))}>Prepare rollback review</button>}
      {uncertain&&<><p className="hint">Automatic replay is blocked. Review rollback, or verify that all files match the complete original state or complete approved state. A partially written or independently changed file requires manual inspection using its private host checkpoint.</p><label className="check-label"><input type="checkbox" checked={approved} disabled={busy} onChange={event=>setApproved(event.target.checked)}/>I approve verifying this receipt without changing source files</label><button type="button" className="button" disabled={!approved||busy} onClick={()=>begin(()=>resolve.mutate())}>Verify file states and close receipt</button></>}
    </div>}
    {notice&&<p role="status">{notice}</p>}
    {(preview.isError||inspect.isError||rollback.isError||apply.isError||resolve.isError||history.isError)&&<ErrorNotice error={preview.error??inspect.error??rollback.error??apply.error??resolve.error??history.error}/>}
  </div>}</section>;
}
