import { validDate } from './tasks-store.js?v=20261021-1';

export const AGENDA_KEY = 'course-dashboard-agenda-v1';
export const MARKET_GROUPS = { morning: '上午开市（09:15 / 09:30）', midday: '午间休市（11:30）', afternoon: '下午开市（13:00）', close: '下午收盘（14:57 / 15:00）' };
export const DEFAULT_REMINDERS = Object.freeze({ enabled: true, courseLead: 10, taskLeadHours: 24, dateOnlyReminder: true, dateOnlyTime: '20:00',
  market: false, marketLead: 10, preferBreak: true, maxEarly: 45, groups: ['morning', 'midday', 'afternoon', 'close'] });
const text = (value, max, label) => { if (typeof value !== 'string' || value.length > max) throw new Error(`${label}格式无效或过长`); return value.trim(); };
const time = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const stamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
function number(value, min, max, label) { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label}需要在${min}至${max}之间`); return value; }

export function validateActivity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('活动数据无效');
  const result = {};
  for (const [key, max, label] of [['id', 100, '编号'], ['semester', 100, '学期'], ['className', 200, '班级'], ['title', 300, '活动名称'], ['location', 300, '地点'], ['sourceText', 6000, '通知原文']]) result[key] = text(value[key], max, label);
  if (!result.id || !result.semester || !result.className || !result.title) throw new Error('请填写活动名称');
  if (!['candidate', 'confirmed', 'cancelled'].includes(value.status)) throw new Error('活动状态无效');
  result.status = value.status;
  for (const key of ['date', 'endDate', 'registrationDate']) { if (value[key] !== '' && !validDate(value[key])) throw new Error('活动日期无效'); result[key] = value[key]; }
  for (const key of ['startTime', 'endTime', 'checkInTime', 'registrationTime']) { if (value[key] !== '' && !time(value[key])) throw new Error('活动时间无效'); result[key] = value[key]; }
  if ((result.startTime || result.endTime || result.checkInTime) && !result.date || result.registrationTime && !result.registrationDate) throw new Error('请先补充对应日期');
  if (result.endDate && (!result.date || result.endDate < result.date)) throw new Error('结束日期不能早于开始日期');
  if (result.checkInTime && result.startTime && result.checkInTime > result.startTime) throw new Error('签到时间不能晚于活动开始');
  if (result.date && result.startTime && result.endTime && new Date(`${result.endDate || result.date}T${result.endTime}`) <= new Date(`${result.date}T${result.startTime}`)) throw new Error('结束应晚于开始；跨天活动请补充结束日期');
  if (result.status === 'confirmed' && (!result.date || !result.startTime || !result.endTime)) throw new Error('确认参加前，请补齐活动日期和起止时间');
  for (const key of ['travelBefore', 'travelAfter']) result[key] = value[key] === null ? null : number(value[key], 0, 180, '通勤分钟');
  result.reminderMinutes = number(value.reminderMinutes, 1, 1440, '提前提醒分钟');
  for (const key of ['createdAt', 'updatedAt']) { if (!stamp(value[key])) throw new Error('活动保存时间无效'); result[key] = value[key]; }
  return result;
}

export function validateReminderPrefs(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('提醒设置格式无效');
  const prefs = { ...DEFAULT_REMINDERS, ...value };
  for (const key of ['enabled', 'market', 'preferBreak','dateOnlyReminder']) if (typeof prefs[key] !== 'boolean') throw new Error('提醒开关无效');
  if(!time(prefs.dateOnlyTime))throw new Error('日期事项的提醒时间无效');
  prefs.courseLead = number(prefs.courseLead, 1, 120, '课程提前量');
  prefs.taskLeadHours = number(prefs.taskLeadHours, 1, 168, '事项提前量');
  prefs.marketLead = number(prefs.marketLead, 1, 60, '大A提前量');
  prefs.maxEarly = number(prefs.maxEarly, prefs.marketLead, 120, '最早提醒窗口');
  if (!Array.isArray(prefs.groups) || prefs.groups.some(key => !Object.hasOwn(MARKET_GROUPS, key))) throw new Error('交易节点无效');
  return Object.fromEntries(Object.keys(DEFAULT_REMINDERS).map(key => [key, key === 'groups' ? [...new Set(prefs.groups)] : prefs[key]]));
}

export function validateAgenda(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.activities) || value.activities.length > 3000) throw new Error('这不是支持的日程备份');
  const activities = value.activities.map(validateActivity);
  if (new Set(activities.map(item => item.id)).size !== activities.length) throw new Error('日程编号重复');
  return { schemaVersion: 1, activities, reminders: validateReminderPrefs(value.reminders || {}) };
}
export function readAgenda() {
  let raw;
  try { raw = localStorage.getItem(AGENDA_KEY); } catch { throw new Error('无法读取日程，请检查浏览器存储权限'); }
  if (raw === null) return validateAgenda({ schemaVersion: 1, activities: [] });
  try { return validateAgenda(JSON.parse(raw)); } catch { throw new Error('本机日程无法读取，原内容已保留。请先下载原始备份'); }
}
function write(value) {
  const clean = validateAgenda(value);
  try { localStorage.setItem(AGENDA_KEY, JSON.stringify(clean)); } catch { throw new Error('日程保存失败，输入仍保留，请检查存储空间'); }
  window.dispatchEvent(new CustomEvent('agenda:changed'));
  return clean;
}
export function scopedActivities(scope, data = readAgenda()) { return data.activities.filter(item => item.semester === scope.semester && item.className === scope.className); }
export function saveActivity(fields, id = '') {
  const data = readAgenda();
  const previous = id ? data.activities.find(item => item.id === id) : null;
  if (id && !previous) throw new Error('活动已不存在，请刷新后重试');
  const now = new Date().toISOString();
  const item = validateActivity({ ...fields, id: previous?.id || crypto.randomUUID(), createdAt: previous?.createdAt || now, updatedAt: now });
  data.activities = previous ? data.activities.map(row => row.id === id ? item : row) : [...data.activities, item];
  write(data); return item;
}
export function setActivityStatus(id, status) {
  const data = readAgenda(); const item = data.activities.find(row => row.id === id);
  if (!item) throw new Error('活动已不存在');
  Object.assign(item, { status, updatedAt: new Date().toISOString() }); return write(data);
}
export function saveReminderPrefs(partial) { const data = readAgenda(); data.reminders = validateReminderPrefs({ ...data.reminders, ...partial }); return write(data); }
export function mergeAgenda(value) {
  const incoming = validateAgenda(value); const data = readAgenda(); const map = new Map(data.activities.map(item => [item.id, item]));
  let changed = 0;
  for (const item of incoming.activities) { const old = map.get(item.id); if (!old || Date.parse(item.updatedAt) > Date.parse(old.updatedAt)) { map.set(item.id, item); changed++; } }
  data.activities = [...map.values()]; write(data); return changed;
}
export function downloadFile(contents, name, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([contents], { type })); const link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportAgenda(raw = false) {
  downloadFile(raw ? localStorage.getItem(AGENDA_KEY) || '' : JSON.stringify(readAgenda(), null, 2), `日程${raw ? '-原始数据' : '-备份'}.json`);
}
