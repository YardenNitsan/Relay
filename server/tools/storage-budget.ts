import {lstat,readdir,statfs} from 'node:fs/promises';
import {join} from 'node:path';

interface Disk {total:number;available:number;}
interface Options {limitBytes?:number;reserveBytes?:number;disk?:()=>Promise<Disk>;}
const GiB=1024**3;
const folders=['workspaces','baselines','checkpoints','runs','containers','git-runs','publications'];

/** Called inside the broker's serialized mutation boundary. It never follows links
 * and includes temporary copies and baseline/checkpoint overhead. It does not
 * replace a kernel storage limit for an executing untrusted process. */
export class StorageBudget {
  constructor(private readonly root:string,private readonly options:Options={}){}
  async assertCapacity(additionalBytes:number):Promise<{usedBytes:number;limitBytes:number;availableBytes:number;reserveBytes:number}>{
    if(!Number.isSafeInteger(additionalBytes)||additionalBytes<0)throw new Error('Invalid storage reservation');
    let disk:Disk;
    try{const value=this.options.disk?await this.options.disk():await statfs(this.root).then(info=>({total:info.blocks*info.bsize,available:info.bavail*info.bsize}));if(!Number.isSafeInteger(value.total)||!Number.isSafeInteger(value.available)||value.total<=0||value.available<0)throw new Error('Unknown disk space');disk=value;}
    catch{throw new Error('Managed storage is unavailable: free disk space could not be verified');}
    const limitBytes=this.options.limitBytes??Math.min(4*GiB,Math.floor(disk.total*.1));
    const reserveBytes=this.options.reserveBytes??Math.min(5*GiB,Math.floor(disk.total*.1));
    if(additionalBytes>limitBytes)throw new Error('Managed storage reservation exceeds the artifact quota');
    if(disk.available-additionalBytes<reserveBytes)throw new Error('Insufficient free disk space: Relay must retain host safety headroom');
    let usedBytes=0;let entries=0;
    const visit=async(path:string,depth:number):Promise<void>=>{
      if(++entries>100000||depth>40)throw new Error('Managed storage inspection limit exceeded');
      const info=await lstat(path);
      if(info.isSymbolicLink()||(!info.isDirectory()&&!info.isFile())||info.isFile()&&info.nlink!==1)throw new Error('Managed storage contains an unsafe link or special file');
      if(info.isFile())usedBytes+=info.size;
      else for(const name of await readdir(path))await visit(join(path,name),depth+1);
      if(usedBytes+additionalBytes>limitBytes)throw new Error('Managed storage quota reached; retain backups and remove old work through owner maintenance before continuing');
    };
    for(const folder of folders){try{await visit(join(this.root,folder),0);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
    return {usedBytes,limitBytes,availableBytes:disk.available,reserveBytes};
  }
}
