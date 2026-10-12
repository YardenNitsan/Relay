import { useState } from 'react';
import { Activity, BarChart3, Bell, ChevronRight, Command, Cpu, FolderOpen, History, Layers, LogOut, Moon, Plus, Plug, Settings, ShieldCheck, Sun, UserRound, Workflow, KeyRound, type LucideIcon } from 'lucide-react';
import { mutation, type SessionInfo } from '../api';
import { ErrorNotice, Modal } from './ui';
import '../features/navigation/navigation.css';

export type Destination = 'history' | 'models' | 'hardware' | 'workspaces' | 'commands' | 'access' | 'mcp' | 'agents' | 'clients' | 'usage' | 'notifications' | 'memory' | 'schedules' | 'google-workspace' | 'settings';
type NavigationItem = {destination:Destination;label:string;icon:LucideIcon;ownerOnly?:boolean};
const groups: {id:string;title:string;description:string;items:NavigationItem[]}[] = [
  {id:'work',title:'Work',description:'Conversations, agents and their activity.',items:[
    {destination:'history',label:'Conversation history',icon:History},
    {destination:'agents',label:'Agents',icon:Workflow},
    {destination:'workspaces',label:'Workspaces',icon:FolderOpen},
    {destination:'schedules',label:'Scheduled tasks',icon:Workflow,ownerOnly:true},
  ]},
  {id:'connections',title:'Connections',description:'Models, services and permitted tools.',items:[
    {destination:'models',label:'Models & providers',icon:Layers},
    {destination:'google-workspace',label:'Google Workspace',icon:Plug},
    {destination:'clients',label:'External clients',icon:KeyRound},
    {destination:'mcp',label:'MCP tools',icon:Plug,ownerOnly:true},
  ]},
  {id:'personal',title:'Personal',description:'Preferences and your saved context.',items:[
    {destination:'settings',label:'Settings',icon:Settings},
    {destination:'notifications',label:'Task notifications',icon:Bell},
    {destination:'memory',label:'Memory',icon:FolderOpen},
    {destination:'usage',label:'Usage',icon:BarChart3},
  ]},
  {id:'host',title:'Host',description:'Owner controls for this execution host.',items:[
    {destination:'hardware',label:'This machine',icon:Cpu,ownerOnly:true},
    {destination:'access',label:'Access & remote connections',icon:ShieldCheck,ownerOnly:true},
  ]},
];
export default function Navigation({ owner, theme, hostName, session, onDestination, onNew, onActivity, onTheme, onClose }: { owner: boolean; theme: 'dark' | 'light'; hostName?: string; session?: SessionInfo; onDestination: (destination: Destination) => void; onNew: () => void; onActivity: () => void; onTheme: () => void; onClose: () => void }) {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true); setError(null);
    try { await mutation('/session/logout'); window.location.assign(session?.connection === 'lan' ? '/' : '/cdn-cgi/access/logout'); }
    catch (caught) { setError(caught); setSigningOut(false); }
  };
  return <Modal title="Navigate Relay" onClose={onClose} className="navigation-modal dispatch-navigation">
    <section className="navigation-identity" aria-label="Account and execution host"><span className="navigation-avatar"><UserRound size={22} aria-hidden="true"/></span><div><strong dir="auto">{session?.user?.name ?? (owner ? 'Local owner' : 'Relay account')}</strong>{session?.user?.email && <p dir="auto">{session.user.email}</p>}<dl><dt>Execution host</dt><dd dir="auto">{hostName ?? 'Host not reported'}</dd><dt>Connection</dt><dd>{session?.connection === 'lan' ? 'Local network browser' : session?.remote ? 'Remote browser' : 'Local browser'}</dd></dl></div></section>
    <nav className="navigation-list" aria-label="Relay destinations">
      {groups.map(group=>{
        const items=group.items.filter(item=>!item.ownerOnly||owner);
        if(!items.length)return null;
        return <section className="navigation-group" key={group.id} aria-labelledby={`navigation-${group.id}`}><h3 id={`navigation-${group.id}`}>{group.title}</h3><p>{group.description}</p>
          {group.id==='work'&&<button className="navigation-new" onClick={onNew}><Plus size={18} aria-hidden="true"/><span>New conversation</span></button>}
          {items.map(item=><button key={item.destination} onClick={()=>onDestination(item.destination)}><item.icon size={18} aria-hidden="true"/><span>{item.label}</span><ChevronRight size={14} aria-hidden="true"/></button>)}
          {group.id==='work'&&<button onClick={onActivity}><Activity size={18} aria-hidden="true"/><span>Activity & approvals</span><ChevronRight size={14} aria-hidden="true"/></button>}
        </section>;
      })}
    </nav>
    <div className="navigation-secondary"><button onClick={onTheme}>{theme === 'light' ? <Moon size={18} aria-hidden="true"/> : <Sun size={18} aria-hidden="true"/>}Switch to {theme === 'light' ? 'dark' : 'light'} theme</button><button onClick={() => onDestination('commands')}><Command size={18} aria-hidden="true"/>Command palette<kbd>Ctrl K</kbd></button>{session?.remote && <div className="navigation-session"><button disabled={signingOut} onClick={() => { void signOut(); }}><LogOut size={18} aria-hidden="true"/>{signingOut ? 'Signing out…' : 'Sign out'}</button><p className="hint navigation-signout-hint">{session?.connection === 'lan' ? 'Signs out of this browser. A new invitation is needed to reconnect.' : 'Signs out of Relay and this Cloudflare Access session.'}</p></div>}</div>{error != null && <ErrorNotice error={error} />}
  </Modal>;
}
