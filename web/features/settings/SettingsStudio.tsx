import {ChevronRight,Monitor,Moon,Sun} from 'lucide-react';
import type {SessionInfo} from '../../api';
import type {Destination} from '../../components/Navigation';
import type {NotificationControls} from '../../useTaskNotifications';
import TaskNotifications from '../../components/TaskNotifications';
import './settings.css';

interface Props {owner:boolean;theme:'light'|'dark';session?:SessionInfo;notifications:NotificationControls;onTheme:(theme:'light'|'dark')=>void;onDestination:(destination:Destination)=>void}
const personal:[Destination,string,string][]=[
  ['models','Models & providers','Inspect available models and your provider connections.'],
  ['google-workspace','Google Workspace','Connect your account for read-only mail and calendar access.'],
  ['clients','External clients','Issue and revoke permitted model API credentials.'],
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
  return <div className="settings-studio">
    <header className="settings-identity"><Monitor size={22} aria-hidden="true"/><div><p dir="auto">{session?.user?.name??'Your Relay account'}</p><span>Execution host: <strong dir="auto">{session?.hostName??'Not reported'}</strong></span><span>{session?.connection==='lan'?'Local network connection':session?.remote?'Protected remote connection':'Local browser connection'}</span></div></header>
    <div className="settings-columns"><div className="settings-preferences">
      <section aria-labelledby="settings-appearance"><h3 id="settings-appearance">Appearance</h3><p>Choose a reading surface for this browser.</p><div className="settings-appearance" role="group" aria-label="Reading appearance"><button aria-label="Light appearance" aria-pressed={theme==='light'} onClick={()=>onTheme('light')}><Sun size={20} aria-hidden="true"/>Light</button><button aria-label="Dark appearance" aria-pressed={theme==='dark'} onClick={()=>onTheme('dark')}><Moon size={20} aria-hidden="true"/>Dark</button></div></section>
      <TaskNotifications controls={notifications}/>
      <p className="settings-policy">Model choice, cloud sharing and spending limits belong to each conversation. Opening Settings grants no additional access.</p>
    </div><div className="settings-connections">
      <section aria-labelledby="settings-connections"><h3 id="settings-connections">Connections</h3>{destinations(personal)}</section>
      {owner&&<section aria-labelledby="settings-host"><h3 id="settings-host">Host settings</h3><p className="hint">These controls affect the host and its authorized users.</p>{destinations(host)}</section>}
    </div></div>
  </div>;
}
