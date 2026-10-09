import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Link2, Unplug } from 'lucide-react';
import type { Workspace } from '../../shared/types';
import { api, mutation, onSessionInvalidated } from '../api';
import { applyDeviceChanges, deviceChanges, scanDeviceFolder, safeDevicePath, textDocument, DEVICE_LIMITS, type DeviceChange, type DeviceDirectoryHandle, type DeviceFile } from '../device-files';
import { ErrorNotice, Modal } from './ui';
import '../device-folder.css';

interface Link { userId: string; root: DeviceDirectoryHandle; workspace: Workspace; baseline: Map<string, DeviceFile> }
let activeLink: Link | null = null;
onSessionInvalidated(() => { activeLink = null; });
type PickerWindow = Window & { showDirectoryPicker?: (options: { mode: 'read' }) => Promise<DeviceDirectoryHandle> };

export default function DeviceFolder({ userId, onImported }: { userId?: string; onImported: (workspace: Workspace) => void }) {
  const [link, setLink] = useState<Link | null>(() => activeLink?.userId === userId ? activeLink : null);
  const [preview, setPreview] = useState<{ root: DeviceDirectoryHandle; files: DeviceFile[]; skipped: number } | null>(null);
  const [changes, setChanges] = useState<DeviceChange[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allowDelete, setAllowDelete] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [message, setMessage] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (activeLink?.userId !== userId) activeLink = null; setLink(activeLink); setPreview(null); setChanges(null); setSelected(new Set()); setError(null); setMessage(''); }, [userId]);
  useEffect(() => onSessionInvalidated(() => { alive.current = false; setLink(null); setPreview(null); setChanges(null); }), []);
  const supported = window.isSecureContext && typeof (window as PickerWindow).showDirectoryPicker === 'function';
  const choose = async () => {
    setError(null); setMessage(''); setBusy(true);
    try {
      const root = await (window as PickerWindow).showDirectoryPicker!({ mode: 'read' });
      const result = await scanDeviceFolder(root);
      if (alive.current) setPreview({ root, ...result });
    } catch (caught) { if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(caught); }
    finally { setBusy(false); }
  };
  const upload = async () => {
    if (!preview) return; setBusy(true); setError(null);
    try {
      const workspace = await mutation<Workspace>('/workspaces', { name: preview.root.name.slice(0, 110) + ' · device', personal:true });
      if (!alive.current) throw new Error('Folder import stopped. An empty personal workspace may have been created.');
      const next: Link = { userId: userId!, root: preview.root, workspace, baseline: new Map() };
      activeLink = next; setLink(next); onImported(workspace);
      // A failed upload retains an accurate baseline for only the files actually copied.
      for (const file of preview.files) {
        if (!alive.current || activeLink !== next) throw new Error('Folder import stopped. Successfully uploaded files remain in your workspace.');
        await mutation(`/workspaces/${workspace.id}/files`, { path: file.path, content: file.content });
        next.baseline.set(file.path, file);
      }
      setPreview(null); setMessage(`Copied ${next.baseline.size} files to your private workspace. Device originals are unchanged.`);
      onImported(workspace);
    } catch (caught) { setPreview(null); setError(caught); }
    finally { setBusy(false); }
  };
  const review = async () => {
    if (!link) return; setBusy(true); setError(null); setMessage('');
    try {
      const result = await api<{ files: string[] }>(`/workspaces/${link.workspace.id}/files`);
      if (result.files.length > DEVICE_LIMITS.files) throw new Error('This workspace exceeds the 100-file device review limit. Download files individually instead.');
      const files: DeviceFile[] = []; let total = 0;
      for (const path of result.files) {
        if (!alive.current || activeLink !== link) throw new Error('Folder connection ended.');
        if (!safeDevicePath(path)) throw new Error(`Unsupported or protected path in workspace: ${path}. Download it separately if needed.`);
        const result = await api<{ content: string }>(`/workspaces/${link.workspace.id}/file?path=${encodeURIComponent(path)}`);
        const file = await textDocument(path, result.content); total += file.bytes;
        if (total > DEVICE_LIMITS.bytes) throw new Error('This workspace exceeds the 5 MiB device review limit.');
        files.push(file);
      }
      const pending = deviceChanges(link.baseline, files);
      setChanges(pending); setSelected(new Set()); setAllowDelete(false);
    } catch (caught) { setError(caught); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!link || !changes) return; setBusy(true); setError(null); let applied = 0;
    try {
      await applyDeviceChanges(link.root, changes.filter(change => selected.has(change.path)), { allowDelete, active: () => alive.current && activeLink === link, onApplied: change => {
        if (change.after) link.baseline.set(change.path, change.after); else link.baseline.delete(change.path); applied++;
        setChanges(current => current?.filter(item => item.path !== change.path) ?? null);
      } });
      setSelected(new Set()); setMessage(`Applied ${applied} reviewed changes to ${link.root.name} on this device.`);
    } catch (caught) { setError(caught); setMessage(`${applied} changes completed before stopping. Inspect the device folder before retrying; an interrupted creation may leave an empty file.`); }
    finally { setBusy(false); }
  };
  return <section className="device-folder" aria-label="Files on this device"><h3><FolderOpen size={18} />Files on this device</h3>
    <p className="muted">Choose a folder, review a bounded text-file copy, then explicitly upload it to your private host workspace. After an agent edits the copy, review and apply selected changes back here.</p>
    {!supported ? <p className="notice">Folder connections are not supported in this browser. Upload files using the conversation attachment button, then use Inspect files → Download saved file. Direct folder editing requires a supported desktop browser such as Chrome or Edge, over HTTPS or localhost.</p> : <>
      {link ? <><p><strong>{link.root.name}</strong> on this device ↔ <strong>{link.workspace.name}</strong> on the host</p><div className="device-actions"><button className="button primary" disabled={busy} onClick={() => { void review(); }}>Review device changes</button><button className="button" disabled={busy} onClick={() => { activeLink = null; setLink(null); setChanges(null); }}><Unplug size={16} />Disconnect folder</button></div></> : <button className="button" disabled={busy || !userId} onClick={() => { void choose(); }}><Link2 size={16} />Choose device folder</button>}
      <p className="hint">Up to 100 UTF-8 text files / 5 MiB total / 240 KiB each. Hidden files, known credential names, dependency and build folders are excluded. Review your files for sensitive content before uploading. Connections last only in this browser session; reloading disconnects them. This does not enable terminal or desktop control.</p>
    </>}
    {busy && <p role="status">Working on your selected files…</p>}{message && <p role="status">{message}</p>}{error != null && !preview && !changes && <ErrorNotice error={error} />}
    {preview && <Modal title="Review folder upload" onClose={() => { if (!busy) setPreview(null); }} className="device-folder-dialog"><p><strong>{preview.root.name}</strong>: {preview.files.length} eligible text files. {preview.skipped} entries skipped. Nothing has been uploaded yet.</p><p className="hint">Only the files below will be copied to the Relay host. Your device originals remain unchanged.</p><ul className="device-file-list">{preview.files.map(file => <li key={file.path}><code>{file.path}</code><span>{Math.ceil(file.bytes / 1024)} KiB</span></li>)}</ul>{error != null && <ErrorNotice error={error} />}<div className="device-actions"><button className="button" disabled={busy} onClick={() => setPreview(null)}>Cancel</button><button className="button primary" disabled={busy || !preview.files.length} onClick={() => { void upload(); }}>Upload managed copy</button></div></Modal>}
    {changes && <Modal title="Review device changes" onClose={() => { if (!busy) setChanges(null); }} wide className="device-folder-dialog"><p>These changes affect <strong>{link?.root.name}</strong> on this device. Select each change to apply. Close other editors first: browser file access cannot provide an atomic lock against external applications.</p><p className="hint">This is the host snapshot fetched for this review. Later host edits require another review. Existing device files must still match their imported or last-applied content.</p>{!changes.length && <p>No changes to apply.</p>}
      {changes.map(change => <section className="device-change" key={change.path}><label><input type="checkbox" disabled={busy} checked={selected.has(change.path)} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(change.path); else next.delete(change.path); return next; })} /><span>{!change.after ? 'Delete' : !change.before ? 'Create' : 'Modify'} <code>{change.path}</code></span></label><details><summary>Compare contents</summary><div className="device-comparison"><div><strong>Before</strong><pre>{change.before?.content.slice(0, 16_000) ?? '(new file)'}</pre></div><div><strong>After</strong><pre>{change.after?.content.slice(0, 16_000) ?? '(deleted)'}</pre></div></div>{Math.max(change.before?.content.length ?? 0, change.after?.content.length ?? 0) > 16_000 && <p className="hint">Preview shortened to the first 16,000 characters per side. Inspect the full host file before selecting this change.</p>}</details></section>)}
      {changes.some(change => !change.after && selected.has(change.path)) && <label className="device-delete"><input type="checkbox" checked={allowDelete} disabled={busy} onChange={event => setAllowDelete(event.target.checked)} />I confirm permanent deletion of the selected files on this device.</label>}{error != null && <ErrorNotice error={error} />}{message && <p role="status">{message}</p>}
      <div className="device-actions"><button className="button" disabled={busy} onClick={() => setChanges(null)}>Close review</button><button className="button primary" disabled={busy || !selected.size || changes.some(change => !change.after && selected.has(change.path)) && !allowDelete} onClick={() => { void apply(); }}>Apply selected changes ({selected.size})</button></div>
    </Modal>}
  </section>;
}
