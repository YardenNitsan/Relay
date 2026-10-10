import { createHash } from 'node:crypto';
import { z } from 'zod';
import { boundedText } from './files';
import { FILE_COUNT_LIMIT,FILE_LIMIT,OUTPUT_LIMIT,WORKSPACE_LIMIT,safePath,sandboxFileFilter } from './platform';
import { developmentProfileSchema, toolchainSchema, type DevelopmentProfileId } from './development-profiles';

const EXCHANGE_LIMIT=80*1024*1024;
const LINE_LIMIT=2*1024*1024;
const resultSchema=z.object({type:z.literal('result'),stdout:z.string().max(OUTPUT_LIMIT),stderr:z.string().max(OUTPUT_LIMIT),exitCode:z.number().int().min(-1).max(255),truncated:z.boolean(),durationMs:z.number().min(0).max(180_000),toolchain:toolchainSchema.optional()}).strict();
export type SandboxCommand=Omit<z.infer<typeof resultSchema>,'type'>;
const fileSchema=z.object({type:z.literal('file'),path:z.string().max(2048),data:z.string().max(Math.ceil(FILE_LIMIT/3)*4),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const completeSchema=z.object({type:z.literal('complete'),files:z.number().int().min(0).max(FILE_COUNT_LIMIT),bytes:z.number().int().min(0).max(WORKSPACE_LIMIT)}).strict();
const line=(value:unknown)=>Buffer.from(JSON.stringify(value)+'\n');
export function* sandboxInput(files:Map<string,string>,argv:string[],timeoutMs:number,profile:DevelopmentProfileId='default'):Generator<Buffer> {
  if(files.size>FILE_COUNT_LIMIT || !argv.length || argv.length>64 || argv.some(value=>value.length>4096 || value.includes('\0')) || !Number.isInteger(timeoutMs) || timeoutMs<1000 || timeoutMs>120_000)throw new Error('Invalid bounded sandbox input');
  developmentProfileSchema.parse(profile);
  yield line({type:'run',version:1,argv,timeoutMs,filter:sandboxFileFilter,profile});let bytes=0;
  for(const [path,content] of files){safePath(path);boundedText(content);const data=Buffer.from(content);bytes+=data.length;if(bytes>WORKSPACE_LIMIT)throw new Error('Sandbox input exceeds workspace limit');yield line({type:'file',path,data:data.toString('base64')});}
  yield line({type:'complete',files:files.size,bytes});
}
/** Parse the fixed supervisor protocol; never extract an untrusted archive into host paths. */
export class SandboxOutput {
  constructor(private readonly expectedProfile?:DevelopmentProfileId){}
  private readonly decoder=new TextDecoder('utf-8',{fatal:true});
  private pending='';private transferred=0;private bytes=0;private complete=false;
  private result:SandboxCommand|undefined;private readonly files=new Map<string,string>();
  push(chunk:Buffer):void {
    this.transferred+=chunk.length;if(this.transferred>EXCHANGE_LIMIT)throw new Error('Sandbox export exceeds transfer limit');
    this.pending+=this.decoder.decode(chunk,{stream:true});
    while(true){const end=this.pending.indexOf('\n');if(end<0)break;if(end>LINE_LIMIT)throw new Error('Sandbox export record limit exceeded');const record=this.pending.slice(0,end);this.pending=this.pending.slice(end+1);this.record(JSON.parse(record));}
    if(this.pending.length>LINE_LIMIT)throw new Error('Sandbox export record limit exceeded');
  }
  private record(raw:unknown):void {
    if(this.complete)throw new Error('Sandbox export continued after completion');
    const type=(raw as {type?:unknown})?.type;
    if(type==='error')throw new Error('Isolated supervisor rejected the command or generated snapshot');
    if(type==='result'){if(this.result)throw new Error('Duplicate sandbox result');const {type:_,...result}=resultSchema.parse(raw);if(this.expectedProfile&&!result.toolchain)throw new Error('Missing toolchain preflight receipt');if(this.expectedProfile&&result.toolchain?.profile!==this.expectedProfile)throw new Error('Toolchain profile does not match the requested environment');this.result=result;return;}
    if(!this.result)throw new Error('Sandbox export has no command result');
    if(type==='file') {
      const item=fileSchema.parse(raw);const path=safePath(item.path);if(this.files.has(path))throw new Error('Duplicate sandbox file');
      const bytes=Buffer.from(item.data,'base64');if(bytes.toString('base64')!==item.data || bytes.length>FILE_LIMIT || createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error('Sandbox file content integrity failed');
      const content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);boundedText(content);this.bytes+=bytes.length;
      if(this.bytes>WORKSPACE_LIMIT || this.files.size>=FILE_COUNT_LIMIT)throw new Error('Sandbox output exceeds workspace limit');this.files.set(path,content);return;
    }
    const complete=completeSchema.parse(raw);if(complete.files!==this.files.size || complete.bytes!==this.bytes)throw new Error('Sandbox export totals mismatch');this.complete=true;
  }
  finish():SandboxCommand&{files:Map<string,string>} {
    this.pending+=this.decoder.decode();if(!this.complete || !this.result || this.pending)throw new Error('Sandbox export did not complete');return {...this.result,files:this.files};
  }
}
