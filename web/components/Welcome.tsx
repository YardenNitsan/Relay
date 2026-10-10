import { GitBranch, Layers, Plus } from 'lucide-react';
import '../features/conversation/welcome.css';

const starters = [
  { title: 'Break down a problem', text: 'Break this problem into clear steps and explain the trade-offs:\n\n' },
  { title: 'Review some code', text: 'Review the following code for bugs and suggest a focused fix. Explain how to verify it:\n\n' },
  { title: 'Make sense of a document', text: 'Summarize the document I attach, identify the key decisions, and cite the relevant passages.\n\n' },
];

export default function Welcome({ modelCount, onModels, onWorkspace, onDraft }: {
  modelCount: number; onModels: () => void; onWorkspace: () => void; onDraft: (text: string) => void;
}) {
  return <section className="studio-welcome" aria-label="Start a conversation">
    <h1>What should we work on?</h1>
    <p>Bring a question or a project. Choose what Relay can access, then review the work as it happens.</p>
    <div className="studio-starting-points" role="group" aria-label="Starting points">
      {starters.map(starter => <button key={starter.title} onClick={() => onDraft(starter.text)}><span>{starter.title}</span><Plus size={16} aria-hidden="true" /></button>)}
    </div>
    <div className="studio-connections"><button onClick={onWorkspace}><GitBranch size={20} aria-hidden="true"/><span><strong>Bring a project</strong><small>Work in a managed copy</small></span></button><button onClick={onModels}><Layers size={20} aria-hidden="true"/><span><strong>{modelCount ? 'Models & providers' : 'Connect your first model'}</strong><small>{modelCount ? `${modelCount} discovered model${modelCount === 1 ? '' : 's'}` : 'Local runtimes or optional cloud'}</small></span></button></div>
  </section>;
}
