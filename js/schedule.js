import { getCurrentWeek, getWeekDates, formatClockDisplay, formatDateShort, getDayName } from './time.js';
import { showCourseDetail } from './app.js';

let tickHandler = null;
let scheduleState = { week: 1, selectedDay: 1, searchOpen: false };

export function renderSchedule(container, state, dm) {
  const info = dm.getSemesterInfo();
  scheduleState.week = state.scheduleWeek || Math.max(info.firstWeek, Math.min(info.lastWeek, getCurrentWeek(info.semesterStart)));

  const currentWeek = Math.max(1, getCurrentWeek(info.semesterStart));
  if (scheduleState.week === currentWeek) {
    const today = new Date();
    scheduleState.selectedDay = today.getDay() === 0 ? 7 : today.getDay();
  } else {
    scheduleState.selectedDay = scheduleState.selectedDay || 1;
  }

  const isMobile = () => window.innerWidth <= 768;

  function buildHTML() {
    const week = scheduleState.week;
    const weekDates = getWeekDates(week, info.semesterStart);
    const todayStr = new Date().toISOString().slice(0, 10);
    const isCurrentWeek = week === currentWeek;
    const mobile = isMobile();

    if (mobile) {
      return buildMobileView(week, weekDates, todayStr, dm, state, info, isCurrentWeek, currentWeek);
    } else {
      return buildDesktopView(week, weekDates, todayStr, dm, state, info, isCurrentWeek, currentWeek);
    }
  }

  function buildDesktopView(week, weekDates, todayStr, dm, state, info, isCurrentWeek, currentWeek) {
    let html = `
      <div class="schedule-toolbar">
        <div class="week-nav">
          <button class="week-nav-btn" id="week-prev" ${week <= 1 ? 'disabled' : ''}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <div class="week-info">
            <div class="week-info-main">第 ${week} 周</div>
            <div class="week-info-sub">${weekDates[0].slice(5)} — ${weekDates[4].slice(5)}</div>
          </div>
          <button class="week-nav-btn" id="week-next" ${week >= info.lastWeek ? 'disabled' : ''}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
          ${!isCurrentWeek ? `<button class="week-today-btn" id="week-today">回到本周</button>` : ''}
        </div>
        <div class="search-box">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" class="search-input" id="schedule-search" placeholder="搜索课程、教师、教室…" />
        </div>
      </div>`;

    html += buildDesktopWeekGrid(week, weekDates, todayStr, dm, state, info);
    html += `<div id="search-results-container"></div>`;
    return html;
  }

  function buildMobileView(week, weekDates, todayStr, dm, state, info, isCurrentWeek, currentWeek) {
    const dayNames = ['一', '二', '三', '四', '五'];
    const selectedDay = scheduleState.selectedDay;
    const courses = dm.getCoursesByWeekday(state.currentClass, week, selectedDay);
    const now = new Date();

    let html = `
      <div class="m-schedule-toolbar">
        <button class="week-nav-btn" id="week-prev" ${week <= 1 ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <div class="m-week-info">
          <span class="m-week-main">第${week}周</span>
          <span class="m-week-sub">${weekDates[0].slice(5)}—${weekDates[4].slice(5)}</span>
        </div>
        <button class="week-nav-btn" id="week-next" ${week >= info.lastWeek ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
        ${!isCurrentWeek ? `<button class="m-today-btn" id="week-today">本周</button>` : ''}
        <button class="m-search-toggle" id="search-toggle-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        </button>
      </div>`;

    if (scheduleState.searchOpen) {
      html += `
        <div class="m-search-bar" id="m-search-bar">
          <input type="text" class="m-search-input" id="schedule-search" placeholder="搜索课程、教师、教室…" />
          <button class="m-search-close" id="search-close-btn">取消</button>
        </div>`;
    }

    html += `<div class="m-day-picker" id="mobile-day-picker">`;
    for (let d = 0; d < 5; d++) {
      const dateStr = weekDates[d];
      const isDayToday = dateStr === todayStr;
      const isActive = (d + 1) === selectedDay;
      const dayNum = dateStr.slice(8);
      html += `
        <button class="m-day-chip ${isDayToday ? 'today' : ''} ${isActive ? 'active' : ''}" data-day="${d + 1}">
          <span class="m-day-chip-name">${dayNames[d]}</span>
          <span class="m-day-chip-date">${parseInt(dayNum)}</span>
        </button>`;
    }
    html += `</div>`;

    html += `<div class="m-agenda" id="m-agenda">`;

    if (courses.length === 0) {
      html += `
        <div class="m-agenda-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--color-text-tertiary);margin-bottom:8px;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <div style="font-size:14px;color:var(--color-text-secondary);">周${dayNames[selectedDay - 1]}没有课程</div>
          <div style="font-size:12px;color:var(--color-text-tertiary);margin-top:4px;">${weekDates[selectedDay - 1]}</div>
        </div>`;
    } else {
      for (let i = 0; i < courses.length; i++) {
        const c = courses[i];
        const isPast = c.endDateTime && now >= c.endDateTime;
        const isCurrent = c.startDateTime && c.endDateTime && now >= c.startDateTime && now < c.endDateTime;

        let itemClass = 'm-agenda-item';
        if (isPast) itemClass += ' past';
        if (isCurrent) itemClass += ' current';

        html += `
          <div class="${itemClass}" data-course-idx="${i}">
            <div class="m-agenda-time">
              <span class="m-agenda-start">${c.startTime || ''}</span>
              <span class="m-agenda-end">${c.endTime || ''}</span>
            </div>
            <div class="m-agenda-dot ${isCurrent ? 'now' : ''}"></div>
            <div class="m-agenda-body">
              <div class="m-agenda-name">${c.courseName}</div>
              <div class="m-agenda-meta">
                <span class="m-agenda-section">第${c.startSection}-${c.endSection}节</span>
                ${c.location ? `<span class="m-agenda-loc">${c.location}</span>` : ''}
                ${c.teacher && state.settings.showTeacher ? `<span class="m-agenda-teacher">${c.teacher}</span>` : ''}
              </div>
            </div>
          </div>`;

        if (isCurrent && i < courses.length - 1) {
          html += `<div class="m-agenda-now-marker"><span>现在</span></div>`;
        }
      }
    }

    html += `</div>`;
    html += `<div id="search-results-container"></div>`;
    return html;
  }

  function buildDesktopWeekGrid(week, weekDates, todayStr, dm, state, info) {
    const coursesByDay = {};
    for (let d = 1; d <= 5; d++) {
      coursesByDay[d] = dm.getCoursesByWeekday(state.currentClass, week, d);
    }
    const hasAnyCourse = Object.values(coursesByDay).some(arr => arr.length > 0);
    const dayNames = ['周一', '周二', '周三', '周四', '周五'];
    const sectionTimes = dm.getSectionTimes();
    const season = coursesByDay[1][0]?.season || 'summer';

    let gridHTML = '';
    gridHTML += `<div class="schedule-corner" style="grid-row:1;grid-column:1;">节次</div>`;
    for (let d = 0; d < 5; d++) {
      const dateStr = weekDates[d];
      const isToday = dateStr === todayStr;
      gridHTML += `<div class="schedule-day-header ${isToday ? 'today' : ''}" style="grid-row:1;grid-column:${d + 2};">
        <div class="schedule-day-name">${dayNames[d]}</div>
        <div class="schedule-day-date">${weekDates[d].slice(5)}</div>
      </div>`;
    }

    for (let s = 1; s <= 10; s++) {
      const st = sectionTimes[season]?.[String(s)];
      const stStart = st ? st.start.slice(0, 5) : '';
      gridHTML += `<div class="schedule-section-label" style="grid-row:${s + 1};grid-column:1;">
        <span>${s}</span>
        ${stStart ? `<span class="section-time">${stStart}</span>` : ''}
      </div>`;

      for (let d = 1; d <= 5; d++) {
        const course = coursesByDay[d].find(c => c.startSection === s);
        if (course) {
          const span = course.endSection - course.startSection + 1;
          const isPast = course.endDateTime && new Date() > course.endDateTime;
          const isToday = course.date === todayStr;
          const isCurrent = course.startDateTime && course.endDateTime && new Date() >= course.startDateTime && new Date() < course.endDateTime;

          let cardClass = 'course-card schedule-desktop-view';
          if (isPast) cardClass += ' past';
          if (isToday && !isPast) cardClass += ' today';
          if (isCurrent) cardClass += ' current';

          gridHTML += `<div class="${cardClass}" style="grid-row:${s + 1} / ${course.endSection + 2};grid-column:${d + 1};" data-course-id="${d}-${s}">
            <div class="course-card-name">${course.courseName}</div>
            <div class="course-card-meta">${course.location || ''}</div>
            ${state.settings.showTeacher && course.teacher ? `<div class="course-card-meta">${course.teacher}</div>` : ''}
            <div class="course-card-section">第${course.startSection}-${course.endSection}节</div>
          </div>`;
        } else {
          const isOccupied = coursesByDay[d].some(c => s > c.startSection && s <= c.endSection);
          if (!isOccupied) {
            gridHTML += `<div class="schedule-cell" style="grid-row:${s + 1};grid-column:${d + 1};"></div>`;
          }
        }
      }
    }

    if (hasAnyCourse) {
      return `
        <div class="schedule-grid-wrapper schedule-desktop-view">
          <div class="schedule-grid" style="grid-template-rows: 44px repeat(10, minmax(48px, 1fr));">
            ${gridHTML}
          </div>
        </div>`;
    } else {
      return `
        <div class="schedule-grid-wrapper schedule-desktop-view">
          <div class="schedule-empty-week">
            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px;color:var(--color-text-tertiary);margin-bottom:12px;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <div>第 ${week} 周没有课程安排</div>
          </div>
        </div>`;
    }
  }

  container.innerHTML = buildHTML();

  function attachEvents() {
    const prevBtn = document.getElementById('week-prev');
    const nextBtn = document.getElementById('week-next');
    const todayBtn = document.getElementById('week-today');

    if (prevBtn) prevBtn.addEventListener('click', () => {
      if (scheduleState.week > 1) {
        scheduleState.week--;
        state.scheduleWeek = scheduleState.week;
        rerender();
      }
    });

    if (nextBtn) nextBtn.addEventListener('click', () => {
      if (scheduleState.week < info.lastWeek) {
        scheduleState.week++;
        state.scheduleWeek = scheduleState.week;
        rerender();
      }
    });

    if (todayBtn) todayBtn.addEventListener('click', () => {
      scheduleState.week = Math.max(1, getCurrentWeek(info.semesterStart));
      state.scheduleWeek = scheduleState.week;
      const today = new Date();
      scheduleState.selectedDay = today.getDay() === 0 ? 7 : today.getDay();
      rerender();
    });

    const searchToggleBtn = document.getElementById('search-toggle-btn');
    if (searchToggleBtn) {
      searchToggleBtn.addEventListener('click', () => {
        scheduleState.searchOpen = !scheduleState.searchOpen;
        rerender();
        if (scheduleState.searchOpen) {
          setTimeout(() => {
            const input = document.getElementById('schedule-search');
            if (input) input.focus();
          }, 100);
        }
      });
    }

    const searchCloseBtn = document.getElementById('search-close-btn');
    if (searchCloseBtn) {
      searchCloseBtn.addEventListener('click', () => {
        scheduleState.searchOpen = false;
        rerender();
      });
    }

    const dayPicker = document.getElementById('mobile-day-picker');
    if (dayPicker) {
      dayPicker.querySelectorAll('.m-day-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          scheduleState.selectedDay = parseInt(chip.dataset.day);
          rerender();
        });
      });
    }

    const agenda = document.getElementById('m-agenda');
    if (agenda) {
      agenda.querySelectorAll('.m-agenda-item').forEach(item => {
        item.addEventListener('click', () => {
          const idx = parseInt(item.dataset.courseIdx);
          const dayCourses = dm.getCoursesByWeekday(state.currentClass, scheduleState.week, scheduleState.selectedDay);
          if (dayCourses[idx]) showCourseDetail(dayCourses[idx]);
        });
      });

      if (isMobile()) {
        attachSwipeGestures(agenda);
      }
    }

    container.querySelectorAll('.course-card').forEach(card => {
      card.addEventListener('click', () => {
        const [day, section] = card.dataset.courseId.split('-').map(Number);
        const courses = dm.getCoursesByWeekday(state.currentClass, scheduleState.week, day);
        const course = courses.find(c => c.startSection === section);
        if (course) showCourseDetail(course);
      });
    });

    const searchInput = document.getElementById('schedule-search');
    if (searchInput) {
      let searchTimer;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        const query = e.target.value;
        searchTimer = setTimeout(() => {
          const resultsContainer = document.getElementById('search-results-container');
          if (!query.trim()) {
            resultsContainer.innerHTML = '';
            return;
          }
          const results = dm.searchAll(query);
          resultsContainer.innerHTML = renderSearchResults(results);
          resultsContainer.querySelectorAll('[data-result-idx]').forEach(item => {
            item.addEventListener('click', () => {
              const idx = parseInt(item.dataset.resultIdx);
              const r = results[idx];
              scheduleState.week = r.week;
              state.scheduleWeek = scheduleState.week;
              scheduleState.selectedDay = r.weekday || 1;
              scheduleState.searchOpen = false;
              rerender();
            });
          });
        }, 250);
      });
    }
  }

  function attachSwipeGestures(el) {
    let startX = 0;
    let startY = 0;
    let isDragging = false;
    let gestureType = null;
    const SWIPE_THRESHOLD = 50;

    function onTouchStart(e) {
      if (e.target.closest('.m-agenda-item')) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isDragging = true;
      gestureType = null;
    }

    function onTouchMove(e) {
      if (!isDragging) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!gestureType && Math.max(Math.abs(dx), Math.abs(dy)) > 10) {
        gestureType = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      }
      if (gestureType === 'horizontal') {
        e.preventDefault();
      }
    }

    function onTouchEnd(e) {
      if (!isDragging) return;
      isDragging = false;
      if (gestureType !== 'horizontal') return;
      const endX = e.changedTouches[0].clientX;
      const dx = endX - startX;
      if (Math.abs(dx) < SWIPE_THRESHOLD) return;

      if (dx > 0) {
        if (scheduleState.selectedDay > 1) {
          scheduleState.selectedDay--;
          rerender();
        } else if (scheduleState.week > 1) {
          scheduleState.week--;
          state.scheduleWeek = scheduleState.week;
          scheduleState.selectedDay = 5;
          rerender();
        }
      } else {
        if (scheduleState.selectedDay < 5) {
          scheduleState.selectedDay++;
          rerender();
        } else if (scheduleState.week < info.lastWeek) {
          scheduleState.week++;
          state.scheduleWeek = scheduleState.week;
          scheduleState.selectedDay = 1;
          rerender();
        }
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
  }

  function renderSearchResults(results) {
    if (results.length === 0) {
      return `<div class="empty-state" style="padding:24px;"><div class="empty-state-text">没有找到相关课程</div></div>`;
    }
    return `<div class="search-results">${results.slice(0, 50).map((r, i) => `
      <div class="search-result-item" data-result-idx="${i}">
        <div class="search-result-main">
          <div class="search-result-name">${r.courseName}</div>
          <div class="search-result-meta">
            第${r.week}周 · 星期${['日','一','二','三','四','五','六'][new Date(r.date+'T00:00:00').getDay()]} ·
            第${r.startSection}-${r.endSection}节 · ${r.startTime}
            ${r.location ? ` · ${r.location}` : ''}
            ${r.teacher ? ` · ${r.teacher}` : ''}
            ${r.className ? ` · ${r.className}` : ''}
          </div>
        </div>
      </div>`).join('')}</div>`;
  }

  function rerender() {
    container.innerHTML = buildHTML();
    attachEvents();
  }

  attachEvents();

  let lastMinute = new Date().getMinutes();
  tickHandler = () => {
    const now = new Date();
    if (now.getMinutes() !== lastMinute && scheduleState.week === Math.max(1, getCurrentWeek(info.semesterStart))) {
      lastMinute = now.getMinutes();

      container.querySelectorAll('.course-card').forEach(card => {
        if (!card.dataset.courseId) return;
        const [day, section] = card.dataset.courseId.split('-').map(Number);
        const courses = dm.getCoursesByWeekday(state.currentClass, scheduleState.week, day);
        const c = courses.find(course => course.startSection === section);
        if (c) {
          const isPast = c.endDateTime && now >= c.endDateTime;
          const isCurrent = c.startDateTime && c.endDateTime && now >= c.startDateTime && now < c.endDateTime;
          const isToday = c.date === now.toISOString().slice(0, 10);

          card.classList.remove('past', 'today', 'current');
          if (isPast) card.classList.add('past');
          if (isToday && !isPast) card.classList.add('today');
          if (isCurrent) card.classList.add('current');
        }
      });

      container.querySelectorAll('.m-agenda-item').forEach(item => {
        if (item.dataset.courseIdx == null) return;
        const idx = parseInt(item.dataset.courseIdx);
        const dayCourses = dm.getCoursesByWeekday(state.currentClass, scheduleState.week, scheduleState.selectedDay);
        const c = dayCourses[idx];
        if (c) {
          const isPast = c.endDateTime && now >= c.endDateTime;
          const isCurrent = c.startDateTime && c.endDateTime && now >= c.startDateTime && now < c.endDateTime;

          item.classList.remove('past', 'current');
          if (isPast) item.classList.add('past');
          if (isCurrent) item.classList.add('current');
        }
      });
    }
  };
  document.addEventListener('app:tick', tickHandler);

  return function cleanup() {
    document.removeEventListener('app:tick', tickHandler);
    tickHandler = null;
  };
}

export function cleanupSchedule() {
  if (tickHandler) {
    document.removeEventListener('app:tick', tickHandler);
    tickHandler = null;
  }
}
