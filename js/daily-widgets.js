import { readDailyData, saveDailyProfile, DAILY_KEY } from './daily-store.js?v=20261030-1';
import { itemsForScope, escapeText as esc } from './tasks-store.js?v=20261030-1';
import { buildAdvice, chooseAdvice, localDate, nextDate, dailyFacts, shortAdvice } from './daily-model.js?v=20261030-1';
import { scopedActivities, AGENDA_KEY } from './agenda-store.js?v=20261030-1';
import { aiEnabled, AI_KEY, DAILY_CACHE_KEY, cachedDaily, dailyIdentity, requestDaily, canRequestDaily, dailyWaitMessage } from './ai-client.js?v=20261030-1';
import { adviceVisibility, changeAdviceVisibility, ADVICE_VISIBILITY_KEY } from './daily-visibility.js?v=20261030-1';
import { setupSwipeDismiss } from './swipe-dismiss.js?v=20261030-1';
import { readStudyData, STUDY_KEY } from './study-store.js?v=20261030-1';
import { applyEveningStudy } from './study-model.js?v=20261030-1';

function getContext(state, dm, now) {
  const today = localDate(now);
  const tomorrow = nextDate(today);
  const context={ now, today, tomorrow, courses: dm.getCoursesByDate(state.currentClass, today),
    tomorrowCourses: dm.getCoursesByDate(state.currentClass, tomorrow),
    futureCourses: dm.getCourses(state.currentClass).filter(course => course.date >= tomorrow && course.date <= nextDate(tomorrow, 7)),
    scope: { semester: dm.getSemesterInfo().semester, className: state.currentClass },studyCourses:[],tomorrowStudyCourses:[],studyNotice:'' };
  try {
    const info=dm.getSemesterInfo(),options={className:state.currentClass,studyData:readStudyData(),sectionTimes:dm.getSectionTimes(),seasonRule:info.seasonRule,semesterInfo:info};
    const attending=course=>course.source==='evening-study'&&course.studyAttendance!==false&&['normal','pending'].includes(course.studyStatus);
    context.studyCourses=applyEveningStudy(context.courses,today,{...options,nextDayCourses:context.tomorrowCourses}).filter(attending);
    context.tomorrowStudyCourses=applyEveningStudy(context.tomorrowCourses,tomorrow,{...options,nextDayCourses:dm.getCoursesByDate(state.currentClass,nextDate(tomorrow))}).filter(attending);
  } catch { context.studyNotice='晚自习资料暂时无法读取，当前建议暂未纳入晚自习安排。'; }
  return context;
}

export function mountDailyAssistant(container, state, dm) {
  const slot=container.querySelector('#dash-advice-slot');
  if(state.isMobile)document.querySelector('.mobile-header')?.append(slot);
  const advice = document.createElement('section');
  advice.className = 'daily-advice daily-advice-inline';
  advice.setAttribute('aria-label', '今日一句');
  slot.append(advice);
  let lastMinute = -1;
  const restore = slot.querySelector('[data-restore-advice]');
  const live = slot.querySelector('#dash-advice-status');
  let disposed = false, busyKey = '', currentKey = '', aiNote = '', memoryEntry = null;
  const markup = new Map();
  function update(element, html) {
    if (markup.get(element) === html) return;
    const opened = new Set([...element.querySelectorAll('details[open][data-detail]')].map(detail => detail.dataset.detail));
    element.innerHTML = html;
    element.querySelectorAll('details[data-detail]').forEach(detail => { if (opened.has(detail.dataset.detail)) detail.open = true; });
    markup.set(element, html);
  }

  function render(refresh = false, now = new Date()) {
    const retainFocus = document.activeElement?.matches('[data-refresh-advice]');
    const context = getContext(state, dm, now);
    let data;
    try { data = readDailyData(); }
    catch (error) {
      advice.hidden = false;
      update(advice, `<p class="daily-error">${esc(error.message)}</p><a class="daily-link" href="#/wardrobe">检查日常资料与备份 →</a>`);
      return;
    }
    let items = [];
    let note = context.studyNotice;
    try { items = itemsForScope(context.scope); } catch { note += ' 个人事项暂时无法读取，本句未使用截止信息。'; }
    let activities = [];
    try { activities = scopedActivities(context.scope); } catch { note += ' 日程暂时无法读取，本句未使用活动信息。'; }
    let visibility = { hidden:false };
    try { visibility = adviceVisibility(context.scope, context.today); } catch (error) { note += ` ${error.message}`; }
    advice.hidden = !data.profile.enabled || visibility.hidden;
    restore.hidden = !advice.hidden;
    if (!advice.hidden) {
      const pool = buildAdvice({ ...context, data, items, activities });
      const useAI = aiEnabled('daily');
      const facts = dailyFacts({ ...context, items, activities });
      const key = dailyIdentity(context.scope, context.today, facts);
      if (key !== currentKey) { currentKey = key; aiNote = ''; }
      const cached = useAI ? (memoryEntry?.key === key ? memoryEntry : cachedDaily(key)) : null;
      const entry = cached && shortAdvice(cached.sentence) ? cached : null;
      const shouldRequest = useAI && !busyKey && (refresh || !entry) && canRequestDaily(key, refresh);
      if (refresh && useAI && !shouldRequest && !busyKey) aiNote = dailyWaitMessage(key);
      if (shouldRequest) busyKey = key;
      const local = chooseAdvice(pool, `${context.scope.semester}|${context.scope.className}`, now, data.profile.refreshPerMinute, refresh && !useAI);
      const chosen = entry ? { id:'ai', priority:10, line:entry.sentence, basis:entry.basisIds.map(id => facts.find(fact=>fact.id===id)?.text || '').join(' ') || '轻量日常评论，未引用个人安排。', href:'#/agenda' } : local;
      const feedback = local.limited ? `这分钟已经换了${data.profile.refreshPerMinute}次，约${local.retrySeconds}秒后可以再换。` : aiNote || local.storageWarning || '';
      const content = `<details class="daily-banner-details" data-detail="advice-tools"><summary aria-label="今日一句：${esc(chosen.line)}，展开操作与依据"><span class="daily-sentence">${esc(chosen.line)}</span></summary>
        <div class="daily-banner-tools"><div class="daily-inline-actions"><button type="button" class="daily-text-button" data-refresh-advice ${busyKey === key ? 'disabled' : ''}>${busyKey === key ? '生成中…' : '换一句'}</button><a class="daily-link" href="${chosen.href}">相关安排</a><a class="daily-link" href="#/api">AI 设置</a><button type="button" class="daily-text-button" data-disable-advice>不再显示</button></div>
        <p class="daily-small">${entry ? '千问 AI' : '当前记录生成'} · ${esc(chosen.basis)}</p><p class="daily-small">${useAI ? '每日自动生成一次；重要记录变化后先显示当前短句，可手动换句。AI各功能合计每分钟最多2次。' : `随日期与记录更新；每分钟最多换${data.profile.refreshPerMinute}次。`}</p>
        ${note ? `<p class="daily-error">${esc(note)}</p>` : ''}<p class="daily-feedback" role="status">${esc(feedback)}</p></div></details><button type="button" class="daily-banner-close" data-hide-advice aria-label="今天隐藏每日一句">×</button>`;
      update(advice, content);
      if (retainFocus) advice.querySelector('[data-refresh-advice]')?.focus({ preventScroll: true });
      if (shouldRequest) {
        requestDaily(key, facts, refresh).then(value => {
          if (disposed || currentKey !== key) return;
          if (value) { memoryEntry = value; aiNote = ''; }
        }).catch(error => { if (!disposed && currentKey === key) aiNote = `显示本地内容：${error.message}`; }).finally(() => {
          if (busyKey === key) busyKey = '';
          if (!disposed && currentKey === key) render();
        });
      }
    }

  }
  function visibilityAction(action) {
    try {
      const context = getContext(state, dm, new Date());
      changeAdviceVisibility(context.scope, context.today, action);
      if (action === 'restore' && !readDailyData().profile.enabled) saveDailyProfile({ enabled:true });
      render();
      live.className = 'sr-only';
      live.textContent = action === 'restore' ? '已恢复每日一句' : action === 'off' ? '每日一句已关闭，可从标题栏恢复；日程提醒不受影响。' : '今天已隐藏每日一句，次日恢复；日程提醒不受影响。';
      (action === 'restore' ? advice.querySelector('summary') : restore)?.focus({ preventScroll:true });
    } catch (error) { live.className = 'daily-action-error'; live.textContent = error.message; }
  }
  const click = event => {
    if (event.target.closest('[data-refresh-advice]')) render(true);
    else if (event.target.closest('[data-hide-advice]')) visibilityAction('today');
    else if (event.target.closest('[data-disable-advice]')) visibilityAction('off');
    else if (event.target.closest('[data-restore-advice]')) visibilityAction('restore');
  };
  const cleanupSwipe = setupSwipeDismiss(advice, () => visibilityAction('today'));
  const changed = () => render();
  const resumed = () => { if (!document.hidden) render(); };
  const storage = event => { if ([DAILY_KEY, AGENDA_KEY, STUDY_KEY, AI_KEY, DAILY_CACHE_KEY, ADVICE_VISIBILITY_KEY, 'course-dashboard-personal-items-v1', null].includes(event.key)) render(); };
  const tick = event => {
    const now = event.detail?.now || new Date();
    const minute = Math.floor(+now / 60000);
    if (minute !== lastMinute) { lastMinute = minute; render(false, now); }
  };
  slot.addEventListener('click', click);
  document.addEventListener('app:tick', tick);
  document.addEventListener('visibilitychange', resumed);
  window.addEventListener('daily:changed', changed);
  window.addEventListener('personal-items:changed', changed);
  window.addEventListener('agenda:changed', changed);
  window.addEventListener('study:changed', changed);
  window.addEventListener('ai:changed', changed);
  window.addEventListener('online', changed);
  window.addEventListener('daily-ai:changed', changed);
  window.addEventListener('storage', storage);
  render();
  return () => {
    disposed = true;
    cleanupSwipe();
    slot.removeEventListener('click', click);
    slot.remove();
    document.removeEventListener('app:tick', tick);
    document.removeEventListener('visibilitychange', resumed);
    window.removeEventListener('daily:changed', changed);
    window.removeEventListener('personal-items:changed', changed);
    window.removeEventListener('agenda:changed', changed);
    window.removeEventListener('study:changed', changed);
    window.removeEventListener('ai:changed', changed);
    window.removeEventListener('online', changed);
    window.removeEventListener('daily-ai:changed', changed);
    window.removeEventListener('storage', storage);
  };
}
