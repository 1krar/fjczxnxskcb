export const ADVICE_VISIBILITY_KEY = 'course-dashboard-advice-visibility-v1';
const scopeKey = scope => JSON.stringify([scope.semester, scope.className]);
function read() {
  const raw = localStorage.getItem(ADVICE_VISIBILITY_KEY);
  if (!raw) return { disabled:false, dismissed:[] };
  try {
    const value = JSON.parse(raw);
    if (typeof value?.disabled !== 'boolean' || !Array.isArray(value.dismissed)) throw Error();
    return { disabled:value.disabled, dismissed:value.dismissed.filter(row => typeof row?.scope === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date)) };
  } catch { throw Error('每日一句的显示偏好无法读取，原内容已保留。'); }
}
export function adviceVisibility(scope, date) {
  const value = read();
  return { disabled:value.disabled, hidden:value.disabled || value.dismissed.some(row => row.scope === scopeKey(scope) && row.date === date) };
}
export function changeAdviceVisibility(scope, date, action) {
  const value = read(), key = scopeKey(scope);
  value.dismissed = value.dismissed.filter(row => row.scope !== key || row.date !== date);
  if (action === 'today') value.dismissed.push({ scope:key, date });
  else if (action === 'off') value.disabled = true;
  else if (action === 'restore') value.disabled = false;
  else throw Error('不支持的显示操作');
  value.dismissed = value.dismissed.slice(-60);
  try { localStorage.setItem(ADVICE_VISIBILITY_KEY, JSON.stringify(value)); }
  catch { throw Error('显示偏好保存失败，请重试。'); }
}
