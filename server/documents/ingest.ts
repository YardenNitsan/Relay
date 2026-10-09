import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {AppError} from '../core/errors.js';

export const documentLimits=Object.freeze({inputBytes:8*1024*1024,outputBytes:240*1024,timeoutMs:15000});
export interface ParsedDocument {text:string;format:'pdf'|'docx';}
const messages:Record<string,string>={DOCUMENT_INVALID:'The document is malformed or exceeds safe parsing limits. Export a smaller PDF or DOCX and try again.',DOCUMENT_ENCRYPTED:'Password-protected documents are not supported. Upload an unlocked copy.',DOCUMENT_EMPTY:'No selectable document text was found. Scanned PDFs need OCR before upload.',DOCUMENT_OUTPUT_LIMIT:'Extracted text exceeds 240 KiB. Split the document into smaller sections.'};
let active=false;

/** Fixed child entry, no shell, no source paths or credentials passed to parsers. */
export async function parseDocument(filename:string,bytes:Buffer,signal?:AbortSignal):Promise<ParsedDocument> {
  const format=/\.pdf$/i.test(filename)?'pdf':/\.docx$/i.test(filename)?'docx':null;
  if(!format)throw new AppError('DOCUMENT_TYPE','Upload PDF or Word DOCX. Legacy .doc files must first be saved as .docx.');
  if(!bytes.length||bytes.length>documentLimits.inputBytes)throw new AppError('DOCUMENT_SIZE','Documents must be nonempty and no larger than 8 MiB.',413);
  if(signal?.aborted)throw new AppError('DOCUMENT_CANCELLED','Document upload was cancelled.',409);
  if(active)throw new AppError('DOCUMENT_BUSY','Another document is being processed. Try again shortly.',409);
  active=true;
  try{return await new Promise<ParsedDocument>((resolve,reject)=>{
    const parser=fileURLToPath(new URL('./parser.mjs',import.meta.url));
    const dependencies=dirname(dirname(fileURLToPath(import.meta.resolve('yauzl'))));
    // Do not inherit NODE_OPTIONS, provider keys, user homes or application secrets.
    const env:NodeJS.ProcessEnv={};for(const name of ['SystemRoot','WINDIR'])if(process.env[name])env[name]=process.env[name];
    const child=spawn(process.execPath,['--max-old-space-size=192','--no-addons','--permission',`--allow-fs-read=${dependencies}`,`--allow-fs-read=${parser}`,parser,format],{stdio:['pipe','pipe','ignore'],windowsHide:true,env});
    const chunks:Buffer[]=[];let size=0,failure:AppError|undefined,settled=false;
    const fail=(error:AppError)=>{failure??=error;child.kill('SIGKILL');};
    const cancel=()=>fail(new AppError('DOCUMENT_CANCELLED','Document upload was cancelled.',409));
    const timer=setTimeout(()=>fail(new AppError('DOCUMENT_TIMEOUT','Document parsing exceeded 15 seconds. Try a smaller document.',408)),documentLimits.timeoutMs);timer.unref();
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);};
    child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>documentLimits.outputBytes*6+1024)fail(new AppError('DOCUMENT_OUTPUT_LIMIT',messages.DOCUMENT_OUTPUT_LIMIT,413));else chunks.push(chunk);});
    child.stdin.on('error',()=>{ /* A killed or rejected child can close stdin early. */ });
    child.on('error',()=>{if(settled)return;settled=true;finish();reject(new AppError('DOCUMENT_PARSER','The document parser could not start.',503));});
    child.on('close',code=>{
      if(settled)return;settled=true;finish();if(failure){reject(failure);return;}
      try{
        const result:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(!result||typeof result!=='object')throw new Error('Invalid parser response');
        if('error' in result&&typeof result.error==='string'&&messages[result.error]){reject(new AppError(result.error,messages[result.error]));return;}
        if(code!==0||!('text' in result)||typeof result.text!=='string'||Buffer.byteLength(result.text)>documentLimits.outputBytes||!result.text.trim())throw new Error('Invalid parser response');
        resolve({text:result.text,format});
      }catch{reject(new AppError('DOCUMENT_INVALID',messages.DOCUMENT_INVALID));}
    });
    child.stdin.end(bytes);
  });}finally{active=false;}
}
