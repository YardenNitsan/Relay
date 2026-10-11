import {useEffect} from 'react';

/** Follow the browser's visible area, never infer a keyboard from a fixed height.
 * Pinch zoom keeps the normal layout instead of continually shrinking it. */
export function useVisualViewport(){
  useEffect(()=>{
    const viewport=window.visualViewport;if(!viewport)return;
    const root=document.documentElement;let frame=0;
    const update=()=>{
      cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
        if(viewport.scale!==1){root.style.removeProperty('--relay-viewport-height');root.style.removeProperty('--relay-viewport-offset');return;}
        root.style.setProperty('--relay-viewport-height',`${Math.max(1,viewport.height)}px`);
        root.style.setProperty('--relay-viewport-offset',`${Math.max(0,viewport.offsetTop)}px`);
      });
    };
    update();viewport.addEventListener('resize',update);viewport.addEventListener('scroll',update);
    return()=>{cancelAnimationFrame(frame);viewport.removeEventListener('resize',update);viewport.removeEventListener('scroll',update);root.style.removeProperty('--relay-viewport-height');root.style.removeProperty('--relay-viewport-offset');};
  },[]);
}
