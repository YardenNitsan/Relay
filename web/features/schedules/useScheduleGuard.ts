import {useLayoutEffect} from 'react';
import {useModalDraftGuard} from '../../components/modal-guard';
export function useScheduleGuard(dirty:boolean,busy:boolean,label:string,onBusy:(busy:boolean)=>void){
  useModalDraftGuard({dirty,busy,label});
  useLayoutEffect(()=>{onBusy(busy);return()=>onBusy(false);},[busy,onBusy]);
}
