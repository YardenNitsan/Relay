import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { bytes, ErrorNotice, Loading, time } from './ui';

interface ResidentSnapshot { state: 'observed' | 'unavailable' | 'disabled'; source: string; sampledAt: string; models: { id: string; digest: string | null; reportedBytes: number | null; gpuBytes: number | null; contextTokens: number | null; expiresAt: string | null }[]; truncated: boolean; error: string | null }
export default function ResidentModels() {
  const query = useQuery({ queryKey: ['resident-models'], queryFn: ({ signal }) => api<ResidentSnapshot>('/models/resident', { signal }), refetchInterval: 5000 });
  const data = query.data;
  return <section className="hardware-section"><h3>Resident models</h3><p className="muted small">Runtime-reported allocations are a snapshot, not measured peak requirements or proof that Relay owns the model.</p>
    {!data ? query.isError ? <ErrorNotice error={query.error} retry={() => { void query.refetch(); }} /> : <Loading>Reading runtime inventory…</Loading> : <>
      <p className="sample-time">Source: {data.source}. Sampled at {time(data.sampledAt)}.</p>
      {data.state !== 'observed' ? <p className="muted small">{data.error ?? (data.state === 'disabled' ? 'Runtime inventory is disabled.' : 'Runtime inventory is unavailable.')}</p> : data.models.length === 0 ? <p className="muted small">The runtime reports no resident models.</p> : <div className="resident-list">{data.models.map(model => <article key={model.id}><h4>{model.id}</h4><dl className="facts-grid"><div><dt>Reported allocation</dt><dd>{bytes(model.reportedBytes)}</dd></div><div><dt>GPU allocation</dt><dd>{bytes(model.gpuBytes)}</dd></div><div><dt>Context capacity</dt><dd>{model.contextTokens?.toLocaleString() ?? 'Unavailable'}</dd></div></dl>{model.expiresAt && <p className="hint">Runtime expiry: {new Date(model.expiresAt).toLocaleString()}</p>}</article>)}</div>}
      {data.truncated && <p className="hint">The runtime inventory was truncated.</p>}{query.isError && <ErrorNotice error={query.error} />}
    </>}
  </section>;
}
