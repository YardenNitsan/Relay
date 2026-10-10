import { ArrowUpRight, GitBranch, Layers, ShieldCheck } from 'lucide-react';

const starters = [
  { title: 'Break down a problem', text: 'Break this problem into clear steps and explain the trade-offs:\n\n' },
  { title: 'Review some code', text: 'Review the following code for bugs and suggest a focused fix. Explain how to verify it:\n\n' },
  { title: 'Make sense of a document', text: 'Summarize the document I attach, identify the key decisions, and cite the relevant passages.\n\n' },
];

export default function Welcome({ modelCount, onModels, onWorkspace, onDraft }: {
  modelCount: number; onModels: () => void; onWorkspace: () => void; onDraft: (text: string) => void;
}) {
  return <section className="welcome">
    <div className="welcome-eyebrow"><div className="relay-emblem" aria-hidden="true"><span /><span /><span /></div><span>Your personal AI workspace</span></div>
    <h1>What should we<br /><span>work on?</span></h1>
    <p className="welcome-description">Bring an idea. Work through the details.<br className="desktop-break" /> Keep the decisions in your hands.</p>
    <div className="starter-list" role="group" aria-label="Starting points">
      {starters.map((starter, index) => <button key={starter.title} onClick={() => onDraft(starter.text)}><span className="starter-number" aria-hidden="true">0{index + 1}</span><span>{starter.title}</span><ArrowUpRight size={16} aria-hidden="true" /></button>)}
    </div>
    <div className="welcome-actions"><button onClick={onWorkspace}><span className="welcome-action-icon"><GitBranch size={20} /></span><span><strong>Bring a project</strong><small>Work in a managed copy</small></span><ArrowUpRight size={16} /></button><button onClick={onModels}><span className="welcome-action-icon"><Layers size={20} /></span><span><strong>{modelCount ? 'Models & providers' : 'Connect your first model'}</strong><small>{modelCount ? `${modelCount} discovered model${modelCount === 1 ? '' : 's'}` : 'Local runtimes or optional cloud'}</small></span><ArrowUpRight size={16} /></button></div>
    <div className="welcome-assurance"><ShieldCheck size={15} /><span>Local by default. Access stays in your control.</span></div>
  </section>;
}
