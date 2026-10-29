import { selectedWear } from './wear-store.js?v=20261029-3';
import { notesForCourse } from './persistent-model.js?v=20261029-3';
import { renderContextNotes } from './context-notes.js?v=20261029-3';
import { readDailyData, saveDailyProfile, DAILY_KEY } from './daily-store.js?v=20261029-3';
import { itemsForScope, escapeText as esc, dateLabel } from './tasks-store.js?v=20261029-3';
import { buildAdvice, chooseAdvice, planOutfits, plannedOutfit, departurePlan, localDate, nextDate, dailyFacts, shortAdvice } from './daily-model.js?v=20261029-3';
import { cachedWeather } from './weather-client.js?v=20261029-3';
import { weatherSummary } from './weather-model.js?v=20261029-3';
import { scopedActivities, AGENDA_KEY } from './agenda-store.js?v=20261029-3';
import { aiEnabled, AI_KEY, DAILY_CACHE_KEY, cachedDaily, dailyIdentity, requestDaily, canRequestDaily, dailyWaitMessage } from './ai-client.js?v=20261029-3';
import { adviceVisibility, changeAdviceVisibility, ADVICE_VISIBILITY_KEY } from './daily-visibility.js?v=20261029-3';
import { setupSwipeDismiss } from './swipe-dismiss.js?v=20261029-3';

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
  advice.className = 'daily-advice daily-advice-inline';
  advice.setAttribute('aria-label', '今日一句');
  container.querySelector('#dash-advice-slot').append(advice);
  const preparation = document.createElement('details');
  preparation.className = 'daily-tomorrow today-preparation';
  container.querySelector('#dash-prep-slot').append(preparation);
  let lastMinute = -1;
  const restore = container.querySelector('[data-restore-advice]');
  const live = container.querySelector('#dash-advice-status');
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
      preparation.hidden = true;
      return;
    }
    preparation.hidden = false;
    const weather=cachedWeather(data.profile.city);
    let items = [];
    let note = '';
    try { items = itemsForScope(context.scope); } catch { note = '个人事项暂时无法读取，本句未使用截止信息。'; }
    let activities = [];
    try { activities = scopedActivities(context.scope); } catch { note += ' 日程暂时无法读取，本句未使用活动信息。'; }
    let visibility = { hidden:false };
    try { visibility = adviceVisibility(context.scope, context.today); } catch (error) { note += ` ${error.message}`; }
    advice.hidden = !data.profile.enabled || visibility.hidden;
    restore.hidden = !advice.hidden;
    if (!advice.hidden) {
      const pool = buildAdvice({ ...context, data, items, activities, weather });
      const useAI = aiEnabled('daily');
      const facts = dailyFacts({ ...context, items, activities, weather });
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
        requestDaily(key, facts, refresh, weather).then(value => {
          if (disposed || currentKey !== key) return;
          if (value) { memoryEntry = value; aiNote = ''; }
        }).catch(error => { if (!disposed && currentKey === key) aiNote = `显示本地内容：${error.message}`; }).finally(() => {
          if (busyKey === key) busyKey = '';
          if (!disposed && currentKey === key) render();
        });
      }
    }

    const preparingToday = now.getHours() < 6;
    const date = preparingToday ? context.today : context.tomorrow;
    const courses = preparingToday ? context.courses : context.tomorrowCourses;
    const future = dm.getCourses(state.currentClass).filter(course => course.date > date && course.date <= nextDate(date, 2));
    const plan = planOutfits(data,date,courses,future,weather,now);
    const fit = plan.daily;
    const selected=selectedWear(data,date,'daily');
    const {pieces:selectedPieces,usable:selectionReady}=plannedOutfit(data,selected,fit);
    const first = selectionReady?{pieces:selectedPieces,reasons:['你为这天选的计划；实际穿过后可到衣橱确认。']}:fit.sets[0];
    const hasGarments = data.garments.some(item => !item.deletedAt);
    const due = items.filter(item => item.reminderMode !== 'persistent' && !item.completedAt && !item.deletedAt && !item.needsConfirmation && item.dueDate === date);
    const prepNotes=[...new Map(courses.flatMap(course=>notesForCourse(items,course,{now,view:'prepare'})).map(item=>[item.id,item])).values()];
    const departure = departurePlan(courses[0], data.profile);
    update(preparation, `<summary><span class="preparation-title">${preparingToday ? '今日出门准备' : '明日准备'}</span><span class="preparation-summary">${plan.weather?esc(weatherSummary(plan.weather)):date.slice(5)+' · 物品与穿衣'}<span class="course-list-chevron" aria-hidden="true"></span></span>${first?`<span class="preparation-fit-line">${first.pieces.map(item=>esc(item.name)).join(' ＋ ')}${plan.sportNeeded?' · 另看运动准备':''}</span>`:''}</summary>
      <div class="preparation-body">${!courses.length ? '<p class="daily-muted">这天课表上无课，个人安排可以在待办里查看。</p>' : ''}
      ${departure ? `<p class="daily-muted">${esc(departure.text)}</p><p class="daily-small">${esc(departure.basis)}</p>` : ''}
      ${renderContextNotes(prepNotes,'prepare')}
      ${due.length ? `<div class="preparation-items"><h2>已记下的事项</h2>${due.slice(0, 3).map(item => `<a href="#/tasks"><span>${esc(item.text)}</span><span class="daily-small">${esc(dateLabel(item, context.today))}</span></a>`).join('')}${due.length > 3 ? `<a class="daily-link" href="#/tasks">查看全部${due.length}条 →</a>` : ''}</div>` : ''}
      <div class="preparation-outfit"><h2>${preparingToday ? '今天' : '明日'}穿衣${plan.sportNeeded ? ' · 有运动安排' : ''}</h2>
      ${selectedPieces.length&&!selectionReady?'<p class="daily-small">原计划不符合当前活动或可穿状态，以下是当前备选。</p>':''}
      ${hasGarments ? first ? `<p class="daily-fit-preview">${first.pieces.map(item => esc(item.name)).join(' ＋ ')}</p><p class="daily-muted">${esc(first.reasons[0])}</p>` : `<p class="daily-muted">${esc(fit.missing[0] || '先检查一下可穿单品。')}</p>` : '<p class="daily-muted">录几件常穿衣服，就能结合活动和洗晒状态选搭配。</p>'}
      ${plan.sport?`<p class="daily-muted">运动准备：${esc(plan.sport.sets[0]?.pieces.map(item=>item.name).join(' ＋ ')||plan.sport.missing[0]||'查看衣橱')}。</p><p class="daily-small">${esc(plan.changeNote)}</p>`:''}
      ${plan.conditional.length?'<p class="daily-small">另有待收衣备选，干透后再确认使用。</p>':''}
      <p class="daily-small">${plan.weather?esc(`${plan.weather.location} ${plan.weather.from}—${plan.weather.to}预报参考；${fit.notes[0]}`):'天气尚未更新，出门前结合实际冷暖调整。'}</p><a class="daily-link" href="#/wardrobe">${hasGarments ? '查看搭配与洗晒 →' : '录几件常穿衣服 →'}</a></div></div>`);
  }
  function visibilityAction(action) {
    try {
      const context = getContext(state, dm, new Date());
      changeAdviceVisibility(context.scope, context.today, action);
      if (action === 'restore' && !readDailyData().profile.enabled) saveDailyProfile({ enabled:true });
      render();
      live.className = 'sr-only';
      live.textContent = action === 'restore' ? '已恢复每日一句' : action === 'off' ? '每日一句已关闭，可从日期栏恢复；日程提醒不受影响。' : '今天已隐藏每日一句，次日恢复；日程提醒不受影响。';
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
  const storage = event => { if ([DAILY_KEY, AGENDA_KEY, AI_KEY, DAILY_CACHE_KEY, ADVICE_VISIBILITY_KEY, 'course-dashboard-personal-items-v1', null].includes(event.key)) render(); };
  const tick = event => {
    const now = event.detail?.now || new Date();
    const minute = Math.floor(+now / 60000);
    if (minute !== lastMinute) { lastMinute = minute; render(false, now); }
  };
  container.addEventListener('click', click);
  document.addEventListener('app:tick', tick);
  document.addEventListener('visibilitychange', resumed);
  window.addEventListener('daily:changed', changed);
  window.addEventListener('personal-items:changed', changed);
  window.addEventListener('agenda:changed', changed);
  window.addEventListener('ai:changed', changed);
  window.addEventListener('online', changed);
  window.addEventListener('daily-ai:changed', changed);
  window.addEventListener('weather:changed', changed);
  window.addEventListener('storage', storage);
  render();
  return () => {
    disposed = true;
    cleanupSwipe();
    container.removeEventListener('click', click);
    document.removeEventListener('app:tick', tick);
    document.removeEventListener('visibilitychange', resumed);
    window.removeEventListener('daily:changed', changed);
    window.removeEventListener('personal-items:changed', changed);
    window.removeEventListener('agenda:changed', changed);
    window.removeEventListener('ai:changed', changed);
    window.removeEventListener('online', changed);
    window.removeEventListener('daily-ai:changed', changed);
    window.removeEventListener('weather:changed', changed);
    window.removeEventListener('storage', storage);
  };
}
