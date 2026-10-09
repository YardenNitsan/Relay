import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { installBoundary } from '../server/api/boundary';

describe('remote sign-in return navigation',()=>{
  it('permits only the inert remote document after cross-site sign-in, never API or subresource access',async()=>{
    const app=Fastify();installBoundary(app,['https://relay.example'],true);
    app.get('/',async()=>'shell');app.get('/api/session',async()=>'private');app.post('/',async()=>'mutation');
    const headers={host:'relay.example','sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
    try{
      expect((await app.inject({url:'/',headers})).statusCode).toBe(200);
      for(const request of [{url:'/api/session',headers},{url:'/',headers:{...headers,'sec-fetch-mode':'cors'}},{url:'/',headers:{...headers,'sec-fetch-dest':'iframe'}},{method:'POST' as const,url:'/',headers}])expect((await app.inject(request)).statusCode).toBe(403);
    }finally{await app.close();}
  });
  it('retains the local loopback cross-site navigation policy',async()=>{
    const app=Fastify();installBoundary(app,['http://127.0.0.1:4317']);app.get('/',async()=>'shell');
    try{expect((await app.inject({url:'/',headers:{host:'127.0.0.1:4317','sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'}})).statusCode).toBe(403);}finally{await app.close();}
  });
});
