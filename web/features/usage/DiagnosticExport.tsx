import {useRef} from 'react';
import {useMutation} from '@tanstack/react-query';
import {Download} from 'lucide-react';
import {api,downloadText} from '../../api';
import {ErrorNotice} from '../../components/ui';
import {useModalDraftGuard} from '../../components/modal-guard';
import './diagnostics.css';

export default function DiagnosticExport(){
  const lock=useRef(false);
  const exportBundle=useMutation({mutationFn:()=>api('/admin/diagnostics',{method:'POST',body:{days:7,maxTasks:200}}),onSuccess:value=>downloadText('relay-diagnostics.json',JSON.stringify(value,null,2)),onSettled:()=>{lock.current=false;}});
  useModalDraftGuard({dirty:false,busy:exportBundle.isPending,label:'Diagnostic export'});
  return <section className="diagnostic-export" aria-labelledby="diagnostic-export-title">
    <header><h3 id="diagnostic-export-title">Diagnostics</h3><p>A bounded report for investigating task execution.</p></header>
    <p className="diagnostic-export-scope">Your account · last seven days · up to 200 tasks</p>
    <dl><div><dt>Included</dt><dd>Status, counts and recorded timings with anonymous correlation IDs.</dd></div><div><dt>Excluded</dt><dd>Conversation text, prompts, tool content, model names, paths and credentials.</dd></div></dl>
    <p className="diagnostic-export-format">Downloads a JSON file to this browser. Exporting does not delete or change your tasks.</p>
    <button className="button secondary" disabled={exportBundle.isPending} onClick={()=>{if(lock.current)return;lock.current=true;exportBundle.mutate();}}><Download size={17} aria-hidden="true"/>{exportBundle.isPending?'Preparing diagnostics…':'Export diagnostic bundle'}</button>
    {exportBundle.isPending&&<p role="status">Preparing your report. Keep this view open until it finishes.</p>}
    {exportBundle.isSuccess&&<p role="status">Diagnostic file prepared. Your browser handles the download.</p>}
    {exportBundle.isError&&<ErrorNotice error={exportBundle.error}/>}
  </section>;
}
