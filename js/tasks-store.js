const KEY = 'course-dashboard-personal-items-v1';
export const KINDS = { task: '作业 / 待办', exam: '考试', bring: '带物品', change: '课程变更', note: '随手记' };
export const SOURCES = { oral: '课堂口头', qq: 'QQ 群', other: '其他' };

export function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function cleanText(value, max, label) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label}格式无效或过长`);
  return value;
}

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTimestamp(value, optional = false) {
  return (optional && value === '') || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)));
}

export function validateItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('事项格式无效');
  const result = {};
  for (const [key, max, label] of [
    ['id', 100, '事项编号'], ['semester', 100, '学期'], ['className', 200, '班级'],
    ['courseName', 300, '课程'], ['text', 5000, '正文'], ['nextStep', 1000, '下一步'],
  ]) result[key] = cleanText(item[key], max, label);
  if (!result.id || !result.semester || !result.className || !result.text.trim()) throw new Error('事项缺少必要内容');
  if (!Object.hasOwn(KINDS, item.kind) || !Object.hasOwn(SOURCES, item.source)) throw new Error('事项类别或来源无效');
  if (typeof item.needsConfirmation !== 'boolean') throw new Error('事项确认状态无效');
  if (typeof item.dueDate !== 'string' || (item.dueDate !== '' && !validDate(item.dueDate))) throw new Error('事项日期无效');
  if (typeof item.dueTime !== 'string' || (item.dueTime !== '' && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(item.dueTime) || !item.dueDate))) throw new Error('事项时间无效，请先选择日期');
  if (!validTimestamp(item.createdAt) || !validTimestamp(item.updatedAt) ||
      !validTimestamp(item.completedAt, true) || !validTimestamp(item.deletedAt, true)) throw new Error('事项保存时间无效');
  for (const key of ['kind', 'source', 'needsConfirmation', 'dueDate', 'dueTime', 'createdAt', 'updatedAt', 'completedAt', 'deletedAt']) result[key] = item[key];
  return result;
}

export function validateBackup(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.items) || value.items.length > 5000) throw new Error('这不是支持的个人事项备份文件');
  const ids = new Set();
  const items = value.items.map(validateItem);
  for (const item of items) {
    if (ids.has(item.id)) throw new Error('备份中有重复编号，未进行导入');
    ids.add(item.id);
  }
  return { schemaVersion: 1, items };
}

export function readItems() {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { throw new Error('浏览器不允许读取个人事项，请检查站点存储权限'); }
  if (raw === null) return [];
  try { return validateBackup(JSON.parse(raw)).items; } catch { throw new Error('本机事项数据无法读取，原数据已保留。请先导出原始数据备份，再检查或恢复'); }
}

function writeItems(items) {
  const value = validateBackup({ schemaVersion: 1, items });
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { throw new Error('本机保存失败，可能是空间不足或存储被禁用。输入内容仍保留，请先备份或检查浏览器设置'); }
  window.dispatchEvent(new CustomEvent('personal-items:changed'));
}

export function itemsForScope(scope, all = readItems()) {
  return all.filter(item => item.semester === scope.semester && item.className === scope.className);
}

export function saveItem(fields, id = '') {
  const items = readItems();
  const previous = id ? items.find(item => item.id === id) : null;
  if (id && !previous) throw new Error('这条事项已不存在，请刷新后重试');
  const now = new Date().toISOString();
  const item = validateItem({
    ...fields,
    id: previous?.id || crypto.randomUUID(),
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    completedAt: previous?.completedAt || '',
    deletedAt: previous?.deletedAt || '',
  });
  writeItems(previous ? items.map(row => row.id === id ? item : row) : [...items, item]);
  return item;
}

export function updateItemState(id, action) {
  if (!['complete', 'reopen', 'trash', 'restore'].includes(action)) throw new Error('不支持的操作');
  const items = readItems();
  if (!items.some(item => item.id === id)) throw new Error('这条事项已不存在，请刷新后重试');
  const now = new Date().toISOString();
  writeItems(items.map(item => item.id !== id ? item : {
    ...item, updatedAt: now,
    completedAt: action === 'complete' ? now : action === 'reopen' ? '' : item.completedAt,
    deletedAt: action === 'trash' ? now : action === 'restore' ? '' : item.deletedAt,
  }));
}

export function mergeBackup(value) {
  const incoming = validateBackup(value).items;
  const map = new Map(readItems().map(item => [item.id, item]));
  let added = 0;
  let updated = 0;
  for (const item of incoming) {
    const old = map.get(item.id);
    if (!old) { map.set(item.id, item); added++; }
    else if (Date.parse(item.updatedAt) > Date.parse(old.updatedAt)) { map.set(item.id, item); updated++; }
  }
  writeItems([...map.values()]);
  return { added, updated };
}

export function exportBackup(raw = false) {
  let contents;
  if (raw) {
    try { contents = localStorage.getItem(KEY) || '{"schemaVersion":1,"items":[]}'; }
    catch { throw new Error('浏览器无法读取原始数据'); }
  } else contents = JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), items: readItems() }, null, 2);
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  const now = new Date();
  const fileDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  link.download = `个人事项${raw ? '-原始数据' : '-备份'}-${fileDate}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function dateLabel(item, today) {
  if (!item.dueDate) return item.needsConfirmation ? '时间待确认' : '未设日期';
  const prefix = item.dueDate === today ? '今天' : item.dueDate;
  return `${prefix}${item.dueTime ? ` ${item.dueTime}` : ''}`;
}

export function isOverdue(item, today, now = new Date()) {
  if (!item.dueDate || item.completedAt || item.deletedAt) return false;
  if (item.dueDate < today) return true;
  return item.dueDate === today && !!item.dueTime && new Date(`${item.dueDate}T${item.dueTime}:00`) < now;
}

export function sortItems(items) {
  return [...items].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') ||
    (a.dueTime || '23:59').localeCompare(b.dueTime || '23:59') || b.updatedAt.localeCompare(a.updatedAt));
}
