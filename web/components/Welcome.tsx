import { ArrowUpRight,Code2,FileText,GitBranch,Layers,Lightbulb,Plus } from 'lucide-react';
import '../features/conversation/welcome.css';

const starters = [
  { title: 'Break down a problem', description:'Find the next useful step.',icon:Lightbulb,text: 'Break this problem into clear steps and explain the trade-offs:\n\n' },
  { title: 'Review some code', description:'Look for a focused, verifiable fix.',icon:Code2,text: 'Review the following code for bugs and suggest a focused fix. Explain how to verify it:\n\n' },
  { title: 'Make sense of a document', description:'Pull out the decisions that matter.',icon:FileText,text: 'Summarize the document I attach, identify the key decisions, and cite the relevant passages.\n\n' },
];

export default function Welcome({ modelCount, onModels, onWorkspace, onDraft }: {
  modelCount: number; onModels: () => void; onWorkspace: () => void; onDraft: (text: string) => void;
}) {
  return <section className="studio-welcome dispatch-welcome" aria-label="Start a conversation">
    <div className="welcome-introduction"><span className="welcome-symbol" aria-hidden="true"><i/><i/><i/></span><div><h1>What should we work on?</h1><p>A question, a document, a piece of code. Start with an objective and keep the work in view.</p></div></div>
    <div className="welcome-section-heading"><h2>A starting point</h2><span>Add a prompt, then make it yours.</span></div>
    <div className="studio-starting-points" role="group" aria-label="Starting points">
      {starters.map(starter => <button key={starter.title} aria-label={starter.title} onClick={() => onDraft(starter.text)}><starter.icon className="starter-icon" size={22} aria-hidden="true"/><span><strong>{starter.title}</strong><small>{starter.description}</small></span><Plus size={17} aria-hidden="true" /></button>)}
    </div>
    <div className="studio-connections"><button onClick={onWorkspace}><GitBranch size={20} aria-hidden="true"/><span><strong>Bring a project</strong><small>Work in a managed copy</small></span><ArrowUpRight size={16} aria-hidden="true"/></button><button onClick={onModels}><Layers size={20} aria-hidden="true"/><span><strong>{modelCount ? 'Models & providers' : 'Connect your first model'}</strong><small>{modelCount ? `${modelCount} discovered model${modelCount === 1 ? '' : 's'}` : 'Local runtimes or optional cloud'}</small></span><ArrowUpRight size={16} aria-hidden="true"/></button></div>
  </section>;
}
