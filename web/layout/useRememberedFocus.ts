import {useEffect,useRef} from 'react';

/** CSS can hide the focused element before matchMedia fires and reset focus to body. */
export function useRememberedFocus() {
  const lastFocused=useRef<Element|null>(null);
  useEffect(()=>{
    lastFocused.current=document.activeElement;
    const remember=(event:FocusEvent)=>{if(event.target instanceof Element)lastFocused.current=event.target;};
    document.addEventListener('focusin',remember);
    return ()=>document.removeEventListener('focusin',remember);
  },[]);
  return lastFocused;
}
