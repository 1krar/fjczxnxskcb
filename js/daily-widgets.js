import { readDailyData, DAILY_KEY } from './daily-store.js?v=20261021-5';
import { itemsForScope, escapeText as esc, dateLabel } from './tasks-store.js?v=20261021-5';
import { buildAdvice, chooseAdvice, outfitRecommendation, departurePlan, localDate, nextDate, dailyFacts } from './daily-model.js?v=20261021-5';
import { scopedActivities, AGENDA_KEY } from './agenda-store.js?v=20261021-5';
import { aiEnabled, AI_KEY, cachedDaily, dailyIdentity, requestDaily } from './ai-client.js?v=20261021-5';

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
  let preparationMode = null;
  let disposed = false, busyKey = '', currentKey = '', aiNote = '', memoryEntry = null;
  const settled = new Set();
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
    let items = [];
    let note = '';
    try { items = itemsForScope(context.scope); } catch { note = '个人事项暂时无法读取，本句未使用截止信息。'; }
    let activities = [];
    try { activities = scopedActivities(context.scope); } catch { note += ' 日程暂时无法读取，本句未使用活动信息。'; }
    advice.hidden = !data.profile.enabled;
    if (data.profile.enabled) {
      const pool = buildAdvice({ ...context, data, items, activities });
      const useAI = aiEnabled('daily');
      const facts = dailyFacts({ ...context, items, activities });
      const key = dailyIdentity(context.scope, context.today, facts);
      if (key !== currentKey) { currentKey = key; aiNote = ''; }
      const entry = useAI ? (memoryEntry?.key === key ? memoryEntry : cachedDaily(key)) : null;
      const shouldRequest = useAI && busyKey !== key && (refresh || !entry && !settled.has(key));
      if (shouldRequest) { busyKey = key; settled.add(key); }
      const local = chooseAdvice(pool, `${context.scope.semester}|${context.scope.className}`, now, data.profile.refreshPerMinute, refresh && !useAI);
      const chosen = entry ? { id:'ai', priority:10, line:entry.sentence, basis:entry.basisIds.map(id => facts.find(fact=>fact.id===id)?.text || '').join(' '), href:'#/agenda' } : local;
      const shownItem = [...container.querySelectorAll('[data-personal-id]')].some(row => chosen.id.startsWith(`item:${row.dataset.personalId}:`));
      const prominent = chosen.priority >= 80 && !shownItem;
      const feedback = local.limited ? `这分钟已经换了${data.profile.refreshPerMinute}次，约${local.retrySeconds}秒后可以再换。` : aiNote || local.storageWarning || '';
      const content = `<p class="daily-sentence">${esc(chosen.line)}</p>
        <details class="daily-inline-tools" data-detail="advice-tools"><summary>${entry ? '千问 AI' : '本地内容'} · 依据与换句</summary><p class="daily-small">${esc(chosen.basis)}</p>
        <div class="daily-inline-actions"><button type="button" class="daily-text-button" data-refresh-advice ${busyKey === key ? 'disabled' : ''}>${busyKey === key ? '生成中…' : '换一句'}</button><a class="daily-link" href="${chosen.href}">去看看 →</a><a class="daily-link" href="#/api">AI 设置</a></div><p class="daily-small">${useAI ? '每日自动生成一次；记录变化后可手动换句。AI各功能合计每分钟最多2次。' : `随日期与记录更新；每分钟最多换${data.profile.refreshPerMinute}次。AI尚未启用时使用本地内容。`}</p></details>
        ${note ? `<p class="daily-error">${esc(note)}</p>` : ''}<p class="daily-feedback" role="status">${esc(feedback)}</p>`;
      update(advice, prominent ? `<div class="daily-context-note">${content}</div>` : `<details class="daily-quiet-note" data-detail="advice"><summary>${shownItem ? '这件事的准备建议' : '今日一句'}</summary>${content}</details>`);
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

    const night = now.getHours() >= 18 || now.getHours() < 6;
    if (preparationMode !== night) { preparation.open = night; preparationMode = night; }
    const preparingToday = now.getHours() < 6;
    const date = preparingToday ? context.today : context.tomorrow;
    const courses = preparingToday ? context.courses : context.tomorrowCourses;
    const future = dm.getCourses(state.currentClass).filter(course => course.date > date && course.date <= nextDate(date, 2));
    const fit = outfitRecommendation(data, date, courses, future);
    const first = fit.sets[0];
    const hasGarments = data.garments.some(item => !item.deletedAt);
    const due = items.filter(item => !item.completedAt && !item.deletedAt && !item.needsConfirmation && item.dueDate === date);
    const departure = departurePlan(courses[0], data.profile);
    update(preparation, `<summary><span class="preparation-title">${preparingToday ? '今日出门准备' : '明日准备'}</span><span class="preparation-summary">${date.slice(5)} · 物品与穿衣<span class="course-list-chevron" aria-hidden="true"></span></span></summary>
      <div class="preparation-body">${!courses.length ? '<p class="daily-muted">这天课表上无课，个人安排可以在待办里查看。</p>' : ''}
      ${departure ? `<p class="daily-muted">${esc(departure.text)}</p><p class="daily-small">${esc(departure.basis)}</p>` : ''}
      ${due.length ? `<div class="preparation-items"><h2>已记下的事项</h2>${due.slice(0, 3).map(item => `<a href="#/tasks"><span>${esc(item.text)}</span><span class="daily-small">${esc(dateLabel(item, context.today))}</span></a>`).join('')}${due.length > 3 ? `<a class="daily-link" href="#/tasks">查看全部${due.length}条 →</a>` : ''}</div>` : ''}
      <div class="preparation-outfit"><h2>${preparingToday ? '今天' : '明日'}穿衣${fit.pe ? ' · 有体育课' : ''}${fit.run ? ' · 已安排校园跑' : ''}</h2>
      ${hasGarments ? first ? `<p class="daily-fit-preview">${first.pieces.map(item => esc(item.name)).join(' ＋ ')}</p><p class="daily-muted">${esc(first.reasons[0])}</p>` : `<p class="daily-muted">${esc(fit.missing[0] || '先检查一下可穿单品。')}</p>` : '<p class="daily-muted">录几件常穿衣服，就能结合活动和洗晒状态选搭配。</p>'}
      ${hasGarments ? '<p class="daily-small">当前未使用天气预报，出门前请结合实际温度调整。</p>' : ''}<a class="daily-link" href="#/wardrobe">${hasGarments ? '查看搭配与洗晒 →' : '录几件常穿衣服 →'}</a></div></div>`);
  }
  const click = event => { if (event.target.closest('[data-refresh-advice]')) render(true); };
  const changed = () => render();
  const storage = event => { if ([DAILY_KEY, AGENDA_KEY, AI_KEY, 'course-dashboard-personal-items-v1', null].includes(event.key)) render(); };
  const tick = event => {
    const now = event.detail?.now || new Date();
    const minute = Math.floor(+now / 60000);
    if (minute !== lastMinute) { lastMinute = minute; render(false, now); }
  };
  advice.addEventListener('click', click);
  document.addEventListener('app:tick', tick);
  window.addEventListener('daily:changed', changed);
  window.addEventListener('personal-items:changed', changed);
  window.addEventListener('agenda:changed', changed);
  window.addEventListener('ai:changed', changed);
  window.addEventListener('storage', storage);
  render();
  return () => {
    disposed = true;
    advice.removeEventListener('click', click);
    document.removeEventListener('app:tick', tick);
    window.removeEventListener('daily:changed', changed);
    window.removeEventListener('personal-items:changed', changed);
    window.removeEventListener('agenda:changed', changed);
    window.removeEventListener('ai:changed', changed);
    window.removeEventListener('storage', storage);
  };
}
