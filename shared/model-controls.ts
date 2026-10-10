export const reasoningEfforts=['none','minimal','low','medium','high','xhigh','max'] as const;
export type ReasoningEffort=typeof reasoningEfforts[number];
export type ReasoningPreference='auto'|'default'|ReasoningEffort;
export interface ReasoningControls {
  levels:ReasoningEffort[];
  source:string;
  defaultLevel?:ReasoningEffort;
  /** The adapter must validate the selected level against its own contract. */
  mode?:'effort'|'anthropic-adaptive'|'anthropic-budget'|'gemini-level'|'gemini-budget'|'deepseek';
}
export const providerLabels={ollama:'Ollama',lmstudio:'LM Studio',openai:'OpenAI · GPT',anthropic:'Anthropic · Claude',gemini:'Google · Gemini',xai:'xAI · Grok',deepseek:'DeepSeek'} as const;
