import {lazy,Suspense} from 'react';
import {codeLanguage,lineEnding} from './editor-document';

const CodeEditor=lazy(()=>import('./CodeEditor'));
export interface SourceContentsProps {path:string;label:string;content:string;readOnly:boolean;busy:boolean;onChange:(value:string)=>void}
export default function SourceContents(props:SourceContentsProps){
  const {path,label,content,readOnly,busy,onChange}=props;
  if(!codeLanguage(path))return <label>{label}<textarea aria-label={label} value={content} readOnly={readOnly} disabled={busy} spellCheck={false} rows={10} onChange={event=>onChange(event.target.value)}/></label>;
  if(lineEnding(content)==='mixed')return <section className="source-mixed" aria-label={label}>
    <p className="notice warning">This file uses mixed line endings. Choose a consistent format to edit it. The saved file stays unchanged until you save.</p>
    {!readOnly&&<div className="workspace-file-actions"><button className="button" disabled={busy} onClick={()=>onChange(content.replace(/\r\n|\r|\n/g,'\n'))}>Edit with LF line endings</button><button className="button" disabled={busy} onClick={()=>onChange(content.replace(/\r\n|\r|\n/g,'\r\n'))}>Edit with CRLF line endings</button></div>}
    <pre tabIndex={0}>{content}</pre>
  </section>;
  return <Suspense fallback={<p role="status">Opening source editor…</p>}><CodeEditor {...props}/></Suspense>;
}
