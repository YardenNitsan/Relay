import { useState } from 'react';
import { Activity, BarChart3, Bell, Command, Cpu, FolderOpen, History, Layers, LogOut, Moon, Plus, Plug, ShieldCheck, Sun, UserRound, Workflow, KeyRound } from 'lucide-react';
import { mutation, type SessionInfo } from '../api';
import { ErrorNotice, Modal } from './ui';

export type Destination = 'history' | 'models' | 'hardware' | 'workspaces' | 'commands' | 'access' | 'mcp' | 'agents' | 'clients' | 'usage' | 'notifications' | 'memory' | 'schedules' | 'google-workspace';
export default function Navigation({ owner, theme, hostName, session, onDestination, onNew, onActivity, onTheme, onClose }: { owner: boolean; theme: 'dark' | 'light'; hostName?: string; session?: SessionInfo; onDestination: (destination: Destination) => void; onNew: () => void; onActivity: () => void; onTheme: () => void; onClose: () => void }) {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true); setError(null);
    try { await mutation('/session/logout'); window.location.assign(session?.connection === 'lan' ? '/' : '/cdn-cgi/access/logout'); }
    catch (caught) { setError(caught); setSigningOut(false); }
  };
  return <Modal title="Navigate Relay" onClose={onClose} className="navigation-modal"><section className="navigation-identity" aria-label="Account and execution host"><UserRound size={23} /><div><strong>{session?.user?.name ?? (owner ? 'Local owner' : 'Relay account')}</strong>{session?.user?.email && <p>{session.user.email}</p>}<dl><dt>Execution host</dt><dd>{hostName ?? 'Host not reported'}</dd><dt>Connection</dt><dd>{session?.connection === 'lan' ? 'Local network browser' : session?.remote ? 'Remote browser' : 'Local browser'}</dd></dl></div></section><nav className="navigation-list" aria-label="Relay destinations">
    <button onClick={onNew}><Plus size={20} /><span>New conversation</span></button>
    <button onClick={() => onDestination('history')}><History size={20} /><span>Conversation history</span></button>
    <button onClick={() => onDestination('agents')}><Workflow size={20} /><span>Agents</span></button>
    <button onClick={() => onDestination('models')}><Layers size={20} /><span>Models & providers</span></button>
    <button onClick={() => onDestination('usage')}><BarChart3 size={20} /><span>Usage</span></button>
    <button onClick={() => onDestination('notifications')}><Bell size={20} /><span>Task notifications</span></button>
    <button onClick={() => onDestination('clients')}><KeyRound size={20} /><span>External clients</span></button>
    {owner && <button onClick={() => onDestination('mcp')}><Plug size={20} /><span>MCP tools</span></button>}
    <button onClick={() => onDestination('memory')}><FolderOpen size={20} /><span>Memory</span></button>
    <button onClick={() => onDestination('google-workspace')}><Plug size={20} /><span>Google Workspace</span></button>
    {owner && <button onClick={() => onDestination('schedules')}><Workflow size={20} /><span>Scheduled tasks</span></button>}
    <button onClick={() => onDestination('workspaces')}><FolderOpen size={20} /><span>Workspaces</span></button>
    <button onClick={onActivity}><Activity size={20} /><span>Activity & approvals</span></button>
    {owner && <><button onClick={() => onDestination('hardware')}><Cpu size={20} /><span>This machine</span></button><button onClick={() => onDestination('access')}><ShieldCheck size={20} /><span>Access & remote connections</span></button></>}
  </nav><div className="navigation-secondary"><button onClick={onTheme}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}Switch to {theme === 'light' ? 'dark' : 'light'} theme</button><button onClick={() => onDestination('commands')}><Command size={19} />Command palette<kbd>Ctrl K</kbd></button>{session?.remote && <><button disabled={signingOut} onClick={() => { void signOut(); }}><LogOut size={19} />{signingOut ? 'Signing out…' : 'Sign out'}</button><p className="hint navigation-signout-hint">{session?.connection === 'lan' ? 'Signs out of this browser. A new invitation is needed to reconnect.' : 'Signs out of Relay and this Cloudflare Access session.'}</p></>}</div>{error != null && <ErrorNotice error={error} />}</Modal>;
}
