import {useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {createPatch} from 'diff';
import type {Workspace} from '../../../shared/types';
import type {BranchReview,BranchFileReview,BranchIntegrationDetail,BranchIntegrationReceipt} from '../../../shared/branch-integration';
import {api} from '../../api';
import {ErrorNotice,Loading} from '../../components/ui';
import {useGuardedModalAction,useModalDraftGuard} from '../../components/modal-guard';
import {BranchFile} from './BranchFile';
import './branch-integration.css';

export default function IntegrateBranch({workspace}:{workspace:Workspace}){
  const client=useQueryClient(),request=useGuardedModalAction(),lock=useRef(false);
  const [selected,setSelected]=useState<string[]>([]),[approved,setApproved]=useState(false),[path,setPath]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false);
  const [receiptId,setReceiptId]=useState<string|null>(null),[receiptPath,setReceiptPath]=useState(''),[restoreApproved,setRestoreApproved]=useState(false);
  const base=`/workspaces/${workspace.id}/integration`,reviewKey=['branch-review',workspace.id],historyKey=['branch-integrations',workspace.id];
  const review=useQuery({queryKey:reviewKey,queryFn:({signal})=>api<BranchReview>(`${base}/preview`,{signal}),staleTime:Infinity,refetchOnWindowFocus:false});
  const history=useQuery({queryKey:historyKey,queryFn:({signal})=>api<BranchIntegrationReceipt[]>(base,{signal})});
  const file=useQuery({queryKey:['branch-file',workspace.id,review.data?.digest,path],queryFn:({signal})=>api<BranchFileReview>(`${base}/file?${new URLSearchParams({path,digest:review.data!.digest})}`,{signal}),enabled:!!path&&!!review.data});
  const receipt=useQuery({queryKey:['branch-receipt',workspace.id,receiptId],queryFn:({signal})=>api<BranchIntegrationDetail>(`${base}/${receiptId}`,{signal}),enabled:!!receiptId});
  useModalDraftGuard({dirty:selected.length>0||approved||restoreApproved,busy,label:'branch integration review'});
  const blocked=uncertain||history.isFetching||history.isPending||history.isError||history.data?.some(record=>record.state==='prepared');
  const reset=()=>{setSelected([]);setApproved(false);setPath('');setReceiptId(null);setRestoreApproved(false);};
  const refresh=()=>request(()=>{reset();setError(null);setUncertain(false);void review.refetch();void history.refetch();});
  const acknowledge=(result:BranchIntegrationReceipt,verified=false)=>{
    client.setQueryData<BranchIntegrationReceipt[]>(historyKey,current=>[result,...(current??[]).filter(item=>item.id!==result.id).map(item=>item.id===result.revertsCheckpointId?{...item,state:'reverted' as const}:item)]);
    reset();setUncertain(false);setNotice(verified?'Receipt verified. Parent files were not changed.':result.revertsCheckpointId?'Parent files restored. The child workspace is unchanged.':`Integrated ${result.paths.length} file${result.paths.length===1?'':'s'} into ${review.data?.parentName??'the parent'}.`);
    void client.invalidateQueries({queryKey:reviewKey});void client.invalidateQueries({queryKey:historyKey});void client.invalidateQueries({queryKey:['workspaces']});void client.invalidateQueries({queryKey:['workspace-files',workspace.git!.parentWorkspaceId]});
  };
  const apply=async(rollback=false,verify=false)=>{
    if(lock.current||(!verify&&blocked))return;
    if(rollback||verify?(!restoreApproved||!receiptId):(!review.data||!approved||!selected.length))return;
    lock.current=true;setBusy(true);setError(null);setNotice('');
    try{acknowledge(await api<BranchIntegrationReceipt>(verify?`${base}/${receiptId}/reconcile`:rollback?`${base}/${receiptId}/rollback`:base,{method:'POST',body:rollback||verify?{confirmed:true}:{digest:review.data!.digest,paths:selected,confirmed:true}}),verify);}
    catch(caught){setError(caught);setApproved(false);setRestoreApproved(false);setUncertain(true);void history.refetch();}
    finally{lock.current=false;setBusy(false);}
  };
  const showReceipt=(id:string)=>request(()=>{reset();setReceiptId(id);setReceiptPath('');setNotice('');});
  const selectedReceipt=history.data?.find(item=>item.id===receiptId),entry=receipt.data?.entries.find(item=>item.path===receiptPath)??receipt.data?.entries[0];
  const rollbackPatch=entry?createPatch(entry.path,entry.after??'',entry.before??'','integrated parent','restore previous parent',{context:3,timeout:50,maxEditLength:20000}):null;
  return <section className="branch-integration" aria-label="Managed branch integration">
    <div className="branch-intro"><p className="project-eyebrow">Review / Integrate / Verify</p><h3>Bring changes into {review.data?.parentName??'the parent workspace'}</h3><p>Compare this branch with its fork baseline and current parent. Choose up to 20 conflict-free files. Original source files are published separately from the parent workspace.</p><button className="button" disabled={busy||review.isFetching} onClick={refresh}>Refresh review</button></div>
    {notice&&<p className="notice" role="status">{notice}</p>}{error!=null&&<ErrorNotice error={error}/>}
    {review.isPending&&<Loading>Comparing managed files…</Loading>}{review.isError&&<ErrorNotice error={review.error}/>}
    {blocked&&<p className="notice">{history.isPending||history.isFetching?'Reading durable integration receipts…':history.isError?'Integration history is unavailable. Refresh before applying changes.':history.data?.some(item=>item.state==='prepared')?'An interrupted integration needs inspection. Automatic replay is blocked; inspect the saved receipt and current parent files.':'The last request needs review. Refresh the files and saved receipts before another attempt.'}</p>}
    {review.data&&<><ul className="branch-changes" aria-label="Branch changes">{review.data.entries.map(item=><li key={item.path}><label><input type="checkbox" aria-label={`Integrate ${item.path}`} checked={selected.includes(item.path)} disabled={busy||blocked||item.status!=='ready'||selected.length>=20&&!selected.includes(item.path)} onChange={event=>{setSelected(current=>event.target.checked?[...current,item.path]:current.filter(value=>value!==item.path));setApproved(false);}}/><span>{item.kind}</span></label><button className="text-button" disabled={busy} aria-label={`Inspect ${item.path}`} onClick={()=>setPath(item.path)}>{item.path}</button><span className={`branch-state ${item.status==='conflict'?'branch-conflict':''}`}>{item.status==='ready'?'Ready to review':item.status==='conflict'?'Conflict — resolve in editor':'Already in parent'}</span></li>)}</ul>{!review.data.entries.length&&<p className="muted">This branch has no changes from its fork baseline.</p>}
      {path&&(file.isPending?<Loading>Reading exact file versions…</Loading>:file.isError?<ErrorNotice error={file.error}/>:file.data&&<BranchFile file={file.data}/>)}
      <div className="branch-approval"><p className="hint">Divergent edits to the same file are not automatically merged. Integration changes only selected parent files. A partial write retains a recovery receipt; this is not an atomic batch.</p><label className="check-label"><input type="checkbox" checked={approved} disabled={busy||blocked||!selected.length||review.isFetching||review.isError} onChange={event=>setApproved(event.target.checked)}/>I approve selected changes to {review.data.parentName}</label><button className="button primary" disabled={busy||blocked||!approved||!selected.length||review.isFetching||review.isError} onClick={()=>{void apply();}}>{busy?'Applying reviewed changes…':'Integrate selected files'}</button></div>
    </>}
    <section className="branch-history" aria-label="Integration history"><h4>Saved integration receipts</h4>{history.isError&&<ErrorNotice error={history.error}/>}<ul>{history.data?.map(item=><li key={item.id}><button className="text-button" disabled={busy} onClick={()=>showReceipt(item.id)}>Review receipt {item.id.slice(0,8)}</button><span>{item.revertsCheckpointId?'Rollback':'Integration'} / {item.state==='prepared'?'Needs inspection':item.state==='reverted'?'Rolled back':'Completed'} / {item.paths.length} files</span></li>)}</ul>{!history.isPending&&!history.isError&&!history.data?.length&&<p className="muted">Completed and interrupted operations will appear here.</p>}</section>
    {receiptId&&<section className="branch-receipt" aria-label="Saved integration receipt"><h4>Saved parent changes</h4>{receipt.isPending&&<Loading>Reading receipt…</Loading>}{receipt.isError&&<ErrorNotice error={receipt.error}/>} {receipt.data&&<><label>Receipt file<select value={entry?.path??''} disabled={busy} onChange={event=>setReceiptPath(event.target.value)}>{receipt.data.entries.map(item=><option key={item.path}>{item.path}</option>)}</select></label><p className="hint">Proposed restoration from the saved integration. Later edits cause rollback to stop.</p><pre tabIndex={0} aria-label="Parent restoration diff">{rollbackPatch??'Diff exceeds the display limit. Inspect the saved versions below.'}</pre><details><summary>Saved exact versions</summary><h5>Before integration</h5><pre tabIndex={0}>{entry?.before===null?'File absent':entry?.before===''?'Empty file (0 bytes)':entry?.before}</pre><h5>After integration</h5><pre tabIndex={0}>{entry?.after===null?'File absent':entry?.after===''?'Empty file (0 bytes)':entry?.after}</pre></details>{selectedReceipt?.state==='prepared'&&<div className="branch-approval"><p>Verify that every parent file matches either the complete saved before state or the complete approved after state. Mixed states require manual inspection. This check does not write project files.</p><label className="check-label"><input type="checkbox" checked={restoreApproved} disabled={busy} onChange={event=>setRestoreApproved(event.target.checked)}/>I approve verifying this receipt without changing files</label><button className="button" disabled={busy||!restoreApproved} onClick={()=>{void apply(false,true);}}>Verify saved file states</button></div>}{selectedReceipt?.state==='committed'&&!selectedReceipt.revertsCheckpointId&&<div className="branch-approval"><label className="check-label"><input type="checkbox" checked={restoreApproved} disabled={busy||blocked} onChange={event=>setRestoreApproved(event.target.checked)}/>I approve restoring these parent files</label><button className="button danger-button" disabled={busy||blocked||!restoreApproved} onClick={()=>{void apply(true);}}>Restore parent files</button></div>}</>}</section>}
  </section>;
}
