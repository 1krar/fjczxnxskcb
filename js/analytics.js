import { getCurrentWeek, formatDuration, getWeekDates } from './time.js';
import { showCourseDetail } from './app.js';

let tickHandler = null;
let activeTab = 'overview';

export function renderAnalytics(container, state, dm) {
  const info = dm.getSemesterInfo();

  container.innerHTML = `
    <div class="tab-bar" id="analytics-tabs">
      <button class="tab-bar-item ${activeTab === 'overview' ? 'active' : ''}" data-tab="overview">总览</button>
      <button class="tab-bar-item ${activeTab === 'courses' ? 'active' : ''}" data-tab="courses">课程统计</button>
      <button class="tab-bar-item ${activeTab === 'teachers' ? 'active' : ''}" data-tab="teachers">教师</button>
      <button class="tab-bar-item ${activeTab === 'rooms' ? 'active' : ''}" data-tab="rooms">教室</button>
      <button class="tab-bar-item ${activeTab === 'freetime' ? 'active' : ''}" data-tab="freetime">空闲时间</button>
    </div>
    <div id="analytics-content"></div>
  `;

  container.querySelectorAll('.tab-bar-item').forEach(tab => {
    tab.addEventListener('click', () => {
      activeTab = tab.dataset.tab;
      container.querySelectorAll('.tab-bar-item').forEach(t => t.classList.toggle('active', t === tab));
      renderContent();
    });
  });

  function renderContent() {
    const el = container.querySelector('#analytics-content');
    if (!el) return;

    const className = state.currentClass;
    const week = Math.max(info.firstWeek, Math.min(info.lastWeek, getCurrentWeek(info.semesterStart)));

    switch (activeTab) {
      case 'overview': el.innerHTML = renderOverview(dm, className, week, info); break;
      case 'courses': el.innerHTML = renderCourseStats(dm, className); attachCourseRowEvents(el, dm, className); break;
      case 'teachers': el.innerHTML = renderTeacherStats(dm, className); attachTeacherSearch(el, dm, className, state); break;
      case 'rooms': el.innerHTML = renderRoomStats(dm, className); attachRoomRowEvents(el, dm, className); break;
      case 'freetime': el.innerHTML = renderFreeTime(dm, className, week); break;
    }
  }

  renderContent();

  tickHandler = () => {};
  document.addEventListener('app:tick', tickHandler);

  return function cleanup() {
    document.removeEventListener('app:tick', tickHandler);
    tickHandler = null;
  };
}

export function cleanupAnalytics() {
  if (tickHandler) {
    document.removeEventListener('app:tick', tickHandler);
    tickHandler = null;
  }
}

function renderOverview(dm, className, week, info) {
  const totalWeeks = info.lastWeek;
  const actualClassWeeks = info.lastWeek - info.firstWeek + 1;
  const currentWeek = Math.max(1, getCurrentWeek(info.semesterStart));

  const totalProgress = Math.min(100, (currentWeek / totalWeeks) * 100);
  const actualProgress = currentWeek < info.firstWeek ? 0 :
    Math.min(100, ((currentWeek - info.firstWeek + 1) / actualClassWeeks) * 100);

  const weekStats = dm.getWeekStats(className, week);
  const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const maxDayCourses = Math.max(1, ...Object.values(weekStats.byDay).map(d => d.courses));

  return `
    <div class="analytics-grid">
      <div class="analytics-card">
        <div class="analytics-card-title">学期进度</div>
        <div class="semester-progress">
          <div class="progress-item">
            <div class="progress-item-header">
              <span class="progress-item-label">学期总进度</span>
              <span class="progress-item-value">${currentWeek} / ${totalWeeks} 周</span>
            </div>
            <div class="progress-bar"><div class="progress-bar-fill" style="width:${totalProgress}%"></div></div>
          </div>
          <div class="progress-item">
            <div class="progress-item-header">
              <span class="progress-item-label">实际上课周进度</span>
              <span class="progress-item-value">${currentWeek < info.firstWeek ? 0 : Math.min(actualClassWeeks, currentWeek - info.firstWeek + 1)} / ${actualClassWeeks} 周</span>
            </div>
            <div class="progress-bar"><div class="progress-bar-fill" style="width:${actualProgress}%"></div></div>
          </div>
        </div>
      </div>

      <div class="analytics-card">
        <div class="analytics-card-title">本周课程负荷</div>
        <div class="weekly-load">
          <div class="load-stat">
            <div class="load-stat-value">${weekStats.courseCount}</div>
            <div class="load-stat-label">课程</div>
          </div>
          <div class="load-stat">
            <div class="load-stat-value">${weekStats.totalSections}</div>
            <div class="load-stat-label">节次</div>
          </div>
          <div class="load-stat">
            <div class="load-stat-value">${weekStats.totalHours}<span style="font-size:16px;">小时</span></div>
            <div class="load-stat-label">教学时长</div>
          </div>
        </div>
        <div style="margin-top:16px;">
          <div style="font-size:13px;color:var(--color-text-secondary);margin-bottom:8px;">每日课程分布</div>
          ${Object.entries(weekStats.byDay).filter(([d]) => d <= 5).map(([day, stats]) => `
            <div class="stat-bar-row" style="margin-bottom:6px;">
              <span style="font-size:12px;width:32px;color:var(--color-text-secondary);">${dayNames[parseInt(day)-1]}</span>
              <div class="stat-bar"><div class="stat-bar-fill" style="width:${(stats.courses / maxDayCourses) * 100}%"></div></div>
              <span class="mono" style="font-size:12px;width:50px;text-align:right;color:var(--color-text-secondary);">${stats.courses}课 ${stats.sections}节</span>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
}

function renderCourseStats(dm, className) {
  const stats = dm.getCourseStats(className);
  if (stats.length === 0) return emptyState('暂无课程数据');

  return `
    <div class="card" style="padding:0;overflow:hidden;">
      <div class="table-scroll">
      <table class="stat-table sticky-table">
        <thead>
          <tr>
            <th>课程名称</th>
            <th>上课次数</th>
            <th>总节数</th>
            <th>总课时</th>
            <th>主要教师</th>
            <th>主要教室</th>
          </tr>
        </thead>
        <tbody>
          ${stats.map(s => {
            const locs = s.locations;
            const showToggle = locs.length > 1;
            const firstLoc = locs.length > 0 ? locs[0] : '<span class="muted">未提供</span>';
            const restLocs = locs.length > 1 ? locs.slice(1).join('、') : '';
            return `
            <tr>
              <td style="font-weight:600;">${s.courseName}</td>
              <td class="mono">${s.count}</td>
              <td class="mono">${s.totalSections}</td>
              <td class="mono">${s.totalHours}h</td>
              <td>${s.teachers.length > 0 ? s.teachers.join('、') : '<span class="muted">未提供</span>'}</td>
              <td class="locations-cell">
                <span class="loc-first">${firstLoc}</span>
                ${showToggle ? `<span class="loc-rest" style="display:none;">、${restLocs}</span><button class="loc-toggle" data-expanded="false" data-count="${locs.length - 1}">+${locs.length - 1}</button>` : ''}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>
    </div>`;
  }

  function renderTeacherStats(dm, className) {
  const stats = dm.getTeacherStats(className);
  return `
    <div style="margin-bottom:16px;">
      <div class="search-box" style="max-width:100%;">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input type="text" class="search-input" id="teacher-search" placeholder="搜索教师姓名…" style="padding-left:36px;" />
      </div>
      <div id="teacher-search-results"></div>
    </div>
    <div class="card" style="padding:0;overflow:hidden;">
      ${stats.length === 0 ? emptyState('暂无教师数据') : `
        <div class="table-scroll">
        <table class="stat-table sticky-table">
          <thead>
            <tr><th>教师</th><th>授课次数</th><th>主要教室</th></tr>
          </thead>
          <tbody>
            ${stats.map(t => `
              <tr class="clickable" data-teacher="${t.teacher}">
                <td style="font-weight:600;">${t.teacher}</td>
                <td class="mono">${t.count}</td>
                <td>${t.locations.length > 0 ? t.locations.join('、') : '<span class="muted">—</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        </div>`}
    </div>`;
}

function renderRoomStats(dm, className) {
  const stats = dm.getRoomStats(className);
  if (stats.length === 0) return emptyState('暂无教室数据');

  const maxCount = Math.max(...stats.map(s => s.count));

  return `
    <div class="card" style="padding:0;overflow:hidden;">
      <div class="table-scroll">
      <table class="stat-table sticky-table">
        <thead>
          <tr><th>教室</th><th>使用次数</th><th>使用频率</th></tr>
        </thead>
        <tbody>
          ${stats.map(r => `
            <tr class="clickable" data-room="${r.room}">
              <td style="font-weight:600;">${r.room}</td>
              <td class="mono">${r.count}</td>
              <td>
                <div class="stat-bar-row">
                  <div class="stat-bar" style="max-width:200px;"><div class="stat-bar-fill" style="width:${(r.count / maxCount) * 100}%"></div></div>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>
    </div>
    <div id="room-detail-container"></div>`;
}

function renderFreeTime(dm, className, week) {
  const analysis = dm.getFreeTimeAnalysis(className, week);
  const summary = dm.getFreeTimeSummary(className, week);
  const dayNames = ['周一', '周二', '周三', '周四', '周五'];

  return `
    <div class="analytics-grid">
      <div class="analytics-card analytics-full">
        <div class="analytics-card-title">本周无课时间</div>
        <div class="free-time-summary">
          <div class="free-time-chip">
            <span class="free-time-chip-label">本周无课</span>
            <span class="free-time-chip-value">${summary.totalFreeHours}小时</span>
          </div>
        </div>
        <div class="free-time-grid" style="margin-top:20px;">
          ${analysis.map(day => `
            <div class="free-time-day">
              <div class="free-time-day-header">${dayNames[day.weekday - 1]} <span style="font-weight:400;color:var(--color-text-secondary);font-size:12px;">无课 ${Math.round(day.totalFreeMin / 60 * 10) / 10}小时</span></div>
              <div class="free-time-slots">
                ${day.slots.map(slot => {
                  const flex = slot.type === 'busy' ? '2' : '1';
                  return `<div class="free-slot ${slot.type}" style="flex:${flex};" title="${slot.label}">${slot.type === 'busy' ? '' : slot.duration}</div>`;
                }).join('')}
              </div>
            </div>`).join('')}
        </div>
        <div style="margin-top:16px;display:flex;gap:16px;font-size:12px;color:var(--color-text-secondary);">
          <span><span style="display:inline-block;width:12px;height:12px;background:var(--color-primary);border-radius:2px;vertical-align:middle;margin-right:4px;"></span>有课</span>
          <span><span style="display:inline-block;width:12px;height:12px;background:var(--color-border-light);border-radius:2px;vertical-align:middle;margin-right:4px;"></span>无课</span>
          <span><span style="display:inline-block;width:12px;height:12px;background:var(--color-warning-light);border-radius:2px;vertical-align:middle;margin-right:4px;"></span>午休</span>
        </div>
      </div>
    </div>`;
}

function attachCourseRowEvents(el, dm, className) {
  el.querySelectorAll('.loc-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const expanded = btn.dataset.expanded === 'true';
      const restSpan = btn.parentElement.querySelector('.loc-rest');
      const count = btn.dataset.count;
      if (expanded) {
        restSpan.style.display = 'none';
        btn.dataset.expanded = 'false';
        btn.textContent = '+' + count;
      } else {
        restSpan.style.display = 'inline';
        btn.dataset.expanded = 'true';
        btn.textContent = '收起';
      }
    });
  });
}

function attachTeacherSearch(el, dm, className, state) {
  const input = el.querySelector('#teacher-search');
  if (!input) return;
  const resultsEl = el.querySelector('#teacher-search-results');

  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    if (!query) {
      resultsEl.innerHTML = '';
      return;
    }
    const stats = dm.getTeacherStats(className);
    const matched = stats.filter(t => t.teacher.includes(query));
    if (matched.length === 0) {
      resultsEl.innerHTML = `<div class="empty-state" style="padding:16px;"><div class="empty-state-text">没有找到该教师</div></div>`;
      return;
    }
    resultsEl.innerHTML = matched.map(t => `
      <div class="card" style="margin-top:12px;padding:0;overflow:hidden;">
        <div style="font-size:16px;font-weight:700;padding:16px 16px 12px;">${t.teacher} · ${t.count}次</div>
        <div class="table-scroll">
          <table class="stat-table sticky-table">
            <thead><tr><th>课程</th><th>日期</th><th>节次</th><th>时间</th><th>地点</th></tr></thead>
            <tbody>
              ${t.courses.slice(0, 20).map(c => `
                <tr>
                  <td style="font-weight:600;">${c.courseName}</td>
                  <td class="mono">${c.date}</td>
                  <td class="mono">第${c.startSection}-${c.endSection}节</td>
                  <td class="mono">${c.startTime}-${c.endTime}</td>
                  <td>${c.location || '<span class="muted">未提供</span>'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`).join('');
  });
}

function attachRoomRowEvents(el, dm, className) {
  const detailContainer = el.querySelector('#room-detail-container');
  el.querySelectorAll('[data-room]').forEach(row => {
    row.addEventListener('click', () => {
      const room = row.dataset.room;
      const stats = dm.getRoomStats(className);
      const roomStat = stats.find(s => s.room === room);
      if (!roomStat) return;

      detailContainer.innerHTML = `
        <div class="card" style="margin-top:12px;padding:0;overflow:hidden;">
          <div style="font-size:16px;font-weight:700;padding:16px 16px 12px;">${room} · 使用${roomStat.count}次</div>
          <div class="table-scroll">
            <table class="stat-table sticky-table">
              <thead><tr><th>课程</th><th>日期</th><th>节次</th><th>教师</th></tr></thead>
              <tbody>
                ${roomStat.courses.slice(0, 30).map(c => `
                  <tr>
                    <td style="font-weight:600;">${c.courseName}</td>
                    <td class="mono">${c.date}</td>
                    <td class="mono">第${c.startSection}-${c.endSection}节</td>
                    <td>${c.teacher || '<span class="muted">未提供</span>'}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    });
  });
}

function emptyState(text) {
  return `<div class="empty-state"><div class="empty-state-text">${text}</div></div>`;
}
