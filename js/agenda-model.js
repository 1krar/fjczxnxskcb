import { localDate, getCoursePhase } from './time.js?v=20261021-8';

export const MARKET_CALENDAR = { from: '2026-01-01', through: '2026-12-31', checkedAt: '2026-10-20',
  source: 'https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml' };
const CLOSED = [['01-01','01-03'],['02-15','02-23'],['04-04','04-06'],['05-01','05-05'],['06-19','06-21'],['09-25','09-27'],['10-01','10-07']];
export function tradingDay(date) {
  if (date < MARKET_CALENDAR.from || date > MARKET_CALENDAR.through) return 'unknown';
  const day = new Date(`${date}T12:00:00+08:00`).getUTCDay();
  if (day === 0 || day === 6 || CLOSED.some(([start,end]) => date.slice(5) >= start && date.slice(5) <= end)) return 'closed';
  return 'open';
}
export function addDate(date, days = 1) { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + days); return localDate(value); }
export function at(date, time) { return date && time ? new Date(`${date}T${time}:00`) : null; }
export function clock(date) { return date instanceof Date && Number.isFinite(+date) ? `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}` : ''; }
export function activityInterval(item) { return { start: at(item.date, item.startTime), end: at(item.endDate || item.date, item.endTime) }; }
export function activityOnDate(item, date) { return item.date && item.date <= date && (item.endDate || item.date) >= date; }

export function checkActivity(item, courses, activities = []) {
  const issues = []; const { start, end } = activityInterval(item);
  const issue = (type, text) => issues.push({ type, text });
  if (!start || !end) { issue('unknown', '缺少日期或起止时间，补齐后才能核对冲突'); return issues; }
  const arrival = at(item.date, item.checkInTime) || start;
  const courseBusy = courses.filter(c => c.date >= item.date && c.date <= (item.endDate || item.date));
  for (const course of courseBusy) {
    if (!course.startDateTime || !course.endDateTime) { issue('unknown', `「${course.courseName}」时间待核对`); continue; }
    const overlapping = Math.max(+start, +course.startDateTime) < Math.min(+end, +course.endDateTime);
    if (overlapping) {
      const parts = course.segments?.filter(part => part.kind === 'lesson' && start < part.end && end > part.start) || [];
      const minutes = parts.length ? parts.reduce((sum,part) => sum + (Math.min(+end,+part.end)-Math.max(+start,+part.start))/60000,0) : 0;
      if (parts.length) issue('overlap', `与「${course.courseName}」第${parts.map(part=>part.section).join('、')}节重叠 ${Math.ceil(minutes)} 分钟`);
      else issue('overlap', `占用「${course.courseName}」的大课区间${course.segments?.length ? '（内部课间也需留校衔接）' : ''}`);
    }
  }
  const busy = [
    ...courses.filter(c => c.startDateTime && c.endDateTime).map(c => ({ start:c.startDateTime,end:c.endDateTime,title:c.courseName })),
    ...activities.filter(other=>other.id!==item.id&&other.status==='confirmed').map(other=>({ ...activityInterval(other),title:other.title }))
  ].filter(other=>other.start&&other.end);
  for (const other of activities.filter(other=>other.id!==item.id&&other.status==='confirmed')) {
    const interval=activityInterval(other);
    if(interval.start&&interval.end&&start<interval.end&&end>interval.start)issue('overlap',`与已确认活动「${other.title}」时间重叠`);
  }
  const previous = busy.filter(other=>other.end<=start).sort((a,b)=>b.end-a.end)[0];
  const next = busy.filter(other=>other.start>=end).sort((a,b)=>a.start-b.start)[0];
  if(previous && previous.end>arrival)issue('travel',`「${previous.title}」结束时已超过签到时间`);
  else if (previous && item.travelBefore !== null) {
    const available=(arrival-previous.end)/60000;
    if(available<item.travelBefore)issue('travel',`「${previous.title}」结束到${item.checkInTime?'签到':'开始'}只有 ${Math.max(0,Math.floor(available))} 分钟，按去程 ${item.travelBefore} 分钟估计，还差 ${Math.ceil(item.travelBefore-available)} 分钟`);
  }
  if(next && item.travelAfter!==null && (next.start-end)/60000<item.travelAfter)issue('travel',`活动后赶往「${next.title}」的回程余量不足，还差 ${Math.ceil(item.travelAfter-(next.start-end)/60000)} 分钟`);
  if(!item.location)issue('unknown','地点未填，尚不能确认赶场是否可行');
  if(item.travelBefore===null||item.travelAfter===null)issue('unknown','去程或回程预算未填，赶场核对尚不完整');
  return issues;
}

export function courseContext(courses, time) {
  const course=courses.find(course=>course.startDateTime&&time>=course.startDateTime&&time<course.endDateTime);
  if(!course)return '课表未排课';
  const phase=getCoursePhase(course,time);
  return phase.kind==='break'?`「${course.courseName}」课间，${phase.segment.endTime}继续第${phase.segment.nextSection}节`:
    `「${course.courseName}」${phase.segment?`第${phase.segment.section}节`:'上课区间'}`;
}
export function preferEarlierBreak(target, courses, lead, maxEarly, preferBreak) {
  const fixed=new Date(+target-lead*60000);
  if(!preferBreak||!courses.some(course=>getCoursePhase(course,fixed).kind==='lesson'))return fixed;
  const options=courses.flatMap(course=>course.segments||[]).filter(part=>part.kind==='break')
    .map(part=>({ start:Math.max(+part.start,+target-maxEarly*60000),end:Math.min(+part.end,+fixed) }))
    .filter(part=>part.end-part.start>=60000).sort((a,b)=>b.end-a.end);
  if(!options.length)return fixed;
  // Leave at least a minute before the next small period rather than notifying on its boundary.
  return new Date(Math.max(options[0].start,options[0].end-5*60000));
}
export function marketReminders(date,courses,prefs) {
  if(!prefs.enabled||!prefs.market||tradingDay(date)!=='open')return [];
  const groups=[['morning','上午开市准备','09:15','09:30','09:15 开盘集合竞价 · 09:30 连续竞价开始'],
    ['midday','午间休市准备','11:30','11:30','11:30 午间休市'],['afternoon','下午开市准备','13:00','13:00','13:00 下午开市'],
    ['close','下午收盘准备','14:57','15:00','14:57 收盘集合竞价 · 15:00 常规竞价收盘']];
  return groups.filter(([key])=>prefs.groups.includes(key)).map(([group,title,time,last,description])=>{
    const target=new Date(`${date}T${time}:00+08:00`),expires=new Date(`${date}T${last}:00+08:00`);
    const remindAt=preferEarlierBreak(target,courses,prefs.marketLead,prefs.maxEarly,prefs.preferBreak);
    return { key:`market:${date}:${group}`,type:'market',title,start:target,end:expires,remindAt,
      expires,detail:`${description}（北京时间）；${courseContext(courses,target)}${last!==time?`；${last}：${courseContext(courses,expires)}`:''}` };
  });
}
export function buildReminders({ date, courses, activities, tasks, prefs, profile = {} }) {
  if(!prefs.enabled)return [];
  const reminders=marketReminders(date,courses.filter(c=>c.date===date),prefs);
  const dailyCourses=courses.filter(c=>c.date===date&&c.startDateTime).sort((a,b)=>a.startDateTime-b.startDateTime);
  for(const course of dailyCourses) {
    const travel=profile.destinationKeyword&&course.location.includes(profile.destinationKeyword)?profile.travelMinutes||0:0;
    const breakfast=course===dailyCourses[0]&&course.startDateTime.getHours()<11?(profile.breakfastBuyMinutes||0)+(profile.breakfastMode==='sit'?profile.breakfastEatMinutes||0:0):0;
    const lead=prefs.courseLead+travel+breakfast;
    reminders.push({key:`course:${course.date}:${course.startSection}:${course.courseName}:${course.location}`,type:'course',title:`准备去上「${course.courseName}」`,start:course.startDateTime,
      remindAt:new Date(+course.startDateTime-lead*60000),expires:course.startDateTime,detail:`${course.startTime} 开始 · ${course.location||'教室待核对'} · 提前 ${lead} 分钟（准备 ${prefs.courseLead}${travel?`＋通勤 ${travel}`:''}${breakfast?`＋早餐 ${breakfast}`:''}）`});
  }
  for(const item of activities.filter(item=>item.status==='confirmed')) {
    const { start }=activityInterval(item);if(!start)continue;
    const arrival=at(item.date,item.checkInTime)||start;
    const remindAt=new Date(+arrival-((item.travelBefore||0)+item.reminderMinutes)*60000);
    if(localDate(remindAt)>date||item.date<date)continue;
    reminders.push({ key:`activity:${item.id}`,type:'activity',title:`准备参加「${item.title}」`,start,remindAt,expires:arrival,
      detail:`${clock(arrival)} ${item.checkInTime?'签到':'开始'} · ${item.location||'地点待核对'} · ${item.travelBefore===null?'通勤尚未计入':`含去程 ${item.travelBefore} 分钟`}` });
  }
  for(const item of tasks.filter(item=>!item.completedAt&&!item.deletedAt&&!item.needsConfirmation&&item.dueDate)) {
    if(!item.dueTime&&!prefs.dateOnlyReminder)continue;
    const target=at(item.dueDate,item.dueTime||'00:00'),remindAt=item.dueTime?new Date(+target-prefs.taskLeadHours*3600000):at(addDate(item.dueDate,-1),prefs.dateOnlyTime);
    if(localDate(remindAt)>date||item.dueDate<date)continue;
    reminders.push({ key:`task:${item.id}`,type:'task',title:`提前准备：${item.text}`,start:target,remindAt,expires:item.dueTime?target:at(addDate(item.dueDate),'00:00'),detail:`${item.dueDate}${item.dueTime?` ${item.dueTime} 截止`:' 的日期事项 · 具体截止时间未设'}${item.nextStep?` · 下一步：${item.nextStep}`:''}` });
  }
  for(const item of activities.filter(item=>item.status!=='cancelled'&&item.registrationDate&&item.registrationTime)) {
    const target=at(item.registrationDate,item.registrationTime),remindAt=new Date(+target-prefs.taskLeadHours*3600000);
    if(localDate(remindAt)>date||item.registrationDate<date)continue;
    reminders.push({key:`registration:${item.id}`,type:'registration',title:`报名准备：${item.title}`,start:target,remindAt,expires:target,detail:`报名截止 ${item.registrationDate} ${item.registrationTime} · 活动日期 ${item.date||'待核对'}`});
  }
  return reminders.sort((a,b)=>a.remindAt-b.remindAt);
}

function icsEscape(value) { return String(value||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,'); }
const utcStamp=date=>date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
export function exportCalendarEvents(rows,reminders=[],now=new Date()) {
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Course Dashboard//Student Agenda//ZH','CALSCALE:GREGORIAN'];
  for(const row of rows.filter(row=>row.dateOnly||row.start&&row.end&&row.end>row.start)) {
    lines.push('BEGIN:VEVENT',`UID:${icsEscape(row.key)}@course-dashboard`,`DTSTAMP:${utcStamp(now)}`);
    if(row.dateOnly)lines.push(`DTSTART;VALUE=DATE:${row.dateOnly.replace(/-/g,'')}`,`DTEND;VALUE=DATE:${addDate(row.dateOnly).replace(/-/g,'')}`,'TRANSP:TRANSPARENT');
    else lines.push(`DTSTART:${utcStamp(row.start)}`,`DTEND:${utcStamp(row.end)}`);
    if(!row.dateOnly&&(row.transparent||row.type==='market'))lines.push('TRANSP:TRANSPARENT');
    lines.push(`SUMMARY:${icsEscape(row.title)}`,`DESCRIPTION:${icsEscape(row.detail)}`);
    if(row.location)lines.push(`LOCATION:${icsEscape(row.location)}`);
    for(const reminder of reminders.filter(item=>item.key===row.key&&(row.dateOnly||item.remindAt<row.start)))lines.push('BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${icsEscape(reminder.title)}`,`TRIGGER;VALUE=DATE-TIME:${utcStamp(reminder.remindAt)}`,'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  // RFC 5545: fold physical lines at no more than 75 UTF-8 octets.
  return lines.map(line=>{let result='',part='',bytes=0;for(const char of line){const length=new TextEncoder().encode(char).length;if(bytes+length>75){result+=part+'\r\n';part=' ';bytes=1;}part+=char;bytes+=length;}return result+part;}).join('\r\n')+'\r\n';
}
