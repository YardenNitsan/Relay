import WorkspaceTaskAccess from './WorkspaceTaskAccess';
import ModelPicker from './ModelPicker';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, CloudOff, FolderOpen, Paperclip, Shield, SlidersHorizontal, Workflow, ChevronDown } from 'lucide-react';
import { getAssistantDefinition } from '../../shared/assistants';
import type { AccessMode, Depth, ModelProfile, ProviderStatus, SystemStatus, TaskOptions, Workspace } from '../../shared/types';
import { mutation, type UserPermissions } from '../api';
import { ErrorNotice } from './ui';
import NetworkPolicyEditor from './NetworkPolicy';
import { McpTaskSelection } from './McpSelection';

interface Props {
  draftRequest?: string | null; onDraftApplied?: () => void;
  conversationId: string | null; options: TaskOptions; onOptions: (options: TaskOptions) => void;
  models: ModelProfile[]; providers?: ProviderStatus[]; onModels?: () => void; workspaces: Workspace[]; onWorkspace: () => void; onAgents?: () => void;
  onSend: (content: string) => Promise<void>; disabled: boolean; stopped: boolean; running: boolean;
  status?: SystemStatus;
  owner?: boolean; permissions?: UserPermissions; userId?: string;
}
const accessDescription: Record<AccessMode, string> = {
  read_only: 'Read authorized managed files. No modifications or commands.',
  supervised: 'Read automatically. File changes and isolated commands require approval.',
  workspace: 'Work autonomously inside the selected managed copy. Original source stays untouched.',
  unrestricted: 'Direct host text-file access: changes affect real files. Protected paths stay blocked; commands remain isolated.',
};
const depthDescription: Record<Depth, string> = {
  fast: 'An efficient worker for straightforward objectives.',
  balanced: 'A capable worker with review and verification where available.',
  deep: 'Specialist analysis and cross-review within your budget.',
  maximum: 'Broader collaboration and review, bounded by your budget.',
};
function readDraft(key: string) { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } }
function base64Document(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer); const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
  return btoa(chunks.join(''));
}

export default function Composer({ draftRequest, onDraftApplied, conversationId, options, onOptions, models, providers = [], onModels, workspaces, onWorkspace, onAgents, onSend, disabled, stopped, running, status, owner = true, permissions, userId = 'owner' }: Props) {
  const draftKey = `relay:draft:v1:${userId}:${conversationId ?? 'new'}`;
  const [draft, setDraft] = useState(() => readDraft(draftKey));
  const [advanced, setAdvanced] = useState(false);
  const [confirmHostAccess, setConfirmHostAccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const sendLock = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadNotice, setUploadNotice] = useState('');
  const uploadLock = useRef(false);
  const dropRoot = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!draftRequest) return;
    setDraft(current => `${current}${current ? '\n\n' : ''}${draftRequest}`);
    textRef.current?.focus();
    onDraftApplied?.();
  }, [draftRequest, onDraftApplied]);
  const accessRef = useRef<HTMLSelectElement>(null);
  const cancelHostRef = useRef<HTMLButtonElement>(null);
  const client = useQueryClient();
  const mounted = useRef(true);
  const currentOptions = useRef(options);
  currentOptions.current = options;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const workspace = workspaces.find(item => item.id === options.workspaceId);
  const cloudPolicy = options.cloudPolicy ?? (options.budget.localOnly ? 'local_only' : 'allow');
  const personalWorkspace = workspace?.ownerUserId === userId;
  const canUpload = !options.workspaceId || personalWorkspace || owner || Boolean(permissions && permissions.maxAccess !== 'read_only');
  const allowedAccess = ['read_only', 'supervised', 'workspace'].slice(0, ['read_only', 'supervised', 'workspace'].indexOf(personalWorkspace || !options.workspaceId ? 'workspace' : permissions?.maxAccess ?? (owner ? 'workspace' : 'read_only')) + 1);
  const canUseCloud = owner || Boolean((permissions?.dailyCloudBudgetUsd || permissions?.allowUnpricedCloud) && permissions.providers.some(provider => !['ollama', 'lmstudio'].includes(provider)));
  useEffect(() => {
    if (confirmHostAccess && owner) cancelHostRef.current?.focus();
    else if (!owner) setConfirmHostAccess(false);
  }, [confirmHostAccess, owner]);
  useEffect(() => {
    try { if (draft) localStorage.setItem(draftKey, draft); else localStorage.removeItem(draftKey); } catch { /* A blocked storage area does not block conversation. */ }
    if (textRef.current) { textRef.current.style.height = 'auto'; textRef.current.style.height = `${Math.min(240, textRef.current.scrollHeight)}px`; }
  }, [draft, draftKey]);
  const send = async () => {
    if (!draft.trim() || sendLock.current || busy || disabled || stopped || uploading || accessBusy || confirmHostAccess) return;
    if (!textRef.current?.form?.reportValidity()) return;
    sendLock.current = true; setBusy(true); setError(null);
    try { await onSend(draft.trim()); setDraft(current => current === draft ? '' : current); try { if (localStorage.getItem(draftKey) === draft) localStorage.removeItem(draftKey); } catch { /* Nothing to clear. */ } }
    catch (caught) { setError(caught); }
    finally { sendLock.current = false; setBusy(false); textRef.current?.focus(); }
  };
  const upload = async (files: File[]) => {
    if (uploadLock.current || busy || accessBusy || disabled) { setError(new Error('Another operation is in progress. Wait before attaching more files.')); return; }
    if (!canUpload) { setError(new Error('This shared workspace is read only. Choose your private workspace before attaching files.')); return; }
    if (!files.length) return;
    uploadLock.current = true;
    setUploading(true); setError(null); setUploadNotice('');
    try {
      if (files.length > 10) throw new Error('Attach up to 10 files at a time.');
      if (files.reduce((total, file) => total + file.size, 0) > 16 * 1024 * 1024) throw new Error('Attach at most 16 MiB in one upload.');
      const documents: Array<{ file: File; content: string | null }> = [];
      for (const file of files) {
        if (/\.(pdf|docx)$/i.test(file.name)) {
          if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name}: PDF and Word documents must be at most 8 MiB each.`);
          documents.push({ file, content: null }); continue;
        }
        if (file.size > 240 * 1024) throw new Error(`${file.name}: attach UTF-8 text files up to 240 KB each.`);
        if (/\.doc$/i.test(file.name)) throw new Error('Legacy .doc files are not supported. Save the document as .docx, PDF or plain text first.');
        if (/\.(xlsx?|pptx?|png|jpe?g|gif|zip)$/i.test(file.name)) throw new Error('Spreadsheets, presentations, images and archives are not supported here. Attach text, PDF or .docx files.');
        const buffer = await file.arrayBuffer();
        let content: string;
        try { content = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw new Error(`${file.name}: this attachment is not valid UTF-8 text.`); }
        if (content.includes('\0')) throw new Error('Binary attachments are not supported by this file workflow. Attach a text file.');
        documents.push({ file, content });
      }
      if (!mounted.current) return;
      let workspaceId = currentOptions.current.workspaceId;
      if (!workspaceId) {
        const created = await mutation<Workspace>('/workspaces', { name: 'Conversation attachments', personal: true });
        if (!mounted.current) return;
        workspaceId = created.id;
        client.setQueryData<Workspace[]>(['workspaces'], current => [...(current ?? []).filter(item => item.id !== created.id), created]);
        currentOptions.current = { ...currentOptions.current, workspaceId };
        onOptions(currentOptions.current);
      }
      for (const { file, content } of documents) {
        if (!mounted.current) return;
        if (content === null) {
          const buffer = await file.arrayBuffer();
          if (buffer.byteLength > 8 * 1024 * 1024) throw new Error('This document exceeds the 8 MiB limit.');
          const imported = await mutation<{ uploaded: boolean; path: string; format: string }>(`/workspaces/${workspaceId}/documents`, { name: file.name, contentBase64: base64Document(buffer) });
          if (mounted.current) {
            setDraft(value => `${value}${value ? '\n\n' : ''}Attached text extracted from ${file.name}: ${imported.path}`);
            setUploadNotice('Document imported as text. The original document is unchanged; agents work with the extracted text copy.');
          }
          continue;
        }
        const path = `attachments/${Date.now()}-${file.name.replace(/[\\/]/g, '_')}`;
        await mutation(`/workspaces/${workspaceId}/files`, { path, content });
        if (mounted.current) setDraft(value => `${value}${value ? '\n\n' : ''}Attached file: ${path}`);
      }
      await client.invalidateQueries({ queryKey: ['workspaces'] });
      await client.invalidateQueries({ queryKey: ['assistants'] });
      await client.invalidateQueries({ queryKey: ['workspace-files', workspaceId] });
    } catch (caught) { if (mounted.current) setError(caught); }
    finally { uploadLock.current = false; if (mounted.current) setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const uploadCurrent = useRef(upload); uploadCurrent.current = upload;
  useEffect(() => {
    const surface = dropRoot.current?.closest('main');
    if (!surface) return;
    let depth = 0;
    const isFileDrag = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true;
    const reset = () => { depth = 0; setDragging(false); };
    const preventNavigation = (event: DragEvent) => { if (isFileDrag(event)) event.preventDefault(); };
    const enter = (event: DragEvent) => { if (isFileDrag(event)) { event.preventDefault(); depth++; setDragging(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const over = (event: DragEvent) => { if (isFileDrag(event)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; } };
    const drop = (event: DragEvent) => { if (!isFileDrag(event)) return; event.preventDefault(); event.stopPropagation(); reset(); void uploadCurrent.current(Array.from(event.dataTransfer?.files ?? [])); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') reset(); };
    surface.addEventListener('dragenter', enter); surface.addEventListener('dragleave', leave); surface.addEventListener('dragover', over); surface.addEventListener('drop', drop);
    document.addEventListener('dragover', preventNavigation); document.addEventListener('drop', preventNavigation); window.addEventListener('dragend', reset); window.addEventListener('blur', reset); window.addEventListener('keydown', escape);
    return () => { surface.removeEventListener('dragenter', enter); surface.removeEventListener('dragleave', leave); surface.removeEventListener('dragover', over); surface.removeEventListener('drop', drop); document.removeEventListener('dragover', preventNavigation); document.removeEventListener('drop', preventNavigation); window.removeEventListener('dragend', reset); window.removeEventListener('blur', reset); window.removeEventListener('keydown', escape); };
  }, []);
  const setBudget = (key: keyof TaskOptions['budget'], value: number | boolean | null) => onOptions({ ...options, budget: { ...options.budget, [key]: value } });
  const chooseAccess = async (access: AccessMode) => {
    if (accessBusy) return;
    if (access === 'unrestricted') { if (owner) setConfirmHostAccess(true); return; }
    setConfirmHostAccess(false);
    if (access !== 'read_only' && !options.workspaceId) {
      setAccessBusy(true); setError(null);
      try {
        const created = await mutation<Workspace>('/workspaces', { name: 'My files', personal: true });
        if (!mounted.current) return;
        client.setQueryData<Workspace[]>(['workspaces'], current => [...(current ?? []).filter(item => item.id !== created.id), created]);
        onOptions({ ...currentOptions.current, workspaceId: created.id, access, hostAccessConfirmed: false });
        void client.invalidateQueries({ queryKey: ['assistants'] });
      } catch (caught) { if (mounted.current) setError(caught); }
      finally { if (mounted.current) setAccessBusy(false); }
      return;
    }
    onOptions({ ...currentOptions.current, access, hostAccessConfirmed: false });
  };
  const dismissHostAccess = () => { setConfirmHostAccess(false); accessRef.current?.focus(); };
  const enableHostAccess = () => {
    if (!owner) return;
    // Switch the default file scope to the explicitly confirmed host. Keeping
    // an automatically prepared workspace would also load its unrelated tool
    // catalog and can exhaust the context before the first model request.
    onOptions({ ...options, workspaceId: null, access: 'unrestricted', hostAccessConfirmed: true });
    dismissHostAccess();
  };
  return <div ref={dropRoot} className={`composer-area ${advanced || confirmHostAccess ? 'options-open' : ''}`}>{dragging && <div className="attachment-drop" role="status"><Paperclip size={22} /><strong>Drop files to attach</strong><span>Up to 10 files: text up to 240 KB, PDF or Word (.docx) up to 8 MiB each. Files go to your selected or new private workspace.</span></div>}<form className={`composer ${advanced ? 'composer-expanded' : ''}`} onSubmit={event => { event.preventDefault(); void send(); }}>
    {onAgents && <div className="composer-agent-row"><button type="button" className="composer-agent" aria-label="Choose agent" onClick={onAgents}><Workflow size={14} /><span>{getAssistantDefinition(options.assistantId)?.name ?? 'General'}</span><ChevronDown size={13} /></button><span>Choose who helps with this objective</span></div>}
    {workspace && <div className="workspace-tag"><button type="button" onClick={onWorkspace}><FolderOpen size={13} />{workspace.name}<span>{personalWorkspace ? 'Your files' : 'Managed copy'}</span></button></div>}
    <label className="sr-only" htmlFor="objective">Your objective</label><textarea ref={textRef} id="objective" value={draft} onChange={event => setDraft(event.target.value)} placeholder={stopped ? 'Your draft is safe. Resume Relay to continue.' : running ? 'Add the next objective…' : 'Describe what you want to accomplish…'} rows={2} maxLength={32_000} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
    <div className="composer-controls"><div className="composer-tools"><button className="icon-button" type="button" aria-label="Attach files" title={canUpload ? 'Attach text, PDF or Word (.docx) files' : 'This shared workspace is read only. Choose your own workspace to attach files.'} disabled={disabled || uploading || busy || accessBusy || !canUpload} onClick={() => fileRef.current?.click()}><Paperclip size={18} /></button><input className="sr-only" type="file" multiple ref={fileRef} tabIndex={-1} disabled={!canUpload} aria-label="File attachments" onChange={event => { void upload(Array.from(event.target.files ?? [])); }} />
      <ModelPicker models={models} providers={providers} options={options} onOptions={onOptions} onConnections={onModels ?? (() => {})} canUseCloud={canUseCloud} />
      <label className="compact-select depth-select"><span className="sr-only">Compute depth</span><select value={options.depth} title={depthDescription[options.depth]} onChange={event => onOptions({ ...options, depth: event.target.value as Depth })}><option value="fast">Fast</option><option value="balanced">Balanced</option><option value="deep">Deep</option><option value="maximum">Maximum</option></select></label>
      <button className={`execution-toggle ${advanced ? 'selected-button' : ''}`} type="button" aria-label="Execution options" aria-expanded={advanced} aria-controls="execution-options" onClick={() => setAdvanced(value => !value)}><SlidersHorizontal size={17} /><span>Advanced</span></button></div><button className="send-button" type="submit" aria-label={busy ? 'Sending objective' : 'Send objective'} disabled={!draft.trim() || disabled || stopped || busy || uploading || accessBusy || confirmHostAccess}><ArrowUp size={20} /></button></div>
    {advanced && <div className="execution-options" id="execution-options"><h3>Advanced controls</h3><p className="hint">{depthDescription[options.depth]} Limits apply to this objective. Whole-task approval and resource waits do not spend active time. The overall limit includes those waits, queueing and time while the host is offline.</p><div className="options-grid"><label>Token efficiency<select value={options.efficiency ?? 'efficient'} onChange={event => onOptions({ ...options, efficiency: event.target.value as TaskOptions['efficiency'] })}><option value="efficient">Efficient</option><option value="standard">Standard</option></select></label><label>Maximum output tokens per model call<input type="number" min={256} max={8192} step={256} value={options.budget.maxOutputTokens ?? 2048} onChange={event => setBudget('maxOutputTokens', Number(event.target.value))} required /></label><label>Maximum calls<input type="number" min={1} max={permissions?.maxCallsPerTask ?? 64} value={options.budget.maxCalls} onChange={event => setBudget('maxCalls', Number(event.target.value))} required /></label><label>Active time limit (seconds)<input type="number" min={30} max={permissions?.maxSecondsPerTask ?? 3600} value={options.budget.maxSeconds} onChange={event => setBudget('maxSeconds', Number(event.target.value))} required /></label><label>Overall time limit (seconds)<input type="number" min={30} max={604800} value={options.budget.maxElapsedSeconds ?? 86400} onChange={event => setBudget('maxElapsedSeconds', Number(event.target.value))} required /></label><label>Maximum iterations<input type="number" min={1} max={16} value={options.budget.maxIterations} onChange={event => setBudget('maxIterations', Number(event.target.value))} required /></label><label>Cloud cost cap (USD)<input type="number" min={0} max={owner || permissions?.allowUnpricedCloud ? 100 : permissions?.dailyCloudBudgetUsd ?? 0} step="0.01" value={options.budget.maxCostUsd ?? ''} placeholder="No cost cap" onChange={event => setBudget('maxCostUsd', event.target.value === '' ? null : Number(event.target.value))} /></label><label>Context token budget<input type="number" min={2048} max={131072} step={1024} value={options.contextTokens} onChange={event => onOptions({ ...options, contextTokens: Number(event.target.value) })} required /></label><label>Cloud sharing<select value={cloudPolicy} onChange={event => onOptions({ ...options, cloudPolicy: event.target.value as TaskOptions['cloudPolicy'], budget: { ...options.budget, localOnly: event.target.value === 'local_only' } })}><option value="local_only">Local only</option><option value="ask" disabled={!canUseCloud}>Ask before sharing</option><option value="allow" disabled={!canUseCloud}>Allow cloud providers</option></select></label></div><p className="hint">Efficient mode requests concise, complete responses and removes tool definitions blocked by your permission mode. Your chosen depth, reviews and verification stay the same. Output tokens limit each model call; they are not an account balance.</p><WorkspaceTaskAccess options={options} onChange={onOptions} userId={userId} /><NetworkPolicyEditor value={options.network} onChange={network => onOptions({ ...options, network })} owner={owner} maxAccess={permissions?.maxNetworkAccess} grantedOrigins={permissions?.networkOrigins} /><McpTaskSelection value={options.mcpServerIds ?? []} onChange={mcpServerIds => onOptions({ ...options, mcpServerIds })} networkOrigins={options.network?.allowedOrigins ?? []} networkMode={options.network?.mode ?? 'deny'} /><p className="hint">A strict cost cap rejects models with unknown pricing. Personal API use without a cap follows your provider billing limits. Cloud sharing may include selected conversation and workspace content.</p>{!status?.sandbox.available && <p className="hint">Isolated terminal unavailable: {status?.sandbox.reason ?? 'The execution boundary has not been verified.'}</p>}</div>}
  </form>{confirmHostAccess && owner && <section className="notice warning" aria-label="Confirm host file access">
    <h3>Allow direct access to this host?</h3>
    <p>Agents can read, create, modify and delete supported text files at absolute paths without per-action approval. These are real host files, outside managed copies.</p>
    <p>System, credential and Relay paths remain protected. Commands remain isolated and require a managed workspace. Audit records, checkpoints and Stop all stay active.</p>
    <p>Enabling this mode switches file scope from the selected managed copy to this host. You can select a managed workspace again when needed.</p>
    <div className="approval-actions"><button ref={cancelHostRef} type="button" className="button" onClick={dismissHostAccess}>Cancel</button><button type="button" className="button danger-button" onClick={enableHostAccess}>Enable host access</button></div>
  </section>}<div className="composer-footer"><label className="access-control"><Shield size={13} /><span className="sr-only">Computer access</span><select ref={accessRef} value={options.access} disabled={accessBusy || uploading || busy || disabled} onChange={event => { void chooseAccess(event.target.value as AccessMode); }} title={accessDescription[options.access]}><option value="read_only">Read only</option><option value="supervised" disabled={!allowedAccess.includes('supervised')}>Supervised</option><option value="workspace" disabled={!allowedAccess.includes('workspace')}>Autonomous workspace</option><option value="unrestricted" disabled={!owner}>Unrestricted · host files</option></select></label><button className="workspace-button" onClick={onWorkspace}><FolderOpen size={13} />{workspace ? 'Workspace' : 'Choose workspace'}</button><span className="privacy-label">{cloudPolicy === 'local_only' && <CloudOff size={12} />}{cloudPolicy === 'local_only' ? 'Local only' : cloudPolicy === 'ask' ? 'Cloud requires approval' : 'Cloud allowed'}</span><span className="composer-shortcut">Shift Enter for a new line</span></div><details className="scope-details"><summary>About these permissions</summary><p className="scope-note">{!options.workspaceId ? 'Choosing Supervised or Autonomous workspace creates private storage for your own files on the host. ' : ''}{personalWorkspace ? "Agent permissions apply only to your selected files. You can upload and manage them yourself in any mode. " : ""}{accessDescription[options.access]}{['supervised', 'workspace'].includes(options.access) && !options.workspaceId ? ' Choose a workspace to enable file tools.' : ''}</p></details>{accessBusy && <p className="hint" role="status">Preparing your private file workspace...</p>}{uploadNotice && <p className="hint" role="status">{uploadNotice}</p>}{uploading && <p className="hint" role="status">Saving attachments to the workspace…</p>}{error != null && <ErrorNotice error={error} />}
  </div>;
}
