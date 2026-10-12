import {useEffect,useRef,type ReactNode} from 'react';
import {Activity, ArrowUpRight, Command, FolderOpen, Inbox, Layers, Menu, MessageSquare, Moon, Plus, Square, Sun, Users} from 'lucide-react';
import type {Destination} from '../components/Navigation';
import {useVisualViewport} from './useVisualViewport';
import {useRememberedFocus} from './useRememberedFocus';
import './relay-frame.css';

interface Props {
  children:ReactNode; connection:ReactNode; screen:'work'|'conversation'; title:string; owner:boolean;
  theme:'light'|'dark'; stopped:boolean; stopBusy:boolean; workbenchOpen:boolean;
  onDestination:(destination:Destination|'navigation')=>void; onWork:()=>void; onNew:()=>void;
  onConversation:()=>void; onWorkbench:()=>void; onTheme:()=>void; onStop:()=>void;
}
export default function RelayFrame({children,connection,screen,title,owner,theme,stopped,stopBusy,workbenchOpen,onDestination,onWork,onNew,onConversation,onWorkbench,onTheme,onStop}:Props){
  useVisualViewport();
  const modelButton=useRef<HTMLButtonElement>(null),moreButton=useRef<HTMLButtonElement>(null),lastFocus=useRememberedFocus();
  useEffect(()=>{const phone=matchMedia('(max-width:700px)');const changed=()=>{if(phone.matches&&(document.activeElement===modelButton.current||document.activeElement===document.body&&lastFocus.current===modelButton.current))moreButton.current?.focus();};phone.addEventListener('change',changed);return()=>phone.removeEventListener('change',changed);},[lastFocus]);
  return <div className="app relay-frame">
    <a className="skip-link" href={screen==='work'?'#dispatch':workbenchOpen?'#workbench':'#main'}>Skip to {screen==='work'?'work':workbenchOpen?'execution':'conversation'}</a>
    <header className="relay-masthead">
      <button className="brand relay-brand" aria-label="Relay home" onClick={onWork}><span className="relay-symbol" aria-hidden="true"><ArrowUpRight size={23}/></span>relay<span className="relay-edition">Dispatch</span></button>
      <div className="relay-connection">{connection}</div>
      <div className="relay-utilities"><button className="icon-button command-trigger" aria-label="Open command palette" onClick={()=>onDestination('commands')}><Command size={20}/></button><button className="icon-button" aria-label={`Switch to ${theme==='light'?'dark':'light'} theme`} onClick={onTheme}>{theme==='light'?<Moon size={20}/>:<Sun size={20}/>}</button>{owner&&<button className="stop-all" onClick={onStop} disabled={stopped||stopBusy}><Square size={12}/><span>{stopBusy?'Stopping…':stopped?'Stopped':'Stop all'}</span></button>}</div>
    </header>
    <nav className="relay-navigation" aria-label="Relay navigation">
      <button aria-current={screen==='work'?'page':undefined} onClick={onWork}><Inbox size={19}/><span>Work</span></button>
      <button aria-label="Conversation" aria-current={screen==='conversation'?'page':undefined} onClick={onConversation}><MessageSquare size={19}/><span className="relay-chat-desktop">Conversation</span><span className="relay-chat-phone">Chat</span></button>
      <button onClick={()=>onDestination('agents')}><Users size={19}/><span>Agents</span></button>
      <button onClick={()=>onDestination('workspaces')}><FolderOpen size={19}/><span>Projects</span></button>
      <button ref={modelButton} className="relay-nav-models" onClick={()=>onDestination('models')}><Layers size={19}/><span>Models</span></button>
      <button ref={moreButton} className="mobile-navigation" aria-label="Open navigation" onClick={()=>onDestination('navigation')}><Menu size={19}/><span>More</span></button>
    </nav>
    <div className="relay-context"><button className="conversation-switcher" aria-label="Open conversation history" onClick={()=>onDestination('history')}><span>{screen==='work'?'Your conversations':title}</span><ArrowUpRight size={15}/></button><div><button className="icon-button" aria-label="Open execution workbench" onClick={onWorkbench}><Activity size={18}/></button><button className="relay-new" onClick={onNew}><Plus size={18}/><span>New conversation</span></button></div></div>
    <div className="relay-content">{children}</div>
  </div>;
}
