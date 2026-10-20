import { readDailyData, DAILY_KEY } from './daily-store.js?v=20261020-6';
import { itemsForScope, escapeText as esc } from './tasks-store.js?v=20261020-6';
import { buildAdvice, chooseAdvice, outfitRecommendation, localDate, nextDate } from './daily-model.js?v=20261020-6';

function getContext(state, dm, now) {
  const today = localDate(now);
  const tomorrow = nextDate(today);
  return { now, today, tomorrow, courses: dm.getCoursesByDate(state.currentClass, today),
    tomorrowCourses: dm.getCoursesByDate(state.currentClass, tomorrow),
    futureCourses: dm.getCourses(state.currentClass).filter(course => course.date >= tomorrow && course.date <= nextDate(tomorrow, 2)),
    scope: { semester: dm.getSemesterInfo().semester, className: state.currentClass } };
}

export function mountDailyAssistant(container, state, dm) {
  const advice = document.createElement('section');
  advice.className = 'daily-advice';
  advice.setAttribute('aria-label', '今日一句');
  container.querySelector('.today-body-grid').before(advice);
  const tomorrow = document.createElement('section');
  tomorrow.className = 'daily-tomorrow';
  container.querySelector('.today-priority').append(tomorrow);
  let lastMinute = -1;
  const markup = new Map();
  function update(element, html) {
    if (markup.get(element) === html) return;
    const explanationOpen = element.querySelector('details')?.open;
    element.innerHTML = html;
    if (explanationOpen && element.querySelector('details')) element.querySelector('details').open = true;
    markup.set(element, html);
  }

  function render(refresh = false, now = new Date()) {
    const retainFocus = document.activeElement?.matches('[data-refresh-advice]');
    const context = getContext(state, dm, now);
    let data;
    try { data = readDailyData(); }
    catch (error) {
      update(advice, `<h2>今日一句</h2><p class="daily-error">${esc(error.message)}</p><a href="#/wardrobe">检查日常资料与备份 →</a>`);
      update(tomorrow, '');
      return;
    }
    if (!data.profile.enabled) update(advice, '<div class="daily-heading"><h2>今日一句已收起</h2><a href="#/wardrobe">调整偏好 →</a></div>');
    else {
      let items = [];
      let note = '';
      try { items = itemsForScope(context.scope); } catch { note = '个人事项暂时无法读取，本句未使用作业截止信息。'; }
      const pool = buildAdvice({ ...context, data, items });
      const chosen = chooseAdvice(pool, `${context.scope.semester}|${context.scope.className}`, now, data.profile.refreshPerMinute, refresh);
      const feedback = chosen.limited ? `这分钟已经换了${data.profile.refreshPerMinute}次，约${chosen.retrySeconds}秒后可以再换。` : chosen.storageWarning || '';
      update(advice, `<div class="daily-heading"><h2>今日一句 <span>温柔朋友</span></h2><button type="button" class="daily-text-button" data-refresh-advice>换一句</button></div>
        <p class="daily-sentence">${esc(chosen.line)}</p>
        <div class="daily-advice-footer"><details><summary>为什么这样建议</summary><p>${esc(chosen.basis)}</p><p>随日期与已录入资料更新；换一句每分钟最多${data.profile.refreshPerMinute}次。<a href="#/wardrobe">调整生活偏好</a></p></details><a href="${chosen.href}">去看看 →</a></div>
        ${note ? `<p class="daily-error">${esc(note)}</p>` : ''}<p class="daily-feedback" role="status">${esc(feedback)}</p>`);
      if (retainFocus) advice.querySelector('[data-refresh-advice]')?.focus({ preventScroll: true });
    }
    const fit = outfitRecommendation(data, context.tomorrow, context.tomorrowCourses, context.futureCourses);
    const first = fit.sets[0];
    update(tomorrow, `<div class="daily-heading"><h2>明日穿衣</h2><span class="daily-date">${context.tomorrow.slice(5)}</span></div>
      ${data.garments.some(item => !item.deletedAt) ? first ? `<p class="daily-fit-preview">${first.pieces.map(item => esc(item.name)).join(' ＋ ')}</p><p class="daily-muted">${esc(first.reasons[0])}${fit.pe ? ' · 有体育课' : ''}${fit.run ? ' · 已安排校园跑' : ''}</p>` : `<p class="daily-muted">${esc(fit.missing[0] || '先检查一下可穿单品。')}</p>` : '<p class="daily-muted">勾选几件常穿衣服，就能结合活动和洗晒状态选搭配。</p>'}
      <p class="daily-small">当前未使用天气预报，记得结合实际温度调整。</p><a class="daily-link" href="#/wardrobe">${first ? '查看搭配与洗晒 →' : '打开小衣橱 →'}</a>`);
  }
  const click = event => { if (event.target.closest('[data-refresh-advice]')) render(true); };
  const changed = () => render();
  const storage = event => { if ([DAILY_KEY, 'course-dashboard-personal-items-v1', null].includes(event.key)) render(); };
  const tick = event => {
    const now = event.detail?.now || new Date();
    const minute = Math.floor(+now / 60000);
    if (minute !== lastMinute) { lastMinute = minute; render(false, now); }
  };
  advice.addEventListener('click', click);
  document.addEventListener('app:tick', tick);
  window.addEventListener('daily:changed', changed);
  window.addEventListener('storage', storage);
  render();
  return () => {
    advice.removeEventListener('click', click);
    document.removeEventListener('app:tick', tick);
    window.removeEventListener('daily:changed', changed);
    window.removeEventListener('storage', storage);
  };
}
