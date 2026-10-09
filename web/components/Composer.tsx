import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, CloudOff, FolderOpen, Paperclip, Shield, SlidersHorizontal } from 'lucide-react';
import type { AccessMode, Depth, ModelProfile, SystemStatus, TaskOptions, Workspace } from '../../shared/types';
import { mutation, type UserPermissions } from '../api';
import { ErrorNotice } from './ui';
import NetworkPolicyEditor from './NetworkPolicy';
import { McpTaskSelection } from './McpSelection';

interface Props {
  conversationId: string | null; options: TaskOptions; onOptions: (options: TaskOptions) => void;
  models: ModelProfile[]; workspaces: Workspace[]; onWorkspace: () => void;
  onSend: (content: string) => Promise<void>; disabled: boolean; stopped: boolean; running: boolean;
  status?: SystemStatus;
  owner?: boolean; permissions?: UserPermissions; userId?: string;
}
const accessDescription: Record<AccessMode, string> = {
  read_only: 'Read authorized managed files. No modifications or commands.',
  supervised: 'Read automatically. File changes and isolated commands require approval.',
  workspace: 'Work autonomously inside the selected managed copy. Original source stays untouched.',
  unrestricted: 'Unavailable until a tested host-access broker exists.',
};
const depthDescription: Record<Depth, string> = {
  fast: 'An efficient worker for straightforward objectives.',
  balanced: 'A capable worker with review and verification where available.',
  deep: 'Specialist analysis and cross-review within your budget.',
  maximum: 'Broader collaboration and review, bounded by your budget.',
};
function readDraft(key: string) { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } }

export default function Composer({ conversationId, options, onOptions, models, workspaces, onWorkspace, onSend, disabled, stopped, running, status, owner = true, permissions, userId = 'owner' }: Props) {
  const draftKey = `relay:draft:v1:${userId}:${conversationId ?? 'new'}`;
  const [draft, setDraft] = useState(() => readDraft(draftKey));
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const client = useQueryClient();
  const workspace = workspaces.find(item => item.id === options.workspaceId);
  const cloudPolicy = options.cloudPolicy ?? (options.budget.localOnly ? 'local_only' : 'allow');
  const canUpload = owner || Boolean(permissions && permissions.maxAccess !== 'read_only' && options.workspaceId);
  const allowedAccess = ['read_only', 'supervised', 'workspace'].slice(0, ['read_only', 'supervised', 'workspace'].indexOf(permissions?.maxAccess ?? (owner ? 'workspace' : 'read_only')) + 1);
  const canUseCloud = owner || Boolean(permissions?.dailyCloudBudgetUsd && permissions.providers.some(provider => !['ollama', 'lmstudio'].includes(provider)));
  useEffect(() => {
    try { if (draft) localStorage.setItem(draftKey, draft); else localStorage.removeItem(draftKey); } catch { /* A blocked storage area does not block conversation. */ }
    if (textRef.current) { textRef.current.style.height = 'auto'; textRef.current.style.height = `${Math.min(240, textRef.current.scrollHeight)}px`; }
  }, [draft, draftKey]);
  const send = async () => {
    if (!draft.trim() || busy || disabled || stopped || uploading) return;
    if (!textRef.current?.form?.reportValidity()) return;
    setBusy(true); setError(null);
    try { await onSend(draft.trim()); setDraft(''); try { localStorage.removeItem(draftKey); } catch { /* Nothing to clear. */ } }
    catch (caught) { setError(caught); }
    finally { setBusy(false); textRef.current?.focus(); }
  };
  const upload = async (file: File) => {
    setUploading(true); setError(null);
    try {
      if (file.size > 240 * 1024) throw new Error('Attach UTF-8 text files up to 240 KB. Import a workspace for larger projects.');
      const buffer = await file.arrayBuffer();
      let content: string;
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw new Error('This attachment is not valid UTF-8 text.'); }
      if (content.includes('\0')) throw new Error('Binary attachments are not supported by this file workflow. Attach a text file.');
      let workspaceId = options.workspaceId;
      if (!workspaceId) {
        const created = await mutation<Workspace>('/workspaces', { name: 'Conversation attachments' });
        workspaceId = created.id;
        onOptions({ ...options, workspaceId });
      }
      const path = `attachments/${Date.now()}-${file.name.replace(/[\\/]/g, '_')}`;
      await mutation(`/workspaces/${workspaceId}/files`, { path, content });
      await client.invalidateQueries({ queryKey: ['workspaces'] });
      await client.invalidateQueries({ queryKey: ['workspace-files', workspaceId] });
      setDraft(value => `${value}${value ? '\n\n' : ''}Attached file: ${path}`);
    } catch (caught) { setError(caught); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const setBudget = (key: keyof TaskOptions['budget'], value: number | boolean | null) => onOptions({ ...options, budget: { ...options.budget, [key]: value } });
  return <div className={`composer-area ${advanced ? 'options-open' : ''}`}><form className={`composer ${advanced ? 'composer-expanded' : ''}`} onSubmit={event => { event.preventDefault(); void send(); }}>
    {workspace && <div className="workspace-tag"><button type="button" onClick={onWorkspace}><FolderOpen size={13} />{workspace.name}<span>Managed copy</span></button></div>}
    <label className="sr-only" htmlFor="objective">Your objective</label><textarea ref={textRef} id="objective" value={draft} onChange={event => setDraft(event.target.value)} placeholder={stopped ? 'Your draft is safe. Resume Relay to continue.' : running ? 'Add the next objective…' : 'Describe what you want to accomplish…'} rows={2} maxLength={32_000} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
    <div className="composer-controls"><div className="composer-tools"><button className="icon-button" type="button" aria-label="Attach a text file" title={canUpload ? 'Attach a UTF-8 text file' : 'Your account needs write access to a selected workspace to attach files'} disabled={disabled || uploading || busy || !canUpload} onClick={() => fileRef.current?.click()}><Paperclip size={18} /></button><input className="sr-only" type="file" ref={fileRef} tabIndex={-1} disabled={!canUpload} accept="text/*,.md,.json,.ts,.tsx,.js,.jsx,.py,.rs,.toml,.yaml,.yml,.csv,.log,.sql,.sh,.ps1" aria-label="Text attachment" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
      <label className="compact-select"><span className="sr-only">Model</span><select value={options.modelId ?? ''} onChange={event => onOptions({ ...options, modelId: event.target.value || null })} title="Select a model"><option value="">Auto model</option>{models.map(model => <option key={model.id} value={model.id} disabled={model.state === 'offline' || model.state === 'error'}>{model.name}{model.local ? '' : ' (cloud)'}</option>)}</select></label>
      <label className="compact-select depth-select"><span className="sr-only">Compute depth</span><select value={options.depth} title={depthDescription[options.depth]} onChange={event => onOptions({ ...options, depth: event.target.value as Depth })}><option value="fast">Fast</option><option value="balanced">Balanced</option><option value="deep">Deep</option><option value="maximum">Maximum</option></select></label>
      <button className={`icon-button ${advanced ? 'selected-button' : ''}`} type="button" aria-label="Execution options" aria-expanded={advanced} aria-controls="execution-options" onClick={() => setAdvanced(value => !value)}><SlidersHorizontal size={17} /></button></div><button className="send-button" type="submit" aria-label={busy ? 'Sending objective' : 'Send objective'} disabled={!draft.trim() || disabled || stopped || busy || uploading}><ArrowUp size={20} /></button></div>
    {advanced && <div className="execution-options" id="execution-options"><p className="hint">{depthDescription[options.depth]} Limits apply to this objective.</p><div className="options-grid"><label>Maximum calls<input type="number" min={1} max={permissions?.maxCallsPerTask ?? 64} value={options.budget.maxCalls} onChange={event => setBudget('maxCalls', Number(event.target.value))} required /></label><label>Time limit (seconds)<input type="number" min={30} max={permissions?.maxSecondsPerTask ?? 3600} value={options.budget.maxSeconds} onChange={event => setBudget('maxSeconds', Number(event.target.value))} required /></label><label>Maximum iterations<input type="number" min={1} max={16} value={options.budget.maxIterations} onChange={event => setBudget('maxIterations', Number(event.target.value))} required /></label><label>Cloud cost cap (USD)<input type="number" min={0} max={owner ? 100 : permissions?.dailyCloudBudgetUsd ?? 0} step="0.01" value={options.budget.maxCostUsd ?? ''} placeholder="No cost cap" onChange={event => setBudget('maxCostUsd', event.target.value === '' ? null : Number(event.target.value))} /></label><label>Context token budget<input type="number" min={2048} max={131072} step={1024} value={options.contextTokens} onChange={event => onOptions({ ...options, contextTokens: Number(event.target.value) })} required /></label><label>Cloud sharing<select value={cloudPolicy} onChange={event => onOptions({ ...options, cloudPolicy: event.target.value as TaskOptions['cloudPolicy'], budget: { ...options.budget, localOnly: event.target.value === 'local_only' } })}><option value="local_only">Local only</option><option value="ask" disabled={!canUseCloud}>Ask before sharing</option><option value="allow" disabled={!canUseCloud}>Allow cloud providers</option></select></label></div><NetworkPolicyEditor value={options.network} onChange={network => onOptions({ ...options, network })} owner={owner} maxAccess={permissions?.maxNetworkAccess} grantedOrigins={permissions?.networkOrigins} /><McpTaskSelection value={options.mcpServerIds ?? []} onChange={mcpServerIds => onOptions({ ...options, mcpServerIds })} networkOrigins={options.network?.allowedOrigins ?? []} networkMode={options.network?.mode ?? 'deny'} /><p className="hint">A strict cost cap may reject cloud models with unknown pricing. Cloud sharing may include selected conversation and workspace content.</p>{!status?.sandbox.available && <p className="hint">Isolated terminal unavailable: {status?.sandbox.reason ?? 'The execution boundary has not been verified.'}</p>}</div>}
  </form><div className="composer-footer"><label className="access-control"><Shield size={13} /><span className="sr-only">Computer access</span><select value={options.access} onChange={event => onOptions({ ...options, access: event.target.value as AccessMode })} title={accessDescription[options.access]}><option value="read_only">Read only</option><option value="supervised" disabled={!allowedAccess.includes('supervised')}>Supervised</option><option value="workspace" disabled={!allowedAccess.includes('workspace')}>Autonomous workspace</option><option value="unrestricted" disabled>Unrestricted — unavailable</option></select></label><button className="workspace-button" onClick={onWorkspace}><FolderOpen size={13} />{workspace ? 'Workspace' : 'Choose workspace'}</button><span className="privacy-label">{cloudPolicy === 'local_only' && <CloudOff size={12} />}{cloudPolicy === 'local_only' ? 'Local only' : cloudPolicy === 'ask' ? 'Cloud requires approval' : 'Cloud allowed'}</span><span className="composer-shortcut">Shift Enter for a new line</span></div><p className="scope-note">{accessDescription[options.access]}{options.access !== 'read_only' && !options.workspaceId ? ' Choose a workspace to enable file tools.' : ''}</p>{uploading && <p className="hint" role="status">Saving attachment to the managed workspace…</p>}{error != null && <ErrorNotice error={error} />}
  </div>;
}
