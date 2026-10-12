import type {ToolContract} from './types';

export function ContractDocument({tool}:{tool:ToolContract}){
  return <><p dir="auto">{tool.description||'No description supplied by this server.'}</p><details><summary>Inspect schema and fingerprint</summary><pre tabIndex={0} role="region" aria-label={`${tool.name} schema`}>{JSON.stringify({input:tool.inputSchema,...(tool.outputSchema?{output:tool.outputSchema}:{})},null,2)}</pre><span className="hint">Pinned contract fingerprint</span><code className="mcp-fingerprint">{tool.schemaHash}</code></details></>;
}
