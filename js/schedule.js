import { getCurrentWeek, getWeekDates, formatClockDisplay, formatDateShort, getDayName } from './time.js';
import { showCourseDetail } from './app.js';

let tickHandler = null;
let scheduleState = { week: 1, selectedDay: 1 };

export function renderSchedule(container, state, dm) {
  const info = dm.getSemesterInfo();
  scheduleState.week = state.scheduleWeek || Math.max(info.firstWeek, Math.min(info.lastWeek, getCurrentWeek(info.semesterStart)));

  // Default selected day to today if current week, else Monday
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

    if (mobile) {
      html += buildMobileDayView(week, weekDates, todayStr, dm, state, info);
    } else {
      html += buildDesktopWeekGrid(week, weekDates, todayStr, dm, state, info);
    }

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

  function buildMobileDayView(week, weekDates, todayStr, dm, state, info) {
    const sectionTimes = dm.getSectionTimes();
    const selectedDay = scheduleState.selectedDay;
    const isToday = weekDates[selectedDay - 1] === todayStr;
    const courses = dm.getCoursesByWeekday(state.currentClass, week, selectedDay);
    const season = courses[0]?.season || 'summer';
    const times = sectionTimes[season] || {};

    // Day picker chips (Mon-Fri only for now, since data has 5 days)
    const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    let dayPickerHTML = `<div class="mobile-day-picker" id="mobile-day-picker">`;
    for (let d = 1; d <= 5; d++) {
      const dateStr = weekDates[d - 1];
      const isDayToday = dateStr === todayStr;
      const isActive = d === selectedDay;
      const dayNum = dateStr.slice(8);
      dayPickerHTML += `
        <button class="mobile-day-chip ${isDayToday ? 'today' : ''} ${isActive ? 'active' : ''}" data-day="${d}">
          <span class="mobile-day-chip-name">${dayNames[d - 1]}</span>
          <span class="mobile-day-chip-date">${parseInt(dayNum)}</span>
        </button>`;
    }
    dayPickerHTML += `</div>`;

    // Timeline
    const dayStartMinutes = 8 * 60; // 08:00
    const dayEndMinutes = 21 * 60; // 21:00
    const totalMinutes = dayEndMinutes - dayStartMinutes;
    const pixelsPerMinute = 1.1; // scale factor
    const timelineHeight = totalMinutes * pixelsPerMinute;

    function timeToTop(timeStr) {
      if (!timeStr) return 0;
      const [h, m] = timeStr.split(':').map(Number);
      const mins = h * 60 + m;
      return (mins - dayStartMinutes) * pixelsPerMinute;
    }

    // Hour markers
    let hourMarkersHTML = '';
    for (let h = 8; h <= 21; h++) {
      const top = (h * 60 - dayStartMinutes) * pixelsPerMinute;
      hourMarkersHTML += `
        <div class="time-slot" style="position:absolute;top:${top}px;left:0;right:0;">
          <span class="time-label">${String(h).padStart(2, '0')}:00</span>
        </div>`;
    }

    // Section markers
    let sectionMarkersHTML = '';
    for (const [secNum, secTime] of Object.entries(times)) {
      const top = timeToTop(secTime.start);
      if (top >= 0 && top <= timelineHeight) {
        sectionMarkersHTML += `
          <div class="section-marker" style="position:absolute;top:${top}px;left:0;right:0;">
            <span class="section-label">第${secNum}节</span>
          </div>`;
      }
    }

    // Course cards
    let courseCardsHTML = '';
    for (let i = 0; i < courses.length; i++) {
      const c = courses[i];
      const top = timeToTop(c.startTime);
      const bottom = timeToTop(c.endTime);
      const height = bottom - top;

      const now = new Date();
      const isPast = c.endDateTime && now >= c.endDateTime;
      const isCurrent = c.startDateTime && c.endDateTime && now >= c.startDateTime && now < c.endDateTime;

      let cardClass = 'mobile-day-course-card';
      if (isPast) cardClass += ' past';
      if (isCurrent) cardClass += ' current';

      courseCardsHTML += `
        <div class="${cardClass}" style="top:${top}px;height:${Math.max(height - 2, 28)}px;" data-course-idx="${i}">
          <div class="course-name">${c.courseName}</div>
          <div class="course-meta">${c.location || ''}</div>
        </div>`;
    }

    // Current time line (only for today)
    let nowLineHTML = '';
    if (isToday) {
      const now = new Date();
      const nowMins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
      const nowTop = (nowMins - dayStartMinutes) * pixelsPerMinute;
      if (nowTop >= 0 && nowTop <= timelineHeight) {
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        nowLineHTML = `
          <div class="mobile-day-now-line" id="mobile-now-line" style="top:${nowTop}px;">
            <span class="now-time">${timeStr}</span>
          </div>`;
      }
    }

    // Empty state
    if (courses.length === 0) {
      const weekdayName = dayNames[selectedDay - 1];
      return `
        ${dayPickerHTML}
        <div class="timeline" style="margin-top:8px;">
          <div class="empty-state">
            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <div class="empty-state-text">${weekdayName}没有课程</div>
            <div class="empty-state-sub">${weekDates[selectedDay - 1]}</div>
          </div>
        </div>`;
    }

    return `
      ${dayPickerHTML}
      <div class="timeline" style="padding: 16px 12px 16px 8px; margin-top: 8px; position: relative; overflow-y: auto; -webkit-overflow-scrolling: touch;" id="mobile-day-timeline">
        <div class="mobile-day-timeline" style="min-height: ${timelineHeight}px; height: ${timelineHeight}px;">
          ${hourMarkersHTML}
          ${sectionMarkersHTML}
          ${courseCardsHTML}
          ${nowLineHTML}
        </div>
        <div class="scroll-hint-arrow" id="scroll-hint-arrow" style="display:none;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
      </div>`;
  }

  container.innerHTML = buildHTML();

  // ===== Event listeners =====
  function attachEvents() {
    // Week nav
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

    // Mobile day picker
    const dayPicker = document.getElementById('mobile-day-picker');
    if (dayPicker) {
      dayPicker.querySelectorAll('.mobile-day-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          scheduleState.selectedDay = parseInt(chip.dataset.day);
          rerender();
        });
      });

      // Scroll active chip into view
      requestAnimationFrame(() => {
        const activeChip = dayPicker.querySelector('.mobile-day-chip.active');
        if (activeChip) {
          activeChip.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
        }
      });
    }

    // Mobile timeline course cards
    const timeline = document.getElementById('mobile-day-timeline');
    if (timeline) {
      timeline.querySelectorAll('.mobile-day-course-card').forEach(card => {
        card.addEventListener('click', () => {
          const idx = parseInt(card.dataset.courseIdx);
          const dayCourses = dm.getCoursesByWeekday(state.currentClass, scheduleState.week, scheduleState.selectedDay);
          if (dayCourses[idx]) showCourseDetail(dayCourses[idx]);
        });
      });

      // Auto-scroll to current time
      requestAnimationFrame(() => {
        scrollMobileTimelineToNow(timeline);
      });

      // Floating arrow for courses positioned low
      setupScrollHintArrow(timeline);
    }

    // Desktop grid course cards
    container.querySelectorAll('.course-card').forEach(card => {
      card.addEventListener('click', () => {
        const [day, section] = card.dataset.courseId.split('-').map(Number);
        const courses = dm.getCoursesByWeekday(state.currentClass, scheduleState.week, day);
        const course = courses.find(c => c.startSection === section);
        if (course) showCourseDetail(course);
      });
    });

    // Search
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
              rerender();
            });
          });
        }, 250);
      });
    }

    // Swipe gestures for mobile day view
    if (isMobile() && timeline) {
      attachSwipeGestures(timeline);
    }
  }

  function attachSwipeGestures(el) {
    let startX = 0;
    let startY = 0;
    let isDragging = false;
    let gestureType = null; // 'horizontal' | 'vertical'
    const SWIPE_THRESHOLD = 50;

    function onTouchStart(e) {
      // Ignore if starting on a course card (let click work)
      if (e.target.closest('.mobile-day-course-card')) return;

      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isDragging = true;
      gestureType = null;
    }

    function onTouchMove(e) {
      if (!isDragging) return;

      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      // Determine gesture direction on first significant movement
      if (!gestureType && Math.max(Math.abs(dx), Math.abs(dy)) > 10) {
        gestureType = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      }

      // Prevent default only for horizontal swipes
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
        // Swipe right → previous day
        if (scheduleState.selectedDay > 1) {
          scheduleState.selectedDay--;
          rerender();
        } else if (scheduleState.week > 1) {
          // Go to previous week, last day
          scheduleState.week--;
          state.scheduleWeek = scheduleState.week;
          scheduleState.selectedDay = 5;
          rerender();
        }
      } else {
        // Swipe left → next day
        if (scheduleState.selectedDay < 5) {
          scheduleState.selectedDay++;
          rerender();
        } else if (scheduleState.week < info.lastWeek) {
          // Go to next week, first day
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

  function scrollMobileTimelineToNow(timelineEl) {
    if (!timelineEl) return;
    const nowLine = timelineEl.querySelector('#mobile-now-line');
    if (nowLine) {
      const top = parseFloat(nowLine.style.top) || 0;
      timelineEl.scrollTop = Math.max(0, top - timelineEl.clientHeight / 3);
      return;
    }

    // If no now line, scroll to first course
    const firstCard = timelineEl.querySelector('.mobile-day-course-card');
    if (firstCard) {
      timelineEl.scrollTop = Math.max(0, parseFloat(firstCard.style.top) - 20);
    }
  }

  function setupScrollHintArrow(timelineEl) {
    if (!timelineEl) return;
    const arrow = timelineEl.querySelector('#scroll-hint-arrow');
    if (!arrow) return;

    const cards = timelineEl.querySelectorAll('.mobile-day-course-card');
    if (cards.length === 0) return;

    function updateArrowVisibility() {
      const scrollTop = timelineEl.scrollTop;
      const viewportBottom = scrollTop + timelineEl.clientHeight;
      
      let hasUnseenCourse = false;
      for (let i = 0; i < cards.length; i++) {
        const top = parseFloat(cards[i].style.top) || 0;
        if (top > viewportBottom - 40) {
          hasUnseenCourse = true;
          break;
        }
      }

      if (hasUnseenCourse) {
        arrow.style.display = 'flex';
      } else {
        arrow.style.display = 'none';
      }
    }

    arrow.addEventListener('click', () => {
      const scrollTop = timelineEl.scrollTop;
      const viewportBottom = scrollTop + timelineEl.clientHeight;
      let targetTop = 0;
      for (let i = 0; i < cards.length; i++) {
        const top = parseFloat(cards[i].style.top) || 0;
        if (top > viewportBottom - 40) {
          targetTop = Math.max(0, top - timelineEl.clientHeight / 3);
          break;
        }
      }
      timelineEl.scrollTo({ top: targetTop, behavior: 'smooth' });
    });

    timelineEl.addEventListener('scroll', updateArrowVisibility, { passive: true });
    updateArrowVisibility();
  }

  function rerender() {
    container.innerHTML = buildHTML();
    attachEvents();
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

  attachEvents();

  // Tick handler - update now line every minute (mobile) or highlight current course (desktop)
  let lastMinute = new Date().getMinutes();
  tickHandler = () => {
    const now = new Date();
    if (now.getMinutes() !== lastMinute && scheduleState.week === Math.max(1, getCurrentWeek(info.semesterStart))) {
      lastMinute = now.getMinutes();

      // Update now line position on mobile
      const nowLine = document.getElementById('mobile-now-line');
      if (nowLine) {
        const dayStartMinutes = 8 * 60;
        const pixelsPerMinute = 1.1;
        const nowMins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
        const nowTop = (nowMins - dayStartMinutes) * pixelsPerMinute;
        nowLine.style.top = `${nowTop}px`;
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const timeSpan = nowLine.querySelector('.now-time');
        if (timeSpan) timeSpan.textContent = timeStr;
      }

      // Update status classes for desktop cards
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

      // Update status classes for mobile cards
      container.querySelectorAll('.mobile-day-course-card').forEach(card => {
        if (card.dataset.courseIdx == null) return;
        const idx = parseInt(card.dataset.courseIdx);
        const dayCourses = dm.getCoursesByWeekday(state.currentClass, scheduleState.week, scheduleState.selectedDay);
        const c = dayCourses[idx];
        if (c) {
          const isPast = c.endDateTime && now >= c.endDateTime;
          const isCurrent = c.startDateTime && c.endDateTime && now >= c.startDateTime && now < c.endDateTime;
          
          card.classList.remove('past', 'current');
          if (isPast) card.classList.add('past');
          if (isCurrent) card.classList.add('current');
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
