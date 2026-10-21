import { getSectionTime } from './time.js?v=20261021-6';
import { NOTICE_VERSION, NOTICE_FIELDS, normalizeNoticeExtraction } from './notice-form.js?v=20261021-6';

export function seasonForDate(date,courses,rule) {
  const actual=courses.find(course=>course.date===date&&course.season);if(actual)return actual.season;
  const monthDay=date.slice(5);
  for(const [season,description]of Object.entries(rule||{})){const range=String(description).match(/(\d{2}-\d{2})_to_(\d{2}-\d{2})/);if(range&&(range[1]<=range[2]?monthDay>=range[1]&&monthDay<=range[2]:monthDay>=range[1]||monthDay<=range[2]))return season;}
  return null;
}
export function describeTimeContext(date,time,courses,sectionTimes,seasonRule) {
  if(!date||!time)return '';
  const moment=new Date(`${date}T${time}:00`),dayCourses=courses.filter(course=>course.date===date);
  for(const course of dayCourses)for(const part of course.segments||[])if(moment>=part.start&&moment<part.end)return part.kind==='break'?`「${course.courseName}」课间 ${part.startTime}—${part.endTime}`:`第${part.section}节 · ${course.courseName}`;
  const season=seasonForDate(date,courses,seasonRule);if(!season)return '该日期作息尚未确定';
  const periods=Object.entries(sectionTimes[season]||{}).map(([section,part])=>({section:Number(section),start:part.start.slice(0,5),end:part.end.slice(0,5)})).sort((a,b)=>a.section-b.section);
  const period=periods.find(part=>time>=part.start&&time<part.end);
  if(period)return `作息第${period.section}节，当前班级该时刻未排课`;
  const previous=periods.filter(part=>part.end<=time).at(-1),next=periods.find(part=>part.start>time);
  return previous&&next?`第${previous.section}、${next.section}节之间 · ${previous.end}—${next.start}，课表未排课`:'课表未排课';
}
export function resolvedTimeContext(item,date,courses,sectionTimes,seasonRule) {
  const clock=item.startTime||item.dueTime;
  const context=date&&clock?describeTimeContext(date,clock,courses,sectionTimes,seasonRule):clock?'日期未定':'';
  const range=item.startTime&&item.endTime?`${item.startTime}—${item.endTime}`:clock;
  return [range,context].filter(Boolean).join(' · ');
}
export function resolveNoticeItems(rawItems,{text,referenceAt,courses,sectionTimes,seasonRule,selectedCourseName=''}) {
  const reference=new Date(referenceAt);if(!Number.isFinite(+reference))throw new Error('参考日期无效');
  const knownCourses=[...new Set(courses.map(course=>course.courseName))];
  if(selectedCourseName&&!knownCourses.includes(selectedCourseName))knownCourses.push(selectedCourseName);
  const normalized=normalizeNoticeExtraction({schemaVersion:NOTICE_VERSION,items:rawItems},text,{knownCourses});
  return normalized.items.map((raw,index)=>{
    const fields=raw.fields, value=key=>fields[key].value??'';
    const issues=[],basis=[],fieldDetails=[];
    for(const [key,field]of Object.entries(NOTICE_FIELDS)){
      const cell=fields[key];
      if(cell.status==='uncertain')issues.push(`${field.label}：${cell.note||'原文存在歧义'}`);
      if(cell.status==='interpreted'&&cell.note)basis.push(`${field.label}：${cell.note}`);
      fieldDetails.push({key,label:field.label,...cell});
    }
    let date=value('date'),startTime=value('startTime'),endTime=value('endTime'),dueTime=value('dueTime'),courseName=value('courseName');
    // The AI supplies interpretation. Only authoritative timetable lookups happen here.
    if(['before_next_class','during_next_class'].includes(raw.relation)){
      const next=courses.filter(course=>courseName&&course.courseName===courseName&&course.startDateTime&&(date?course.date===date:course.startDateTime>=reference)).sort((a,b)=>a.startDateTime-b.startDateTime);
      if(next.length&&(!date||next.length===1)){
        const course=next[0];date=course.date;
        if(raw.relation==='before_next_class')dueTime=dueTime||course.startTime;else {startTime=startTime||course.startTime;endTime=endTime||course.endTime;}
        basis.push(`按AI识别的${raw.relation==='before_next_class'?'课前':'课程期间'}关系查询课表：${course.date} ${course.startTime}「${course.courseName}」`);
      }else issues.push(next.length?'这天同一课程有多次，请选择对应那次':'课表中尚未找到唯一的对应课程');
    }
    const firstSection=value('sectionStart'),lastSection=value('sectionEnd')||firstSection;
    if(firstSection&&date){
      const season=seasonForDate(date,courses,seasonRule),first=season&&getSectionTime(firstSection,season,sectionTimes),last=season&&getSectionTime(lastSection,season,sectionTimes);
      if(lastSection<firstSection)issues.push('结束小节早于起始小节');
      else if(first&&last){
        if(raw.relation==='between_sections'){startTime=startTime||first.end;endTime=endTime||last.start;}
        else {startTime=startTime||first.start;endTime=endTime||last.end;}
        basis.push(`AI识别第${firstSection}${lastSection!==firstSection?'—'+lastSection:''}节，按${date}真实作息查询时段`);
        const matches=courses.filter(course=>course.date===date&&course.startSection<=firstSection&&course.endSection>=lastSection);
        if(matches.length===1&&!courseName)courseName=matches[0].courseName;
      }else issues.push('对应日期的小节作息尚未确定');
    }
    if(startTime&&endTime&&endTime<=startTime)issues.push('结束时刻不晚于开始，跨天安排需要结束日期');
    const item={id:index,kind:raw.kind,title:raw.title,date,startTime,endTime,dueTime,courseName,location:value('location'),nextStep:value('nextStep'),
      checkInTime:value('checkInTime'),registrationDate:value('registrationDate'),registrationTime:value('registrationTime'),
      needsConfirmation:issues.length>0,issues:[...new Set(issues)],basis,fieldDetails,
      evidence:[...new Set([...Object.values(fields).flatMap(cell=>cell.evidence),...raw.relationEvidence])]};
    item.timeContext=resolvedTimeContext(item,date,courses,sectionTimes,seasonRule);
    return item;
  });
}

export function noticeRecordFields(item) {
  const anchor=item.dueTime||(item.kind!=='task'?item.startTime:'')||'';
  const startTime=item.startTime||'';
  const endTime=item.endTime&&(!startTime||item.endTime>startTime)?item.endTime:'';
  return {title:item.title||'',timeRole:item.dueTime?'deadline':item.startTime?'start':'',kind:item.kind==='activity'?'note':item.kind,courseName:item.courseName||'',dueDate:item.date||'',dueTime:anchor,
    windowStart:startTime,windowEnd:endTime,location:item.location||'',nextStep:item.nextStep||'',
    timeContext:item.timeContext||(!item.date&&anchor?anchor+'（日期未定）':''),needsConfirmation:!!item.needsConfirmation};
}
