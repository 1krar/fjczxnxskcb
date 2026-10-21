import { validAccessToken } from './ai-access.js?v=20261021-9';
export const AI_KEY = 'course-dashboard-ai-v1';
const TOKEN_KEY = 'course-dashboard-ai-access';
const CACHE_KEY = 'course-dashboard-ai-daily-v1';
const DEFAULTS = { enabled: false, notice: true, daily: true };
const dailyRequests = new Map();
const attempted = new Set();
let calls = [];

export function readAISettings() {
  try {
    const value = JSON.parse(localStorage.getItem(AI_KEY) || '{}');
    return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => [key, typeof value?.[key] === 'boolean' ? value[key] : fallback]));
  } catch { return { ...DEFAULTS }; }
}
export function accessToken() { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
export function saveAISettings(value, token) {
  if (token && !validAccessToken(token)) throw new Error('请填写6位数字口令，或24至512位、不含空格的长口令');
  sessionStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(AI_KEY, JSON.stringify(Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, !!value[key]]))));
  attempted.clear();
  window.dispatchEvent(new CustomEvent('ai:changed'));
}
export function aiEnabled(feature) { const value = readAISettings(); return value.enabled && value[feature] && !!accessToken(); }
export async function serverStatus() {
  try {
    const response = await fetch('/api/ai', { cache: 'no-store', headers: { Accept: 'application/json' } });
    const value = await response.json();
    if (!response.ok || typeof value.configured !== 'boolean') throw new Error();
    return value;
  } catch { throw new Error('此地址尚无 AI 服务。本地静态预览仍可保存记录；在线网站配置后可使用 AI。'); }
}
export async function callAI(action, fields = {}) {
  const token = accessToken();
  if (!token) throw new Error('请先在 API 设置填写个人访问口令');
  if (action !== 'check') {
    const now = Date.now(); calls = calls.filter(time => time > now - 60000);
    if (calls.length >= 2) throw new Error('通知识别与每日一句合计每分钟最多2次，请稍后再试');
    calls.push(now);
  }
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch('/api/ai', { method: 'POST', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...fields, action }) });
    let value; try { value = await response.json(); } catch { throw new Error('此地址尚未配置 AI 服务，可以先保存原话'); }
    if (!response.ok) throw new Error(value.error || 'AI 服务暂不可用');
    return value.result ?? value;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('AI 等待超时，可以先保存原话');
    throw error;
  } finally { clearTimeout(timer); }
}
function readCache() {
  try { const value = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
}
// Exact request time is useful to the model, but must not invalidate prose every minute.
export function dailyIdentity(scope, date, facts) { return JSON.stringify([scope, date, facts.filter(fact => fact.id !== 'clock')]); }
export function cachedDaily(key) {
  const entry = readCache().entry;
  return entry?.key === key && typeof entry.sentence === 'string' && Array.isArray(entry.basisIds) ? entry : null;
}
export function requestDaily(key, facts, manual = false) {
  if (dailyRequests.has(key)) return dailyRequests.get(key);
  if (!manual && attempted.has(key)) return Promise.resolve(cachedDaily(key));
  attempted.add(key);
  const work = (async () => {
    const cache = readCache();
    const [scope,date] = JSON.parse(key);
    const automaticKey = JSON.stringify([scope,date]);
    if (!manual && cache.automaticKey === automaticKey) return null;
    if (!manual) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...cache, automaticKey })); } catch { /* Session-level attempted keys still prevent repeated ticks. */ }
    }
    const recent = Array.isArray(cache.recent) ? cache.recent.filter(line => typeof line === 'string').slice(-5) : [];
    const result = await callAI('daily', { facts, recent });
    if (typeof result.sentence !== 'string' || !Array.isArray(result.basisIds) || !result.basisIds.length || result.basisIds.some(id => !facts.some(fact => fact.id === id))) throw new Error('每日一句的依据无效，继续显示本地内容');
    const entry = { key, sentence: result.sentence, basisIds: result.basisIds, at: new Date().toISOString() };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ entry, automaticKey, recent: [...recent, entry.sentence].slice(-7) })); } catch { /* A sentence remains usable if caching is unavailable. */ }
    return entry;
  })();
  dailyRequests.set(key, work);
  work.finally(() => dailyRequests.delete(key)).catch(() => {});
  return work;
}
