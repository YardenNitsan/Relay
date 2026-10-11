import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BrainCircuit, Check, Cloud, Cpu, Search, ShieldCheck, SlidersHorizontal, Workflow } from 'lucide-react';
import { providerLabels, type ReasoningPreference } from '../../shared/model-controls';
import type { AutoModelPolicy, ModelProfile, ProviderId, TaskOptions } from '../../shared/types';
import { autoPolicyLabels, reasoningLabels, type ModelPickerProps } from './ModelPicker';

type Sharing = NonNullable<TaskOptions['cloudPolicy']>;
type Screen = 'providers' | 'auto' | 'models' | 'reasoning';
const localProvider = (id: ProviderId) => id === 'ollama' || id === 'lmstudio';
const usable = (model: ModelProfile) => model.state !== 'offline' && model.state !== 'error';
const reasoningDescriptions: Record<ReasoningPreference, string> = {
  auto: 'Relay chooses a supported effort for the task.', default: 'Use the provider\'s own default behavior.',
  none: 'Disable adjustable reasoning where supported.', minimal: 'The smallest supported reasoning effort.',
  low: 'Less reasoning for straightforward work.', medium: 'A middle level of reasoning effort.',
  high: 'More reasoning for demanding problems.', xhigh: 'Additional reasoning, with potentially higher latency and cost.',
  max: 'The highest supported effort; potentially substantial token use.',
};
const sharingFor = (options: TaskOptions): Sharing => options.budget.localOnly ? 'local_only' : options.cloudPolicy ?? 'allow';

export default function PickerPanel({ models, providers, options, onOptions, onConnections, canUseCloud, initialModelId, onClose }: ModelPickerProps & { onClose: () => void }) {
  const initial = models.find(model => model.id === initialModelId);
  const [screen, setScreen] = useState<Screen>(initial ? 'reasoning' : 'providers');
  const [providerId, setProviderId] = useState<ProviderId | null>(initial?.provider ?? null);
  const [modelId, setModelId] = useState<string | null>(initial?.id ?? null);
  const [search, setSearch] = useState('');
  const [reasoning, setReasoning] = useState<ReasoningPreference>(initial?.id === options.modelId ? options.reasoning ?? 'auto' : 'auto');
  const [sharing, setSharing] = useState<Sharing>(sharingFor(options));
  const [autoPolicy,setAutoPolicy]=useState<AutoModelPolicy>(options.autoPolicy??'balanced');
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const model = models.find(item => item.id === modelId);
  const provider = providers.find(item => item.id === providerId);
  const connected = (item: ModelProfile) => {
    const status = providers.find(current => current.id === item.provider);
    return usable(item) && Boolean(status?.connected && status.enabled !== false) && (item.local || canUseCloud);
  };
  const knownProviders = providers.filter(item => localProvider(item.id) || item.configured || item.connected);
  const matching = models.filter(item => item.provider === providerId && `${item.id} ${item.name} ${item.runtime}`.toLowerCase().includes(search.toLowerCase()));
  const cloudCount = models.filter(item => !item.local && connected(item)).length;
  const localCount = models.filter(item => item.local && connected(item)).length;
  const levels: ReasoningPreference[] = ['auto', 'default', ...(model?.reasoning?.levels ?? [])];
  const validReasoning = levels.includes(reasoning);
  const selectingCloud = screen === 'reasoning' && model && !model.local;
  const changedSharing = sharing !== sharingFor(options);
  const sharingAllowed = sharing === 'local_only' || canUseCloud;
  const canApply = screen === 'auto' ? sharingAllowed : Boolean(model && connected(model) && validReasoning && (!selectingCloud || sharing !== 'local_only') && sharingAllowed);
  const choice = screen === 'auto' ? 'Auto' : 'model';
  const applyLabel = changedSharing && sharing === 'ask' ? `Use ${choice} and ask before sharing` : changedSharing && sharing === 'allow' ? `Use ${choice} and allow cloud sharing` : `Use ${choice}`;
  useEffect(() => { heading.current?.focus(); }, [screen]);
  const apply = () => {
    if (!canApply) return;
    onOptions({ ...options, autoPolicy, modelId: screen === 'auto' ? null : model!.id,
      modelSelection: screen === 'auto' ? undefined : 'required', reasoning: screen === 'auto' ? 'auto' : reasoning,
      cloudPolicy: sharing, budget: { ...options.budget, localOnly: sharing === 'local_only' } });
    onClose();
  };
  const connections = () => { onClose(); onConnections(); };
  const selectModel = (item: ModelProfile) => {
    setModelId(item.id);
    setReasoning(item.id === options.modelId && ['auto', 'default', ...(item.reasoning?.levels ?? [])].includes(options.reasoning ?? 'auto') ? options.reasoning ?? 'auto' : 'auto');
    setScreen('reasoning');
  };
  const back = () => { setScreen(screen === 'reasoning' ? 'models' : 'providers'); };
  const title = screen === 'providers' ? 'The right model for your work' : screen === 'auto' ? 'Let Relay choose' : screen === 'models' ? providerId ? providerLabels[providerId] : 'Models' : model?.name ?? 'Model unavailable';

  return <>
    <div className="model-picker-body">
      {screen !== 'providers' && <button type="button" className="model-picker-back" onClick={back}><ArrowLeft size={15} aria-hidden="true" />{screen === 'reasoning' ? 'Back to models' : 'All providers'}</button>}
      <div className="model-picker-intro">
        <h3 ref={heading} tabIndex={-1}>{title}</h3>
        <p>{screen === 'providers' ? 'Choose a connection, then a model and its reasoning. Your draft stays here.' : screen === 'auto' ? 'Auto weighs task needs, available evidence, speed and known cost within your permissions.' : screen === 'models' ? 'Models discovered through your connection. Availability is checked again before execution.' : model ? `${providerLabels[model.provider]}${model.local ? ' · Runs on this computer' : ' · Uses your API account'}` : 'Refresh your connections to choose an available model.'}</p>
      </div>

      {screen === 'providers' && <>
        <button type="button" className="model-picker-auto" aria-label="Auto" onClick={() => setScreen('auto')}>
          <span className="model-picker-symbol"><Workflow size={23} aria-hidden="true" /></span>
          <span><strong>Auto</strong><span>Model and reasoning chosen for the task</span><small>{sharingFor(options) === 'local_only' ? 'Local models only' : 'Authorized local and cloud models'}</small></span>
          <ArrowRight size={18} aria-hidden="true" />
        </button>
        {(['local', 'cloud'] as const).map(group => {
          const items = knownProviders.filter(item => localProvider(item.id) === (group === 'local'));
          if (!items.length) return null;
          return <section className="model-picker-group" key={group} aria-labelledby={`${id}-${group}`}>
            <h4 id={`${id}-${group}`}>{group === 'local' ? 'On this computer' : 'Your cloud connections'}</h4>
            {items.map(item => {
              const count = models.filter(current => current.provider === item.id && connected(current)).length;
              return <button type="button" className="model-picker-provider" key={item.id} aria-label={providerLabels[item.id]} onClick={() => { setProviderId(item.id); setSearch(''); setScreen('models'); }}>
                {group === 'local' ? <Cpu size={19} aria-hidden="true" /> : <Cloud size={19} aria-hidden="true" />}
                <span><strong>{providerLabels[item.id]}</strong><small>{item.enabled === false ? 'Disabled' : !item.connected ? 'Connection unavailable' : !localProvider(item.id) && !canUseCloud ? 'Cloud use is not permitted' : `${count} available ${count === 1 ? 'model' : 'models'}`}</small></span>
                {options.modelId && models.some(current => current.id === options.modelId && current.provider === item.id) ? <Check size={17} aria-label="Current provider" /> : <ArrowRight size={16} aria-hidden="true" />}
              </button>;
            })}
          </section>;
        })}
        <button type="button" className="model-picker-connect" onClick={connections}><SlidersHorizontal size={17} aria-hidden="true" />Manage connections<ArrowRight size={16} aria-hidden="true" /></button>
        <p className="model-picker-note">API access is separate from a ChatGPT, Claude or other chat subscription. Connecting a provider does not permit sharing your task.</p>
      </>}

      {screen === 'models' && <>
        <label className="model-picker-search"><Search size={17} aria-hidden="true" /><span className="sr-only">Search models</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search this connection" /></label>
        <div className="model-picker-results" aria-live="polite">{matching.length} {matching.length === 1 ? 'model' : 'models'}{search ? ' matching your search' : ' discovered'}</div>
        {(!provider?.connected || !matching.some(connected)) && <div className="model-picker-empty"><h4>{search ? 'No available matching models' : 'No available models'}</h4><p>{provider?.connected ? 'Try a different search or refresh the model list in connections.' : 'Check this connection to discover models available to your account.'}</p><button type="button" className="button" onClick={connections}>Open connections</button></div>}
        <div className="model-picker-models">{matching.map(item => <button type="button" key={item.id} className="model-picker-model" aria-label={item.name} disabled={!connected(item)} onClick={() => selectModel(item)}>
          <span><strong>{item.name}</strong><small>{item.runtime}</small><span className="model-picker-capabilities">{item.contextWindow ? `${item.contextWindow.toLocaleString()} context` : 'Context unknown'}{item.capabilities.tools && <span>Tools</span>}{item.capabilities.vision && <span>Vision</span>}</span></span>
          <ArrowRight size={17} aria-hidden="true" />
        </button>)}</div>
      </>}

      {screen === 'auto' && <>
        <div className="model-picker-route"><Workflow size={24} aria-hidden="true" /><div><strong>{localCount} local{sharing !== 'local_only' ? ` + ${cloudCount} cloud` : ''} models available</strong><p>Eligibility is checked first. Missing measurements remain uncertain; Auto uses a conservative fallback.</p></div></div>
        <fieldset className="model-picker-sharing"><legend>Auto preference</legend>{(['balanced','quality','economy'] as const).map(policy=><label key={policy} className={`model-picker-sharing-choice ${autoPolicy===policy?'selected':''}`}><input type="radio" aria-label={autoPolicyLabels[policy]} name={`${id}-auto-policy`} value={policy} checked={autoPolicy===policy} onChange={()=>setAutoPolicy(policy)}/><span><strong>{autoPolicyLabels[policy]}</strong><small>{policy==='balanced'?'Balance measured suitability, speed and cost.':policy==='quality'?'Prioritize relevant measured task performance. Unmeasured quality remains uncertain.':'Favor lower known cloud cost among similarly suitable models. Unknown cloud prices are excluded.'}</small></span></label>)}</fieldset>
        <SharingChoices value={sharing} onChange={setSharing} allowLocal canUseCloud={canUseCloud} name={`${id}-sharing`} />
        <p className="model-picker-note">Auto selects a supported reasoning level. Auto never requests maximum effort; provider defaults can vary. A failed local model never grants cloud permission.</p>
      </>}

      {screen === 'reasoning' && model && <>
        <fieldset className="model-picker-reasoning"><legend><BrainCircuit size={18} aria-hidden="true" />Reasoning effort</legend><p>More effort can use more tokens and take longer. Effort is not a spending limit.</p>
          <div className="model-picker-efforts">{levels.map(level => <label key={level} className={`model-picker-effort ${reasoning === level ? 'selected' : ''}`}><input type="radio" name={`${id}-reasoning`} value={level} checked={reasoning === level} onChange={() => setReasoning(level)} /><span>{reasoningLabels[level]}</span>{reasoning === level && <Check size={14} aria-hidden="true" />}</label>)}</div>
          <p className="model-picker-effort-description" aria-live="polite">{reasoningDescriptions[reasoning]}</p>
          {!model.reasoning?.levels.length && <p className="model-picker-note">Reasoning controls are not verified for this model. Auto preserves the provider default.</p>}
        </fieldset>
        {!model.local && <SharingChoices value={sharing} onChange={setSharing} allowLocal={false} canUseCloud={canUseCloud} name={`${id}-sharing`} />}
        <div className="model-picker-price">{model.local ? <><Cpu size={16} aria-hidden="true" /><span>No cloud API charge. Local resource admission still applies.</span></> : model.inputPricePerMillion === null || model.outputPricePerMillion === null ? <><Cloud size={16} aria-hidden="true" /><span><strong>Pricing unavailable</strong>Relay cannot verify a dollar estimate for this model. A strict dollar cap may prevent execution.</span></> : <><Cloud size={16} aria-hidden="true" /><span><strong>Published token pricing</strong>${model.inputPricePerMillion.toLocaleString()} input / ${model.outputPricePerMillion.toLocaleString()} output per million tokens. This is not a task estimate.</span></>}</div>
      </>}

      {(screen === 'auto' || screen === 'reasoning') && <div className="model-picker-limits"><ShieldCheck size={18} aria-hidden="true" /><div><strong>Your budget stays in place</strong><p>Up to {(options.budget.maxOutputTokens ?? 2048).toLocaleString()} output tokens per call · {options.budget.maxCalls} calls maximum{options.budget.maxCostUsd === null ? ' · No task dollar cap' : ` · $${options.budget.maxCostUsd} task cap`}. Model and context limits may lower the output ceiling. Adjust limits in Advanced controls.</p></div></div>}
    </div>
    {(screen === 'auto' || screen === 'reasoning') && <footer className="model-picker-footer"><div className="model-picker-selection"><span>{screen === 'auto' ? 'Auto' : model?.name ?? 'Model unavailable'}</span><small>{screen === 'auto' ? 'Model + reasoning' : reasoningLabels[reasoning]}</small></div><button type="button" className="button" onClick={onClose}>Cancel</button><button type="button" className="button primary" disabled={!canApply} onClick={apply}>{applyLabel}<Check size={16} aria-hidden="true" /></button></footer>}
  </>;
}

function SharingChoices({ value, onChange, allowLocal, canUseCloud, name }: { value: Sharing; onChange: (value: Sharing) => void; allowLocal: boolean; canUseCloud: boolean; name: string }) {
  const choices: Array<{ value: Sharing; title: string; text: string }> = [
    ...(allowLocal ? [{ value: 'local_only' as const, title: 'Keep it local', text: 'Only models running on this computer.' }] : []),
    { value: 'ask', title: 'Ask before sharing', text: 'Include cloud models, with approval before sending task context.' },
    { value: 'allow', title: 'Allow for this objective', text: 'Permit task context to reach your authorized cloud providers.' },
  ];
  return <fieldset className="model-picker-sharing"><legend><ShieldCheck size={18} aria-hidden="true" />{allowLocal ? 'Models Auto may use' : 'Cloud sharing for this objective'}</legend>
    {!allowLocal && value === 'local_only' && <p>Choose a sharing policy to use this cloud model.</p>}
    {choices.map(choice => <label key={choice.value} className={`model-picker-sharing-choice ${value === choice.value ? 'selected' : ''}`}><input type="radio" aria-label={choice.title} name={name} value={choice.value} checked={value === choice.value} disabled={choice.value !== 'local_only' && !canUseCloud} onChange={() => onChange(choice.value)} /><span><strong>{choice.title}</strong><small>{choice.text}</small></span></label>)}
    {!canUseCloud && <p className="model-picker-note">Your account does not permit cloud inference. Ask the host owner to review your access.</p>}
  </fieldset>;
}
