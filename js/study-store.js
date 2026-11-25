import { validDate } from './tasks-store.js?v=20261030-1';

export const STUDY_KEY = 'course-dashboard-evening-study-v1';
export const STUDY_STATUS_LABELS = Object.freeze({normal:'正常参加',other:'另有安排',pending:'请假待确认',excused:'已请假（个人确认）'});
export const DEFAULT_EXCUSAL_REASONS = Object.freeze(['社团活动','志愿活动','学生工作']);
export const DEFAULT_STUDY_SETTINGS = Object.freeze({enabled:true,weekdays:Object.freeze([1,2,3,4,5,6,7]),location:'',note:''});
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, label) => {
  if (typeof value !== 'string' || value.length > max) throw Error(`${label}格式无效或过长`);
  return value.trim();
};
const classKey = value => { const clean=text(value,200,'班级');if(!clean)throw Error('请先选择班级');return clean; };
const timestamp = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const dateKey = value => {if(!validDate(value))throw Error('晚自习日期无效');return value;};

export function validateStudyOverride(value) {
  if(!record(value)||!Object.hasOwn(STUDY_STATUS_LABELS,value.status))throw Error('晚自习当日状态无效');
  if(!timestamp(value.updatedAt))throw Error('晚自习保存时间无效');
  return {status:value.status,title:text(value.title??'',200,'当晚安排'),location:text(value.location??'',300,'晚自习地点'),
    note:text(value.note??'',1000,'晚自习备注'),activityId:text(value.activityId??'',100,'关联活动'),quickExcusal:value.status==='excused'&&value.quickExcusal===true,updatedAt:value.updatedAt};
}
function validateProfile(value) {
  if(!record(value)||typeof value.enabled!=='boolean'||!Array.isArray(value.weekdays)||value.weekdays.length>7
    ||value.weekdays.some(day=>!Number.isInteger(day)||day<1||day>7))throw Error('晚自习每周设置无效');
  if(value.updatedAt!==''&&!timestamp(value.updatedAt))throw Error('晚自习设置保存时间无效');
  if(!record(value.overrides)||Object.keys(value.overrides).length>3000)throw Error('晚自习当日安排过多或格式无效');
  const overrides=Object.fromEntries(Object.entries(value.overrides).map(([date,row])=>[dateKey(date),validateStudyOverride(row)]));
  const weekdays=[...new Set(value.weekdays)].sort((a,b)=>a-b);
  const legacyDefault=value.excusalReasons===undefined&&weekdays.join(',')==='1,2,3,4,5';
  return {enabled:value.enabled,weekdays:legacyDefault?[...DEFAULT_STUDY_SETTINGS.weekdays]:weekdays,location:text(value.location,300,'晚自习地点'),
    note:text(value.note,1000,'晚自习备注'),updatedAt:value.updatedAt,overrides,excusalReasons:cleanReasons(value.excusalReasons??DEFAULT_EXCUSAL_REASONS)};
}
export function emptyStudyData() {return {schemaVersion:1,profiles:{}};}
export function validateStudyData(value) {
  if(!record(value)||value.schemaVersion!==1||!record(value.profiles)||Object.keys(value.profiles).length>60)throw Error('这不是支持的晚自习资料');
  const entries=Object.entries(value.profiles).map(([name,profile])=>[classKey(name),validateProfile(profile)]);
  if(new Set(entries.map(([name])=>name)).size!==entries.length)throw Error('晚自习班级名称重复');
  if(entries.reduce((sum,[,profile])=>sum+Object.keys(profile.overrides).length,0)>10000)throw Error('晚自习当日安排过多');
  return {schemaVersion:1,profiles:Object.fromEntries(entries)};
}
export function studyProfile(data, className) {
  const name=classKey(className);
  if(data&&(!record(data)||data.schemaVersion!==1||!record(data.profiles)))throw Error('晚自习资料格式无效');
  return data&&Object.hasOwn(data.profiles,name)?validateProfile(data.profiles[name]):{...DEFAULT_STUDY_SETTINGS,weekdays:[...DEFAULT_STUDY_SETTINGS.weekdays],updatedAt:'',overrides:{},excusalReasons:[...DEFAULT_EXCUSAL_REASONS]};
}
export function rawStudyData() {
  try{return localStorage.getItem(STUDY_KEY)??'';}catch{throw Error('无法读取晚自习资料，请检查浏览器存储权限');}
}
export function readStudyData() {
  let raw;
  try{raw=localStorage.getItem(STUDY_KEY);}catch{throw Error('无法读取晚自习资料，请检查浏览器存储权限');}
  if(raw===null)return emptyStudyData();
  try{return validateStudyData(JSON.parse(raw));}catch{throw Error('本机晚自习资料无法读取，原内容已保留。请先下载原始资料');}
}
function writeStudyData(value) {
  const clean=validateStudyData(value);
  try{localStorage.setItem(STUDY_KEY,JSON.stringify(clean));}catch{throw Error('晚自习保存失败，原资料与输入仍保留，请检查存储空间');}
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('study:changed'));
  return clean;
}
export function saveStudySettings(className,partial) {
  if(!record(partial))throw Error('晚自习设置格式无效');
  const name=classKey(className),data=readStudyData(),previous=studyProfile(data,name);
  const profile=validateProfile({...previous,...Object.fromEntries(Object.keys(DEFAULT_STUDY_SETTINGS).filter(key=>Object.hasOwn(partial,key)).map(key=>[key,partial[key]])),updatedAt:new Date().toISOString()});
  data.profiles={...data.profiles,[name]:profile};writeStudyData(data);return profile;
}
function cleanReasons(values) {
  if(!Array.isArray(values)||values.length>20)throw Error('最多保存 20 个销假标签');
  return [...new Set(values.map(value=>text(value,24,'销假原因')).filter(Boolean))];
}
export function saveStudyExcusalReasons(className,reasons,previousReasons) {
  const name=classKey(className),data=readStudyData(),profile=studyProfile(data,name);
  if(previousReasons&&JSON.stringify(previousReasons)!==JSON.stringify(profile.excusalReasons))throw Error('快捷标签已在另一页面更新，请先核对后再保存');
  const next={...profile,excusalReasons:cleanReasons(reasons),updatedAt:new Date().toISOString()};
  data.profiles={...data.profiles,[name]:next};
  writeStudyData(data);
  return next;
}
export function saveStudyExcusal(className,date,reason) {
  const title=text(reason,24,'销假原因');
  if(!title)throw Error('请填写销假原因');
  return saveStudyOverride(className,date,{status:'excused',title,quickExcusal:true},title);
}
export function saveStudyOverride(className,date,fields,rememberReason='') {
  if(!record(fields))throw Error('晚自习当日安排格式无效');
  const name=classKey(className),day=dateKey(date),data=readStudyData(),profile=studyProfile(data,name);
  const row=validateStudyOverride({...fields,updatedAt:new Date().toISOString()});
  data.profiles={...data.profiles,[name]:{...profile,overrides:{...profile.overrides,[day]:row},updatedAt:row.updatedAt,excusalReasons:cleanReasons([...new Set([...profile.excusalReasons,...(rememberReason?[rememberReason]:[])])])}};
  writeStudyData(data);return row;
}
export function removeStudyOverride(className,date) {
  const name=classKey(className),day=dateKey(date),data=readStudyData(),profile=studyProfile(data,name);
  if(!Object.hasOwn(profile.overrides,day))return profile;
  const overrides={...profile.overrides};delete overrides[day];
  const next={...profile,overrides,updatedAt:new Date().toISOString()};
  data.profiles={...data.profiles,[name]:next};writeStudyData(data);return next;
}
