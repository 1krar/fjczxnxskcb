import { getCurrentWeek, getWeekDates } from './time.js';
import { showCourseDetail } from './app.js';

let tickHandler = null;
let compareState = { week: 1, classes: [null, null, null] };

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

    const dayNames = ['周一', '周二', '周三', '周四', '周五'];
    const sectionPairs = [[1,2],[3,4],[5,6],[7,8],[9,10]];

    html += `<div class="card table-scroll" style="padding:0;overflow:hidden;"><table class="stat-table sticky-table" style="min-width:600px;">`;
    html += `<thead><tr><th>节次</th>`;
    for (let i = 0; i < 3; i++) {
      html += `<th>${compareState.classes[i] || '—'}</th>`;
    }
    html += `</tr></thead><tbody>`;

    for (const [s, e] of sectionPairs) {
      html += `<tr>`;
      html += `<td class="compare-cell-label">第${s}-${e}节</td>`;
      for (let i = 0; i < 3; i++) {
        const className = compareState.classes[i];
        if (!className) { html += `<td></td>`; continue; }
        const courses = dm.getCoursesByWeek(className, week).filter(c =>
          c.weekday === undefined || c.weekday === null ? false : true
        );
        const dayCourses = {};
        for (let d = 1; d <= 5; d++) {
          dayCourses[d] = dm.getCoursesByWeekday(className, week, d);
        }
        const matching = [];
        for (let d = 1; d <= 5; d++) {
          const course = dayCourses[d].find(c => c.startSection <= e && c.endSection >= s);
          if (course) matching.push(course);
        }
        html += `<td>`;
        if (matching.length > 0) {
          html += matching.map(c => `<div class="compare-course" title="${c.courseName} · ${c.location || ''}">${c.courseName}</div>`).join('');
        } else {
          html += `<span class="compare-course empty">—</span>`;
        }
        html += `</td>`;
      }
      html += `</tr>`;
    }

    html += `</tbody></table></div>`;

    html += `<div class="analytics-grid" style="margin-top:24px;">`;
    for (let i = 0; i < 3; i++) {
      const className = compareState.classes[i];
      if (!className) continue;
      const stats = dm.getWeekStats(className, week);
      const freeTime = dm.getFreeTimeSummary(className, week);
      html += `
        <div class="analytics-card">
          <div class="analytics-card-title">${className}</div>
          <div class="weekly-load">
            <div class="load-stat">
              <div class="load-stat-value">${stats.courseCount}</div>
              <div class="load-stat-label">课程</div>
            </div>
            <div class="load-stat">
              <div class="load-stat-value">${stats.totalSections}</div>
              <div class="load-stat-label">节次</div>
            </div>
            <div class="load-stat">
              <div class="load-stat-value">${freeTime.totalFreeHours}<span style="font-size:14px;">小时</span></div>
              <div class="load-stat-label">无课</div>
            </div>
          </div>
        </div>`;
    }
    html += `</div>`;

    return html;
  }

  container.innerHTML = buildHTML();

  container.querySelectorAll('.compare-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      compareState.classes[idx] = e.target.value;
      container.innerHTML = buildHTML();
      attachEvents();
    });
  });

  function attachEvents() {
    const prevBtn = container.querySelector('#compare-prev');
    const nextBtn = container.querySelector('#compare-next');
    if (prevBtn) prevBtn.addEventListener('click', () => {
      if (compareState.week > 1) { compareState.week--; container.innerHTML = buildHTML(); attachEvents(); }
    });
    if (nextBtn) nextBtn.addEventListener('click', () => {
      if (compareState.week < info.lastWeek) { compareState.week++; container.innerHTML = buildHTML(); attachEvents(); }
    });
    container.querySelectorAll('.compare-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        compareState.classes[idx] = e.target.value;
        container.innerHTML = buildHTML();
        attachEvents();
      });
    });
  }

  attachEvents();

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
