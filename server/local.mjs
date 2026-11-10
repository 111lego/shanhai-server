import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {handleAPI,sqliteStore} from './api.js';
import {requestURL} from './request.js';
const root=fileURLToPath(new URL('../',import.meta.url)),publicDir=resolve(root,'public');
// Two storage backends: Postgres when DATABASE_URL is set (Render's free plan has
// no disk, so a SQLite file would be wiped on every restart), else local SQLite.
let db=null,pool=null,store;
if(process.env.DATABASE_URL){
  const pg=(await import('pg')).default;
  const {pgStore,PG_SCHEMA}=await import('./pg-store.mjs');
  pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4,ssl:{rejectUnauthorized:false}});
  await pool.query(PG_SCHEMA);
  store=pgStore(pool);
  console.log('storage: postgres');
}else{
  const dataDir=resolve(root,process.env.GAME_DATA_DIR||'runtime');
  await mkdir(dataDir,{recursive:true});
  db=new DatabaseSync(resolve(dataDir,'game.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  db.exec(await readFile(resolve(root,'server/schema.sql'),'utf8'));
  store=sqliteStore(db);
  console.log('storage: sqlite');
}
const port=Number(process.env.PORT)||4174;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{
 const url=requestURL(req,process.env.TRUST_PROXY==='1');
 if(url.pathname==='/healthz'){if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:JSON.stringify({ok:true}));return;}
 if(url.pathname.startsWith('/api/')){let body='';for await(const chunk of req){body+=chunk;if(body.length>250000){res.writeHead(413);res.end();return;}}const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body}: {})});const response=await handleAPI(request,store);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}const path=resolve(publicDir,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!path.startsWith(publicDir+sep)){res.writeHead(403);res.end();return;}const file=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:file);
 }catch(e){res.writeHead(e.code==='ENOENT'?404:500);res.end('Not found');}});
server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`山海五侠 Local: http://127.0.0.1:${port}`));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>server.close(async()=>{try{if(db)db.close();if(pool)await pool.end();}catch{}process.exit();}));
