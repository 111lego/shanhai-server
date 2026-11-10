import {createSave,validateSave} from '../public/engine.js';
const enc=new TextEncoder();
const hex=buffer=>Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,'0')).join('');
const rand=length=>hex(crypto.getRandomValues(new Uint8Array(length)));
const digest=async text=>hex(await crypto.subtle.digest('SHA-256',enc.encode(text)));
async function passwordHash(password,salt){let value=password;for(let pass=0;pass<3;pass++){const key=await crypto.subtle.importKey('raw',enc.encode(value),'PBKDF2',false,['deriveBits']);value=hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:100000,salt:enc.encode(`${salt}:${pass}`)},key,256));}return value;}
const equal=(a,b)=>{let d=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)d|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return d===0;};
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const cookie=(request,token,age=2592000)=>`shanhai_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
export function sqliteStore(db){return{get:async(sql,p=[])=>db.prepare(sql).get(...p),all:async(sql,p=[])=>db.prepare(sql).all(...p),run:async(sql,p=[])=>({changes:db.prepare(sql).run(...p).changes}),batch:async statements=>{db.exec('BEGIN IMMEDIATE');try{const r=statements.map(s=>db.prepare(s.sql).run(...(s.params||[])));db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};}
export function d1Store(db){return{get:async(sql,p=[])=>db.prepare(sql).bind(...p).first(),all:async(sql,p=[])=>((await db.prepare(sql).bind(...p).all()).results),run:async(sql,p=[])=>({changes:(await db.prepare(sql).bind(...p).run()).meta.changes}),batch:async statements=>db.batch(statements.map(s=>db.prepare(s.sql).bind(...(s.params||[]))))};}
async function limited(store,key,max){const now=Date.now(),start=now-900000;await store.run('INSERT INTO rate_limits(key,count,started) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.started<? THEN 1 ELSE rate_limits.count+1 END, started=CASE WHEN rate_limits.started<? THEN ? ELSE rate_limits.started END',[key,now,start,start,now]);const r=await store.get('SELECT count FROM rate_limits WHERE key=?',[key]);return r.count>max;}
async function session(request,store){const token=request.headers.get('cookie')?.match(/(?:^|;\s*)shanhai_session=([a-f0-9]{64})(?:;|$)/)?.[1];if(!token)return null;return store.get('SELECT users.id, users.name, sessions.token FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token=? AND sessions.expires>?',[await digest(token),Date.now()]);}
async function snapshot(user,store){const s=await store.get('SELECT data,revision FROM saves WHERE user_id=?',[user.id]);return{user:{id:user.id,name:user.name},save:JSON.parse(s.data),revision:s.revision};}
export async function handleAPI(request,store){
 try{
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(!['GET','POST','PUT'].includes(method))return json({error:'请求方式不支持'},405);
  if(method!=='GET'){const origin=request.headers.get('origin');if((origin&&origin!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'请求来源无效'},403);if(Number(request.headers.get('content-length')||0)>250000)return json({error:'存档过大'},413);}
  let data={};if(method!=='GET'){const raw=await request.text();if(raw.length>250000)return json({error:'存档过大'},413);try{data=JSON.parse(raw||'{}');}catch{return json({error:'数据格式无效'},400);}}
  if(['/api/register','/api/login'].includes(path)&&method==='POST'){
   const name=typeof data.username==='string'?data.username.normalize('NFKC').trim():'',username=name.toLowerCase(),password=data.password;
   if(!/^[\p{L}\p{N}_-]{2,20}$/u.test(name)||typeof password!=='string'||password.length<8||password.length>72)return json({error:'用户名2–20位，可用中文、字母、数字；密码8–72位'},400);
   const ip=request.headers.get('cf-connecting-ip')||'local';
   if(await limited(store,`${path}:${ip}:${path.endsWith('login')?username:'all'}`,path.endsWith('login')?8:12))return json({error:'尝试次数较多，请15分钟后再试'},429);
   let user=await store.get('SELECT * FROM users WHERE username=?',[username]);
   if(path.endsWith('register')){
    if(user)return json({error:'这个用户名已经注册，请直接登录'},409);
    const id=crypto.randomUUID(),salt=rand(24),hash=await passwordHash(password,salt);
    try{await store.batch([{sql:'INSERT INTO users(id,name,username,password,salt,created) VALUES(?,?,?,?,?,?)',params:[id,name,username,hash,salt,Date.now()]},{sql:'INSERT INTO saves(user_id,data,revision,updated) VALUES(?,?,0,?)',params:[id,JSON.stringify(createSave()),Date.now()]}]);}catch(e){if(/UNIQUE|constraint/i.test(String(e)))return json({error:'这个用户名已经注册'},409);throw e;}
    user={id,name};
   }else{
    const hash=await passwordHash(password,user?.salt||'missing-account-padding-salt');
    if(!user||!equal(hash,user.password))return json({error:'用户名或密码不正确'},401);
   }
   const token=rand(32);await store.batch([{sql:'DELETE FROM sessions WHERE expires<?',params:[Date.now()]},{sql:'INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)',params:[await digest(token),user.id,Date.now()+2592000000]}]);
   return json(await snapshot(user,store),path.endsWith('register')?201:200,{'Set-Cookie':cookie(request,token)});
  }
  const user=await session(request,store);if(!user)return json({error:'请先登录自己的账号'},401);
  if(path==='/api/me'&&method==='GET')return json(await snapshot(user,store));
  if(path==='/api/logout'&&method==='POST'){await store.run('DELETE FROM sessions WHERE token=?',[user.token]);return json({ok:true},200,{'Set-Cookie':cookie(request,'',0)});}
  if(path==='/api/save'&&method==='PUT'){
   if(data.userId!==user.id)return json({error:'账号已在其他页面切换；本页进度未覆盖其他账号，请重新登录。'},403);
   if(!Number.isInteger(data.revision)||data.revision<0)return json({error:'存档版本无效'},400);
   let save;try{save=validateSave(data.save);}catch(e){return json({error:e.message},400);}
   const result=await store.run('UPDATE saves SET data=?,revision=revision+1,updated=? WHERE user_id=? AND revision=?',[JSON.stringify(save),Date.now(),user.id,data.revision]);
   if(result.changes!==1)return json({error:'另一个页面已更新进度。请先导出本机进度，再重新登录读取最新存档。'},409);
   return json({ok:true,revision:data.revision+1});
  }
  return json({error:'接口不存在'},404);
 }catch(error){console.error('API failure:',error.name,error.message);return json({error:'服务暂时不可用，请稍后重试'},500);}
}
