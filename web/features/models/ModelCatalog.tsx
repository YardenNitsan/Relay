import { ChevronRight, Cloud, Cpu } from 'lucide-react';
import type { ModelProfile } from '../../../shared/types';
import { Status } from '../../components/ui';

export type ModelLocation = 'all' | 'local' | 'cloud';
interface Props {
  models: ModelProfile[]; inspected: string | null; search: string; location: ModelLocation;
  pending: boolean; failed: boolean; onSearch: (value: string) => void;
  onLocation: (value: ModelLocation) => void; onInspect: (id: string) => void;
}

export default function ModelCatalog({ models, inspected, search, location, pending, failed, onSearch, onLocation, onInspect }: Props) {
  return <aside className="model-catalog" aria-label="Model catalog">
    <div className="model-catalog-tools">
      <label>Find a model<input type="search" value={search} onChange={event => onSearch(event.target.value)} placeholder="Name or provider" /></label>
      <label className="model-location">Location<select aria-label="Model location" value={location} onChange={event => onLocation(event.target.value as ModelLocation)}><option value="all">All models</option><option value="local">Local</option><option value="cloud">Cloud</option></select></label>
    </div>
    <div className="model-catalog-list"><p className="model-catalog-count">{pending ? 'Discovering models' : failed ? 'Discovery unavailable' : `${models.length} ${models.length === 1 ? 'model' : 'models'} in this view`}</p>
      {models.map(model => <button key={model.id} data-model-id={model.id} className="model-catalog-item" aria-label={`Inspect ${model.name}`} aria-current={model.id === inspected ? 'true' : undefined} onClick={() => onInspect(model.id)}>
        <span className="model-catalog-symbol">{model.local ? <Cpu size={19} aria-hidden="true" /> : <Cloud size={19} aria-hidden="true" />}</span>
        <span className="model-catalog-identity"><strong dir="auto">{model.name}</strong><span>{model.provider} / {model.local ? 'Local' : 'Cloud'}</span><Status status={model.state} /></span><ChevronRight className="model-catalog-arrow" size={16} aria-hidden="true" />
      </button>)}
      {!models.length && !pending && !failed && <div className="model-catalog-empty"><strong>{search || location !== 'all' ? 'No matching models' : 'No models available'}</strong><p>{search || location !== 'all' ? 'Try another model name or location.' : 'Open Connections to check a runtime or connect an allowed cloud provider.'}</p></div>}
    </div>
    <p className="model-catalog-footnote">Inspecting a model does not load it or start a measurement.</p>
  </aside>;
}
