import { dataManager } from './data.js';
import { getSettings, saveSettings, getSelectedClass, setSelectedClass } from './storage.js';
import { getCurrentWeek, formatClockDisplay, getTodayStr } from './time.js';
import { renderDashboard, cleanupDashboard } from './dashboard.js';
import { renderSchedule, cleanupSchedule } from './schedule.js';
import { renderAnalytics, cleanupAnalytics } from './analytics.js';
import { renderCompare, cleanupCompare } from './compare.js';
import { renderData } from './data-page.js';
import { renderSettings } from './settings.js';

const state = {
  currentClass: '',
  settings: getSettings(),
  route: 'today',
  currentWeek: 1,
  scheduleWeek: 1,
  now: new Date(),
  pageCleanup: null,
  isMobile: window.innerWidth <= 768,
};

const routes = {
  today: { render: renderDashboard, cleanup: cleanupDashboard },
  schedule: { render: renderSchedule, cleanup: cleanupSchedule },
  analytics: { render: renderAnalytics, cleanup: cleanupAnalytics },
  compare: { render: renderCompare, cleanup: cleanupCompare },
  data: { render: renderData, cleanup: null },
  settings: { render: renderSettings, cleanup: null },
};

function $(id) { return document.getElementById(id); }

async function init() {
  const dataUrl = 'data/2026-2027-1_虚拟现实技术应用_全部班级.json';
  const result = await dataManager.load(dataUrl);

  if (!result.success) {
    $('loading-screen').innerHTML = `
      <div style="text-align:center;max-width:420px;padding:24px;">
        <div style="font-size:18px;font-weight:600;color:#0F172A;margin-bottom:8px;">课程数据加载失败</div>
        <div style="font-size:14px;color:#64748B;margin-bottom:20px;">请检查数据文件是否存在，然后刷新页面。</div>
        <button class="btn btn-primary" onclick="location.reload()">刷新页面</button>
      </div>`;
    return;
  }

  if (dataManager.hasErrors()) {
    console.warn('Data validation warnings:', dataManager.getErrors());
  }

  state.currentClass = state.settings.selectedClass || '26虚拟现实技术应用3';
  const info = dataManager.getSemesterInfo();
  state.currentWeek = getCurrentWeek(info.semesterStart);
  state.scheduleWeek = Math.max(info.firstWeek, Math.min(info.lastWeek, state.currentWeek));

  $('loading-screen').style.display = 'none';
  $('app').style.display = 'block';

  setupClassSelector();
  setupNavigation();
  setupDetailOverlay();
  startClock();
  setupResizeHandler();

  window.addEventListener('hashchange', handleRoute);
  if (!location.hash) location.hash = '#/today';
  else handleRoute();
}

function setupResizeHandler() {
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const wasMobile = state.isMobile;
      state.isMobile = window.innerWidth <= 768;
      if (wasMobile !== state.isMobile) {
        updateNavActiveState();
        rerenderCurrentPage();
      }
    }, 150);
  });
}

function setupClassSelector() {
  // Desktop
  setupSingleClassSelector({
    btnId: 'class-selector-btn-desktop',
    dropdownId: 'class-selector-dropdown-desktop',
    nameId: 'current-class-name-desktop',
    isMobile: false,
  });
  // Mobile
  setupSingleClassSelector({
    btnId: 'class-selector-btn-mobile',
    dropdownId: 'class-selector-dropdown-mobile',
    nameId: 'current-class-name-mobile',
    isMobile: true,
  });
}

function setupSingleClassSelector({ btnId, dropdownId, nameId, isMobile }) {
  const btn = $(btnId);
  const dropdown = $(dropdownId);
  const nameEl = $(nameId);
  if (!btn || !dropdown || !nameEl) return;

  function updateDisplay() {
    nameEl.textContent = state.currentClass;
  }

  function buildDropdown() {
    const classes = dataManager.getClasses();
    if (isMobile) {
      dropdown.innerHTML = `
        <div class="mobile-class-dropdown-inner">
          <div class="mobile-class-dropdown-title">选择班级</div>
          ${classes.map(c => `
            <button class="mobile-class-option ${c.className === state.currentClass ? 'active' : ''}" data-class="${c.className}">
              <svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>${c.className}</span>
            </button>`).join('')}
        </div>`;
    } else {
      dropdown.innerHTML = classes.map(c => `
        <button class="class-option ${c.className === state.currentClass ? 'active' : ''}" data-class="${c.className}">
          <svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          ${c.className}
        </button>`).join('');
    }

    dropdown.querySelectorAll('[data-class]').forEach(opt => {
      opt.addEventListener('click', () => {
        const className = opt.dataset.class;
        if (className === state.currentClass) {
          closeDropdown();
          return;
        }
        state.currentClass = className;
        setSelectedClass(className);
        updateAllClassDisplays();
        closeDropdown();
        rerenderCurrentPage();
      });
    });
  }

  function openDropdown() {
    buildDropdown();
    btn.classList.add('open');
    dropdown.classList.add('open');
  }

  function closeDropdown() {
    btn.classList.remove('open');
    dropdown.classList.remove('open');
  }

  function toggleDropdown() {
    if (dropdown.classList.contains('open')) closeDropdown();
    else openDropdown();
  }

  btn.addEventListener('click', (e) => { e.stopPropagation(); toggleDropdown(); });

  if (isMobile) {
    dropdown.addEventListener('click', (e) => {
      if (e.target === dropdown) closeDropdown();
    });
  }

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      closeDropdown();
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDropdown(); });

  updateDisplay();
}

function updateAllClassDisplays() {
  const desktopName = $('current-class-name-desktop');
  const mobileName = $('current-class-name-mobile');
  if (desktopName) desktopName.textContent = state.currentClass;
  if (mobileName) mobileName.textContent = state.currentClass;
}

function setupNavigation() {
  // Desktop nav
  const desktopNav = $('main-nav-desktop');
  if (desktopNav) {
    desktopNav.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        location.hash = `#/${item.dataset.route}`;
      });
    });
  }
  // Mobile bottom nav
  const bottomNav = $('bottom-nav');
  if (bottomNav) {
    bottomNav.querySelectorAll('.bottom-nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        location.hash = `#/${item.dataset.route}`;
      });
    });
  }
}

function updateNavActiveState() {
  const route = state.route;
  // Desktop
  const desktopNav = $('main-nav-desktop');
  if (desktopNav) {
    desktopNav.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.route === route);
    });
  }
  // Mobile
  const bottomNav = $('bottom-nav');
  if (bottomNav) {
    bottomNav.querySelectorAll('.bottom-nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.route === route);
    });
  }
}

function setupDetailOverlay() {
  const overlay = $('detail-overlay');
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDetailPanel();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeDetailPanel();
  });
}

export function showCourseDetail(course) {
  const panel = $('detail-panel');
  const settings = state.settings;
  const teacher = course.teacher || '未提供';
  const location = course.location || '未提供';
  const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const wd = course.date ? weekdayNames[new Date(course.date + 'T00:00:00').getDay()] : '未知';
  const dateLabel = course.date ? `${course.date} 第${course.week}周 星期${wd}` : '未知';

  panel.innerHTML = `
    <div class="detail-header">
      <div>
        <div style="font-size:18px;font-weight:700;color:var(--color-text);line-height:1.4;">${course.courseName}</div>
        <div style="font-size:13px;color:var(--color-text-secondary);margin-top:4px;">第${course.startSection}-${course.endSection}节 · ${course.startTime}—${course.endTime}</div>
      </div>
      <button class="detail-close" id="detail-close-btn">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
    <div class="detail-body">
      <div class="detail-row"><span class="detail-label">时间</span><span class="detail-value mono">${dateLabel}</span></div>
      <div class="detail-row"><span class="detail-label">节次</span><span class="detail-value mono">第${course.startSection}-${course.endSection}节</span></div>
      <div class="detail-row"><span class="detail-label">时段</span><span class="detail-value mono">${course.startTime} — ${course.endTime}</span></div>
      <div class="detail-row"><span class="detail-label">季节</span><span class="detail-value">${course.seasonName || course.season}</span></div>
      <div class="detail-row"><span class="detail-label">地点</span><span class="detail-value ${!course.location ? 'muted' : ''}" style="word-break:break-all;text-align:right;">${location}</span></div>
      <div class="detail-row"><span class="detail-label">教师</span><span class="detail-value ${!course.teacher ? 'muted' : ''}">${teacher}</span></div>
      <div class="detail-row"><span class="detail-label">班级</span><span class="detail-value">${course.className}</span></div>
      ${course.courseId ? `<div class="detail-row"><span class="detail-label">课程编号</span><span class="detail-value mono muted">${course.courseId}</span></div>` : ''}
    </div>`;

  $('detail-close-btn').addEventListener('click', closeDetailPanel);
  $('detail-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDetailPanel() {
  $('detail-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

function handleRoute() {
  const hash = location.hash.replace('#/', '') || 'today';
  const route = routes[hash] ? hash : 'today';
  state.route = route;

  updateNavActiveState();

  document.querySelectorAll('.page-view').forEach(view => view.classList.remove('active'));

  if (state.pageCleanup) {
    state.pageCleanup();
    state.pageCleanup = null;
  }

  const container = $(`view-${route}`);
  container.classList.add('active');

  const routeConfig = routes[route];
  const result = routeConfig.render(container, state, dataManager);
  if (typeof result === 'function') {
    state.pageCleanup = result;
  } else if (result && typeof result.cleanup === 'function') {
    state.pageCleanup = result.cleanup;
  }

  // Scroll to top on route change (mobile)
  if (state.isMobile) {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}

export function rerenderCurrentPage() {
  const container = $(`view-${state.route}`);
  if (!container) return;
  if (state.pageCleanup) {
    state.pageCleanup();
    state.pageCleanup = null;
  }
  const routeConfig = routes[state.route];
  const result = routeConfig.render(container, state, dataManager);
  if (typeof result === 'function') {
    state.pageCleanup = result;
  } else if (result && typeof result.cleanup === 'function') {
    state.pageCleanup = result.cleanup;
  }
}

function startClock() {
  function tick() {
    state.now = new Date();
    document.dispatchEvent(new CustomEvent('app:tick', { detail: { now: state.now } }));
  }
  tick();
  setInterval(tick, 1000);
}

export function getAppState() { return state; }
export function updateState(partial) { Object.assign(state, partial); }

init();
