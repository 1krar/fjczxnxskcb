import { validAccessToken } from './ai-access.js?v=20261024-2';

const LEGACY_KEY = 'course-dashboard-ai-access';
export const AUTH_EVENT_KEY = 'course-dashboard-ai-auth-change';
let state = { status:'unknown', remembered:false, expiresAt:null };
let pending = null, revision = 0, checkedAt = 0, started = false, failures = 0;
export function aiSessionStatus() {
  return state.status === 'unlocked' && Date.parse(state.expiresAt) <= Date.now()
    ? { status:'locked', remembered:false, expiresAt:null } : { ...state };
}
function changed(value) {
  const previous = JSON.stringify(state);
  state = value;
  if (JSON.stringify(state) !== previous) window.dispatchEvent(new CustomEvent('ai:changed'));
}
function accepted(value) {
  if (typeof value?.authenticated !== 'boolean' || value.authenticated && !Number.isFinite(Date.parse(value.expiresAt))) throw Error('设备授权响应暂时无法读取');
  return { status:value.authenticated ? 'unlocked' : 'locked', remembered:!!value.remembered, expiresAt:value.authenticated ? value.expiresAt : null };
}
async function sessionRequest(method = 'GET', body) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('/api/ai-session', { method, cache:'no-store', credentials:'same-origin', signal:controller.signal,
      headers:{ Accept:'application/json', ...(body ? { 'Content-Type':'application/json' } : {}) }, ...(body ? { body:JSON.stringify(body) } : {}) });
    let value; try { value = await response.json(); } catch { throw Error('此地址尚无设备授权服务，请在正式网站使用 AI'); }
    if (!response.ok) throw Object.assign(Error(value.error || '设备授权暂不可用'), { status:response.status, code:value.code });
    return accepted(value);
  } catch (error) {
    if (error.name === 'AbortError') throw Error('设备授权检查超时，稍后可重试');
    throw error;
  } finally { clearTimeout(timer); }
}
function clearLegacy() { try { sessionStorage.removeItem(LEGACY_KEY); } catch { /* Storage may be blocked. */ } }
function broadcast() { try { localStorage.setItem(AUTH_EVENT_KEY, `${Date.now()}:${Math.random()}`); } catch { /* Resume also checks authorization. */ } }
export function lockAISession() {
  revision++;
  checkedAt = Date.now();
  changed({ status:'locked', remembered:false, expiresAt:null });
}
export function restoreAISession(force = false) {
  if (pending) return pending;
  if (!force && checkedAt && Date.now() - checkedAt < Math.min(5, Math.max(1, failures))*60000) return Promise.resolve(aiSessionStatus());
  const current = revision;
  const work = sessionRequest().then(value => {
    if (current === revision) { checkedAt = Date.now(); failures = 0; changed(value); }
    return aiSessionStatus();
  }).catch(error => {
    if (current === revision) { checkedAt = Date.now(); failures++; changed({ status:'unavailable', remembered:false, expiresAt:null }); }
    throw error;
  });
  pending = work;
  work.finally(() => { if (pending === work) pending = null; }).catch(() => {});
  return work;
}
export async function unlockAISession(token, remember = false) {
  if (!validAccessToken(token)) throw Error('请填写6位数字口令，或24至512位、不含空格的长口令');
  const current = ++revision;
  const value = await sessionRequest('POST', { action:'unlock', token, remember:!!remember });
  // A successful POST alone cannot prove the browser retained a cookie.
  const verified = await sessionRequest();
  if (verified.status !== 'unlocked') throw Error('浏览器未保留授权，请允许此网站使用 Cookie 后再试');
  clearLegacy(); checkedAt = Date.now(); failures = 0;
  if (current === revision) { revision++; changed(verified); }
  broadcast();
  return value;
}
export async function logoutAISession(all = false) {
  const current = ++revision;
  const value = await sessionRequest('POST', { action:all ? 'logoutAll' : 'logout' });
  clearLegacy(); checkedAt = Date.now();
  if (current === revision) { revision++; changed(value); }
  broadcast();
}
export function startAISession() {
  if (started) return;
  started = true;
  // Upgrade an existing tab's temporary PIN once. New logins never store the PIN.
  let legacy = ''; try { legacy = sessionStorage.getItem(LEGACY_KEY) || ''; } catch { /* Optional migration. */ }
  const initial = validAccessToken(legacy) ? unlockAISession(legacy, false).catch(error => { if (error.status === 401) clearLegacy(); throw error; }) : restoreAISession();
  initial.catch(() => {});
  const resume = () => { if (!document.hidden) restoreAISession().catch(() => {}); };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', () => restoreAISession(true).catch(() => {}));
  window.addEventListener('storage', event => { if (event.key === AUTH_EVENT_KEY) restoreAISession(true).catch(() => {}); });
  document.addEventListener('app:tick', () => {
    if (!document.hidden && ['unknown','unavailable'].includes(aiSessionStatus().status)) restoreAISession().catch(() => {});
  });
}
