import {useEffect,useRef,useState} from 'react';
import type {ActivityEvent,TaskRecord} from '../shared/types';
import {CompletionTracker,completionMessage,notificationSupport} from './task-notifications';
import {onSessionInvalidated} from './api';

export interface NotificationControls {enabled:boolean;pending:boolean;permission:NotificationPermission|'unsupported';supported:boolean;enable:()=>Promise<void>;disable:()=>void;notice:string|null;dismiss:()=>void;track:(taskId:string)=>void;}
export function useTaskNotifications({userId,enabled:sessionReady,events,tasks}:{userId?:string;enabled:boolean;events:ActivityEvent[];tasks:TaskRecord[]}):NotificationControls {
  const tracker=useRef(new CompletionTracker());const identity=useRef(userId);const allowed=useRef(sessionReady);const notifications=useRef(new Set<Notification>());
  const [enabled,setEnabled]=useState(false);const [notice,setNotice]=useState<string|null>(null);
  const [pending,setPending]=useState(false);const permissionPending=useRef(false),lifetime=useRef(0);
  const [admission,setAdmission]=useState(0);
  const supported=notificationSupport();const [permission,setPermission]=useState<NotificationControls['permission']>(()=>supported?Notification.permission:'unsupported');
  useEffect(()=>{lifetime.current++;identity.current=userId;tracker.current=new CompletionTracker();allowed.current=sessionReady;setNotice(null);
    let selected=false;try{selected=!!userId&&localStorage.getItem(`relay:notifications:v1:${userId}`)==='enabled';}catch{/* Preference storage is optional. */}setEnabled(selected);
    return ()=>{lifetime.current++;allowed.current=false;for(const notification of notifications.current)notification.close();notifications.current.clear();};
  },[userId,sessionReady]);
  useEffect(()=>onSessionInvalidated(()=>{lifetime.current++;allowed.current=false;tracker.current=new CompletionTracker();setNotice(null);setEnabled(false);for(const notification of notifications.current)notification.close();notifications.current.clear();}),[]);
  useEffect(()=>{
    if(!sessionReady||!userId||identity.current!==userId||!allowed.current)return;
    tracker.current.observe(tasks);
    const completed=tracker.current.consume(events);if(!completed.length)return;
    setNotice(completed.length===1?'Task complete. Your result is ready.':`${completed.length} tasks completed. Their results are ready.`);
    if(!enabled||!supported||Notification.permission!=='granted'||document.visibilityState!=='hidden')return;
    try{
      // Generic content only: no objective, answer, file name, model or user identity.
      const notification=new Notification('Relay task complete',{body:completionMessage,tag:'relay-task-completion'});notifications.current.add(notification);
      notification.onclick=()=>{if(allowed.current&&identity.current===userId)window.focus();notification.close();};
      notification.onclose=()=>notifications.current.delete(notification);
      notification.onerror=()=>{setNotice('Task complete. This browser could not display a system notification. Your result is ready in Relay.');notification.close();};
    }catch{setNotice('Task complete. This browser supports in-app alerts only. Your result is ready in Relay.');}
  },[events,tasks,sessionReady,userId,enabled,supported,admission]);
  useEffect(()=>{const visible=()=>{if(document.visibilityState==='visible'){setPermission(notificationSupport()?Notification.permission:'unsupported');for(const notification of notifications.current)notification.close();notifications.current.clear();}};document.addEventListener('visibilitychange',visible);return()=>document.removeEventListener('visibilitychange',visible);},[]);
  const save=(value:boolean)=>{setEnabled(value);if(userId)try{localStorage.setItem(`relay:notifications:v1:${userId}`,value?'enabled':'disabled');}catch{/* Keep the session preference. */}};
  const enable=async()=>{
    if(permissionPending.current)return;
    if(!supported){setNotice('System notifications are unavailable here. Completion alerts remain available in Relay.');return;}
    if(!allowed.current||!userId)return;const startingUser=userId,startingLifetime=lifetime.current;
    const current=()=>allowed.current&&identity.current===startingUser&&lifetime.current===startingLifetime;
    permissionPending.current=true;setPending(true);
    try{const result=await Notification.requestPermission();if(!current())return;setPermission(result);save(result==='granted');if(result!=='granted')setNotice('Notifications were not enabled. You can allow them in browser site settings; in-app completion alerts remain available.');}
    catch{if(current())setNotice('This browser could not enable system notifications. In-app completion alerts remain available.');}
    finally{permissionPending.current=false;setPending(false);}
  };
  return {enabled,pending,permission,supported,enable,disable:()=>{lifetime.current++;save(false);for(const notification of notifications.current)notification.close();notifications.current.clear();},notice,dismiss:()=>setNotice(null),track:taskId=>{if(allowed.current&&identity.current===userId){tracker.current.track(taskId);setAdmission(value=>value+1);}}};
}
