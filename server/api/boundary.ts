import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../core/errors.js';

export function installBoundary(app:FastifyInstance,origins:string[],remote=false) {
  const allowed=new Set(origins);const hosts=new Set(origins.map(value=>new URL(value).host));
  app.addHook('onRequest',async(request,reply)=>{
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('X-Frame-Options','DENY').header('Cross-Origin-Resource-Policy','same-origin');
    reply.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if(remote)reply.header('Strict-Transport-Security','max-age=31536000');
    const host=request.headers.host;
    if(!host||!hosts.has(host))throw new AppError('BAD_HOST','Unrecognized host header',403);
    const origin=request.headers.origin;
    if(origin&&!allowed.has(origin))throw new AppError('BAD_ORIGIN','Cross-origin requests are not permitted',403);
    if(request.headers['sec-fetch-site']==='cross-site')throw new AppError('CROSS_SITE','Cross-site access is not permitted',403);
    if(request.url.startsWith('/api/'))reply.header('Cache-Control','no-store');
  });
}
export class RateLimiter {
  private clients=new Map<string,{until:number;count:number}>();
  check(key:string,limit=120) {
    const now=Date.now();
    if(this.clients.size>2000)for(const [id,bucket]of this.clients)if(bucket.until<now)this.clients.delete(id);
    if(this.clients.size>3000)throw new AppError('RATE_LIMIT','The host is serving too many clients. Try again shortly.',429);
    let bucket=this.clients.get(key);
    if(!bucket||bucket.until<now){bucket={until:now+60000,count:0};this.clients.set(key,bucket);}
    if(++bucket.count>limit)throw new AppError('RATE_LIMIT','Too many requests. Wait one minute before retrying.',429);
  }
}
export function routeId(request:FastifyRequest):string {
  const params=request.params as Record<string,string>;return params.id??'';
}
