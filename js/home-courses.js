import { notesForCourse } from './persistent-model.js?v=20261023-4b';
import { renderContextNotes } from './context-notes.js?v=20261023-4b';
import { getUpcomingCourseGroups, courseKey, formatMinutes } from './day-plan.js?v=20261023-4b';
import { escapeText as esc } from './tasks-store.js?v=20261023-4b';
import { formatLocation } from './location.js?v=20261023-4b';

export function courseListCount(courses,now) {
  const value=getUpcomingCourseGroups(courses,now), timed=value.groups.length-value.unknownCount;
  return `${timed}次${value.lessonCount?` · ${value.lessonCount}小节`:''}${value.unknownCount?` · ${value.unknownCount}次时间待定`:''}`;
}
export function courseContinuation(course,segment,now) {
  if (!course?.endTime || !course.segments?.length) return '';
  const next=course.segments.find(part=>part.kind==='lesson'&&part.start>now&&part!==segment);
  // Before the first lesson, list the second lesson rather than repeating the first.
  const continuing=segment?.kind==='lesson'?next:segment?.kind==='break'?null:course.segments.filter(part=>part.kind==='lesson')[1];
  return `${continuing?`${continuing.startTime}继续第${continuing.section}小节 · `:''}${course.endTime}本次课结束`;
}
export function renderUpcomingCourses(courses,now,state,expanded=true,opened=new Set(),items=[]) {
  const model=getUpcomingCourseGroups(courses,now);
  const clock=date=>`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
  const rows=model.groups.map((row,index)=>{
    const course=row.course,key=courseKey(course);
    const gap=model.gaps.find(gap=>gap.nextCourse===course);
    const segments=course.segments||[],notes=notesForCourse(items,course,{now,view:'detail'});
    return `${gap?`<p class="course-gap-note"${!expanded&&index>0?' hidden':''}>课表空档 ${clock(gap.start)}—${clock(gap.end)} · ${formatMinutes(gap.durationMin)}</p>`:''}<details class="upcoming-course" data-course-detail="${esc(key)}"${opened.has(key)?' open':''}${!expanded&&index>0?' hidden':''}><summary>
      <span class="upcoming-time mono">${row.unknown?'时间待定':esc(course.startTime)}${!row.unknown?`<small>${esc(course.endTime)}</small>`:''}</span>
      <span class="upcoming-content"><strong>${esc(course.courseName)}</strong><span class="upcoming-location">${esc(formatLocation(course.location,state.settings.showFullLocation)||'教室待确认')}</span><span class="upcoming-sections">${row.unknown?'时间信息待确认':`第${course.startSection}—${course.endSection}小节`}${notes.length?` · 常记${notes.length}`:''}</span></span><span class="course-list-chevron" aria-hidden="true"></span>
    </summary><div class="upcoming-detail">${renderContextNotes(notes,key)}${!row.unknown&&segments.length?`<ol class="course-segment-list">${segments.map(part=>`<li class="${part.kind==='break'?'is-break':''}"><span class="mono">${esc(part.startTime)}—${esc(part.endTime)}</span><span>${part.kind==='break'?'课间':`第${part.section}小节`}</span></li>`).join('')}</ol>`:row.unknown?'<p>原记录的时间未确认，尚未计入后续小节数。</p>':'<p>此记录仅有整次课时段，尚无小节明细。</p>'}${course.teacher&&state.settings.showTeacher?`<p>${esc(course.teacher)}</p>`:''}<button type="button" class="daily-text-button" data-course-key="${esc(key)}">课程详情 →</button></div></details>`;
  }).join('');
  const history=model.past.length?`<details class="course-history" data-course-detail="history"${opened.has('history')?' open':''}><summary>已结束 ${model.past.length} 次课</summary>${model.past.map(course=>`<button type="button" class="history-course" data-course-key="${esc(courseKey(course))}"><span class="mono">${esc(course.startTime)}—${esc(course.endTime)}</span><span>${esc(course.courseName)}</span></button>`).join('')}</details>`:'';
  return `${rows}${!model.groups.length?`<p class="remaining-done">${model.focus?'上方这次课之后，今天没有其他课程。':'今天没有后续课程。'}</p>`:!expanded&&model.groups.length>1?`<p class="remaining-more">另有${model.groups.length-1}次课，展开查看</p>`:''}${history}<a class="personal-view-all" href="#/schedule">完整课表 →</a>`;
}
