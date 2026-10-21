import { validDate } from './tasks-store.js?v=20261021-9';

export const DAILY_KEY = 'course-dashboard-daily-v1';
export const CATEGORIES = {
  tshirt: { label: 'T恤', group: 'top', running: true },
  shirt: { label: '衬衫', group: 'top', running: false },
  jacket: { label: '外套', group: 'layer', running: false },
  jeans: { label: '牛仔裤', group: 'bottom', running: false },
  trousers: { label: '休闲长裤', group: 'bottom', running: false },
  joggers: { label: '运动长裤', group: 'bottom', running: true },
  sportshorts: { label: '运动短裤', group: 'bottom', running: true },
  shorts: { label: '休闲短裤', group: 'bottom', running: false },
  trainers: { label: '运动鞋', group: 'shoes', running: true },
  shoes: { label: '日常鞋', group: 'shoes', running: false },
  belt: { label: '腰带', group: 'accessory', running: false },
};
export const COLORS = { unknown: '颜色未指定', black: '黑色', white: '白色', grey: '灰色', navy: '藏蓝', blue: '蓝色', beige: '米色 / 卡其', green: '绿色', red: '红色', other: '其他颜色' };
export const CLOTHING_STATES = { ready: '可穿', dirty: '待洗', washing: '洗涤中', drying: '晾晒中' };
export const DEFAULT_PROFILE = Object.freeze({
  enabled: true, refreshPerMinute: 2, city: '', baseArea: '', destinationKeyword: '', destinationArea: '',
  travelMinutes: 0, breakfastMode: 'unknown', breakfastBuyMinutes: 0, breakfastEatMinutes: 0,
  laundryEveryDays: 0, dryAfterDays: 1, peNeedsShorts: false, updatedAt: '1970-01-01T00:00:00.000Z',
});

function text(value, max, label) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label}格式无效或过长`);
  return value;
}
function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label}需要在${min}到${max}之间`);
  return value;
}
function member(value, options, label) {
  if (!options.includes(value)) throw new Error(`${label}无效`);
  return value;
}
function timestamp(value, optional = false) {
  if (optional && value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('保存时间无效');
  return value;
}
function identifier(value) { if (!text(value, 100, '编号')) throw new Error('缺少编号'); return value; }
function metadata(value) {
  return { id: identifier(value.id), createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt), deletedAt: timestamp(value.deletedAt, true) };
}
export function validateProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('生活偏好格式无效');
  const result = {};
  for (const key of ['enabled', 'peNeedsShorts']) {
    if (typeof value[key] !== 'boolean') throw new Error('生活偏好开关无效');
    result[key] = value[key];
  }
  for (const key of ['city', 'baseArea', 'destinationKeyword', 'destinationArea']) result[key] = text(value[key], 100, '地点');
  for (const key of ['travelMinutes', 'breakfastBuyMinutes', 'breakfastEatMinutes']) result[key] = integer(value[key], 0, 180, '准备时间');
  result.refreshPerMinute = integer(value.refreshPerMinute, 1, 10, '每分钟换句上限');
  result.laundryEveryDays = integer(value.laundryEveryDays, 0, 30, '洗衣间隔');
  result.dryAfterDays = integer(value.dryAfterDays, 0, 14, '预计收衣间隔');
  result.breakfastMode = member(value.breakfastMode, ['unknown', 'onway', 'sit', 'prepared'], '早餐安排');
  result.updatedAt = timestamp(value.updatedAt);
  return result;
}
function validateGarment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('衣物格式无效');
  const result = { ...metadata(value), name: text(value.name, 120, '衣物名称'),
    category: member(value.category, Object.keys(CATEGORIES), '衣物类别'), color: member(value.color, Object.keys(COLORS), '颜色'),
    state: member(value.state, Object.keys(CLOTHING_STATES), '洗晒状态'), running: member(value.running, ['auto', 'yes', 'no'], '运动适配'),
    needsBelt: member(value.needsBelt, ['unknown', 'yes', 'optional', 'no'], '腰带要求'),
    warmth: member(value.warmth, ['light', 'medium', 'warm'], '厚薄'), stateAt: timestamp(value.stateAt),
    expectedDate: text(value.expectedDate, 10, '预计收衣日期') };
  if (!result.name.trim() || (result.expectedDate && !validDate(result.expectedDate))) throw new Error('衣物名称或预计收衣日期无效');
  return result;
}
function validateOutfit(value, ids, garments) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('搭配格式无效');
  if (!Array.isArray(value.garmentIds) || value.garmentIds.length < 2 || value.garmentIds.length > 12 || new Set(value.garmentIds).size !== value.garmentIds.length || value.garmentIds.some(id => !ids.has(id))) throw new Error('搭配中的单品无效或重复');
  const name = text(value.name, 120, '搭配名称');
  if (!name.trim()) throw new Error('请填写搭配名称');
  const groups = value.garmentIds.map(id => CATEGORIES[garments.find(item => item.id === id).category].group);
  if (groups.filter(group => group === 'top').length !== 1 || groups.filter(group => group === 'bottom').length !== 1 || ['layer', 'shoes', 'accessory'].some(group => groups.filter(item => item === group).length > 1)) throw new Error('每套先选一件上衣、一件下装；外套、鞋和腰带各选至多一件');
  return { ...metadata(value), name, garmentIds: [...value.garmentIds] };
}
export function validateDailyData(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.garments) || value.garments.length > 2000 || !Array.isArray(value.outfits) || value.outfits.length > 500 || !Array.isArray(value.plans) || value.plans.length > 500) throw new Error('这不是支持的日常助手备份');
  const garments = value.garments.map(validateGarment);
  const ids = new Set(garments.map(item => item.id));
  if (ids.size !== garments.length) throw new Error('衣物编号重复');
  const outfits = value.outfits.map(item => validateOutfit(item, ids, garments));
  if (new Set(outfits.map(item => item.id)).size !== outfits.length) throw new Error('搭配编号重复');
  const plans = value.plans.map(item => {
    if (!item || !validDate(item.date) || typeof item.run !== 'boolean') throw new Error('跑步安排格式无效');
    return { date: item.date, run: item.run, updatedAt: timestamp(item.updatedAt) };
  });
  if (new Set(plans.map(item => item.date)).size !== plans.length) throw new Error('跑步安排日期重复');
  return { schemaVersion: 1, profile: validateProfile(value.profile), garments, outfits, plans, lastLaundryAt: timestamp(value.lastLaundryAt || '', true) };
}
export function emptyDailyData() { return { schemaVersion: 1, profile: { ...DEFAULT_PROFILE }, garments: [], outfits: [], plans: [], lastLaundryAt: '' }; }
export function readDailyData() {
  let raw;
  try { raw = localStorage.getItem(DAILY_KEY); } catch { throw new Error('浏览器无法读取日常助手资料，请检查存储权限'); }
  if (raw === null) return emptyDailyData();
  try { return validateDailyData(JSON.parse(raw)); } catch { throw new Error('本机日常资料无法读取，原内容已保留。请先下载原始文件，再恢复备份'); }
}
export function rawDailyData() { return localStorage.getItem(DAILY_KEY) || JSON.stringify(emptyDailyData()); }
function write(value) {
  const clean = validateDailyData(value);
  try { localStorage.setItem(DAILY_KEY, JSON.stringify(clean)); } catch { throw new Error('本机保存失败，输入仍保留；请检查存储权限或剩余空间'); }
  window.dispatchEvent(new CustomEvent('daily:changed'));
  return clean;
}
export function saveDailyProfile(partial) {
  const data = readDailyData();
  data.profile = { ...data.profile, ...partial, updatedAt: new Date().toISOString() };
  return write(data);
}
export function addGarments(groups) {
  const data = readDailyData();
  if (!Array.isArray(groups) || !groups.length || groups.length > Object.keys(CATEGORIES).length) throw new Error('先勾选至少一种衣物');
  const now = new Date().toISOString();
  let added = 0;
  for (const group of groups) {
    member(group.category, Object.keys(CATEGORIES), '衣物类别');
    const quantity = integer(group.quantity, 1, 10, '单类数量');
    for (let index = 0; index < quantity; index++) {
      const category = CATEGORIES[group.category];
      const number = data.garments.filter(item => item.category === group.category).length + 1;
      data.garments.push({ id: crypto.randomUUID(), name: group.name?.trim() ? `${group.name.trim()}${quantity > 1 ? ` ${index + 1}` : ''}` : `${COLORS[group.color] === '颜色未指定' ? '' : COLORS[group.color] + ' '}${category.label} ${number}`,
        category: group.category, color: group.color, needsBelt: group.needsBelt || 'unknown', running: 'auto', warmth: 'medium',
        state: group.state || 'ready', stateAt: now, expectedDate: '', createdAt: now, updatedAt: now, deletedAt: '' });
      added++;
    }
  }
  write(data);
  return added;
}
export function editGarment(id, fields) {
  const data = readDailyData();
  const item = data.garments.find(item => item.id === id);
  if (!item) throw new Error('衣物已不存在，请刷新列表');
  const allowed = ['name', 'color', 'needsBelt', 'running', 'warmth'];
  const partial = Object.fromEntries(allowed.filter(key => Object.hasOwn(fields, key)).map(key => [key, fields[key]]));
  Object.assign(item, partial, { updatedAt: new Date().toISOString() });
  return write(data);
}
export function changeGarmentState(ids, state, expectedDate = '') {
  const data = readDailyData();
  member(state, Object.keys(CLOTHING_STATES), '洗晒状态');
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id => !data.garments.some(item => item.id === id && !item.deletedAt))) throw new Error('请先选择仍在衣橱中的衣物');
  const now = new Date().toISOString();
  if (ids.some(id => { const old = data.garments.find(item => item.id === id).state; return state === 'washing' && old !== 'washing' || state === 'drying' && old !== 'washing' && old !== 'drying'; })) data.lastLaundryAt = now;
  for (const item of data.garments) if (ids.includes(item.id)) Object.assign(item, { state, stateAt: now, expectedDate: state === 'drying' ? expectedDate : '', updatedAt: now });
  return write(data);
}
export function setArchived(type, id, archived) {
  const data = readDailyData();
  const item = data[type === 'outfit' ? 'outfits' : 'garments'].find(item => item.id === id);
  if (!item) throw new Error('记录已不存在');
  const now = new Date().toISOString();
  item.deletedAt = archived ? now : '';
  item.updatedAt = now;
  return write(data);
}
export function saveOutfit(name, garmentIds) {
  const data = readDailyData();
  if (garmentIds.some(id => !data.garments.some(item => item.id === id && !item.deletedAt))) throw new Error('搭配中有已收起的衣物');
  const now = new Date().toISOString();
  data.outfits.push({ id: crypto.randomUUID(), name: name.trim(), garmentIds, createdAt: now, updatedAt: now, deletedAt: '' });
  return write(data);
}
export function saveRunPlan(date, run) {
  const data = readDailyData();
  const updatedAt = new Date().toISOString();
  data.plans = [...data.plans.filter(item => item.date !== date), { date, run, updatedAt }];
  return write(data);
}
export function mergeDailyBackup(value, replaceUnreadable = false) {
  const incoming = validateDailyData(value);
  let current;
  try { current = readDailyData(); } catch (error) { if (!replaceUnreadable) throw error; return write(incoming); }
  const merge = (old, next, key) => {
    const map = new Map(old.map(item => [item[key], item]));
    for (const item of next) if (!map.has(item[key]) || Date.parse(item.updatedAt) > Date.parse(map.get(item[key]).updatedAt)) map.set(item[key], item);
    return [...map.values()];
  };
  return write({ schemaVersion: 1, lastLaundryAt: (incoming.lastLaundryAt ? Date.parse(incoming.lastLaundryAt) : 0) > (current.lastLaundryAt ? Date.parse(current.lastLaundryAt) : 0) ? incoming.lastLaundryAt : current.lastLaundryAt,
    profile: Date.parse(incoming.profile.updatedAt) > Date.parse(current.profile.updatedAt) ? incoming.profile : current.profile,
    garments: merge(current.garments, incoming.garments, 'id'), outfits: merge(current.outfits, incoming.outfits, 'id'), plans: merge(current.plans, incoming.plans, 'date') });
}
