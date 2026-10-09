import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Check, Cloud, Cpu, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import type { Admission, ModelProfile, ProviderStatus } from '../../shared/types';
import { api, mutation } from '../api';
import Calibration from './Calibration';
import { bytes, Empty, ErrorNotice, humanize, Loading, Status } from './ui';

export interface ModelList { models: ModelProfile[]; providers: ProviderStatus[] }

function ProviderRow({ provider }: { provider: ProviderStatus }) {
  const client = useQueryClient();
  const [key, setKey] = useState('');
  const [persist, setPersist] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const cloud = !['ollama', 'lmstudio'].includes(provider.id);
  const perform = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(null); setMessage('');
    try { await action(); setMessage(success); await client.invalidateQueries({ queryKey: ['models'] }); }
    catch (caught) { setError(caught); }
    finally { setBusy(false); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    await perform(async () => {
      const response = await mutation<{ saved: boolean; storage: string }>(`/providers/${provider.id}/key`, { key, persist });
      setKey(''); return response;
    }, persist ? 'Credential saved to the host secret store.' : 'Credential set for this service session.');
  };
  return <div className="provider-row">
    <div className="split"><div className="provider-name">{cloud ? <Cloud size={17} /> : <Cpu size={17} />}<strong>{provider.name}</strong><span className={`connection-dot ${provider.connected ? 'connected' : ''}`} /></div><span className="muted small">{provider.state ? humanize(provider.state) : provider.connected ? 'Connected' : provider.configured ? 'Unavailable' : 'Not configured'}</span></div>
    {provider.error && <p className="small provider-error">{provider.error}</p>}
    <div className="provider-actions"><label className="check-label"><input type="checkbox" checked={provider.enabled !== false} disabled={busy} onChange={event => { void perform(() => mutation(`/providers/${provider.id}/enabled`, { enabled: event.target.checked }), 'Provider preference updated.'); }} />Enabled</label><button className="text-button" disabled={busy} onClick={() => { void perform(() => mutation(`/providers/${provider.id}/verify`), 'Connection check completed.'); }}>Check connection</button>{provider.secretStorage && <span className="muted small">Storage: {provider.secretStorage}</span>}</div>
    {cloud && <details className="credential-details"><summary><KeyRound size={14} />{provider.configured ? 'Update credential' : 'Connect provider'}</summary><form onSubmit={event => { void save(event); }} className="credential-form"><label>API key<input type="password" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder="Paste a provider API key" required disabled={busy} /></label><label className="check-label"><input type="checkbox" checked={persist} onChange={event => setPersist(event.target.checked)} disabled={busy} />Save in the operating system’s secret store</label><p className="hint">Keys stay in the local service. Connecting a provider does not authorize sharing task content.</p><div className="button-row"><button type="submit" className="button primary" disabled={busy || !key.trim()}>Save credential</button>{provider.configured && <button type="button" className="button subtle" disabled={busy} onClick={() => { void perform(() => api(`/providers/${provider.id}/key`, { method: 'DELETE' }), 'Stored credential removed.'); }}>Remove credential</button>}</div></form></details>}
    {busy && <Loading>Updating provider…</Loading>}{error != null && <ErrorNotice error={error} />}{message && <p className="small success-text" role="status">{message}</p>}
  </div>;
}

function ModelRow({ model, onSelect, contextTokens, owner }: { model: ModelProfile; onSelect: (id: string) => void; contextTokens: number; owner: boolean }) {
  const [admission, setAdmission] = useState<Admission | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  const assess = async () => {
    setChecking(true); setError(null);
    try { setAdmission(await mutation<Admission>('/models/assess', { modelId: model.id, contextTokens })); }
    catch (caught) { setError(caught); }
    finally { setChecking(false); }
  };
  return <article className="model-row"><div className="model-title"><div className="model-glyph">{model.local ? <Cpu size={19} /> : <Cloud size={19} />}</div><div><h3>{model.name}</h3><p className="small muted">{model.provider} / {model.runtime}{model.quantization ? ` / ${model.quantization}` : ''}</p></div><Status status={model.state} /></div>
    <div className="model-facts"><span>{model.contextWindow ? `${model.contextWindow.toLocaleString()} context` : 'Context unknown'}</span>{model.sizeBytes != null && <span>{bytes(model.sizeBytes)} weights</span>}<span>{model.tokensPerSecond == null ? 'Not benchmarked' : `${model.tokensPerSecond.toFixed(1)} tok/s measured`}</span><span>{model.local ? 'Runs on this machine' : model.inputPricePerMillion == null ? 'Cloud pricing unknown' : `$${model.inputPricePerMillion}/M input tokens`}</span></div>
    <div className="split"><div className="capabilities">{Object.entries(model.capabilities).filter(([, supported]) => supported).map(([capability]) => <span key={capability}>{humanize(capability)}</span>)}</div><div className="button-row">{model.local && <button className="text-button" onClick={() => { void assess(); }} disabled={checking}>{checking ? 'Checking…' : 'Check hardware fit'}</button>}<button className="button small-button" disabled={model.state === 'offline' || model.state === 'error'} onClick={() => onSelect(model.id)}>Use model<ArrowUpRight size={14} /></button></div></div>
    {admission && <div className={`admission ${admission.allowed ? '' : 'admission-warning'}`}><div className="split"><strong>{humanize(admission.decision)}</strong><span className="small">{humanize(admission.confidence)}</span></div><ul>{admission.reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul><p className="small muted">Context {admission.contextTokens.toLocaleString()} / RAM {bytes(admission.estimatedRamBytes)} / GPU {bytes(admission.estimatedVramBytes)}</p></div>}
    {owner && model.local && <Calibration modelId={model.id} contextTokens={contextTokens} />}{error != null && <ErrorNotice error={error} />}
  </article>;
}

export default function Models({ onSelect, contextTokens, owner = true }: { onSelect: (id: string) => void; contextTokens: number; owner?: boolean }) {
  const query = useQuery({ queryKey: ['models'], queryFn: ({ signal }) => api<ModelList>('/models', { signal }) });
  const [filter, setFilter] = useState<'all' | 'local' | 'cloud'>('all');
  const [search, setSearch] = useState('');
  const models = query.data?.models.filter(model => (filter === 'all' || model.local === (filter === 'local')) && `${model.name} ${model.provider}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <><div className="section-intro"><p>Choose the intelligence for your work.</p><p className="muted">Local runtimes are discovered on this host. Cloud providers are optional and require separate sharing permission.</p></div><div className="manager-toolbar"><label className="search-field"><span className="sr-only">Find a model</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a model…" /></label><select aria-label="Model location" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">All models</option><option value="local">Local</option><option value="cloud">Cloud</option></select><button className="icon-button" aria-label="Refresh models" disabled={query.isFetching} onClick={() => { void query.refetch(); }}><RefreshCw size={17} className={query.isFetching ? 'spin' : ''} /></button></div>
    {query.isPending ? <Loading>Discovering models…</Loading> : query.isError ? <ErrorNotice error={query.error} retry={() => { void query.refetch(); }} /> : <><div className="model-list">{models.map(model => <ModelRow key={model.id} model={model} onSelect={onSelect} contextTokens={contextTokens} owner={owner} />)}{!models.length && <Empty title={search ? 'No matching models' : 'No models available'} icon={<Cpu size={28} />}><p>{search ? 'Try another model name or location.' : owner ? 'Start a supported local runtime with an installed model, or connect a cloud provider below.' : 'The host owner manages model availability and your provider access.'}</p></Empty>}</div>{owner && <><div className="section-heading"><h3>Provider connections</h3><ShieldCheck size={17} /></div><div className="providers-list">{query.data.providers.map(provider => <ProviderRow key={provider.id} provider={provider} />)}</div></>}<p className="hint"><Check size={13} />Availability is checked by the backend. Model claims are not verification.</p></>}
  </>;
}
