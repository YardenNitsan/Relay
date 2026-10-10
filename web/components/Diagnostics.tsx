import {useMutation} from '@tanstack/react-query';
import {api,downloadText} from '../api';
import {ErrorNotice} from './ui';
export default function Diagnostics(){
  const exportBundle=useMutation({mutationFn:()=>api('/admin/diagnostics',{method:'POST',body:{days:7,maxTasks:200}}),onSuccess:value=>downloadText('relay-diagnostics.json',JSON.stringify(value,null,2))});
  return <section className="hardware-section"><h3>Diagnostics</h3><p className="hint">Export up to 200 of your tasks from the last seven days. Includes status, counts and recorded timings with anonymous correlation IDs. Excludes conversation text, prompts, tool content, model names, paths and credentials.</p><button className="button secondary" disabled={exportBundle.isPending} onClick={()=>exportBundle.mutate()}>{exportBundle.isPending?'Preparing diagnostics…':'Export diagnostic bundle'}</button>{exportBundle.isError&&<ErrorNotice error={exportBundle.error}/>}</section>;
}
