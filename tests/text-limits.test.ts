import {expect,it} from 'vitest';
import {utf8Excerpt} from '../server/core/text.js';
it('preserves complete Unicode characters while enforcing a byte ceiling',()=>{
  const original='aé中文🎸';for(let bytes=0;bytes<=Buffer.byteLength(original)+2;bytes++){const excerpt=utf8Excerpt(original,bytes);expect(Buffer.byteLength(excerpt.text)).toBeLessThanOrEqual(bytes);expect(original.startsWith(excerpt.text)).toBe(true);expect(excerpt.text).not.toContain('\ufffd');expect(excerpt.truncated).toBe(Buffer.byteLength(original)>bytes);}
});
