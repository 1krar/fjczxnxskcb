import { aiSessionStatus, restoreAISession, lockAISession } from './ai-session-client.js?v=20261024-1';
export { aiSessionStatus, restoreAISession, unlockAISession, logoutAISession } from './ai-session-client.js?v=20261024-1';
export const AI_KEY = 'course-dashboard-ai-v1';
export const DAILY_CACHE_KEY = 'course-dashboard-ai-daily-v2';
const LEASE_KEY = DAILY_CACHE_KEY + '-lease';
const DEFAULTS = { enabled:false, notice:true, daily:true, outfit:true, rememberDevice:false };
const dailyRequests = new Map();
let calls = [], memoryCache = {}, leaseRetryAt = 0;

export function readAISettings() {
  try {
    const value = JSON.parse(localStorage.getItem(AI_KEY) || '{}');
    return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => [key, typeof value?.[key] === 'boolean' ? value[key] : fallback]));
  } catch { return { ...DEFAULTS }; }
}
export function saveAISettings(value) {
  localStorage.setItem(AI_KEY, JSON.stringify(Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, !!value[key]]))));
  window.dispatchEvent(new CustomEvent('ai:changed'));
}
export function aiEnabled(feature) { const value = readAISettings(); return value.enabled && value[feature] && aiSessionStatus().status === 'unlocked'; }
export async function serverStatus() {
  try {
    const response = await fetch('/api/ai', { cache:'no-store', headers:{ Accept:'application/json' } });
    const value = await response.json();
    if (!response.ok || typeof value.configured !== 'boolean') throw Error();
    return value;
  } catch { throw Error('此地址尚无 AI 服务。本地静态预览仍可保存记录；在线网站配置后可使用 AI。'); }
}
export async function callAI(action, fields = {}) {
  if (aiSessionStatus().status !== 'unlocked') await restoreAISession();
  if (aiSessionStatus().status !== 'unlocked') throw Object.assign(Error('请先在 API 设置解锁 AI'), { code:'unauthorized', status:401 });
  if (action !== 'check') {
    const now = Date.now(); calls = calls.filter(time => time > now - 60000);
    if (calls.length >= 2) throw Object.assign(Error('AI功能合计每分钟最多2次，请稍后再试'), { status:429, code:'client_rate_limited' });
    calls.push(now);
  }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch('/api/ai', { method:'POST', cache:'no-store', credentials:'same-origin', signal:controller.signal,
      headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ ...fields, action }) });
    let value; try { value = await response.json(); } catch { throw Error('此地址尚未配置 AI 服务，可以先保存原话'); }
    if (!response.ok) {
      if (response.status === 401) lockAISession();
      throw Object.assign(Error(value.error || 'AI 服务暂不可用'), { status:response.status, code:value.code });
    }
    return value.result ?? value;
  } catch (error) {
    if (error.name === 'AbortError') throw Error('AI 等待超时，可以先保存原话');
    throw error;
  } finally { clearTimeout(timer); }
}
function readCache() {
  try { const value = JSON.parse(localStorage.getItem(DAILY_CACHE_KEY) || 'null'); return value && typeof value === 'object' && !Array.isArray(value) ? value : memoryCache; } catch { return memoryCache; }
}
function writeCache(value) { memoryCache = value; try { localStorage.setItem(DAILY_CACHE_KEY, JSON.stringify(value)); } catch { /* Keep successful prose in this tab if storage is unavailable. */ } }
const dayKey = key => JSON.stringify(JSON.parse(key).slice(0,2));
const authStamp = () => aiSessionStatus().expiresAt || '';
const generatedDays = cache => [...new Set([...(Array.isArray(cache.automaticKeys) ? cache.automaticKeys : []), cache.automaticKey].filter(key => typeof key === 'string'))];
// Exact request time must not invalidate prose every minute. v2 drops poisoned v1 success markers.
export function dailyIdentity(scope, date, facts) { return JSON.stringify([scope, date, facts.filter(fact => fact.id !== 'clock'), 'v2']); }
export function cachedDaily(key) {
  const entry = readCache().entry;
  return entry?.key === key && typeof entry.sentence === 'string' && Array.isArray(entry.basisIds) ? entry : null;
}
export function canRequestDaily(key, manual = false) {
  if (dailyRequests.size || leaseRetryAt > Date.now()) return false;
  const cache = readCache(), day = dayKey(key), retry = cache.retry?.day === day ? cache.retry : null;
  if (!manual && generatedDays(cache).includes(day)) return false;
  if (!retry) return true;
  if (retry.auth && retry.auth !== authStamp()) return true;
  if (retry.nextAt > Date.now()) return false;
  return manual || retry.failures < 3;
}
export function dailyWaitMessage(key) {
  const retry = readCache().retry;
  if (leaseRetryAt > Date.now()) return '另一个页面正在生成，稍后再换一句。';
  if (retry?.day === dayKey(key) && retry.nextAt > Date.now()) return '刚才未能生成，正在稍作等待；也可以先看看当前短句。';
  return '暂时无法换句，稍后可再试。';
}
function retryState(cache, day, error, previousAuth) {
  const failures = (cache.retry?.day === day ? cache.retry.failures || 0 : 0) + 1;
  const auth = previousAuth;
  // Bounded automatic retries. Quota failures wait five minutes; no retry storm on each tick.
  const delay = error.status === 401 ? 30*86400000 : error.status === 429 || failures > 1 ? 5*60000 : 60000;
  return { day, failures, nextAt:Date.now()+delay, auth };
}
async function withDailyLease(work) {
  if (globalThis.navigator?.locks) return navigator.locks.request('course-dashboard-daily-ai', { ifAvailable:true }, lock => {
    if (lock) return work();
    leaseRetryAt = Date.now()+15000;
    return null;
  });
  const lease = String(Date.now()) + ':' + Math.random();
  try {
    const old = JSON.parse(localStorage.getItem(LEASE_KEY) || 'null');
    if (old?.until > Date.now()) { leaseRetryAt = Date.now()+15000; return null; }
    localStorage.setItem(LEASE_KEY, JSON.stringify({ id:lease, until:Date.now()+40000 }));
    await new Promise(resolve => setTimeout(resolve, 50));
    if (JSON.parse(localStorage.getItem(LEASE_KEY) || 'null')?.id !== lease) { leaseRetryAt = Date.now()+15000; return null; }
  } catch { /* Server quota remains authoritative when storage is blocked. */ }
  try { return await work(); }
  finally { try { if (JSON.parse(localStorage.getItem(LEASE_KEY) || 'null')?.id === lease) localStorage.removeItem(LEASE_KEY); } catch { /* Lease expires automatically. */ } }
}
export function requestDaily(key, facts, manual = false, weather = null) {
  if (dailyRequests.has(key)) return dailyRequests.get(key);
  if (!canRequestDaily(key, manual)) return Promise.resolve(cachedDaily(key));
  const work = withDailyLease(async () => {
    const cache = readCache(), automaticKey = dayKey(key);
    if (!manual && generatedDays(cache).includes(automaticKey)) return cachedDaily(key);
    const recent = Array.isArray(cache.recent) ? cache.recent.filter(line => typeof line === 'string').slice(-5) : [];
    const history = Array.isArray(cache.topics) ? cache.topics.filter(row => typeof row?.scope === 'string' && Number.isFinite(row.at) && row.at > Date.now()-3*86400000 && Array.isArray(row.ids)).slice(-29) : [];
    const topics = history.filter(row => row.scope === JSON.stringify(JSON.parse(key)[0])).slice(-6);
    const repeated = new Set(topics.slice(-2).flatMap(row => row.ids || []));
    // A recently mentioned item need not recur as a footer. Dedicated reminders stay unchanged.
    const selectedFacts = facts.filter(fact => !/^(item|activity):/.test(fact.id) || !repeated.has(fact.id));
    const previousAuth = authStamp();
    try {
      const result = await callAI('daily', { facts:selectedFacts, recent, recentTopics:topics.map(row => ({ ids:row.ids, sentence:row.sentence })), weather });
      if (typeof result.sentence !== 'string' || [...result.sentence.trim()].length < 5 || [...result.sentence.trim()].length > 48 || /[\r\n]/.test(result.sentence) || !Array.isArray(result.basisIds) || result.basisIds.some(id => !selectedFacts.some(fact => fact.id === id))) throw Error('每日一句暂时无法展示，继续显示本地内容');
      const entry = { key, sentence:result.sentence.trim(), basisIds:[...new Set(result.basisIds)], at:new Date().toISOString() };
      const topic = { scope:JSON.stringify(JSON.parse(key)[0]), ids:entry.basisIds.filter(id => id !== 'clock' && id !== 'date'), sentence:entry.sentence, at:Date.now() };
      writeCache({ entry, automaticKey, automaticKeys:[...generatedDays(cache).filter(day => day !== automaticKey),automaticKey].slice(-90), recent:[...recent,entry.sentence].slice(-7), topics:[...history,topic] });
      window.dispatchEvent(new CustomEvent('daily-ai:changed'));
      return entry;
    } catch (error) {
      writeCache({ ...readCache(), retry:retryState(readCache(),automaticKey,error,previousAuth) });
      throw error;
    }
  });
  dailyRequests.set(key, work);
  work.finally(() => dailyRequests.delete(key)).catch(() => {});
  return work;
}
