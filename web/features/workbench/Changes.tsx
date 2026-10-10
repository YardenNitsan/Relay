import {useState} from 'react';
import {Check,Copy,Download,FileDiff,Undo2} from 'lucide-react';
import type {FileChange} from '../../../shared/types';
import {downloadText} from '../../api';
import {Empty,ErrorNotice} from '../../components/ui';

export default function Changes({ changes, onRevert, busy }: { changes: FileChange[]; onRevert: (id: string) => void; busy: boolean }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  const selected = changes.find(change => `${change.checkpointId}:${change.path}` === selectedPath) ?? changes[0];
  if (!selected) return <Empty title="No recorded file changes" icon={<FileDiff size={27} />}><p>Changes made through Relay’s tools will appear here with their checkpoint.</p></Empty>;
  const copy = async () => {
    setCopyError(null);
    try { await navigator.clipboard.writeText(selected.patch); setCopied(true); }
    catch (caught) { setCopyError(caught); }
  };
  return <div className="changes"><label className="field-label">Changed file<select value={`${selected.checkpointId}:${selected.path}`} onChange={event => { setSelectedPath(event.target.value); setCopied(false); setConfirm(null); }}>{changes.map(change => <option key={`${change.checkpointId}:${change.path}`} value={`${change.checkpointId}:${change.path}`}>{change.path}</option>)}</select></label><div className="diff-heading"><code>{selected.path}</code><div className="button-row"><button className="icon-button" aria-label={copied ? 'Patch copied' : 'Copy patch'} onClick={() => { void copy(); }}>{copied ? <Check size={15} /> : <Copy size={15} />}</button><button className="icon-button" aria-label="Download patch" onClick={() => downloadText(`${selected.path.split(/[\\/]/).pop() ?? 'change'}.patch`, selected.patch)}><Download size={15} /></button></div></div><pre className="diff-view" tabIndex={0} aria-label={`Unified diff for ${selected.path}`}><code>{selected.patch.split('\n').slice(0, 1200).map((line, index) => <span key={index} className={line.startsWith('+') && !line.startsWith('+++') ? 'diff-added' : line.startsWith('-') && !line.startsWith('---') ? 'diff-removed' : line.startsWith('@@') ? 'diff-hunk' : ''}>{line || ' '}{'\n'}</span>)}</code></pre>{selected.patch.split('\n').length > 1200 && <p className="hint">Showing the first 1,200 lines. Download the patch to inspect the entire change.</p>}<p className="hint">Checkpoint <code>{selected.checkpointId}</code>. Original source files are unchanged.</p>{confirm === selected.checkpointId ? <div className="notice warning"><p>Restore this checkpoint in the managed workspace? The service checks the current content before reverting and rejects conflicting external changes.</p><div className="button-row"><button className="button danger-button" disabled={busy} onClick={() => { onRevert(selected.checkpointId); setConfirm(null); }}>Restore checkpoint</button><button className="button subtle" onClick={() => setConfirm(null)}>Keep changes</button></div></div> : <button className="text-button" disabled={busy} onClick={() => setConfirm(selected.checkpointId)}><Undo2 size={14} />Revert checkpoint</button>}{copyError != null && <ErrorNotice error={copyError} />}</div>;
}
