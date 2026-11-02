// Local static preview. Production hosting needs only demo-site/.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../demo-site/',import.meta.url));
const port=Number(process.env.DEMO_PORT||4321);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  try{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const relative=path==='/'?'index.html':path.slice(1);
    if(relative.split('/').some(part=>part==='..'||part.startsWith('.'))){res.writeHead(404);res.end();return;}
    const body=await readFile(join(root,relative));
    res.writeHead(200,{'content-type':types[extname(relative)]||'application/octet-stream','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`MendCue demo: http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
