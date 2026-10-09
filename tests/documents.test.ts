import {describe,it,expect,vi} from 'vitest';
import {parseDocument,documentLimits} from '../server/documents/ingest.js';
import {pdfFixture,docxFixture,zipFixture} from './helpers/documents.js';

describe('isolated document text extraction',()=>{
  it.each(['pdf','docx'] as const)('extracts real %s text without retaining or changing original bytes',async format=>{
    const bytes=format==='pdf'?pdfFixture():docxFixture(),original=Buffer.from(bytes);
    const result=await parseDocument(`file.${format}`,bytes);
    expect(result).toMatchObject({format});expect(result.text).toContain('Hello Relay document');expect(bytes.equals(original)).toBe(true);
  });
  it('keeps source markup as plain text',async()=>{expect((await parseDocument('x.docx',docxFixture('<script>alert(1)</script>'))).text).toContain('<script>alert(1)</script>');});
  it('rejects legacy, malformed, empty and oversized files',async()=>{
    await expect(parseDocument('old.doc',Buffer.from('abc'))).rejects.toMatchObject({code:'DOCUMENT_TYPE'});
    await expect(parseDocument('bad.pdf',Buffer.from('bad'))).rejects.toMatchObject({code:'DOCUMENT_INVALID'});
    await expect(parseDocument('empty.docx',Buffer.alloc(0))).rejects.toMatchObject({code:'DOCUMENT_SIZE'});
    await expect(parseDocument('large.pdf',Buffer.alloc(documentLimits.inputBytes+1))).rejects.toMatchObject({code:'DOCUMENT_SIZE'});
  });
  it('rejects ZIP size lies and excessive decompression before Word parsing',async()=>{
    await expect(parseDocument('lie.docx',zipFixture({'word/document.xml':'x'.repeat(100000)},1))).rejects.toMatchObject({code:'DOCUMENT_INVALID'});
    await expect(parseDocument('bomb.docx',zipFixture({'word/document.xml':'x'.repeat(9*1024*1024)}))).rejects.toMatchObject({code:'DOCUMENT_INVALID'});
  });
  it('rejects XML entity declarations and path traversal members',async()=>{
    await expect(parseDocument('entity.docx',zipFixture({'word/document.xml':'<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><x>&y;</x>'}))).rejects.toMatchObject({code:'DOCUMENT_INVALID'});
    await expect(parseDocument('escape.docx',zipFixture({'../word/document.xml':'x'}))).rejects.toMatchObject({code:'DOCUMENT_INVALID'});
  });
  it('rejects textless documents and output beyond the bounded editable copy',async()=>{
    await expect(parseDocument('empty.pdf',pdfFixture(''))).rejects.toMatchObject({code:'DOCUMENT_EMPTY'});
    await expect(parseDocument('long.docx',docxFixture('x'.repeat(documentLimits.outputBytes+1)))).rejects.toMatchObject({code:'DOCUMENT_OUTPUT_LIMIT'});
  });
  it('kills cancelled extraction and releases the global parser slot',async()=>{
    const controller=new AbortController(),pending=parseDocument('x.pdf',pdfFixture(),controller.signal);controller.abort();
    await expect(pending).rejects.toMatchObject({code:'DOCUMENT_CANCELLED'});
    expect((await parseDocument('next.pdf',pdfFixture())).text).toContain('Hello');
  });
  it('bounds concurrent parsing and enforces a real child deadline',async()=>{
    vi.useFakeTimers();
    try{
      const pending=parseDocument('x.pdf',pdfFixture());
      const rejected=expect(pending).rejects.toMatchObject({code:'DOCUMENT_TIMEOUT'});
      await expect(parseDocument('another.pdf',pdfFixture())).rejects.toMatchObject({code:'DOCUMENT_BUSY'});
      await vi.advanceTimersByTimeAsync(documentLimits.timeoutMs+1);await rejected;
    }finally{vi.useRealTimers();}
  });
});
