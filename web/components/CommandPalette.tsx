import { useMemo, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { Modal } from './ui';

export interface Command { id: string; label: string; description: string; action: () => void; disabled?: boolean }
export default function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [index, setIndex] = useState(0);
  const filtered = useMemo(() => commands.filter(command => `${command.label} ${command.description}`.toLowerCase().includes(search.toLowerCase())), [commands, search]);
  const active = filtered[Math.min(index, filtered.length - 1)];
  const execute = (command: Command) => { if (!command.disabled) { onClose(); command.action(); } };
  return <Modal title="Commands" onClose={onClose} className="command-modal"><div className="command-search"><Search size={19} /><input autoFocus role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="command-results" aria-activedescendant={active ? `command-${active.id}` : undefined} aria-label="Search commands" placeholder="What would you like to do?" value={search} onChange={event => { setSearch(event.target.value); setIndex(0); }} onKeyDown={event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setIndex(value => filtered.length ? (value + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length : 0); }
    if (event.key === 'Enter' && active) { event.preventDefault(); execute(active); }
  }} /></div><div className="command-results" role="listbox" id="command-results" aria-label="Available commands">{filtered.map((command, itemIndex) => <div key={command.id} id={`command-${command.id}`} role="option" aria-selected={active?.id === command.id} aria-disabled={command.disabled} className={`command-result ${active?.id === command.id ? 'command-active' : ''} ${command.disabled ? 'command-disabled' : ''}`} onMouseMove={() => setIndex(itemIndex)} onClick={() => execute(command)}><div><strong>{command.label}</strong><span>{command.description}</span></div>{active?.id === command.id && <CornerDownLeft size={15} />}</div>)}</div>{!filtered.length && <p className="empty-search">No commands match “{search}”.</p>}<div className="command-footer"><span>↑ ↓ to navigate</span><span>Enter to select</span><span>Esc to close</span></div></Modal>;
}
