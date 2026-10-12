import {createPatch} from 'diff';
import type {BranchFileReview} from '../../../shared/branch-integration';

export function BranchFile({file}:{file:BranchFileReview}){
  const patch=createPatch(file.path,file.parent??'',file.child??'',file.parent===null?'absent in parent':'current parent',file.child===null?'delete from parent':'reviewed child',{context:3,timeout:50,maxEditLength:20000});
  return <section className="branch-file" aria-label="Reviewed file difference"><h4>{file.path}</h4><pre tabIndex={0} aria-label="Proposed parent diff">{patch??'Diff exceeds the display limit. Inspect the exact versions below.'}</pre><details><summary>Compare exact versions</summary>{([['Fork baseline',file.base],['Current parent',file.parent],['Current child',file.child]] as const).map(([label,content])=><div key={label}><h5>{label}</h5><pre tabIndex={0} aria-label={label}>{content===null?'File absent':content===''?'Empty file (0 bytes)':content}</pre></div>)}</details></section>;
}
