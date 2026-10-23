import { AIError, response, missingConfiguration, checkOrigin, identifier, ownerIdentifier, ensureTables, authenticatePIN, readJSON } from './ai-auth.js';
import { validAccessToken } from '../js/ai-access.js';

export const SESSION_COOKIE='__Host-ai-session';
export const REMEMBER_MS=30*86400000;
export const SESSION_MS=8*3600000;
const clearCookie = () => `${SESSION_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;
function cookieToken(request) {
  const values=(request.headers.get('Cookie')||'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(SESSION_COOKIE+'='));
  const token=values.length===1?values[0].slice(SESSION_COOKIE.length+1):'';
  return /^[a-f0-9]{64}$/.test(token)?token:'';
}
export async function readSession(request,env,now=new Date()) {
  const token=cookieToken(request);if(!token)return null;
  try {
    await ensureTables(env.AI_DB,now);
    const hash=await identifier(token),owner=await ownerIdentifier(env);
    const row=await env.AI_DB.prepare('SELECT token_hash, owner, created, expires, last_seen, remembered FROM ai_sessions WHERE token_hash=? AND owner=? AND expires>?').bind(hash,owner,+now).first();
    if(!row)return null;
    if(+now-row.last_seen>=5*60000)await env.AI_DB.prepare('UPDATE ai_sessions SET last_seen=? WHERE token_hash=?').bind(+now,hash).run();
    return row;
  } catch { throw new AIError('设备授权暂时无法验证，未调用模型',503,'auth_unavailable'); }
}
export async function authenticateRequest(request,env,now) {
  const session=await readSession(request,env,now);
  if(session){checkOrigin(request,true);return session.owner;}
  if(request.headers.has('Authorization'))return authenticatePIN(request,env,now);
  throw new AIError('AI尚未解锁或授权已到期，请重新解锁',401,'unauthorized');
}
export async function handleSession(request,env,{now=new Date()}={}) {
  try {
    checkOrigin(request,request.method!=='GET');
    const missing=missingConfiguration(env);
    if(missing.length)throw new AIError('AI服务端配置尚未就绪',503,'not_configured');
    if(request.method==='GET'){
      const session=await readSession(request,env,now);
      return response({authenticated:!!session,remembered:!!session?.remembered,expiresAt:session?new Date(session.expires).toISOString():null},200,!session&&request.headers.get('Cookie')?.includes(SESSION_COOKIE+'=')?{'Set-Cookie':clearCookie()}:{});
    }
    if(request.method!=='POST')return response({error:'不支持的请求方式'},405);
    const body=await readJSON(request);
    if(!body||typeof body!=='object'||Array.isArray(body))throw new AIError('请求内容无效');
    if(body.action==='unlock'){
      if(!validAccessToken(body.token)||typeof body.remember!=='boolean')throw new AIError('请填写6位数字口令或原有长口令');
      const owner=await authenticatePIN(request,env,now,body.token);
      const bytes=crypto.getRandomValues(new Uint8Array(32)),token=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
      const expires=+now+(body.remember?REMEMBER_MS:SESSION_MS),hash=await identifier(token);
      const previous=cookieToken(request);
      if(previous)await env.AI_DB.prepare('DELETE FROM ai_sessions WHERE token_hash=? AND owner=?').bind(await identifier(previous),owner).run();
      await env.AI_DB.prepare('INSERT INTO ai_sessions(token_hash,owner,created,expires,last_seen,remembered) VALUES(?,?,?,?,?,?)').bind(hash,owner,+now,expires,+now,body.remember?1:0).run();
      const cookie=`${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict${body.remember?`; Max-Age=${REMEMBER_MS/1000}`:''}`;
      return response({authenticated:true,remembered:body.remember,expiresAt:new Date(expires).toISOString()},200,{'Set-Cookie':cookie});
    }
    if(body.action==='logout'||body.action==='logoutAll'){
      const session=await readSession(request,env,now);
      if(session)await env.AI_DB.prepare(body.action==='logoutAll'?'DELETE FROM ai_sessions WHERE owner=?':'DELETE FROM ai_sessions WHERE token_hash=?').bind(body.action==='logoutAll'?session.owner:session.token_hash).run();
      return response({authenticated:false,remembered:false,expiresAt:null},200,{'Set-Cookie':clearCookie()});
    }
    throw new AIError('不支持的设备操作');
  } catch(error) {
    return response({error:error instanceof AIError?error.message:'设备授权暂不可用',code:error instanceof AIError?error.code:'server_error'},error instanceof AIError?error.status:500);
  }
}
