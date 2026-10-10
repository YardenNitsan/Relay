import {createContext,useCallback,useContext,useEffect,useId,useLayoutEffect,useRef,useState} from 'react';

type Action=()=>void;
interface DraftState {dirty:boolean;busy:boolean;label:string}
interface GuardContext {register:(id:string,state:()=>DraftState)=>()=>void;request:(action:Action)=>void;changed:()=>void}
export const ModalGuardContext=createContext<GuardContext|null>(null);

/** A guard protects deliberate navigation, not forced account/session teardown. */
export function useModalGuardController(){
  const guards=useRef(new Map<string,()=>DraftState>());
  const [pending,setPending]=useState<{run:Action;labels:string[]}|null>(null);
  const [blocked,setBlocked]=useState(false);
  const register=useCallback((id:string,state:()=>DraftState)=>{guards.current.set(id,state);return()=>{guards.current.delete(id);};},[]);
  const changed=useCallback(()=>{if(![...guards.current.values()].some(read=>read().busy))setBlocked(false);},[]);
  const request=useCallback((action:Action)=>{
    const current=[...guards.current.values()].map(read=>read());
    if(current.some(state=>state.busy)){setBlocked(true);return;}
    setBlocked(false);const dirty=current.filter(state=>state.dirty);
    if(dirty.length){setPending({run:action,labels:dirty.map(state=>state.label)});return;}
    action();
  },[]);
  const discard=()=>{
    // A pending decision never authorizes interrupting a mutation started later.
    if([...guards.current.values()].some(read=>read().busy)){setBlocked(true);setPending(null);return;}
    const action=pending?.run;setPending(null);action?.();
  };
  return {register,request,changed,pending,blocked,discard,keep:()=>setPending(null)};
}

export function useModalDraftGuard(state:DraftState){
  const context=useContext(ModalGuardContext),id=useId(),latest=useRef(state);
  useLayoutEffect(()=>{latest.current=state;context?.changed();});
  useLayoutEffect(()=>context?.register(id,()=>latest.current),[context?.register,id]);
  useEffect(()=>{
    if(!state.dirty&&!state.busy)return;
    const beforeUnload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',beforeUnload);return()=>window.removeEventListener('beforeunload',beforeUnload);
  },[state.dirty,state.busy]);
}

export function useGuardedModalAction(){
  const context=useContext(ModalGuardContext);
  return context?.request??((action:Action)=>action());
}
