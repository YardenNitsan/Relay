import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Cloud, Cpu, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../../api';
import type { ModelList } from '../../components/Models';
import { Empty, ErrorNotice, Loading } from '../../components/ui';
import { useGuardedModalAction } from '../../components/modal-guard';
import { useRememberedFocus } from '../../layout/useRememberedFocus';
import ModelCatalog, { type ModelLocation } from './ModelCatalog';
import ModelInspector from './ModelInspector';
import ProviderConnection from './ProviderConnection';
import {ModelOperationContext} from './model-operation';
import type {ModelProfile} from '../../../shared/types';
import './models.css';

export interface ModelStudioProps { onSelect: (id: string) => void; contextTokens: number; owner?: boolean; hostName?: string; accountName?: string }

export default function ModelStudio({ onSelect, contextTokens, owner = true, hostName, accountName }: ModelStudioProps) {
  const query = useQuery({ queryKey: ['models'], queryFn: ({ signal }) => api<ModelList>('/models?refreshLocal=1', { signal }), refetchOnMount: 'always', refetchOnWindowFocus: false });
  const [location, setLocation] = useState<ModelLocation>('all'), [search, setSearch] = useState('');
  const [inspected, setInspected] = useState<string | null>(null), [showInspector, setShowInspector] = useState(false);
  const [view, setView] = useState<'catalog' | 'connections'>('catalog');
  const root = useRef<HTMLDivElement>(null), lastFocused = useRememberedFocus();
  const moveFocus = useRef<'catalog' | 'inspector' | 'connections' | null>(null);
  const request = useGuardedModalAction();
  const [operations,setOperations]=useState<Set<string>>(()=>new Set()),[blocked,setBlocked]=useState(false);
  const reportOperation=useCallback((id:string,busy:boolean)=>setOperations(previous=>{
    if(previous.has(id)===busy)return previous;
    const next=new Set(previous);if(busy)next.add(id);else next.delete(id);return next;
  }),[]);
  const inspectorBusy=operations.size>0,lastSelected=useRef<ModelProfile|undefined>(undefined);
  const discovered = inspected ? query.data?.models.find(model => model.id === inspected) : query.data?.models[0];
  const selected=inspectorBusy?lastSelected.current??discovered:discovered;
  useLayoutEffect(()=>{if(!inspectorBusy)lastSelected.current=selected;},[inspectorBusy,selected]);
  useEffect(()=>{if(!inspectorBusy)setBlocked(false);},[inspectorBusy]);
  const models = query.data?.models.filter(model => (location === 'all' || model.local === (location === 'local')) && `${model.id} ${model.name} ${model.provider} ${model.runtime}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? [];
  const localProviders = query.data?.providers.filter(provider => ['ollama', 'lmstudio'].includes(provider.id)) ?? [];
  const cloudProviders = query.data?.providers.filter(provider => !['ollama', 'lmstudio'].includes(provider.id)) ?? [];
  const focusCatalog = () => {
    const items = root.current?.querySelectorAll<HTMLButtonElement>('[data-model-id]');
    const item = items && Array.from(items).find(button => button.dataset.modelId === selected?.id);
    (item ?? root.current?.querySelector<HTMLInputElement>('.model-catalog input'))?.focus();
  };
  useEffect(() => {
    const target = moveFocus.current; moveFocus.current = null;
    if (target === 'catalog') focusCatalog();
    else if (target === 'inspector') root.current?.querySelector<HTMLElement>('.model-inspector-title')?.focus();
    else if (target === 'connections') root.current?.querySelector<HTMLElement>('.model-connections-title')?.focus();
  }, [view, inspected, showInspector]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 899px)');
    const resized = () => {
      const active = document.activeElement === document.body ? lastFocused.current : document.activeElement;
      if (!(active instanceof HTMLElement) || !root.current?.contains(active) || active.getClientRects().length) return;
      const title = root.current.querySelector<HTMLElement>('.model-inspector-title');
      if (active.closest('.model-catalog') && title?.getClientRects().length) title.focus();
      else {
        const inspectedButton = Array.from(root.current.querySelectorAll<HTMLButtonElement>('[data-model-id]')).find(button => button.getAttribute('aria-current') === 'true');
        const target = inspectedButton ?? root.current.querySelector<HTMLElement>('.model-catalog input');
        if (target?.getClientRects().length) target.focus();
      }
    };
    media.addEventListener('change', resized); return () => media.removeEventListener('change', resized);
  }, [lastFocused]);
  const inspect = (id: string) => {
    if(inspectorBusy&&id!==selected?.id){setBlocked(true);return;}
    if (id === inspected && showInspector) { root.current?.querySelector<HTMLElement>('.model-inspector-title')?.focus(); return; }
    moveFocus.current = 'inspector'; setInspected(id); setShowInspector(true);
  };
  const back = () => { moveFocus.current = 'catalog'; setShowInspector(false); };
  const navigate = (next: typeof view) => {
    if (next === view && (next !== 'catalog' || !showInspector)) return;
    moveFocus.current = next; setView(next); if (next === 'catalog') setShowInspector(false);
  };
  const select = (id: string) => request(() => onSelect(id));
  return <ModelOperationContext.Provider value={reportOperation}><div ref={root} className={`model-studio model-dispatch ${showInspector ? 'model-show-inspector' : ''}`}>
    <header className="model-library-heading"><div><span className="model-library-label">RELAY / MODEL LIBRARY</span><h3>Choose with confidence.</h3><p>Inspect capabilities and evidence. Keep control of where your work runs.</p></div><div className="model-library-context"><span>{query.data ? `${query.data.models.length} discovered models` : query.isError ? 'Model discovery unavailable' : 'Discovering your models'}</span><strong dir="auto">{hostName ?? 'Your Relay host'}</strong><span dir="auto">{accountName ?? 'Your account'}</span></div></header>
    <nav className="model-studio-nav" aria-label="Model Studio views"><button aria-current={view === 'catalog' ? 'page' : undefined} onClick={() => navigate('catalog')}>Model catalog</button><button aria-current={view === 'connections' ? 'page' : undefined} onClick={() => navigate('connections')}>Connections</button><button className="icon-button" aria-label="Refresh models" disabled={query.isFetching||inspectorBusy} onClick={() => { void query.refetch(); }}><RefreshCw size={18} aria-hidden="true" className={query.isFetching ? 'spin' : ''} /></button></nav>
    {blocked&&<div className="model-studio-feedback"><p role="status">Wait for the current operation to finish before inspecting another model.</p></div>}
    {query.isPending && <div className="model-studio-feedback"><Loading>Discovering models…</Loading></div>}
    {query.isError && <div className="model-studio-feedback">{query.data && <p className="hint">Refresh failed. Previously discovered models and connections remain available below.</p>}<ErrorNotice error={query.error} retry={() => { void query.refetch(); }} /></div>}
    <div className="model-workspace" hidden={view !== 'catalog'}>
      <ModelCatalog models={models} inspected={selected?.id ?? null} search={search} location={location} pending={query.isPending} failed={query.isError && !query.data} onSearch={setSearch} onLocation={setLocation} onInspect={inspect} />
      <section className="model-inspector" aria-label="Model inspector">
        <div className="model-inspector-back"><button className="text-button" onClick={back}><ArrowLeft size={17} aria-hidden="true" />All models</button></div>
        {selected ? <ModelInspector key={selected.id} model={selected} provider={query.data?.providers.find(provider => provider.id === selected.provider)} contextTokens={contextTokens} owner={owner} onSelect={select} /> : <Empty title={inspected ? 'Model no longer listed' : 'Inspect a model'} icon={<Cpu size={26} aria-hidden="true" />}><p>{inspected ? 'Return to the catalog or refresh discovery to choose another model.' : 'Compare reported capabilities, measured evidence and task limits before choosing.'}</p></Empty>}
      </section>
    </div>
    <section className="model-connections" hidden={view !== 'connections'} aria-label="Provider connections">
      <h3 className="model-connections-title" tabIndex={-1}>Provider connections</h3>
      <div className="model-account-context"><ShieldCheck size={20} aria-hidden="true" /><div><strong dir="auto">{accountName ? `Connections for ${accountName}` : 'Your Relay connections'}</strong><p>Cloud credentials belong to your account. Task sharing permission stays separate.</p></div></div>
      <p className="model-host-context">Local models and tools run on {hostName ?? 'the host computer'}. Your browser can connect from another device.</p>
      <section aria-labelledby="cloud-connections-heading"><div className="section-heading"><h3 id="cloud-connections-heading">Your cloud connections</h3><Cloud size={18} aria-hidden="true" /></div><p className="hint">Use your own API account. Signing in to Relay does not connect a model provider. Consumer subscriptions for ChatGPT, Claude, Gemini, Grok or DeepSeek do not automatically provide API access.</p>{cloudProviders.length ? <div className="providers-list">{cloudProviders.map(provider => <ProviderConnection key={provider.id} provider={provider} owner={owner} />)}</div> : !query.isPending && !query.isError && <p className="notice">Your account currently permits local models only. The host owner can grant individual cloud providers.</p>}<p className="hint">Your provider’s billing limits apply. Unknown pricing cannot satisfy a strict dollar cap; any permission to use personal API billing without a cap must come from the host owner.</p></section>
      {owner && localProviders.length > 0 && <section aria-labelledby="host-runtimes-heading"><div className="section-heading"><h3 id="host-runtimes-heading">Host runtimes</h3><Cpu size={18} aria-hidden="true" /></div><p className="hint">These runtime settings affect local models shared on this host.</p><div className="providers-list">{localProviders.map(provider => <ProviderConnection key={provider.id} provider={provider} owner={owner} />)}</div></section>}
      <p className="hint">Availability is checked by the backend. Model claims are not verification.</p>
    </section>
  </div></ModelOperationContext.Provider>;
}
