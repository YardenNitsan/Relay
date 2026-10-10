import { lazy, Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Cloud, Cpu, Workflow } from 'lucide-react';
import type { ReasoningPreference } from '../../shared/model-controls';
import type { ModelProfile, ProviderStatus, TaskOptions } from '../../shared/types';
import { Loading, Modal } from './ui';
import '../styles/model-picker.css';

const PickerPanel = lazy(() => import('./ModelPickerPanel'));

export interface ModelPickerProps {
  models: ModelProfile[];
  providers: ProviderStatus[];
  options: TaskOptions;
  onOptions: (options: TaskOptions) => void;
  onConnections: () => void;
  canUseCloud: boolean;
  /** Controlled mode renders only the panel, without the composer trigger. */
  open?: boolean;
  onClose?: () => void;
  initialModelId?: string | null;
}

export const reasoningLabels: Record<ReasoningPreference, string> = {
  auto: 'Auto', default: 'Provider default', none: 'Off', minimal: 'Minimal', low: 'Low',
  medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Maximum',
};

export default function ModelPicker(props: ModelPickerProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const opened = props.open ?? ownOpen;
  const selected = props.models.find(model => model.id === props.options.modelId);
  const close = () => { setOwnOpen(false); props.onClose?.(); };
  return <>
    {props.open === undefined && <button type="button" className="model-picker-trigger" aria-label="Choose model" aria-haspopup="dialog" aria-expanded={opened} onClick={() => setOwnOpen(true)}>
      {selected ? selected.local ? <Cpu size={15} aria-hidden="true" /> : <Cloud size={15} aria-hidden="true" /> : <Workflow size={15} aria-hidden="true" />}
      <span>{selected?.name ?? (props.options.modelId ? 'Selected model unavailable' : 'Auto')}</span>
      {selected && <small>{reasoningLabels[props.options.reasoning ?? 'auto']}</small>}
      <ChevronDown size={13} aria-hidden="true" />
    </button>}
    {opened && createPortal(<Modal title="Choose model" onClose={close} className="model-picker-panel"><Suspense fallback={<div className="model-picker-body"><Loading>Opening model choices...</Loading></div>}><PickerPanel {...props} onClose={close} /></Suspense></Modal>, document.body)}
  </>;
}
