import {Check,ChevronRight,Monitor,Moon,Sun,UserRound} from 'lucide-react';
import type {SessionInfo} from '../../api';
import type {Destination} from '../../components/Navigation';
import type {NotificationControls} from '../../useTaskNotifications';
import TaskNotifications from '../../components/TaskNotifications';
import './settings.css';

interface Props {owner:boolean;theme:'light'|'dark';session?:SessionInfo;notifications:NotificationControls;onTheme:(theme:'light'|'dark')=>void;onDestination:(destination:Destination)=>void}
const connections:[Destination,string,string][]=[
  ['models','Models & providers','Inspect available models and your provider connections.'],
  ['google-workspace','Google Workspace','Connect your account for read-only mail and calendar access.'],
  ['clients','External clients','Issue and revoke permitted model API credentials.'],
];
const personal:[Destination,string,string][]=[
  ['memory','Memory','Review saved notes, preferences and their scope.'],
  ['usage','Usage','See measured activity and reported provider limits.'],
];
const host:[Destination,string,string][]=[
  ['hardware','Host resources','Hardware measurements, model safety and recovery.'],
  ['access','Access & devices','Protected gateways, allowed people and browser sessions.'],
  ['mcp','MCP tools','Review pinned tool contracts and server access.'],
  ['schedules','Scheduled tasks','Authorize recurring local work and review its runs.'],
];
export default function SettingsStudio({owner,theme,session,notifications,onTheme,onDestination}:Props){
  const destinations=(rows:typeof personal)=><ul className="settings-destinations">{rows.map(([destination,label,description])=><li key={destination}><button aria-label={label} onClick={()=>onDestination(destination)}><span><strong>{label}</strong><span>{description}</span></span><ChevronRight size={18} aria-hidden="true"/></button></li>)}</ul>;
  return <div className="settings-studio dispatch-settings">
    <header className="settings-identity"><div className="settings-account"><span className="settings-avatar"><UserRound size={22} aria-hidden="true"/></span><div><p dir="auto">{session?.user?.name??'Your Relay account'}</p>{session?.user?.email&&<span dir="auto">{session.user.email}</span>}<span>{owner?'Host owner':'Relay account'}</span></div></div><div className="settings-host-identity"><Monitor size={18} aria-hidden="true"/><div><span>Execution host</span><strong dir="auto">{session?.hostName??'Not reported'}</strong><span>{session?.connection==='lan'?'Local network connection':session?.remote?'Protected remote connection':'Local browser connection'}</span></div></div></header>
    <div className="settings-document">
      <section className="settings-document-row" aria-labelledby="settings-appearance"><div className="settings-row-label"><h3 id="settings-appearance">Appearance</h3><p>Choose a reading surface for this browser.</p></div><div className="settings-appearance" role="group" aria-label="Reading appearance">{(['light','dark'] as const).map(value=><button key={value} aria-label={value==='light'?'Light appearance':'Dark appearance'} aria-pressed={theme===value} onClick={()=>onTheme(value)}><span className={`settings-theme-preview preview-${value}`} aria-hidden="true"><i/><span><i/><i/><i/></span></span><span className="settings-theme-label">{value==='light'?<Sun size={17} aria-hidden="true"/>:<Moon size={17} aria-hidden="true"/>}{value==='light'?'Light':'Dark'}{theme===value&&<Check size={17} aria-hidden="true"/>}</span></button>)}</div></section>
      <div className="settings-notification-row"><TaskNotifications controls={notifications}/></div>
      <section className="settings-document-row" aria-labelledby="settings-connections"><div className="settings-row-label"><h3 id="settings-connections">Connections</h3><p>Models and services available to your account.</p></div>{destinations(connections)}</section>
      <section className="settings-document-row" aria-labelledby="settings-personal"><div className="settings-row-label"><h3 id="settings-personal">Personal records</h3><p>Saved context and measured activity.</p></div>{destinations(personal)}</section>
      {owner&&<section className="settings-document-row" aria-labelledby="settings-host"><div className="settings-row-label"><h3 id="settings-host">Host settings</h3><p>These controls affect the host and its authorized users.</p></div>{destinations(host)}</section>}
      <p className="settings-policy">Model choice, cloud sharing and spending limits belong to each conversation. Opening Settings grants no additional access.</p>
    </div>
  </div>;
}
