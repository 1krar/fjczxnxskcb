import { localDate, getSectionTime } from './time.js?v=20261021-1';
import { validDate } from './tasks-store.js?v=20261021-1';
const WEEKDAYS={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':7,'天':7};
const DIGITS={'零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
function chineseNumber(value) {
  if(/^\d+$/.test(value))return Number(value);
  if(value.includes('十')){const [a,b]=value.split('十');return (a?DIGITS[a]:1)*10+(b?DIGITS[b]:0);}
  return DIGITS[value];
}
function shift(date,days){const result=new Date(`${date}T12:00:00`);result.setDate(result.getDate()+days);return localDate(result);}
export function resolveDateExpression(expression,referenceAt) {
  if(!expression)return {date:'',range:null,issues:[]};
  const ref=new Date(referenceAt),base=localDate(ref),value=String(expression).replace(/\s/g,'');
  const found=[];let range=null;
  for(const match of value.matchAll(/(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})日?/g))found.push(`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`);
  if(!found.length)for(const match of value.matchAll(/(\d{1,2})月(\d{1,2})[日号]?/g))found.push(`${ref.getFullYear()+(value.includes('明年')?1:0)}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`);
  const relative=[['大后天',3],['后天',2],['明天',1],['明早',1],['明晚',1],['今天',0],['今日',0],['今晚',0],['今早',0]].find(([word])=>value.includes(word));
  if(relative)found.push(shift(base,relative[1]));
  const week=value.match(/(下下|下|本|这)?(?:周|星期|礼拜)([一二三四五六日天])?/);
  if(week){const monday=shift(base,-((ref.getDay()+6)%7));const offset=week[1]==='下下'?14:week[1]==='下'?7:0;
    if(week[2]){let date=shift(monday,offset+WEEKDAYS[week[2]]-1);if(!week[1]&&date<base)date=shift(date,7);found.push(date);}
    else if(week[1])range={from:shift(monday,offset),through:shift(monday,offset+6)};
  }
  const unique=[...new Set(found)];
  if(unique.some(date=>!validDate(date)))return {date:'',range,issues:['通知中的日期无效']};
  if(unique.length>1)return {date:'',range,issues:['日期与星期或相对日期不一致，请选择实际日期']};
  return {date:unique[0]||'',range,issues:unique.length||range?[]:['原文中的日期暂不能准确换算']};
}
export function resolveTimeExpression(expression) {
  if(!expression)return {time:'',issues:[]};
  const value=String(expression).replace(/\s/g,'').replace(/明晚|今晚/g,'晚上').replace(/明早|今早/g,'早上');
  const match=value.match(/(上午|早上|早晨|下午|晚上|傍晚|中午|凌晨)?([零一二两三四五六七八九十\d]{1,3})(?:[:：]([0-5]\d)|[点时](半|一刻|三刻|[零一二两三四五六七八九十\d]{1,3})?)/);
  if(!match)return {time:'',issues:['原文中的时刻暂不能准确换算']};
  let hour=chineseNumber(match[2]);const minutes=match[3]!==undefined?Number(match[3]):match[4]==='半'?30:match[4]==='一刻'?15:match[4]==='三刻'?45:match[4]?chineseNumber(match[4]):0;
  if(!match[1]&&match[3]===undefined&&hour>=1&&hour<=12)return {time:'',issues:[`“${expression}”未注明上午或下午`]};
  if(['下午','晚上','傍晚'].includes(match[1])&&hour<12)hour+=12;
  if(match[1]==='中午'&&hour>=1&&hour<6)hour+=12;
  if(['晚上','傍晚'].includes(match[1])&&hour===12)return {time:'',issues:['晚上12点的跨日归属需要确认']};
  if(match[1]==='凌晨'&&hour===12)hour=0;
  if(!Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(minutes)||minutes<0||minutes>59)return {time:'',issues:['通知中的时刻无效']};
  return {time:`${String(hour).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`,issues:[]};
}
export function resolveSections(expression) {
  if(!expression)return null;
  const value=String(expression).replace(/\s/g,'').match(/第?([^节]+)节/)?.[1];if(!value)return null;
  let values;
  if(/[至到—\-~、,，和与]/.test(value))values=value.split(/[至到—\-~、,，和与]+/).map(chineseNumber);
  else if(/^[一二两三四五六七八九]{2}$/.test(value))values=[...value].map(chineseNumber);
  else values=[chineseNumber(value)];
  if(values.some(number=>!Number.isInteger(number)||number<1||number>10)||values.length>2||values.at(-1)<values[0])return null;
  return {start:values[0],end:values.at(-1)};
}
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
export function resolveNoticeItems(rawItems,{text,referenceAt,courses,sectionTimes,seasonRule,selectedCourseName=''}) {
  const reference=new Date(referenceAt);if(!Number.isFinite(+reference))throw new Error('参考日期无效');
  if(!Array.isArray(rawItems)||rawItems.length>6)throw new Error('识别事项数量无效');
  return rawItems.map((raw,index)=>{
    const quote=key=>typeof raw[key]==='string'&&text.includes(raw[key])?raw[key]:'';
    const dated=resolveDateExpression(quote('dateExpression'),referenceAt);
    const starts=resolveTimeExpression(quote('startExpression')),ends=resolveTimeExpression(quote('endExpression')),deadline=resolveTimeExpression(quote('deadlineExpression'));
    const checkIn=resolveTimeExpression(quote('checkInExpression')),registration=resolveDateExpression(quote('registrationDateExpression'),referenceAt),registrationTime=resolveTimeExpression(quote('registrationTimeExpression'));
    const sections=resolveSections(quote('sectionExpression'));
    const issues=[...dated.issues,...starts.issues,...ends.issues,...deadline.issues,...checkIn.issues,...registration.issues,...registrationTime.issues];
    if(dated.range)issues.push('只给出了周范围，未给出具体哪一天');
    if(quote('sectionExpression')&&!sections)issues.push('原文中的节次暂不能准确换算');
    let date=dated.date,startTime=starts.time,endTime=ends.time,dueTime=deadline.time,courseName='',basis=[];
    const courseHint=(quote('courseHint')||selectedCourseName).replace(/老师|课程|课|的/g,'').trim();
    const names=[...new Set(courses.map(course=>course.courseName).filter(name=>courseHint&&name.includes(courseHint)))];
    if(names.length===1)courseName=names[0];
    if(names.length>1)issues.push(`匹配到多门课程：${names.join('、')}`);
    if(['before_next_class','during_next_class'].includes(raw.relation)&&quote('relationEvidence')){
      const next=courses.filter(course=>courseName&&course.courseName===courseName&&course.startDateTime&&(date?course.date===date:course.startDateTime>=reference)).sort((a,b)=>a.startDateTime-b.startDateTime);
      if(next.length&&(!date||next.length===1)){
        const course=next[0];date=course.date;
        if(raw.relation==='before_next_class')dueTime=course.startTime;else {startTime=course.startTime;endTime=course.endTime;}
        basis.push(`关联${course.date} ${course.startTime}「${course.courseName}」，${raw.relation==='before_next_class'?'课前':'课程期间'}来自原文`);
      }else issues.push(next.length?'这天同一课程有多次，请选择对应那次':'尚未找到唯一的对应课程');
    }
    if(sections&&date){
      const season=seasonForDate(date,courses,seasonRule),first=season&&getSectionTime(sections.start,season,sectionTimes),last=season&&getSectionTime(sections.end,season,sectionTimes);
      if(first&&last){
        const breakEvidence = /课间|之间/.test(quote('sectionExpression')+' '+quote('relationEvidence'));
        if(raw.relation==='between_sections'&&!breakEvidence)issues.push('模型判断为课间，但未找到对应原话依据');
        if(breakEvidence){startTime=first.end;endTime=last.start;if(startTime>=endTime)issues.push('课间节次未形成有效区间');}
        else {startTime=startTime||first.start;endTime=endTime||last.end;}
        basis.push(`第${sections.start}${sections.end!==sections.start?`—${sections.end}`:''}节按${date}作息换算`);
        const matches=courses.filter(course=>course.date===date&&course.startSection<=sections.start&&course.endSection>=sections.end);
        if(matches.length===1&&!courseName)courseName=matches[0].courseName;
      }else issues.push('对应日期的小节作息尚未确定');
    }
    if(!date&&(startTime||dueTime||sections))issues.push(dated.range?'只确定了周范围，尚未确定具体哪一天':'时间尚未关联到具体日期');
    const location=quote('location');
    let timeContext=date&&(startTime||dueTime)?describeTimeContext(date,startTime||dueTime,courses,sectionTimes,seasonRule):'';
    if(startTime&&endTime)timeContext=`${startTime}—${endTime}${timeContext?' · '+timeContext:''}`;
    if(dated.range)timeContext=`${dated.range.from}—${dated.range.through}（周范围）`;
    if(!dueTime&&!sections&&raw.kind!=='activity')dueTime=startTime;
    if(date&&startTime&&endTime&&endTime<=startTime)issues.push('结束时刻不晚于开始；跨天情况请补充确认');
    return {id:index,kind:raw.kind,title:raw.title,date,startTime,endTime,dueTime,courseName,location,timeContext,
      checkInTime:checkIn.time,registrationDate:registration.date,registrationTime:registrationTime.time,
      needsConfirmation:issues.length>0,issues:[...new Set(issues)],basis,
      evidence:Object.keys(raw).filter(key=>key.endsWith('Expression')||key==='location'||key==='courseHint'||key==='relationEvidence').map(quote).filter(Boolean)};
  });
}
