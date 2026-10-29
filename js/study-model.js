import { getCourseSegments, getSectionTime, seasonForDate, getWeekday } from './time.js?v=20261029-5';
import { courseSectionRange } from './day-slots.js?v=20261029-5';
import { studyProfile, STUDY_STATUS_LABELS } from './study-store.js?v=20261029-5';
import { validDate } from './tasks-store.js?v=20261029-5';

export { STUDY_STATUS_LABELS };
const dayNumber = date => Date.parse(`${date}T00:00:00Z`)/86400000;
function coverageReason(date,info) {
  if(info==null)return '';
  if(!validDate(info.semesterStart)||!Number.isInteger(info.firstWeek)||!Number.isInteger(info.lastWeek)||info.firstWeek<1||info.lastWeek<info.firstWeek)return '课表范围待确认，暂不自动安排晚自习';
  const offset=dayNumber(date)-dayNumber(info.semesterStart);
  return offset<(info.firstWeek-1)*7||offset>=info.lastWeek*7?'不在已导入的课表范围内，暂不自动安排晚自习':'';
}
const realRows = (courses,date,className) => courses.filter(course=>course.source!=='evening-study'&&course.date===date&&(!course.className||course.className===className));

/** Describe defaults/overrides separately from their safe insertion into the school timetable. */
export function describeEveningStudy(courses,date,options={}) {
  const {studyData,className,sectionTimes={},seasonRule={},semesterInfo}=options;
  const profile=studyProfile(studyData,className),override=profile.overrides[date]||null,status=override?.status||'normal';
  const base={enabled:profile.enabled,scheduled:false,status,label:STUDY_STATUS_LABELS[status],profile,override,
    attendance:status==='normal'||status==='pending',reason:'',season:null,availableSections:[],blockedSections:[],unknownCourses:[]};
  if(!validDate(date))return {...base,reason:'晚自习日期待确认'};
  const scheduled=!!override||profile.enabled&&profile.weekdays.includes(getWeekday(date));
  if(!scheduled)return {...base,reason:'当天未设置晚自习'};
  const coverage=coverageReason(date,semesterInfo);
  if(coverage)return {...base,reason:coverage};
  const rows=realRows(courses,date,className),season=seasonForDate(date,rows,seasonRule);
  const result={...base,scheduled:true,season};
  // Missing raw section metadata is never interpreted as an unoccupied evening.
  const unknownCourses=rows.filter(course=>!courseSectionRange(course));
  if(unknownCourses.length)return {...result,unknownCourses,reason:'有课程节次待确认，暂不叠加晚自习'};
  const periodTimes=[9,10].map(section=>({section,time:season&&getSectionTime(section,season,sectionTimes)}));
  if(periodTimes.some(({time})=>!time||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time.end)||time.end<=time.start)
    ||periodTimes[1].time.start<periodTimes[0].time.end)return {...result,reason:'晚自习作息待确认'};
  const blockedSections=[9,10].filter(section=>rows.some(course=>{const range=courseSectionRange(course);return section>=range.start&&section<=range.end;}));
  const availableSections=[9,10].filter(section=>!blockedSections.includes(section));
  return {...result,blockedSections,availableSections,reason:blockedSections.length?`第${blockedSections.join('、')}节已有课程，优先显示真实课程`:''};
}
export function getEveningStudyState(date,options={}) {return describeEveningStudy(options.courses||[],date,options);}

function courseWeek(date,courses,semesterInfo) {
  if(validDate(semesterInfo?.semesterStart))return Math.floor((dayNumber(date)-dayNumber(semesterInfo.semesterStart))/7)+1;
  const sample=courses.find(course=>validDate(course.date)&&Number.isInteger(course.week)&&course.week>0);
  if(!sample)return 0;
  const monday=dayNumber(sample.date)-(getWeekday(sample.date)-1);
  return Math.floor((dayNumber(date)-monday)/7)+sample.week;
}
export function applyEveningStudy(courses,date,options={}) {
  const {className,sectionTimes={},semesterInfo}=options;
  const base=courses.filter(course=>!(course.source==='evening-study'&&course.date===date&&course.className===className));
  const description=describeEveningStudy(base,date,options);
  if(!description.scheduled||!description.availableSections.length)return [...base];
  const {profile,override,status,season,attendance}=description;
  const sections=description.availableSections,startSection=sections[0],endSection=sections.at(-1);
  const id=`evening-study:${className}:${date}:${startSection}-${endSection}`;
  const label=status==='normal'?'晚自习':status==='other'?'晚自习特殊安排':status==='pending'?'晚自习 · 请假待确认':'晚自习已请假';
  const title=status==='other'?(override?.title||'晚自习特殊安排'):status==='normal'?(override?.title||'晚自习'):label;
  const row={source:'evening-study',courseId:id,id,className,date,week:courseWeek(date,base,semesterInfo),weekday:getWeekday(date),
    courseName:title,title,teacher:'',location:override?.location||profile.location,season,startSection,endSection,startSectionRaw:startSection,endSectionRaw:endSection,
    studyStatus:status,studyLabel:label,studyAttendance:attendance,studyArrangementTitle:override?.title||'',studyNote:override?.note||profile.note,note:override?.note||profile.note,
    studyActivityId:override?.activityId||'',activityId:override?.activityId||'',studyPersonalRecord:true};
  row.segments=getCourseSegments(row,sectionTimes);
  if(!row.segments.length)return [...base];
  row.startDateTime=row.segments[0].start;row.endDateTime=row.segments.at(-1).end;
  row.startTime=row.segments[0].startTime;row.endTime=row.segments.at(-1).endTime;
  return [...base,row].sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||
    (a.startDateTime instanceof Date&&Number.isFinite(+a.startDateTime)?+a.startDateTime:Infinity)-(b.startDateTime instanceof Date&&Number.isFinite(+b.startDateTime)?+b.startDateTime:Infinity));
}
