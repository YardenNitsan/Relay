import {useEffect,useRef,type ReactNode} from 'react';
import {Activity,BarChart3,ChevronDown,Command,Cpu,FolderOpen,Layers,Menu,MessageSquare,Moon,Plus,Settings,ShieldCheck,Square,Sun} from 'lucide-react';
import type {Destination} from '../components/Navigation';
import {useRememberedFocus} from './useRememberedFocus';
import {useVisualViewport} from './useVisualViewport';
import './studio-frame.css';

interface Props {
  children:ReactNode;title:string;hostName?:string;owner:boolean;theme:'light'|'dark';stopped:boolean;stopBusy:boolean;workbenchOpen:boolean;
  onDestination:(destination:Destination|'navigation')=>void;onNew:()=>void;onConversation:()=>void;onWorkbench:()=>void;onTheme:()=>void;onStop:()=>void;
}
function Brand({onClick,mobile=false}:{onClick:()=>void;mobile?:boolean}) {
  return <button className={`brand studio-brand ${mobile?'studio-brand-mobile':''}`} onClick={onClick} aria-label="Relay home"><span className="brand-mark" aria-hidden="true"><i/><i/><i/></span><span className="studio-brand-name">relay</span></button>;
}
export default function StudioFrame({children,title,hostName,owner,theme,stopped,stopBusy,workbenchOpen,onDestination,onNew,onConversation,onWorkbench,onTheme,onStop}:Props) {
  useVisualViewport();
  const navigation=useRef<HTMLElement>(null);
  const mobileMenu=useRef<HTMLButtonElement>(null);
  const lastFocused=useRememberedFocus();
  useEffect(()=>{
    const compact=window.matchMedia('(max-width: 700px)');
    const resized=()=>{
      const active=document.activeElement===document.body?lastFocused.current:document.activeElement;
      if(compact.matches&&(navigation.current?.contains(active)||active?.closest('.studio-new')))mobileMenu.current?.focus();
      else if(!compact.matches&&active===mobileMenu.current)navigation.current?.querySelector<HTMLButtonElement>('[aria-label="Open navigation"]')?.focus();
      else if(!compact.matches&&active?.closest('.studio-brand-mobile'))navigation.current?.querySelector<HTMLButtonElement>('.brand')?.focus();
    };
    compact.addEventListener('change',resized);
    return ()=>compact.removeEventListener('change',resized);
  },[lastFocused]);
  return <div className="app studio-frame">
    <a className="skip-link" href={workbenchOpen?'#workbench':'#main'}>{workbenchOpen?'Skip to execution':'Skip to conversation'}</a>
    <nav ref={navigation} className="studio-navigation" aria-label="Relay studio">
      <Brand onClick={onNew}/>
      <div className="studio-destinations">
        <button aria-label="Conversation" aria-current={!workbenchOpen?'page':undefined} onClick={onConversation}><MessageSquare size={19}/><span>Conversation</span></button>
        <button aria-label="Open execution workbench" aria-current={workbenchOpen?'page':undefined} onClick={onWorkbench}><Activity size={19}/><span>Workbench</span></button>
        <button aria-label="Projects" onClick={()=>onDestination('workspaces')}><FolderOpen size={19}/><span>Projects</span></button>
        <button aria-label="Models" onClick={()=>onDestination('models')}><Layers size={19}/><span>Models</span></button>
      </div>
      <div className="studio-administration">
        <button aria-label="Open navigation" onClick={()=>onDestination('navigation')}><Menu size={19}/><span>More & account</span></button>
        <button aria-label="Usage" onClick={()=>onDestination('usage')}><BarChart3 size={19}/><span>Usage</span></button>
        <button aria-label="Settings" onClick={()=>onDestination('settings')}><Settings size={19}/><span>Settings</span></button>
        {owner&&<><button aria-label="Machine" onClick={()=>onDestination('hardware')}><Cpu size={19}/><span>Host resources</span></button><button aria-label="Access" onClick={()=>onDestination('access')}><ShieldCheck size={19}/><span>Access</span></button></>}
        <button className="command-trigger" aria-label="Open command palette" onClick={()=>onDestination('commands')}><Command size={19}/><span>Commands</span></button>
        <button aria-label={`Switch to ${theme==='light'?'dark':'light'} theme`} onClick={onTheme}>{theme==='light'?<Moon size={19}/>:<Sun size={19}/>}<span>{theme==='light'?'Dark':'Light'} appearance</span></button>
      </div>
      <div className="studio-host" role="group" aria-label={`Execution host: ${hostName??'not reported'}`}><span className="studio-host-symbol" aria-hidden="true"><Cpu size={18}/></span><div><span>Relay Host</span><strong title={hostName}>{hostName??'Not reported'}</strong></div></div>
    </nav>
    <div className="studio-document">
      <header className="studio-header">
        <Brand onClick={onNew} mobile/>
        <button className="conversation-switcher" aria-label="Open conversation history" onClick={()=>onDestination('history')}><span>{title}</span><ChevronDown size={15}/></button>
        <button className="icon-button studio-new" aria-label="New conversation" onClick={onNew}><Plus size={19}/></button>
        <div className="studio-header-actions"><button ref={mobileMenu} className="mobile-navigation studio-menu" aria-label="Open navigation" onClick={()=>onDestination('navigation')}><Menu size={20}/><span>Menu</span></button>
          {owner&&<button className="stop-all" onClick={onStop} disabled={stopped||stopBusy}><Square size={12} fill="currentColor"/><span>{stopBusy?'Stopping…':stopped?'Stopped':'Stop all'}</span></button>}
        </div>
      </header>
      {children}
    </div>
  </div>;
}
