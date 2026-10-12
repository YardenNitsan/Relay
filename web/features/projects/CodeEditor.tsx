import {useEffect,useRef,useState} from 'react';
import {Annotation,Compartment,EditorState,Text,Transaction} from '@codemirror/state';
import {EditorView,drawSelection,highlightActiveLine,keymap,lineNumbers} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap,redo,redoDepth,undo,undoDepth} from '@codemirror/commands';
import {findNext,findPrevious,getSearchQuery,search,SearchQuery,setSearchQuery} from '@codemirror/search';
import {bracketMatching,HighlightStyle,StreamLanguage,syntaxHighlighting} from '@codemirror/language';
import {javascript} from '@codemirror/lang-javascript';
import {python} from '@codemirror/lang-python';
import {json} from '@codemirror/lang-json';
import {csharp} from '@codemirror/legacy-modes/mode/clike';
import {tags} from '@lezer/highlight';
import {Search,Undo2,Redo2,WrapText,X,ArrowDown,ArrowUp} from 'lucide-react';
import {codeLanguage,lineEnding,sourceState} from './editor-document';
import type {SourceContentsProps} from './SourceContents';
import './code-editor.css';

const colors=syntaxHighlighting(HighlightStyle.define([
  {tag:[tags.keyword,tags.modifier,tags.operatorKeyword],color:'var(--accent)'},
  {tag:[tags.string,tags.regexp],color:'var(--success)'},
  {tag:[tags.number,tags.bool,tags.null],color:'var(--warning)'},
  {tag:tags.comment,color:'var(--muted)',fontStyle:'italic'},
  {tag:[tags.typeName,tags.className],color:'var(--accent)'},
]));
const externalContent=Annotation.define<boolean>();
const separatorFor=(content:string)=>lineEnding(content)==='CRLF'?'\r\n':lineEnding(content)==='CR'?'\r':'\n';
export default function CodeEditor({path,label,content,readOnly,busy,onChange}:SourceContentsProps){
  const mount=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),latest=useRef({content,onChange,readOnly,busy});
  latest.current={content,onChange,readOnly,busy};
  const access=useRef(new Compartment()),wrapping=useRef(new Compartment()),separator=useRef(new Compartment());
  const [wrap,setWrap]=useState(false),[finding,setFinding]=useState(false),[query,setQuery]=useState(''),[match,setMatch]=useState<string|null>(null);
  const [position,setPosition]=useState({line:1,column:1,lines:1,undo:false,redo:false,ending:separatorFor(content)});
  const findInput=useRef<HTMLInputElement>(null);
  const language=codeLanguage(path),jsx=/\.[jt]sx$/i.test(path);
  const navigate=(editor:EditorView,previous=false)=>{
    if(!getSearchQuery(editor.state).valid){setFinding(true);findInput.current?.focus();return true;}
    const found=(previous?findPrevious:findNext)(editor);setMatch(found?'Match selected':'No matches');editor.focus();return true;
  };
  useEffect(()=>{
    const writable=()=>[EditorView.editable.of(!latest.current.readOnly&&!latest.current.busy),
      // readOnly and editable serve different purposes: commands and DOM input.
      accessReadOnly(!latest.current.readOnly&&!latest.current.busy)];
    const initial=latest.current;
    const editor=new EditorView({parent:mount.current!,state:sourceState(initial.content,false,[
      access.current.of(writable()),wrapping.current.of([]),separator.current.of(EditorState.lineSeparator.of(separatorFor(initial.content))),
      EditorView.clipboardInputFilter.of((text,state)=>text.replace(/\r\n|\r|\n/g,state.lineBreak)),
      EditorView.contentAttributes.of(editor=>({'aria-label':label,'aria-multiline':'true','aria-readonly':String(editor.state.readOnly),role:'textbox',spellcheck:'false',autocapitalize:'off',autocorrect:'off',tabindex:'0'})),
      lineNumbers(),history(),drawSelection(),highlightActiveLine(),bracketMatching(),colors,search({literal:true}),
      language==='Python'?python():language==='JSON'?json():language==='C#'?StreamLanguage.define(csharp):javascript({typescript:language==='TypeScript',jsx}),
      keymap.of([{key:'Mod-f',run:()=>{setFinding(true);findInput.current?.focus();return true;}},
        {key:'F3',run:editor=>navigate(editor)},{key:'Shift-F3',run:editor=>navigate(editor,true)},...defaultKeymap,...historyKeymap]),
      EditorView.updateListener.of(update=>{
        if(update.docChanged&&!update.transactions.some(transaction=>transaction.annotation(externalContent)))latest.current.onChange(update.state.sliceDoc());
        if(update.docChanged||update.selectionSet||update.startState===update.state){
          const head=update.state.selection.main.head,line=update.state.doc.lineAt(head);
          setPosition({line:line.number,column:head-line.from+1,lines:update.state.doc.lines,undo:undoDepth(update.state)>0,redo:redoDepth(update.state)>0,ending:update.state.lineBreak});
        }
      }),
    ])});
    view.current=editor;
    setPosition({line:1,column:1,lines:editor.state.doc.lines,undo:false,redo:false,ending:editor.state.lineBreak});
    return()=>{view.current=null;editor.destroy();};
  },[language,jsx,label]);
  useEffect(()=>{
    const editor=view.current;if(!editor)return;
    editor.dispatch({effects:access.current.reconfigure([EditorView.editable.of(!readOnly&&!busy),accessReadOnly(!readOnly&&!busy)])});
  },[readOnly,busy,language,jsx,label]);
  useEffect(()=>{view.current?.dispatch({effects:wrapping.current.reconfigure(wrap?EditorView.lineWrapping:[])});},[wrap,language,jsx,label]);
  useEffect(()=>{
    const editor=view.current;if(!editor||editor.state.sliceDoc()===content)return;
    // Only an authoritative parent update bypasses read-only. Ordinary edits,
    // history and commands remain filtered. Saving equal content keeps history.
    editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:Text.of(content.split(/\r\n|\r|\n/))},
      effects:separator.current.reconfigure(EditorState.lineSeparator.of(separatorFor(content))),filter:false,
      annotations:[Transaction.addToHistory.of(false),externalContent.of(true)]});
  },[content,language,jsx,label]);
  useEffect(()=>{if(finding)findInput.current?.focus();},[finding]);
  useEffect(()=>{view.current?.dispatch({effects:setSearchQuery.of(new SearchQuery({search:query,literal:true}))});setMatch(null);},[query,language,jsx,label]);
  const find=(previous=false)=>{if(view.current)navigate(view.current,previous);};
  const closeFind=()=>{setFinding(false);view.current?.focus();};
  const ending=position.ending==='\r\n'?'CRLF':position.ending==='\r'?'CR':'LF';
  return <section className="source-editor" aria-label="Source editor">
    <div className="source-toolbar" aria-label="Source editing controls">
      <span className="source-language">{language} · {ending}</span>
      <div className="source-tools">
        <button className="button" aria-label="Find in file" title="Find in file (Ctrl/⌘ F)" aria-expanded={finding} onClick={()=>{setFinding(value=>!value);}}><Search size={16}/></button>
        <button className="button" aria-label="Undo edit" title="Undo edit" disabled={readOnly||busy||!position.undo} onClick={()=>{if(view.current){undo(view.current);view.current.focus();}}}><Undo2 size={16}/></button>
        <button className="button" aria-label="Redo edit" title="Redo edit" disabled={readOnly||busy||!position.redo} onClick={()=>{if(view.current){redo(view.current);view.current.focus();}}}><Redo2 size={16}/></button>
        <button className="button" aria-label="Wrap lines" title="Wrap lines" aria-pressed={wrap} onClick={()=>setWrap(value=>!value)}><WrapText size={16}/></button>
      </div>
    </div>
    {finding&&<div className="source-search"><label>Find in file<input ref={findInput} type="search" value={query} spellCheck={false} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();find(event.shiftKey);}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeFind();}}}/></label>
      <div className="source-tools"><button className="button" aria-label="Previous match" disabled={!query} onClick={()=>find(true)}><ArrowUp size={16}/></button><button className="button" aria-label="Next match" disabled={!query} onClick={()=>find()}><ArrowDown size={16}/></button><button className="button" aria-label="Close file search" onClick={closeFind}><X size={16}/></button></div>
      {match&&<span role="status">{match}</span>}
    </div>}
    <div ref={mount} className="source-code"/>
    <div className="source-status"><span>Ln {position.line}, Col {position.column} · {position.lines} lines</span><span>{busy?'Saving…':readOnly?'Read only':'Tab moves to the next control'}</span></div>
  </section>;
}

// Kept here to make the advisory state facet explicit at both initial and live
// configuration sites, while sourceState supplies the actual change filter.
function accessReadOnly(writable:boolean){return EditorState.readOnly.of(!writable);}
