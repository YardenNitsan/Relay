import type {ModelProfile,TaskOptions,ToolDefinition} from '../../shared/types.js';
import {AppError} from '../core/errors.js';

export interface CallBudget {maxOutputTokens:number;inputReservationTokens:number;requestedOutputTokens:number;modelOutputLimit:number|null;inputSizingMethod:'conservative_utf8_bytes';}
/** One ceiling shared by context fit, provider request and cloud reservation. */
export function callBudget(options:TaskOptions,model:ModelProfile):CallBudget {
  const requested=options.budget.maxOutputTokens??2048;
  if(!Number.isInteger(requested)||requested<256||requested>8192)throw new AppError('OUTPUT_BUDGET','Maximum output tokens must be an integer from 256 to 8192.');
  if(!Number.isInteger(options.contextTokens)||options.contextTokens<2048)throw new AppError('CONTEXT_BUDGET','A context window of at least 2048 tokens is required.');
  const advertised=model.details.maxOutputTokens;
  const modelOutputLimit=typeof advertised==='number'&&Number.isSafeInteger(advertised)&&advertised>0?advertised:null;
  return {maxOutputTokens:Math.min(requested,Math.floor(options.contextTokens/3),modelOutputLimit??Infinity),inputReservationTokens:options.contextTokens,requestedOutputTokens:requested,modelOutputLimit,inputSizingMethod:'conservative_utf8_bytes'};
}
export function efficientTools(options:TaskOptions,tools:ToolDefinition[]):ToolDefinition[] {
  if(options.efficiency==='standard'||options.access!=='read_only')return tools;
  const unavailable=new Set(['file_write','file_delete','terminal','host_write','host_delete']);
  return tools.filter(tool=>!unavailable.has(tool.name));
}
export const efficientInstruction='Token efficiency: Give a complete answer with concise wording. Avoid repeating the objective, instructions or tool output. Preserve necessary detail, evidence, uncertainty and required verification; do not skip checks or shorten code merely to save tokens.';
export function outputTruncated(reason:string):boolean {return ['length','max_tokens','max_output_tokens','max_output_length','token_limit'].includes(reason.toLowerCase());}
