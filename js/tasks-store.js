import { normalizeNoteRule, isPersistent, noteDate } from './persistent-model.js?v=20261024-2';
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
  for (const [key,max,label] of [['title',300,'事项名称'],['location',300,'地点'],['timeContext',500,'时间区间'],['referenceAt',100,'通知参考时间']]) result[key] = cleanText(item[key] ?? '', max, label);
  result.reminderMode = item.reminderMode ?? 'task';
  if (!['task','persistent'].includes(result.reminderMode)) throw new Error('事项提醒模式无效');
  result.noteRule = normalizeNoteRule(item.noteRule);
  result.notePaused = item.notePaused ?? false;
  result.noteHiddenOn = item.noteHiddenOn ?? '';
  if (typeof result.notePaused !== 'boolean' || typeof result.noteHiddenOn !== 'string' || result.noteHiddenOn && !validDate(result.noteHiddenOn)) throw new Error('常驻提示状态无效');
  result.timeRole = item.timeRole ?? '';
  if (!['','start','deadline'].includes(result.timeRole)) throw new Error('事项时间类型无效');
  result.homeOrder = item.homeOrder ?? null;
  if (result.homeOrder !== null && (!Number.isInteger(result.homeOrder) || result.homeOrder < 0 || result.homeOrder > 5000)) throw new Error('事项排序无效');
  if (result.referenceAt && !validTimestamp(result.referenceAt)) throw new Error('通知参考时间无效');
  if (!result.id || !result.semester || !result.className || !result.text.trim()) throw new Error('事项缺少必要内容');
  if (!Object.hasOwn(KINDS, item.kind) || !Object.hasOwn(SOURCES, item.source)) throw new Error('事项类别或来源无效');
  if (typeof item.needsConfirmation !== 'boolean') throw new Error('事项确认状态无效');
  if (typeof item.dueDate !== 'string' || (item.dueDate !== '' && !validDate(item.dueDate))) throw new Error('事项日期无效');
  if (typeof item.dueTime !== 'string' || (item.dueTime !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.dueTime))) throw new Error('事项时刻格式无效');
  for (const key of ['windowStart','windowEnd']) {
    const value = item[key] ?? '';
    if (typeof value !== 'string' || value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('相关区间的时刻无效');
    result[key] = value;
  }
  if (result.windowStart && result.windowEnd && result.windowEnd <= result.windowStart) throw new Error('相关区间的结束时刻应晚于开始时刻');
  if (!validTimestamp(item.createdAt) || !validTimestamp(item.updatedAt) ||
      !validTimestamp(item.completedAt, true) || !validTimestamp(item.deletedAt, true)) throw new Error('事项保存时间无效');
  for (const key of ['kind', 'source', 'needsConfirmation', 'dueDate', 'dueTime', 'createdAt', 'updatedAt', 'completedAt', 'deletedAt']) result[key] = item[key];
  return result;
}

export function validateBackup(value) {
  if (!value || ![1,2].includes(value.schemaVersion) || !Array.isArray(value.items) || value.items.length > 5000) throw new Error('这不是支持的个人事项备份文件');
  const ids = new Set();
  const items = value.items.map(validateItem);
  for (const item of items) {
    if (ids.has(item.id)) throw new Error('备份中有重复编号，未进行导入');
    ids.add(item.id);
  }
  return { schemaVersion: 2, items };
}

export function readItems() {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { throw new Error('浏览器不允许读取个人事项，请检查站点存储权限'); }
  if (raw === null) return [];
  try { return validateBackup(JSON.parse(raw)).items; } catch { throw new Error('本机事项数据无法读取，原数据已保留。请先导出原始数据备份，再检查或恢复'); }
}

function writeItems(items) {
  const value = validateBackup({ schemaVersion: 2, items });
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
    ...previous, ...fields,
    ...(previous && fields.reminderMode && fields.reminderMode !== previous.reminderMode ? {notePaused:false,noteHiddenOn:''} : {}),
    homeOrder:previous?.homeOrder ?? null,
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
  if (!['complete', 'reopen', 'trash', 'restore', 'pause', 'resume', 'hideToday', 'showToday', 'stopPersistent'].includes(action)) throw new Error('不支持的操作');
  const items = readItems();
  const previous=items.find(item => item.id === id);
  if (!previous) throw new Error('这条事项已不存在，请刷新后重试');
  const now = new Date().toISOString();
  writeItems(items.map(item => item.id !== id ? item : {
    ...item, updatedAt: now,
    notePaused: action === 'pause' ? true : ['resume','stopPersistent'].includes(action) ? false : item.notePaused,
    noteHiddenOn: action === 'hideToday' ? noteDate(new Date()) : ['showToday','stopPersistent'].includes(action) ? '' : item.noteHiddenOn,
    reminderMode: action === 'stopPersistent' ? 'task' : item.reminderMode,
    completedAt: action === 'complete' ? now : action === 'reopen' ? '' : item.completedAt,
    deletedAt: action === 'trash' ? now : action === 'restore' ? '' : item.deletedAt,
  }));
  return { id, previous:Object.fromEntries(['completedAt','deletedAt','notePaused','noteHiddenOn','reminderMode'].map(key=>[key,previous[key]])), expected:JSON.stringify(readItems().find(item=>item.id===id)) };
}

export function undoItemState(change) {
  const items=readItems(), current=items.find(item=>item.id===change.id);
  if (!current || JSON.stringify(current)!==change.expected) throw new Error('这条事项已有新的修改，未覆盖。请到事项页查看。');
  const previous=Object.fromEntries(['completedAt','deletedAt','notePaused','noteHiddenOn','reminderMode'].map(key=>[key,change.previous[key]]));
  writeItems(items.map(item=>item.id===change.id?validateItem({...item,...previous,updatedAt:new Date().toISOString()}):item));
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
  } else contents = JSON.stringify({ schemaVersion: 2, exportedAt: new Date().toISOString(), items: readItems() }, null, 2);
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  const now = new Date();
  const fileDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  link.download = `个人事项${raw ? '-原始数据' : '-备份'}-${fileDate}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function itemTimeLabel(item) {
  const range = item.windowStart && item.windowEnd ? `${item.windowStart}—${item.windowEnd}` : item.windowStart || (item.windowEnd ? `至${item.windowEnd}` : '');
  if (item.dueTime && range && item.dueTime !== item.windowStart) return `${item.dueTime} · 相关区间 ${range}`;
  return range || item.dueTime || '';
}
export function dateLabel(item, today) {
  const time = itemTimeLabel(item);
  if (!item.dueDate) return `${item.needsConfirmation ? '时间待确认' : '未设日期'}${time ? ' · '+time : ''}`;
  const prefix = item.dueDate === today ? '今天' : item.dueDate;
  return `${prefix}${time ? ` ${time}` : ''}`;
}

export function isOverdue(item, today, now = new Date()) {
  if (isPersistent(item) || !item.dueDate || item.completedAt || item.deletedAt) return false;
  if (item.dueDate < today) return true;
  return item.dueDate === today && !!item.dueTime && new Date(`${item.dueDate}T${item.dueTime}:00`) < now;
}

export function sortItems(items) {
  return [...items].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') ||
    (a.dueTime || '23:59').localeCompare(b.dueTime || '23:59') || b.updatedAt.localeCompare(a.updatedAt));
}

export function sortHomeItems(items, now = new Date(), manual = true) {
  const timed = item => {
    if (!item.dueDate) return {group:2,time:0};
    const clock=item.dueTime||item.windowStart;
    const moment=clock?+new Date(`${item.dueDate}T${clock}:00`):+new Date(`${item.dueDate}T23:59:59.999`);
    return {group:moment>=+now?0:1,time:moment};
  };
  return [...items].sort((a,b)=>{
    if(manual){const x=a.homeOrder??Infinity,y=b.homeOrder??Infinity;if(x!==y)return x-y;}
    const x=timed(a),y=timed(b);
    return x.group-y.group || (x.group===1?y.time-x.time:x.time-y.time) || String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id);
  });
}

export function saveHomeOrder(scope, ids = null) {
  if (!scope?.semester || !scope?.className || ids!==null && (!Array.isArray(ids) || ids.length>5000 || ids.some(id=>typeof id!=='string') || new Set(ids).size!==ids.length)) throw new Error('排序内容无效');
  const all=readItems(),matches=item=>item.semester===scope.semester&&item.className===scope.className;
  const active=all.filter(item=>matches(item)&&!isPersistent(item)&&!item.completedAt&&!item.deletedAt);
  const available=new Set(active.map(item=>item.id));
  const supplied=new Set(ids||[]);
  const ordered=ids===null?[]:[...ids.filter(id=>available.has(id)),...sortHomeItems(active).filter(item=>!supplied.has(item.id)).map(item=>item.id)];
  const positions=new Map(ordered.map((id,index)=>[id,index])),stamp=new Date().toISOString();
  writeItems(all.map(item=>matches(item)&&(ids===null||positions.has(item.id))?{...item,homeOrder:ids===null?null:positions.get(item.id),updatedAt:stamp}:item));
}
