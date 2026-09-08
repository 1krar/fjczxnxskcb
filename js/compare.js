import { getCurrentWeek, getWeekDates } from './time.js';
import { showCourseDetail } from './app.js';

let tickHandler = null;
let compareState = { week: 1, classes: [null, null, null], activeTab: 'stats' };

export function renderCompare(container, state, dm) {
  const info = dm.getSemesterInfo();
  const allClasses = dm.getClasses();

  if (compareState.week === 1) {
    compareState.week = Math.max(info.firstWeek, Math.min(info.lastWeek, getCurrentWeek(info.semesterStart)));
  }

  if (!compareState.classes[0]) {
    compareState.classes[0] = state.currentClass || allClasses[0]?.className || '';
  }
  if (!compareState.classes[1]) {
    const idx = allClasses.findIndex(c => c.className !== compareState.classes[0]);
    compareState.classes[1] = idx >= 0 ? allClasses[idx].className : allClasses[0]?.className || '';
  }
  if (!compareState.classes[2]) {
    const idx = allClasses.findIndex(c => c.className !== compareState.classes[0] && c.className !== compareState.classes[1]);
    compareState.classes[2] = idx >= 0 ? allClasses[idx].className : allClasses[0]?.className || '';
  }

  function buildHTML() {
    const week = compareState.week;
    const weekDates = getWeekDates(week, info.semesterStart);
    const isCurrentWeek = week === Math.max(1, getCurrentWeek(info.semesterStart));

    let html = `
      <div class="schedule-toolbar">
        <div class="week-nav">
          <button class="week-nav-btn" id="compare-prev" ${week <= 1 ? 'disabled' : ''}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <div class="week-info">
            <div class="week-info-main">第 ${week} 周</div>
            <div class="week-info-sub">${weekDates[0].slice(5)} — ${weekDates[4].slice(5)}</div>
          </div>
          <button class="week-nav-btn" id="compare-next" ${week >= info.lastWeek ? 'disabled' : ''}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
          ${!isCurrentWeek ? `<button class="week-today-btn" id="compare-today">回到本周</button>` : ''}
        </div>
      </div>

      <div class="compare-selector-row">`;

    for (let i = 0; i < 3; i++) {
      html += `
        <div class="compare-selector">
          <label>班级 ${String.fromCharCode(65 + i)}</label>
          <select class="compare-select" data-idx="${i}">
            ${allClasses.map(c => `<option value="${c.className}" ${c.className === compareState.classes[i] ? 'selected' : ''}>${c.className}</option>`).join('')}
          </select>
        </div>`;
    }

    html += `</div>`;

    html += `
      <div class="tab-bar" id="compare-tabs">
        <button class="tab-bar-item ${compareState.activeTab === 'stats' ? 'active' : ''}" data-tab="stats">基础统计</button>
        <button class="tab-bar-item ${compareState.activeTab === 'courses' ? 'active' : ''}" data-tab="courses">课程覆盖</button>
        <button class="tab-bar-item ${compareState.activeTab === 'weekly' ? 'active' : ''}" data-tab="weekly">每周负担</button>
        <button class="tab-bar-item ${compareState.activeTab === 'freetime' ? 'active' : ''}" data-tab="freetime">空闲时间</button>
      </div>
      <div id="compare-content"></div>`;

    return html;
  }

  function renderContent() {
    const el = container.querySelector('#compare-content');
    if (!el) return;
    switch (compareState.activeTab) {
      case 'stats': el.innerHTML = renderStatsTab(dm); break;
      case 'courses': el.innerHTML = renderCoursesTab(dm); break;
      case 'weekly': el.innerHTML = renderWeeklyTab(dm, info); break;
      case 'freetime': el.innerHTML = renderFreetimeTab(dm); break;
    }
  }

  function renderStatsTab(dm) {
    const week = compareState.week;
    let html = `<div class="analytics-grid">`;

    for (let i = 0; i < 3; i++) {
      const cn = compareState.classes[i];
      if (!cn) continue;
      const courses = dm.getCourses(cn);
      const courseStats = dm.getCourseStats(cn);
      const courseTypes = courseStats.length;
      const totalSessions = courseStats.reduce((s, c) => s + c.count, 0);
      const totalSections = courseStats.reduce((s, c) => s + c.totalSections, 0);
      const totalHours = courseStats.reduce((s, c) => s + c.totalHours, 0);
      const actualWeeks = info.lastWeek - info.firstWeek + 1;
      const avgHours = actualWeeks > 0 ? Math.round(totalHours / actualWeeks * 10) / 10 : 0;

      html += `
        <div class="analytics-card">
          <div class="analytics-card-title">${cn}</div>
          <div class="compare-stats-list">
            <div class="compare-stat-row"><span>课程种类</span><span class="mono">${courseTypes}</span></div>
            <div class="compare-stat-row"><span>上课次数</span><span class="mono">${totalSessions}</span></div>
            <div class="compare-stat-row"><span>总节数</span><span class="mono">${totalSections}</span></div>
            <div class="compare-stat-row"><span>总课时</span><span class="mono">${totalHours}h</span></div>
            <div class="compare-stat-row"><span>平均每周</span><span class="mono">${avgHours}h</span></div>
          </div>
        </div>`;
    }

    html += `</div>`;
    return html;
  }

  function renderCoursesTab(dm) {
    const allCourseNames = new Set();
    for (let i = 0; i < 3; i++) {
      const cn = compareState.classes[i];
      if (!cn) continue;
      const stats = dm.getCourseStats(cn);
      stats.forEach(s => allCourseNames.add(s.courseName));
    }

    const sortedNames = Array.from(allCourseNames).sort();
    let html = `
      <div class="card" style="padding:0;overflow:hidden;">
        <div class="table-scroll">
        <table class="stat-table sticky-table sticky-first-col" style="min-width:500px;">
          <thead><tr><th>课程名称</th>`;

    for (let i = 0; i < 3; i++) {
      html += `<th>${compareState.classes[i] || '—'}</th>`;
    }
    html += `</tr></thead><tbody>`;

    for (const name of sortedNames) {
      html += `<tr><td style="font-weight:600;white-space:nowrap;">${name}</td>`;
      for (let i = 0; i < 3; i++) {
        const cn = compareState.classes[i];
        if (!cn) { html += `<td></td>`; continue; }
        const stats = dm.getCourseStats(cn);
        const s = stats.find(x => x.courseName === name);
        if (s) {
          html += `<td class="mono">${s.count}次 · ${s.totalSections}节</td>`;
        } else {
          html += `<td class="muted">—</td>`;
        }
      }
      html += `</tr>`;
    }

    html += `</tbody></table></div></div>`;
    return html;
  }

  function renderWeeklyTab(dm, info) {
    let html = `
      <div class="card" style="padding:0;overflow:hidden;">
        <div class="table-scroll">
        <table class="stat-table sticky-table sticky-first-col" style="min-width:500px;">
          <thead><tr><th>周次</th>`;

    for (let i = 0; i < 3; i++) {
      html += `<th>${compareState.classes[i] || '—'}</th>`;
    }
    html += `</tr></thead><tbody>`;

    for (let w = info.firstWeek; w <= info.lastWeek; w++) {
      html += `<tr><td class="mono" style="font-weight:600;white-space:nowrap;">第${w}周</td>`;
      for (let i = 0; i < 3; i++) {
        const cn = compareState.classes[i];
        if (!cn) { html += `<td></td>`; continue; }
        const stats = dm.getWeekStats(cn, w);
        html += `<td class="mono">${stats.courseCount}课 · ${stats.totalSections}节 · ${stats.totalHours}h</td>`;
      }
      html += `</tr>`;
    }

    html += `</tbody></table></div></div>`;
    return html;
  }

  function renderFreetimeTab(dm) {
    const week = compareState.week;
    let html = `<div class="analytics-grid">`;

    for (let i = 0; i < 3; i++) {
      const cn = compareState.classes[i];
      if (!cn) continue;
      const summary = dm.getFreeTimeSummary(cn, week);
      const analysis = summary.days || [];
      const dayNames = ['周一', '周二', '周三', '周四', '周五'];

      let busiest = '', busiestVal = -1;
      let lightest = '', lightestVal = Infinity;
      for (const d of analysis) {
        const busyMin = 780 - d.totalFreeMin;
        if (busyMin > busiestVal) { busiestVal = busyMin; busiest = dayNames[d.weekday - 1]; }
        if (busyMin < lightestVal) { lightestVal = busyMin; lightest = dayNames[d.weekday - 1]; }
      }

      html += `
        <div class="analytics-card">
          <div class="analytics-card-title">${cn}</div>
          <div class="compare-stats-list">
            <div class="compare-stat-row"><span>本周无课</span><span class="mono">${summary.totalFreeHours}h</span></div>
            <div class="compare-stat-row"><span>最忙</span><span>${busiest || '—'}</span></div>
            <div class="compare-stat-row"><span>最轻松</span><span>${lightest || '—'}</span></div>
          </div>
        </div>`;
    }

    html += `</div>`;
    return html;
  }

  container.innerHTML = buildHTML();

  container.querySelectorAll('.tab-bar-item').forEach(tab => {
    tab.addEventListener('click', () => {
      compareState.activeTab = tab.dataset.tab;
      container.querySelectorAll('.tab-bar-item').forEach(t => t.classList.toggle('active', t === tab));
      renderContent();
    });
  });

  function attachEvents() {
    const prevBtn = container.querySelector('#compare-prev');
    const nextBtn = container.querySelector('#compare-next');
    const todayBtn = container.querySelector('#compare-today');
    if (prevBtn) prevBtn.addEventListener('click', () => {
      if (compareState.week > 1) { compareState.week--; container.innerHTML = buildHTML(); attachAll(); }
    });
    if (nextBtn) nextBtn.addEventListener('click', () => {
      if (compareState.week < info.lastWeek) { compareState.week++; container.innerHTML = buildHTML(); attachAll(); }
    });
    if (todayBtn) todayBtn.addEventListener('click', () => {
      compareState.week = Math.max(1, getCurrentWeek(info.semesterStart));
      container.innerHTML = buildHTML(); attachAll();
    });
    container.querySelectorAll('.compare-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        compareState.classes[idx] = e.target.value;
        container.innerHTML = buildHTML(); attachAll();
      });
    });
    container.querySelectorAll('.tab-bar-item').forEach(tab => {
      tab.addEventListener('click', () => {
        compareState.activeTab = tab.dataset.tab;
        container.querySelectorAll('.tab-bar-item').forEach(t => t.classList.toggle('active', t === tab));
        renderContent();
      });
    });
  }

  function attachAll() {
    attachEvents();
    renderContent();
  }

  attachAll();

  tickHandler = () => {};
  document.addEventListener('app:tick', tickHandler);

  return function cleanup() {
    document.removeEventListener('app:tick', tickHandler);
    tickHandler = null;
  };
}

export function cleanupCompare() {
  if (tickHandler) {
    document.removeEventListener('app:tick', tickHandler);
    tickHandler = null;
  }
}
