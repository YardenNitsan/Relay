import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ArrowLeft,Check,ChevronRight,FolderOpen,Link2,Plus,Server} from 'lucide-react';
import type {Workspace} from '../../../shared/types';
import {api} from '../../api';
import {Empty,ErrorNotice,Loading,shortDate} from '../../components/ui';
import {useGuardedModalAction} from '../../components/modal-guard';
import {useRememberedFocus} from '../../layout/useRememberedFocus';
import DeviceFolder from '../../components/DeviceFolder';
import Publication from '../../components/Publication';
import ProjectFiles from './ProjectFiles';
import CreateProject from './CreateProject';
import './projects.css';

interface Props {selected:string|null;onSelect:(id:string|null)=>void;owner?:boolean;userId?:string;canWriteShared?:boolean}
type View='index'|'files'|'publication'|'create'|'device';

export default function ProjectWorkspace({selected,onSelect,owner=true,userId,canWriteShared=false}:Props){
  const client=useQueryClient(),request=useGuardedModalAction();
  const root=useRef<HTMLDivElement>(null),lastFocused=useRememberedFocus(),moveFocus=useRef(false);
  useEffect(()=>{
    const queries=[window.matchMedia('(max-width: 760px)'),window.matchMedia('(max-width: 1050px)')];
    const resized=()=>{
      const active=document.activeElement===document.body?lastFocused.current:document.activeElement;
      if(!(active instanceof HTMLElement)||!root.current?.contains(active)||active.getClientRects().length)return;
      const selector=active.closest('.project-index')?'.project-mobile-heading button':active.closest('.project-mobile-heading')?'.project-index input':active.closest('.project-file-index')?'.workspace-editor h4':'.project-index input';
      const next=root.current.querySelector<HTMLElement>(selector);if(next?.getClientRects().length)next.focus();
    };
    for(const query of queries)query.addEventListener('change',resized);
    return()=>{for(const query of queries)query.removeEventListener('change',resized);};
  },[lastFocused]);
  const query=useQuery({queryKey:['workspaces'],queryFn:({signal})=>api<Workspace[]>('/workspaces',{signal})});
  const [inspect,setInspect]=useState<string|null>(selected),[view,setView]=useState<View>(selected?'files':'index');
  const [filter,setFilter]=useState('');
  useEffect(()=>{
    if(!moveFocus.current)return;
    moveFocus.current=false;
    // Run after the discard dialog has closed and restored its previous focus.
    const selector=view==='index'?'.project-index input':'.project-detail';
    root.current?.querySelector<HTMLElement>(selector)?.focus();
  },[view,inspect]);
  const workspace=query.data?.find(project=>project.id===inspect);
  const projects=query.data?.filter(project=>project.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))??[];
  const active=query.data?.find(project=>project.id===selected);
  const navigate=(next:View)=>{if(next!==view)request(()=>{moveFocus.current=true;setView(next);});};
  const open=(id:string)=>{if(id!==inspect||view!=='files')request(()=>{moveFocus.current=true;setInspect(id);setView('files');});};
  const remember=(project:Workspace)=>{
    client.setQueryData<Workspace[]>(['workspaces'],current=>[...(current??[]).filter(item=>item.id!==project.id),project]);
    onSelect(project.id);setInspect(project.id);
    void client.invalidateQueries({queryKey:['workspaces']});void client.invalidateQueries({queryKey:['assistants']});
  };
  const created=async(project:Workspace)=>{remember(project);moveFocus.current=true;setView('files');};
  return <div ref={root} className={`project-studio ${view==='index'?'project-show-index':'project-show-detail'}`}>
    <aside className="project-index" aria-label="Project index">
      <div className="project-index-heading"><span className="project-eyebrow">Your projects</span><button className="icon-button" aria-label="New workspace" onClick={()=>navigate('create')}><Plus size={18}/></button></div>
      <label className="project-search">Find a project<input type="search" value={filter} onChange={event=>setFilter(event.target.value)} placeholder="Search by name"/></label>
      <div className="project-index-list">
        {query.isPending&&<Loading>Loading workspaces...</Loading>}
        {query.isError&&<ErrorNotice error={query.error} retry={()=>{void query.refetch();}}/>}
        {projects.map(project=><button key={project.id} className={`project-index-item ${inspect===project.id?'is-inspected':''}`} aria-label={`Open ${project.name}`} aria-current={inspect===project.id?'page':undefined} onClick={()=>open(project.id)}><FolderOpen size={18}/><span><strong>{project.name}</strong><small>{project.ownerUserId===userId?'Personal':'Shared'} / {project.fileCount} files</small></span>{selected===project.id&&<Check size={15} aria-label="Selected for conversation"/>}</button>)}
        {!query.isPending&&!query.isError&&!projects.length&&<div className="project-index-empty"><p className="muted">{filter?'No projects match this name.':'Your first project starts here.'}</p>{!filter&&<button className="button primary" onClick={()=>navigate('create')}>Create your first workspace</button>}</div>}
      </div>
      <div className="project-conversation"><span className="project-eyebrow">Conversation context</span><strong>{active?.name??'No workspace'}</strong><button className="text-button" disabled={selected==null} onClick={()=>onSelect(null)}>Use no workspace</button></div>
      <button className="project-device-link" onClick={()=>navigate('device')}><Link2 size={17}/><span>Connect a device folder</span><ChevronRight size={16}/></button>
      <div className="project-host-label"><Server size={15}/><span>Files are stored on Relay Host</span></div>
    </aside>
    <section className="project-detail" aria-label="Project inspector" tabIndex={-1}>
      <div className="project-mobile-heading"><button className="text-button" onClick={()=>navigate('index')}><ArrowLeft size={16}/>All projects</button><button className="icon-button" aria-label="New workspace" onClick={()=>navigate('create')}><Plus size={18}/></button></div>
      {view==='index'&&<div className="project-start"><p className="project-eyebrow">Work with real files</p><h3>Give your objective a place to work.</h3><p>Select a project to explore its files, review changes and choose the context for your next conversation.</p><button className="button primary" onClick={()=>navigate('create')}><Plus size={17}/>Create a workspace</button><p className="hint">Personal files stay separate from shared workspaces. Agent permissions are chosen in the conversation.</p></div>}
      {view==='create'&&<div className="project-scroll"><CreateProject owner={owner} onCreated={created}/></div>}
      <div className="project-scroll" hidden={view!=='device'}><DeviceFolder key={userId??'anonymous'} userId={userId} onImported={remember}/></div>
      {(view==='files'||view==='publication')&&(workspace?<>
        <header className="project-title"><div><p className="project-eyebrow">{workspace.ownerUserId===userId?'Personal workspace':'Shared workspace'} / Relay Host</p><h3>{workspace.name}</h3><p className="muted">{workspace.fileCount} files / created {shortDate(workspace.createdAt)}</p></div><button className={`button ${selected===workspace.id?'':'primary'}`} disabled={selected===workspace.id} onClick={()=>onSelect(workspace.id)}>{selected===workspace.id?<><Check size={16}/>In this conversation</>:'Use for conversation'}</button></header>
        <nav className="project-sections" aria-label="Project views"><button aria-current={view==='files'?'page':undefined} onClick={()=>navigate('files')}>Files</button>{owner&&workspace.sourcePath&&<button aria-current={view==='publication'?'page':undefined} onClick={()=>navigate('publication')}>Original source & review</button>}</nav>
        <div className="project-scroll" key={`${workspace.id}-${view}`}>
          {view==='files'?<ProjectFiles id={workspace.id} writable={workspace.ownerUserId===userId||owner||canWriteShared}/>:<><div className="project-source"><p className="project-eyebrow">Original on Relay Host</p><code>{workspace.sourcePath}</code><p className="hint">This workspace is a managed copy. Review exact changes before publishing to the original.</p></div><Publication workspaceId={workspace.id}/></>}
        </div>
      </>:query.isPending?<Loading>Opening project...</Loading>:<Empty title="Choose a project" icon={<FolderOpen size={24}/>}><p>Select a workspace from your project index.</p></Empty>)}
    </section>
  </div>;
}
