import {describe,expect,it} from 'vitest';
import {codingAcceptanceOptions} from '../scripts/coding-acceptance-options';

describe('explicit coding acceptance resource choices',()=>{
  it('preserves the original context and output defaults',()=>{
    expect(codingAcceptanceOptions(['--model=local/exact'])).toEqual({mode:'model',modelId:'local/exact',contextTokens:16384,maxOutputTokens:4096});
    expect(codingAcceptanceOptions(['--sandbox-only']).mode).toBe('sandbox');
    expect(codingAcceptanceOptions(['--discover']).mode).toBe('discover');
  });
  it('records a deliberately larger output allowance without changing other budgets',()=>{
    expect(codingAcceptanceOptions(['--model=local/exact','--context=32768','--output=8192'])).toEqual({mode:'model',modelId:'local/exact',contextTokens:32768,maxOutputTokens:8192});
    expect(codingAcceptanceOptions(['--model=local/exact','--output=8192','--context=32768']).maxOutputTokens).toBe(8192);
  });
  it.each([[],['--model='],['--cloud'],['--model=local/exact','--output=65536'],['--model=local/exact','--context=65536'],['--model=local/exact','--output=8192','--output=4096'],['--model=local/exact','--context=32768','--context=16384'],['--discover','--output=8192'],['--sandbox-only','--context=32768']].map(args=>({args})))('rejects ambiguous, unrelated or unsupported options $args',({args})=>{
    expect(()=>codingAcceptanceOptions(args)).toThrow();
  });
});
