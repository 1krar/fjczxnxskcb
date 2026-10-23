// Contextual notes are not deadlines. Matching uses the selected course schedule,
// never device location or guesses from the note's prose.
export const NOTE_SCENES = { manual:'仅在事项中保存', course:'关联课程', prepare:'出门准备', place:'关联教学楼', time:'每天的时间段', home:'首页轻提示' };
const clock = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export const noteDate = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const isPersistent = item => item.reminderMode === 'persistent';
export function normalizeNoteRule(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('常驻提示的关联格式无效');
  const scene=value.scene??'manual',weekdays=value.weekdays??[],place=value.place??'',leadMinutes=value.leadMinutes??20;
  if (!Object.hasOwn(NOTE_SCENES,scene) || !Array.isArray(weekdays) || weekdays.length>7 || weekdays.some(day=>!Number.isInteger(day)||day<0||day>6) || new Set(weekdays).size!==weekdays.length) throw new Error('常驻提示的场景或星期无效');
  if (typeof place!=='string'||place.length>300 || !Number.isInteger(leadMinutes)||leadMinutes<0||leadMinutes>180) throw new Error('常驻提示的地点或提前量无效');
  const startTime=value.startTime??'',endTime=value.endTime??'';
  if (startTime!==''&&!clock(startTime) || endTime!==''&&!clock(endTime)) throw new Error('常驻提示的时间段无效');
  return {scene,weekdays:[...weekdays].sort((a,b)=>a-b),place:place.trim(),startTime,endTime,leadMinutes};
}
export function noteActive(item,now=new Date()) {
  return isPersistent(item)&&!item.completedAt&&!item.deletedAt&&!item.notePaused&&item.noteHiddenOn!==noteDate(now);
}
function dayMatches(item,date) {
  const rule=normalizeNoteRule(item.noteRule);
  return (!item.dueDate||item.dueDate===date)&&(!rule.weekdays.length||rule.weekdays.includes(new Date(`${date}T12:00:00`).getDay()));
}
const normalized = value => String(value||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
function associationMatches(item,course) {
  const rule=normalizeNoteRule(item.noteRule);
  if (item.courseName && normalized(item.courseName)!==normalized(course.courseName)) return false;
  if (['place','prepare'].includes(rule.scene) && rule.place && !normalized(course.location).includes(normalized(rule.place))) return false;
  return true;
}
export function notesForCourse(items,course,{now=new Date(),view='detail'}={}) {
  if(!course?.date)return [];
  return items.filter(item=>{
    if(!noteActive(item,now)||!dayMatches(item,course.date))return false;
    const rule=normalizeNoteRule(item.noteRule);
    if(!['course','place','prepare'].includes(rule.scene)||!associationMatches(item,course))return false;
    // Empty course/place associations remain saved, but never match every class.
    if(rule.scene==='course'&&!item.courseName || rule.scene==='place'&&!rule.place || rule.scene==='prepare'&&!item.courseName&&!rule.place)return false;
    if(view==='prepare'||view==='detail')return true;
    if(rule.scene==='prepare' && view!=='focus')return false;
    const start=+course.startDateTime,end=+course.endDateTime;
    return Number.isFinite(start)&&Number.isFinite(end)&&end>start&&+now>=start-rule.leadMinutes*60000&&+now<end;
  });
}
export function notesForMoment(items,now=new Date(),courses=[]) {
  return items.filter(item=>{
    if(!noteActive(item,now))return false;
    const rule=normalizeNoteRule(item.noteRule),today=noteDate(now);
    if(rule.scene==='home')return dayMatches(item,today);
    if(rule.scene!=='time'||!rule.startTime||!rule.endTime||rule.startTime===rule.endTime)return false;
    let start=new Date(`${today}T${rule.startTime}`),end=new Date(`${today}T${rule.endTime}`);
    if(rule.endTime<rule.startTime){
      if(now<end)start.setDate(start.getDate()-1);else end.setDate(end.getDate()+1);
    }
    const date=noteDate(start);
    if(!dayMatches(item,date)||now<start||now>=end)return false;
    return !item.courseName||courses.some(course=>course.date===date&&associationMatches(item,course));
  });
}
export function noteRuleLabel(item) {
  const rule=normalizeNoteRule(item.noteRule),parts=[];
  if(rule.scene==='course')parts.push(item.courseName?`${item.courseName} · 课前${rule.leadMinutes}分钟起`:'尚未选择关联课程');
  else if(rule.scene==='place')parts.push(rule.place?`课表地点含“${rule.place}” · 课前${rule.leadMinutes}分钟起`:'尚未填写教学楼关键词');
  else if(rule.scene==='prepare')parts.push(item.courseName||rule.place?`出门准备 · ${[item.courseName,rule.place].filter(Boolean).join(' / ')}`:'尚未选择准备关联的课程或教学楼');
  else if(rule.scene==='time')parts.push(rule.startTime&&rule.endTime&&rule.startTime!==rule.endTime?`${rule.startTime}—${rule.endTime}${rule.endTime<rule.startTime?'（跨日）':''}${item.courseName?` · 有${item.courseName}的当天`:''}`:'时间段尚未完整设置');
  else parts.push(NOTE_SCENES[rule.scene]);
  if(rule.scene==='place'&&item.courseName)parts.push(item.courseName);
  if(rule.weekdays.length)parts.push(rule.weekdays.map(day=>'周'+'日一二三四五六'[day]).join('、'));
  if(item.dueDate)parts.push(`仅${item.dueDate}`);
  return parts.join(' · ');
}
