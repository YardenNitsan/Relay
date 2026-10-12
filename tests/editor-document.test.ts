import {describe,expect,it} from 'vitest';
import {EditorState} from '@codemirror/state';
import {codeLanguage,lineEnding,sourceState} from '../web/features/projects/editor-document';

describe('source document fidelity',()=>{
  for(const source of ['', 'const x = 1;', 'a\nb\n', 'a\r\nb\r\n', 'a\rb\r'])it(`preserves exact source ${JSON.stringify(source)}`,()=>{
    const state=sourceState(source,false);
    expect(state.sliceDoc()).toBe(source);
    const edited=state.update({changes:{from:0,to:0,insert:'// edited'+state.lineBreak}}).state;
    expect(edited.sliceDoc()).toBe('// edited'+state.lineBreak+source);
  });
  it('blocks changes in read-only state even from dispatched commands',()=>{
    const state=sourceState('original\r\n',true);
    expect(state.facet(EditorState.readOnly)).toBe(true);
    expect(state.update({changes:{from:0,to:state.doc.length,insert:'replaced'}}).state.sliceDoc()).toBe('original\r\n');
  });
  it('requires an explicit choice for mixed separators',()=>{
    expect(lineEnding('a\r\nb\n')).toBe('mixed');
    expect(()=>sourceState('a\r\nb\n',false)).toThrow(/line endings/i);
    expect(lineEnding('one line')).toBe('none');
  });
  it('recognizes supported source types without interpreting arbitrary paths',()=>{
    expect(codeLanguage('src/app.TSX')).toBe('TypeScript');
    expect(codeLanguage('tool.py')).toBe('Python');
    expect(codeLanguage('Program.cs')).toBe('C#');
    expect(codeLanguage('package.json')).toBe('JSON');
    expect(codeLanguage('notes.txt')).toBe(null);
  });
});
