import type {ProviderId} from './types.js';
export interface ProviderLimitSnapshot {
  observedAt:string;
  limits:Array<{kind:'tokens'|'input_tokens'|'output_tokens'|'requests';remaining:number;limit:number|null;reset:string|null}>;
}
export interface UsageReport {
  periodStart:string;
  periodEnd:string;
  truncated:boolean;
  models:Array<{modelId:string;provider:ProviderId;name:string;local:boolean;requests:number;inputTokens:number;outputTokens:number;unreportedCalls:number;limits:ProviderLimitSnapshot|null}>;
}
