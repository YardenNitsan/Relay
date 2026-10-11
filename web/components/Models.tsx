import type { ModelProfile, ProviderStatus } from '../../shared/types';
import ModelStudio, { type ModelStudioProps } from '../features/models/ModelStudio';

export interface ModelList { models: ModelProfile[]; providers: ProviderStatus[] }

export default function Models(props: ModelStudioProps) {
  return <ModelStudio {...props} />;
}
