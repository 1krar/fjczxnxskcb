import { formatClockDisplay, formatCountdown, getTodayStr, getDayName, formatDate, getCurrentWeek } from './time.js';
import { showCourseDetail } from './app.js';

let tickHandler = null;

export function renderDashboard(container, state, dm) {
  const info = dm.getSemesterInfo();
  const todayStr = getTodayStr();
  const today = new Date();
  const weekday = today.getDay() === 0 ? 7 : today.getDay();

  container.innerHTML = `
    <div class="today-header">
      <div class="today-date">
        <div class="today-date-main" id="dash-date-main">${formatDate(todayStr)}</div>
        <div class="today-date-sub" id="dash-date-sub">星期${getDayName(todayStr)} · 第${Math.max(1, getCurrentWeek(info.semesterStart))}周</div>
      </div>
      <div class="today-clock" id="dash-clock"></div>
    </div>
    <div id="dash-status"></div>
    <div id="dash-timeline"></div>
    <div id="dash-summary"></div>
  `;

  function updateClock() {
    const now = new Date();
    const display = formatClockDisplay(now, state.settings.timeFormat !== '12h');
    const el = document.getElementById('dash-clock');
    if (el) el.innerHTML = `${display.main}<span class="seconds">${display.seconds}</span>${display.ampm ? ` <span style="font-size:14px;color:var(--color-text-tertiary);">${display.ampm}</span>` : ''}`;
  }

  function updateAll() {
    updateClock();
    updateStatus();
    updateTimeline();
    updateSummary();
  }

  function updateStatus() {
    const el = document.getElementById('dash-status');
    if (!el) return;
    const now = new Date();
    const courses = dm.getTodayCourses(state.currentClass);
    el.innerHTML = renderStatusCard(courses, now, dm, state, info);
    el.querySelectorAll('[data-course-detail]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.courseDetail);
        if (courses[idx]) showCourseDetail(courses[idx]);
      });
    });
  }

  function updateTimeline() {
    const el = document.getElementById('dash-timeline');
    if (!el) return;
    const now = new Date();
    const courses = dm.getTodayCourses(state.currentClass);
    el.innerHTML = renderTimeline(courses, now, state);
    el.querySelectorAll('[data-course-detail]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.courseDetail);
        if (courses[idx]) showCourseDetail(courses[idx]);
      });
    });
  }

  function updateSummary() {
    const el = document.getElementById('dash-summary');
    if (!el) return;
    const week = getCurrentWeek(info.semesterStart);
    const weekStats = dm.getWeekStats(state.currentClass, Math.max(info.firstWeek, Math.min(info.lastWeek, week)));
    el.innerHTML = `
      <div class="today-summary">
        <div class="summary-chip">
          <span class="summary-chip-label">学期周次</span>
          <span class="summary-chip-value">${Math.max(1, week)} / ${info.lastWeek}</span>
        </div>
        <div class="summary-chip">
          <span class="summary-chip-label">本周课程</span>
          <span class="summary-chip-value">${weekStats.courseCount}</span>
        </div>
        <div class="summary-chip">
          <span class="summary-chip-label">本周节次</span>
          <span class="summary-chip-value">${weekStats.totalSections}</span>
        </div>
        <div class="summary-chip">
          <span class="summary-chip-label">本周时长</span>
          <span class="summary-chip-value">${weekStats.totalHours}小时</span>
        </div>
      </div>`;
  }

  updateAll();

  tickHandler = updateAll;
  document.addEventListener('app:tick', tickHandler);

  // Auto-scroll to current position on mobile after render
  requestAnimationFrame(() => {
    scrollToCurrent();
  });

  return function cleanup() {
    document.removeEventListener('app:tick', tickHandler);
    tickHandler = null;
  };
}

export function cleanupDashboard() {
  if (tickHandler) {
    document.removeEventListener('app:tick', tickHandler);
    tickHandler = null;
  }
}

function renderStatusCard(courses, now, dm, state, info) {
  if (courses.length === 0) {
    const tomorrow = dm.getTomorrowCourses(state.currentClass);
    let nextHtml = '';
    if (tomorrow.length > 0) {
      const t = tomorrow[0];
      nextHtml = `
        <div class="status-next-preview">
          <span class="next-label">明天</span>
          <div>
            <div class="next-course-name">${t.courseName}</div>
            <div class="next-course-meta">${t.startTime} · ${t.location || '地点未提供'}</div>
          </div>
        </div>`;
    }
    return `
      <div class="status-card state-complete">
        <div class="status-label">今日无课</div>
        <div class="status-course-name">今天没有课程安排</div>
        <div class="status-course-meta">享受空闲时光</div>
        ${nextHtml}
      </div>`;
  }

  const current = courses.find(c => c.startDateTime && c.endDateTime && now >= c.startDateTime && now < c.endDateTime);

  if (current) {
    const remaining = current.endDateTime - now;
    const total = current.endDateTime - current.startDateTime;
    const elapsed = total - remaining;
    const progress = Math.max(0, Math.min(100, (elapsed / total) * 100));
    const nextIdx = courses.indexOf(current) + 1;
    const next = nextIdx < courses.length ? courses[nextIdx] : null;
    let nextPreview = '';
    if (next) {
      nextPreview = `
        <div class="status-next-preview">
          <span class="next-label">下一节</span>
          <div>
            <div class="next-course-name">${next.courseName}</div>
            <div class="next-course-meta">${next.startTime} 开始 · ${next.location || '地点未提供'}</div>
          </div>
        </div>`;
    }
    return `
      <div class="status-card state-in-class">
        <div class="status-label">正在上课</div>
        <div class="status-course-name" data-course-detail="${courses.indexOf(current)}" style="cursor:pointer">${current.courseName}</div>
        <div class="status-course-meta">
          <span>${current.location || '地点未提供'}</span>
          ${current.teacher ? `<span class="dot"></span><span>${current.teacher}</span>` : ''}
        </div>
        <div class="status-section-info">
          <span class="mono">第${current.startSection}-${current.endSection}节</span>
          <span> · </span>
          <span class="mono">${current.startTime}—${current.endTime}</span>
        </div>
        <div class="status-countdown">
          <span class="countdown-label">还剩</span>
          <span class="countdown-value mono">${formatCountdown(remaining)}</span>
        </div>
        <div class="status-progress">
          <div class="status-progress-fill" style="width:${progress}%"></div>
        </div>
        ${nextPreview}
      </div>`;
  }

  const next = courses.find(c => c.startDateTime && c.startDateTime > now);
  if (next) {
    const prev = courses.filter(c => c.endDateTime && c.endDateTime <= now).pop();
    const wait = next.startDateTime - now;

    let stateClass = 'state-break';
    let label = '课间休息';
    if (prev && prev.endDateTime && next.startDateTime) {
      if (prev.endDateTime.getHours() <= 12 && next.startDateTime.getHours() >= 13) {
        stateClass = 'state-lunch';
        label = '午休时间';
      }
    } else if (!prev) {
      stateClass = 'state-before';
      label = '课前准备';
    }

    return `
      <div class="status-card ${stateClass}">
        <div class="status-label">${label}</div>
        <div class="status-course-name" data-course-detail="${courses.indexOf(next)}" style="cursor:pointer">${next.courseName}</div>
        <div class="status-course-meta">
          <span>${next.location || '地点未提供'}</span>
          ${next.teacher ? `<span class="dot"></span><span>${next.teacher}</span>` : ''}
        </div>
        <div class="status-section-info">
          <span class="mono">第${next.startSection}-${next.endSection}节</span>
          <span> · </span>
          <span class="mono">${next.startTime} 开始</span>
        </div>
        <div class="status-countdown">
          <span class="countdown-label">距离开始</span>
          <span class="countdown-value mono">${formatCountdown(wait)}</span>
        </div>
      </div>`;
  }

  const tomorrow = dm.getTomorrowCourses(state.currentClass);
  let tomorrowHtml = '';
  if (tomorrow.length > 0) {
    const t = tomorrow[0];
    tomorrowHtml = `
      <div class="status-next-preview">
        <span class="next-label">明天</span>
        <div>
          <div class="next-course-name">${t.courseName}</div>
          <div class="next-course-meta">${t.startTime} · ${t.location || '地点未提供'}</div>
        </div>
      </div>`;
  }
  return `
    <div class="status-card state-complete">
      <div class="status-label">今日课程结束</div>
      <div class="status-course-name">今天的课程已经结束</div>
      <div class="status-course-meta">共完成 ${courses.length} 门课程</div>
      ${tomorrowHtml}
    </div>`;
}

function renderTimeline(courses, now, state) {
  if (courses.length === 0) {
    return `
      <div class="timeline">
        <div class="timeline-header"><span class="timeline-title">今日课程</span></div>
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <div class="empty-state-text">今天没有课程</div>
        </div>
      </div>`;
  }

  const items = [];
  const current = courses.find(c => c.startDateTime && c.endDateTime && now >= c.startDateTime && now < c.endDateTime);

  for (let i = 0; i < courses.length; i++) {
    const c = courses[i];
    const isPast = c.endDateTime && now >= c.endDateTime;
    const isCurrent = c === current;
    const isUpcoming = !isPast && !isCurrent;

    let stateClass = 'upcoming';
    if (isPast) stateClass = 'past';
    if (isCurrent) stateClass = 'current';

    items.push(`
      <div class="timeline-item ${stateClass}" data-course-detail="${i}" style="cursor:pointer">
        <div class="timeline-time">${c.startTime}</div>
        <div class="timeline-content">
          <div class="timeline-course-name">${c.courseName}</div>
          <div class="timeline-course-meta">
            ${c.location || '地点未提供'}
            ${c.teacher ? ` · ${c.teacher}` : ''}
            <span class="mono" style="margin-left:6px;color:var(--color-text-tertiary);">${c.startTime}—${c.endTime}</span>
          </div>
        </div>
      </div>`);

    if (i < courses.length - 1) {
      const next = courses[i + 1];
      if (c.endDateTime && next.startDateTime) {
        const isNow = now >= c.endDateTime && now < next.startDateTime;
        if (isNow) {
          items.push(`
            <div class="timeline-now-marker">
              <div class="timeline-now-dot"></div>
              <span class="timeline-now-label">现在 ${formatClockDisplay(now, true).main}</span>
            </div>`);
        } else {
          items.push(`
            <div class="timeline-separator">
              <span class="timeline-separator-time">${c.endTime}</span>
              <div class="timeline-separator-line"></div>
            </div>`);
        }
      }
    }
  }

  const currentActive = current ? 'current' : (courses.find(c => c.startDateTime && c.startDateTime > now) ? 'next' : 'done');

  return `
    <div class="timeline">
      <div class="timeline-header">
        <span class="timeline-title">今日课程</span>
        <span class="badge badge-muted">共 ${courses.length} 门</span>
      </div>
      <div class="timeline-list">
        ${items.join('')}
      </div>
    </div>`;
}

function scrollToCurrent() {
  // Only auto-scroll on narrow viewports
  if (window.innerWidth > 768) return;

  const timeline = document.querySelector('.timeline');
  if (!timeline) return;

  // Try to find the "now" marker first
  const nowMarker = timeline.querySelector('.timeline-now-marker');
  if (nowMarker) {
    nowMarker.scrollIntoView({ behavior: 'auto', block: 'center' });
    return;
  }

  // Try current course item
  const currentItem = timeline.querySelector('.timeline-item.current');
  if (currentItem) {
    currentItem.scrollIntoView({ behavior: 'auto', block: 'center' });
    return;
  }

  // Try first upcoming item
  const upcomingItem = timeline.querySelector('.timeline-item.upcoming');
  if (upcomingItem) {
    upcomingItem.scrollIntoView({ behavior: 'auto', block: 'center' });
    return;
  }

  // All past - scroll to last item
  const items = timeline.querySelectorAll('.timeline-item');
  if (items.length > 0) {
    items[items.length - 1].scrollIntoView({ behavior: 'auto', block: 'center' });
  }
}
