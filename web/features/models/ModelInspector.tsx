import { useState } from 'react';
import { ArrowUpRight, Cloud, Cpu } from 'lucide-react';
import type { Admission, ModelProfile, ProviderStatus } from '../../../shared/types';
import { mutation } from '../../api';
import Calibration from '../../components/Calibration';
import ModelEvaluation from '../../components/ModelEvaluation';
import { useModelOperation } from './model-operation';
import { bytes, ErrorNotice, humanize, Status } from '../../components/ui';

interface Props { model: ModelProfile; provider?: ProviderStatus; contextTokens: number; owner: boolean; onSelect: (id: string) => void }
const price = (value: number | null, direction: 'input' | 'output') => value == null || !Number.isFinite(value) || value < 0
  ? `${direction === 'input' ? 'Input' : 'Output'} price unknown`
  : `$${value} / million ${direction} tokens`;

export default function ModelInspector({ model, provider, contextTokens, owner, onSelect }: Props) {
  const [admission, setAdmission] = useState<Admission | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  useModelOperation(checking, 'hardware assessment');
  const assess = async () => {
    setChecking(true); setError(null);
    try { setAdmission(await mutation<Admission>('/models/assess', { modelId: model.id, contextTokens })); }
    catch (caught) { setError(caught); }
    finally { setChecking(false); }
  };
  return <article className="model-inspector-content">
    <header className="model-inspector-heading">
      <div className="model-inspector-location">{model.local ? <Cpu size={19} aria-hidden="true" /> : <Cloud size={19} aria-hidden="true" />}<span>{model.local ? 'Local model' : 'Cloud model'}</span><Status status={model.state} /></div>
      <h3 className="model-inspector-title" tabIndex={-1} dir="auto">{model.name}</h3>
      <p className="model-runtime">{model.provider} / {model.runtime}{model.quantization ? ` / ${model.quantization}` : ''}</p>
      <div className="model-inspector-actions"><button className="button primary" disabled={model.state === 'offline' || model.state === 'error'} onClick={() => onSelect(model.id)}>Use model<ArrowUpRight size={16} aria-hidden="true" /></button>{model.local && <button className="button" disabled={checking} onClick={() => { void assess(); }}>{checking ? 'Checking…' : 'Check hardware fit'}</button>}</div>
      <p className="hint">{model.local ? 'Runs on the host computer. Loading still depends on current hardware and task limits.' : 'Uses your account connection. Sharing task content still requires your conversation policy.'}</p>
    </header>
    <section className="model-inspector-section" aria-label="Model facts">
      <h4>Model facts</h4>
      <dl className="model-inspector-facts">
        <div><dt>Exact model ID</dt><dd><code dir="ltr">{model.id}</code></dd></div>
        <div><dt>Context window</dt><dd>{model.contextWindow ? `${model.contextWindow.toLocaleString()} tokens advertised` : 'Context unknown'}</dd></div>
        <div><dt>Model weights</dt><dd>{model.sizeBytes == null ? 'Weight size unknown' : `${bytes(model.sizeBytes)} reported`}</dd></div>
        <div><dt>Measured generation</dt><dd>{model.tokensPerSecond == null || !Number.isFinite(model.tokensPerSecond) ? 'Not benchmarked' : `${model.tokensPerSecond.toFixed(1)} tok/s measured`}</dd></div>
        <div><dt>Provider availability</dt><dd>{provider ? provider.enabled === false ? 'Disabled' : provider.state ? humanize(provider.state) : provider.connected ? 'Connected' : provider.configured ? 'Unavailable' : 'Not configured' : 'Not reported'}</dd></div>
      </dl>
      {provider?.error && <p className="notice">{provider.error}</p>}
      {model.local && typeof model.details.limitation === 'string' && <p className="hint">{model.details.limitation}</p>}
    </section>
    {!model.local && <section className="model-inspector-section" aria-label="Cloud prices"><h4>Cloud prices</h4><p>{price(model.inputPricePerMillion, 'input')}</p><p>{price(model.outputPricePerMillion, 'output')}</p><p className="hint">Unknown pricing is not free. It cannot satisfy a strict dollar cap. Provider billing and task-sharing permissions apply separately.</p></section>}
    <section className="model-inspector-section" aria-label="Advertised model capabilities"><h4>Advertised capabilities</h4><ul className="model-capability-list">{Object.entries(model.capabilities).map(([capability, supported]) => <li key={capability}><span>{humanize(capability)}</span><span>{supported ? 'Advertised' : 'Not advertised'}</span></li>)}</ul><p className="hint">Provider and model claims are not verified task results.</p></section>
    {admission && <section className={`admission ${admission.allowed ? '' : 'admission-warning'}`} aria-label="Hardware assessment"><div className="split"><strong>{humanize(admission.decision)}</strong><span>{humanize(admission.confidence)}</span></div><ul>{admission.reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul><p className="hint">Context {admission.contextTokens.toLocaleString()} / RAM {bytes(admission.estimatedRamBytes)} / GPU {bytes(admission.estimatedVramBytes)}</p></section>}
    {error != null && <ErrorNotice error={error} />}
    {owner && model.local && <section className="model-inspector-section model-measurements" aria-label="Local model measurements"><h4>Measure this model</h4><Calibration modelId={model.id} contextTokens={contextTokens} /><ModelEvaluation modelId={model.id} contextTokens={contextTokens} /></section>}
  </article>;
}
