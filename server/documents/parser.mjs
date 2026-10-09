// Separate, fixed-purpose process. This is a resource boundary, not an OS sandbox.
import {fromBufferPromise} from 'yauzl';
import sax from 'sax';
const MAX_INPUT=8*1024*1024,MAX_OUTPUT=240*1024,MAX_EXPANDED=24*1024*1024;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const chunks=[];let size=0;
// PDF.js diagnostics must never become document text or expose parser internals.
console.log=console.warn=console.error=()=>{};
function collector(){let bytes=0;const parts=[];return {add(text){bytes+=Buffer.byteLength(text);if(bytes>MAX_OUTPUT)fail('DOCUMENT_OUTPUT_LIMIT');parts.push(text);},value(){return parts.join('');}};}

async function docx(data){
  const zip=await fromBufferPromise(data,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true});
  const names=new Set(),texts=new Map();let expanded=0,count=0;
  for await(const entry of zip.eachEntry()){
    if(++count>256||names.has(entry.fileName)||entry.uncompressedSize>MAX_INPUT||entry.isEncrypted()||!Number.isSafeInteger(entry.uncompressedSize))fail('DOCUMENT_INVALID');
    names.add(entry.fileName);expanded+=entry.uncompressedSize;if(expanded>MAX_EXPANDED)fail('DOCUMENT_INVALID');
    const selected=/^word\/(?:document|footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(entry.fileName);
    const stream=await zip.openReadStreamPromise(entry);let actual=0;const pieces=[];
    for await(const part of stream){actual+=part.length;if(actual>MAX_INPUT)fail('DOCUMENT_INVALID');if(selected)pieces.push(part);}
    if(actual!==entry.uncompressedSize)fail('DOCUMENT_INVALID');
    if(selected)texts.set(entry.fileName,Buffer.concat(pieces));
  }
  if(!texts.has('word/document.xml')||!names.has('[Content_Types].xml'))fail('DOCUMENT_INVALID');
  const output=collector();
  const paths=[...texts.keys()].sort((a,b)=>a==='word/document.xml'?-1:b==='word/document.xml'?1:a.localeCompare(b));
  for(const path of paths){
    const text=new TextDecoder('utf-8',{fatal:true}).decode(texts.get(path));
    const parser=sax.parser(true,{xmlns:true,strictEntities:true});let depth=0,textDepth=0;
    const word=new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main','http://purl.oclc.org/ooxml/wordprocessingml/main']);
    parser.ondoctype=()=>fail('DOCUMENT_INVALID');parser.onerror=()=>fail('DOCUMENT_INVALID');
    parser.onopentag=node=>{if(++depth>128)fail('DOCUMENT_INVALID');if(!word.has(node.uri))return;if(node.local==='t')textDepth=depth;if(node.local==='tab')output.add('\t');if(node.local==='br'||node.local==='cr')output.add('\n');};
    parser.ontext=value=>{if(textDepth)output.add(value);};parser.oncdata=parser.ontext;
    parser.onclosetag=()=>{const node=parser.tag;if(word.has(node.uri)&&node.local==='p')output.add('\n\n');if(depth===textDepth)textDepth=0;depth--;};
    // Chunk input to avoid the parser building giant event buffers.
    for(let i=0;i<text.length;i+=16384)parser.write(text.slice(i,i+16384));parser.close();output.add('\n');
  }
  return output.value();
}
async function pdf(data){
  if(!data.subarray(0,1024).includes(Buffer.from('%PDF-')))fail('DOCUMENT_INVALID');
  // Text extraction needs no native canvas. PDF.js checks for DOMMatrix at import
  // time; this sentinel rejects any unexpected rendering instead of emulating it.
  globalThis.DOMMatrix=class {constructor(){throw new Error('Rendering is disabled');}};
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading=getDocument({data:new Uint8Array(data),isEvalSupported:false,disableFontFace:true,useSystemFonts:false,useWorkerFetch:false,isOffscreenCanvasSupported:false,isImageDecoderSupported:false,maxImageSize:1,stopAtErrors:true,verbosity:0});
  try{
    const document=await loading.promise;if(document.numPages>200)fail('DOCUMENT_INVALID');const output=collector();
    for(let i=1;i<=document.numPages;i++){
      const page=await document.getPage(i),reader=page.streamTextContent().getReader();
      try{while(true){const {done,value}=await reader.read();if(done)break;for(const item of value.items)if(typeof item.str==='string')output.add(item.str+(item.hasEOL?'\n':' '));}}
      finally{await reader.cancel().catch(()=>{});reader.releaseLock();page.cleanup();}
      output.add('\n\n');
    }
    return output.value();
  }catch(error){if(error?.name==='PasswordException')fail('DOCUMENT_ENCRYPTED');throw error;}
  finally{await loading.destroy();}
}
try{
  for await(const chunk of process.stdin){size+=chunk.length;if(size>MAX_INPUT)fail('DOCUMENT_INVALID');chunks.push(chunk);}
  const data=Buffer.concat(chunks),format=process.argv[2];
  const text=format==='pdf'?await pdf(data):format==='docx'?await docx(data):fail('DOCUMENT_INVALID');
  if(!text.trim())fail('DOCUMENT_EMPTY');process.stdout.write(JSON.stringify({text}));
}catch(error){const allowed=new Set(['DOCUMENT_INVALID','DOCUMENT_ENCRYPTED','DOCUMENT_EMPTY','DOCUMENT_OUTPUT_LIMIT']);process.stdout.write(JSON.stringify({error:allowed.has(error?.code)?error.code:'DOCUMENT_INVALID'}));}
