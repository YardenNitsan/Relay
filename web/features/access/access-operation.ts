import {createContext,useContext,useId,useLayoutEffect} from 'react';
import {useModalDraftGuard} from '../../components/modal-guard';
export const AccessOperationContext=createContext<(id:string,busy:boolean)=>void>(()=>undefined);
export const AccessBusyContext=createContext(false);
export const useAccessBusy=()=>useContext(AccessBusyContext);
export function useAccessGuard({dirty,busy,label}:{dirty:boolean;busy:boolean;label:string}){
  const report=useContext(AccessOperationContext),id=useId();
  useModalDraftGuard({dirty,busy,label});
  useLayoutEffect(()=>{report(id,busy);return()=>report(id,false);},[report,id,busy]);
}
