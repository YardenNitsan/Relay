import {useEffect,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {errorMessage,mutation,onSessionInvalidated} from '../api';
import type {WorkspaceStatus} from './GoogleWorkspace';

interface ReturnInput {state:string;code?:string;error?:string;}
// This module must be eagerly imported by App: scrub before any App requests.
function capture():ReturnInput|null{
  const url=new URL(window.location.href);if(url.searchParams.get('relay_workspace')!=='1')return null;
  const state=url.searchParams.get('state')??'',code=url.searchParams.get('code'),error=url.searchParams.get('error');
  window.history.replaceState({},'',url.pathname);
  if(state.length>128||(code?.length??0)>4096||(error?.length??0)>128)return {state:'',error:'invalid_response'};
  return {state,...error?{error}:code?{code}:{}};
}
let pending=capture();const returned=pending!==null;let exchange:Promise<WorkspaceStatus>|null=null;
onSessionInvalidated(()=>{pending=null;exchange=null;});
function complete(){if(!exchange){const input=pending;pending=null;exchange=input?.state?mutation<WorkspaceStatus>('/integrations/google-workspace/complete',input):Promise.reject(new Error('Google Workspace sign-in was incomplete or this Relay session changed. Connect again from Google Workspace.'));}return exchange;}
export default function GoogleWorkspaceReturn({onOpen}:{onOpen:()=>void}){
  const client=useQueryClient(),[dismissed,setDismissed]=useState(false),[result,setResult]=useState<{done:boolean;error?:string}>({done:false});
  useEffect(()=>{if(!returned)return;let active=true;void complete().then(status=>{if(!status.connected)throw new Error('Google did not confirm a saved Workspace connection. Connect again.');client.setQueryData(['google-workspace'],status);if(active)setResult({done:true});}).catch(error=>{if(active)setResult({done:true,error:errorMessage(error)});});return()=>{active=false;};},[client]);
  if(!returned||dismissed)return null;
  return <section className={`notice ${result.error?'warning':''}`} aria-label="Google Workspace sign-in result" role={result.error?'alert':'status'}><p>{!result.done?'Completing Google Workspace authorization…':result.error??'Google Workspace connected for your Relay account. Mail and calendar are read only when you request them.'}</p>{result.done&&<div className="button-row"><button className="button" onClick={onOpen}>Open Google Workspace</button><button className="button" onClick={()=>setDismissed(true)}>Dismiss</button></div>}</section>;
}
