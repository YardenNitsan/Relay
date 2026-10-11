import {createContext,useContext,useId,useLayoutEffect} from 'react';
import {useModalDraftGuard} from '../../components/modal-guard';

/** Pending admission has no durable task to recover yet. Keep its inspector
 * mounted until acknowledgement; already admitted tasks may be left running. */
export const ModelOperationContext=createContext<(id:string,busy:boolean)=>void>(()=>{});
export function useModelOperation(busy:boolean,label:string){
  const report=useContext(ModelOperationContext),id=useId();
  useModalDraftGuard({dirty:false,busy,label});
  useLayoutEffect(()=>{report(id,busy);return()=>report(id,false);},[report,id,busy]);
}
