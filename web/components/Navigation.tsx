import { Activity, Command, Cpu, FolderOpen, History, Layers, Moon, Plus, Plug, ShieldCheck, Sun } from 'lucide-react';
import { Modal } from './ui';

export type Destination = 'history' | 'models' | 'hardware' | 'workspaces' | 'commands' | 'access' | 'mcp';
export default function Navigation({ owner, theme, hostName, onDestination, onNew, onActivity, onTheme, onClose }: { owner: boolean; theme: 'dark' | 'light'; hostName?: string; onDestination: (destination: Destination) => void; onNew: () => void; onActivity: () => void; onTheme: () => void; onClose: () => void }) {
  return <Modal title="Navigate Relay" onClose={onClose} className="navigation-modal"><nav className="navigation-list" aria-label="Relay destinations">
    <button onClick={onNew}><Plus size={20} /><span>New conversation</span></button>
    <button onClick={() => onDestination('history')}><History size={20} /><span>Conversation history</span></button>
    <button onClick={() => onDestination('models')}><Layers size={20} /><span>Models & providers</span></button>
    {owner && <button onClick={() => onDestination('mcp')}><Plug size={20} /><span>MCP tools</span></button>}
    <button onClick={() => onDestination('workspaces')}><FolderOpen size={20} /><span>Workspaces</span></button>
    <button onClick={onActivity}><Activity size={20} /><span>Activity & approvals</span></button>
    {owner && <><button onClick={() => onDestination('hardware')}><Cpu size={20} /><span>This machine</span></button><button onClick={() => onDestination('access')}><ShieldCheck size={20} /><span>Access & remote connections</span></button></>}
  </nav><div className="navigation-secondary"><button onClick={onTheme}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}Switch to {theme === 'light' ? 'dark' : 'light'} theme</button><button onClick={() => onDestination('commands')}><Command size={19} />Command palette<kbd>Ctrl K</kbd></button></div>{hostName && <p className="hint navigation-host">Connected to <strong>{hostName}</strong></p>}</Modal>;
}
