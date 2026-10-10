import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ShieldCheck } from 'lucide-react';
import { api, mutation } from '../api';
import { ErrorNotice, Loading } from './ui';

type Profile = 'safe' | 'balanced' | 'performance' | 'custom';
type Reserves = { ramReserveGiB: number; ramReservePercent: number; vramReserveGiB: number; vramReservePercent: number };
type Policy = { profile: Exclude<Profile, 'custom'> } | ({ profile: 'custom' } & Reserves);
interface PolicyState { policy: Policy; profiles: ({ profile: Profile; label: string; description: string } & Reserves)[]; bounds: Record<keyof Reserves, { min: number; max: number }> }
const fields: { key: keyof Reserves; label: string }[] = [{ key: 'ramReserveGiB', label: 'RAM reserve (GiB)' }, { key: 'ramReservePercent', label: 'RAM reserve (%)' }, { key: 'vramReserveGiB', label: 'VRAM reserve (GiB)' }, { key: 'vramReservePercent', label: 'VRAM reserve (%)' }];

export default function ResourcePolicy() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['resource-policy'], queryFn: ({ signal }) => api<PolicyState>('/hardware/policy', { signal }) });
  const [draft, setDraft] = useState<Policy | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!query.data) return <section className="hardware-section"><h3><ShieldCheck size={18} />Resource policy</h3>{query.isError ? <ErrorNotice error={query.error} retry={() => { void query.refetch(); }} /> : <Loading>Reading resource policy…</Loading>}</section>;
  const data = query.data;
  const selected = draft ?? data.policy;
  const selectedProfile = data.profiles.find(profile => profile.profile === selected.profile);
  const applied = data.profiles.find(profile => profile.profile === data.policy.profile);
  const reserves = selected.profile === 'custom' ? selected : selectedProfile;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(data.policy);
  const edit = (next: Policy) => { setDraft(next); setSaved(false); setError(null); };
  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      const updated = await mutation<PolicyState>('/hardware/policy', selected);
      client.setQueryData(['resource-policy'], updated); setDraft(null);
      setSaved(true);
      // The policy POST is the commit acknowledgement. Telemetry/discovery can
      // be slow or unavailable and must not keep a successful save disabled.
      // Each query retains its own loading/error state during background refresh.
      void Promise.all(['hardware', 'model-assessment', 'models'].map(key => client.invalidateQueries({ queryKey: [key] }))).catch(() => undefined);
    } catch (caught) { setError(caught); }
    finally { setSaving(false); }
  };

  return <section className="hardware-section resource-policy"><div className="split"><h3><ShieldCheck size={18} />Resource policy</h3><span className="small muted">Applied: {applied?.label ?? data.policy.profile}</span></div><p className="muted small">Host-wide reserves protect the system during each new model admission. Saving does not interrupt a running generation.</p>
    <form onSubmit={event => { event.preventDefault(); void save(); }}><label className="field-label">Resource profile<select value={selected.profile} disabled={saving} onChange={event => {
      const profile = event.target.value as Profile;
      if (profile === 'custom') {
        const base = reserves ?? data.profiles.find(item => item.profile === 'safe')!;
        edit({ profile, ramReserveGiB: base.ramReserveGiB, ramReservePercent: base.ramReservePercent, vramReserveGiB: base.vramReserveGiB, vramReservePercent: base.vramReservePercent });
      } else edit({ profile });
    }}>{data.profiles.map(profile => <option key={profile.profile} value={profile.profile}>{profile.label}</option>)}</select></label>
      <p className="hint">{selectedProfile?.description}</p>
      {selected.profile === 'custom' && <div className="policy-reserves">{fields.map(field => <label key={field.key}>{field.label}<input required type="number" aria-label={field.label} aria-describedby={`policy-${field.key}-limits`} min={data.bounds[field.key].min} max={data.bounds[field.key].max} step="any" value={selected[field.key]} disabled={saving} onChange={event => edit({ ...selected, [field.key]: Number(event.target.value) })} /><span id={`policy-${field.key}-limits`} className="hint">Minimum {data.bounds[field.key].min}; maximum {data.bounds[field.key].max}.</span></label>)}</div>}
      {reserves && <p className="policy-summary">{dirty ? 'When saved, reserves' : 'Reserves'} the greater of <strong>{reserves.ramReserveGiB} GiB / {reserves.ramReservePercent}% RAM</strong>, and <strong>{reserves.vramReserveGiB} GiB / {reserves.vramReservePercent}% discrete VRAM</strong>. Enforced minimums always apply.</p>}
      <div className="button-row"><button className="button primary" disabled={!dirty || saving} type="submit">{saving ? 'Saving policy…' : 'Save resource policy'}</button>{dirty && <><button className="button subtle" type="button" disabled={saving} onClick={() => { setDraft(null); setError(null); }}>Discard changes</button><span className="small muted" role="status">Unsaved changes</span></>}{saved && <span className="success-text small" role="status"><Check size={14} />Resource policy saved</span>}</div>
    </form>{error != null && <ErrorNotice error={error} />}{query.isError && <ErrorNotice error={query.error} />}
  </section>;
}
