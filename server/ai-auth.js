import { validAccessToken } from '../js/ai-access.js';

export class AIError extends Error {
  constructor(message, status=400, code='invalid_request') { super(message); this.status=status; this.code=code; }
}
export const response = (value,status=200,headers={}) => Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
export function missingConfiguration(env) {
  return [!env.DASHSCOPE_API_KEY?'百炼密钥':null,!validAccessToken(env.AI_ACCESS_TOKEN)?'个人访问口令':null,!env.AI_DB?.prepare?'用量数据库':null].filter(Boolean);
}
export function checkOrigin(request,required=false) {
  const origin=request.headers.get('Origin');
  if(origin&&origin!==new URL(request.url).origin||request.headers.get('Sec-Fetch-Site')==='cross-site'||required&&!origin) throw new AIError('不支持跨站调用',403,'forbidden');
}
export async function identifier(value) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export const ownerIdentifier = env => identifier(`${env.DASHSCOPE_API_KEY}\0${env.AI_ACCESS_TOKEN}`);
const initialized = new WeakSet();
export async function ensureTables(db,now) {
  if(initialized.has(db))return;
  await db.prepare('CREATE TABLE IF NOT EXISTS ai_quota (owner TEXT NOT NULL, day TEXT NOT NULL, minute INTEGER NOT NULL, minute_count INTEGER NOT NULL, day_count INTEGER NOT NULL, PRIMARY KEY (owner, day))').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS ai_auth (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS ai_auth_expiry ON ai_auth(expires)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS ai_sessions (token_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, last_seen INTEGER NOT NULL, remembered INTEGER NOT NULL)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS ai_session_owner ON ai_sessions(owner, expires)').run();
  await db.prepare('DELETE FROM ai_auth WHERE expires <= ?').bind(+now).run();
  await db.prepare('DELETE FROM ai_sessions WHERE expires <= ?').bind(+now).run();
  initialized.add(db);
}
async function reserveAuthAttempt(db,key,limit,now) {
  const row=await db.prepare(`INSERT INTO ai_auth(key,attempts,expires) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN ai_auth.expires<=? THEN 1 ELSE ai_auth.attempts+1 END,
    expires=CASE WHEN ai_auth.expires<=? THEN excluded.expires ELSE ai_auth.expires END
    WHERE ai_auth.expires<=? OR ai_auth.attempts<? RETURNING expires`).bind(key,+now+15*60000,+now,+now,+now,limit).first();
  if(!row)throw new AIError('口令尝试过多，已暂停验证，请15分钟后再试',429,'auth_rate_limited');
  return {key,expires:row.expires};
}
export async function authenticatePIN(request,env,now,supplied=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'') {
  const owner=await ownerIdentifier(env);
  const ip=await identifier(`${owner}\0${request.headers.get('CF-Connecting-IP')||'unknown'}`);
  try {
    await ensureTables(env.AI_DB,now);
    const all=await reserveAuthAttempt(env.AI_DB,`${owner}:all`,30,now);
    const client=await reserveAuthAttempt(env.AI_DB,`${owner}:${ip}`,5,now);
    const actual=await identifier(typeof supplied==='string'&&supplied.length<=512?supplied:''), expected=await identifier(env.AI_ACCESS_TOKEN);
    let diff=0;for(let i=0;i<actual.length;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);
    if(!supplied||diff)throw new AIError('个人访问口令不正确或尚未填写',401,'unauthorized');
    for(const row of [all,client])await env.AI_DB.prepare('UPDATE ai_auth SET attempts=MAX(0,attempts-1) WHERE key=? AND expires=?').bind(row.key,row.expires).run();
    return owner;
  } catch(error) {
    if(error instanceof AIError)throw error;
    throw new AIError('口令验证暂不可用，未调用模型',503,'auth_unavailable');
  }
}
export async function readJSON(request) {
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new AIError('请发送JSON请求',415);
  const reader=request.body?.getReader();if(!reader)throw new AIError('请求内容为空');
  let bytes=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>48000){await reader.cancel();throw new AIError('内容过长，请拆分后重试',413);}chunks.push(value);}
  const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(body));}catch{throw new AIError('请求JSON无效');}
}
