import {EditorState,type Extension} from '@codemirror/state';

export function lineEnding(content:string):'LF'|'CRLF'|'CR'|'mixed'|'none'{
  const endings=new Set(content.match(/\r\n|\r|\n/g)??[]);
  return endings.size>1?'mixed':endings.has('\r\n')?'CRLF':endings.has('\r')?'CR':endings.has('\n')?'LF':'none';
}
export function codeLanguage(path:string){
  const extension=path.split('.').at(-1)?.toLowerCase();
  if(extension&&['ts','tsx','mts','cts'].includes(extension))return 'TypeScript';
  if(extension&&['js','jsx','mjs','cjs'].includes(extension))return 'JavaScript';
  if(extension==='py')return 'Python';
  if(extension==='cs')return 'C#';
  if(extension==='json')return 'JSON';
  return null;
}
export function sourceState(content:string,readOnly:boolean,extensions:Extension=[]){
  const ending=lineEnding(content);
  if(ending==='mixed')throw new Error('Mixed line endings require an explicit normalization choice.');
  return EditorState.create({doc:content,extensions:[extensions,
    EditorState.lineSeparator.of(ending==='CRLF'?'\r\n':ending==='CR'?'\r':'\n'),
    EditorState.readOnly.of(readOnly),EditorState.tabSize.of(2),
    // readOnly is advisory for commands; this also refuses document transactions.
    EditorState.changeFilter.of(transaction=>!transaction.startState.readOnly),
  ]});
}
