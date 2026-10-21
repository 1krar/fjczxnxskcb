import { escapeText as esc } from './tasks-store.js?v=20261021-9';
export function segmentMarkup(course, collapsible = true) {
  if (!course.segments?.length) return '<p class="agenda-muted">小节作息待核对</p>';
  const content = `<ol class="course-segments">${course.segments.map(part => `<li class="${part.kind === 'break' ? 'is-break' : ''}"><time>${esc(part.startTime)}—${esc(part.endTime)}</time><span>${part.kind === 'break' ? `课间 ${Math.round((part.end-part.start)/60000)} 分钟` : `第 ${part.section} 节`}</span></li>`).join('')}</ol>`;
  return collapsible ? `<details class="course-segments-details"><summary>小节与课间</summary>${content}</details>` : content;
}
