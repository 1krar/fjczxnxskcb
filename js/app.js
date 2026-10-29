import { dataManager } from './data.js?v=20261030-1';
import { getSettings, setSelectedClass } from './storage.js?v=20261030-1';
import { getCurrentWeek, getTodayStr } from './time.js?v=20261030-1';
import { renderDashboard, cleanupDashboard } from './dashboard.js?v=20261030-1';
import { renderSchedule, cleanupSchedule } from './schedule.js?v=20261030-1';
import { renderAnalytics, cleanupAnalytics } from './analytics.js?v=20261030-1';
import { renderCompare, cleanupCompare } from './compare.js?v=20261030-1';
import { renderData } from './data-page.js?v=20261030-1';
import { applySavedUpdates } from './data-update.js?v=20261030-1';
import { renderSettings } from './settings.js?v=20261030-1';
import { renderTasks, setupPersonalItems, mountCourseItems } from './tasks.js?v=20261030-1';
import { renderWardrobe } from './wardrobe.js?v=20261030-1';
import { renderStudy } from './study.js?v=20261030-1';
import { STUDY_KEY } from './study-store.js?v=20261030-1';
import { renderAgenda, selectAgendaDate } from './agenda.js?v=20261030-1';
import { setupReminders, renderReminderSettings } from './reminders.js?v=20261030-1';
import { renderApiSettings } from './api-settings.js?v=20261030-1';
import { segmentMarkup } from './course-segments.js?v=20261030-1';
import { readAISettings } from './ai-client.js?v=20261030-1';
import { startAISession } from './ai-session-client.js?v=20261030-1';
import { createRefreshGate, trackEditors } from './refresh-guard.js?v=20261030-1';
import { reducedMotion } from './motion.js?v=20261030-1';
import { focusSelector } from './focus.js?v=20261030-1';

const state = {
  currentClass: '',
  settings: getSettings(),
  route: 'today',
  currentWeek: 1,
  scheduleWeek: 1,
  now: new Date(),
  pageCleanup: null,
  isMobile: window.innerWidth <= 768,
  scheduleFollowToday: true,
};

let refreshGate;
let sheetCleanup;

const routes = {
  today: { render: renderDashboard, cleanup: cleanupDashboard },
  schedule: { render: renderSchedule, cleanup: cleanupSchedule },
  agenda: { render: renderAgenda },
  reminders: { render: renderReminderSettings },
  api: { render: renderApiSettings },
  analytics: { render: renderAnalytics, cleanup: cleanupAnalytics },
  compare: { render: renderCompare, cleanup: cleanupCompare },
  data: { render: renderData, cleanup: null },
  settings: { render: renderSettings, cleanup: null },
  tasks: { render: renderTasks, cleanup: null },
  wardrobe: { render: renderWardrobe, cleanup: null },
  study: { render: renderStudy },
};

function $(id) { return document.getElementById(id); }

async function init() {
  if (readAISettings().enabled) startAISession();
  const dataUrl = 'data/2026-2027-1_虚拟现实技术应用_全部班级.json';
  const result = await dataManager.load(dataUrl);

  if (!result.success) {
    $('loading-screen').innerHTML = `
      <div style="text-align:center;max-width:420px;padding:24px;">
        <div style="font-size:1.125rem;font-weight:600;color:var(--color-text);margin-bottom:8px;">课程数据加载失败</div>
        <div style="font-size:0.875rem;color:var(--color-text-secondary);margin-bottom:20px;">请检查数据文件是否存在，然后刷新页面。</div>
        <button class="btn btn-primary" onclick="location.reload()">刷新页面</button>
      </div>`;
    return;
  }

  applySavedUpdates(dataManager);

  if (dataManager.hasErrors()) {
    console.warn('Data validation warnings:', dataManager.getErrors());
  }

  const classes = dataManager.getClasses();
  state.currentClass = classes.some(c => c.className === state.settings.selectedClass)
    ? state.settings.selectedClass
    : (classes[0]?.className || '');
  const info = dataManager.getSemesterInfo();
  state.currentWeek = getCurrentWeek(info.semesterStart);
  state.scheduleWeek = Math.max(info.firstWeek, Math.min(info.lastWeek, state.currentWeek));

  $('loading-screen').style.display = 'none';
  $('app').style.display = 'block';

  setupClassSelector();
  setupNavigation();
  setupDetailOverlay();
  setupRoutineRefresh();
  window.addEventListener('study:changed',()=>{if(state.route!=='study')requestPageRefresh('study');});
  window.addEventListener('storage',event=>{if((event.key===STUDY_KEY||event.key===null)&&state.route!=='study')requestPageRefresh('study');});
  setupPersonalItems(state, dataManager, rerenderCurrentPage, closeDetailPanel, requestPageRefresh);
  setupReminders(state, dataManager);
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
        // Wardrobe layout already adapts in CSS; preserve open editors and dates.
        if (state.route !== 'wardrobe') requestPageRefresh('resize');
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
        selectClass(className);
        closeDropdown();
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

export function selectClass(className) {
  if (!dataManager.getClasses().some(c => c.className === className)) return;
  state.currentClass = className;
  state.scheduleFollowToday=true;
  setSelectedClass(className);
  state.settings = getSettings();
  updateAllClassDisplays();
  rerenderCurrentPage();
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
        item.classList.toggle('active', item.dataset.route === (route === 'agenda' ? 'schedule' : ['api','reminders','study'].includes(route) ? 'settings' : route));
    });
  }
  // Mobile
  const bottomNav = $('bottom-nav');
  if (bottomNav) {
    bottomNav.querySelectorAll('.bottom-nav-item').forEach(item => {
      const mobileRoute = route === 'agenda' ? 'schedule' : ['wardrobe', 'analytics', 'compare', 'data','api','reminders','study'].includes(route) ? 'settings' : route;
      item.classList.toggle('active', item.dataset.route === mobileRoute);
    });
  }
}

function setupDetailOverlay() {
  const overlay = $('detail-overlay');
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDetailPanel();
  });
  overlay.addEventListener('cancel',event=>{event.preventDefault();closeDetailPanel();});
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeDetailPanel();
  });
}

export function showCourseDetail(course) {
  if(course.source==='evening-study') { closeDetailPanel();location.hash=`#/study?date=${encodeURIComponent(course.date)}`;return; }
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
        <div id="course-detail-title" style="font-size:1.125rem;font-weight:700;color:var(--color-text);line-height:1.4;">${course.courseName}</div>
        <div style="font-size:0.8125rem;color:var(--color-text-secondary);margin-top:4px;">第${course.startSection}-${course.endSection}节 · ${course.startTime}—${course.endTime}</div>
      </div>
      <button class="detail-close" id="detail-close-btn" aria-label="关闭课程详情">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
    <div class="detail-body">
      <div class="detail-row"><span class="detail-label">时间</span><span class="detail-value mono">${dateLabel}</span></div>
      <div class="detail-row"><span class="detail-label">节次</span><span class="detail-value mono">第${course.startSection}-${course.endSection}节</span></div>
      <div class="detail-row"><span class="detail-label">时段</span><span class="detail-value mono">${course.startTime} — ${course.endTime}</span></div>
      ${segmentMarkup(course, false)}
      <div class="detail-row"><span class="detail-label">季节</span><span class="detail-value">${course.seasonName || course.season}</span></div>
      <div class="detail-row"><span class="detail-label">地点</span><span class="detail-value ${!course.location ? 'muted' : ''}" style="word-break:break-all;text-align:right;">${location}</span></div>
      <div class="detail-row"><span class="detail-label">教师</span><span class="detail-value ${!course.teacher ? 'muted' : ''}">${teacher}</span></div>
      <div class="detail-row"><span class="detail-label">班级</span><span class="detail-value">${course.className}</span></div>
      ${course.courseId ? `<div class="detail-row"><span class="detail-label">课程编号</span><span class="detail-value mono muted">${course.courseId}</span></div>` : ''}
    </div>`;

  mountCourseItems(panel, course);
  $('detail-close-btn').addEventListener('click', closeDetailPanel);
  $('detail-overlay').classList.add('open');
  if (!$('detail-overlay').open) $('detail-overlay').showModal();
  $('detail-close-btn').focus({preventScroll:true});
  document.body.style.overflow = 'hidden';

  sheetCleanup?.(); sheetCleanup=setupSheetDragGesture(panel);
}

function closeDetailPanel() {
  sheetCleanup?.(); sheetCleanup=null;
  $('detail-overlay').classList.remove('open');
  if ($('detail-overlay').open) $('detail-overlay').close();
  document.body.style.overflow = '';
  document.dispatchEvent(new Event('app:editor-closed'));
}

function setupSheetDragGesture(panel) {
  if (window.innerWidth > 768) return;

  const overlay = $('detail-overlay');
  const CLOSE_THRESHOLD = 0.25;
  const VELOCITY_THRESHOLD = 500;
  const timers=new Set();
  const later=callback=>{const id=setTimeout(()=>{timers.delete(id);callback();},reducedMotion()?0:180);timers.add(id);};
  let startY = 0;
  let currentY = 0;
  let isDragging = false;
  let dragMode = null;
  let startTime = 0;

  function onTouchStart(e) {
    if (e.touches.length!==1) { onTouchCancel(); return; }
    if (e.target.closest('button,a,input,select,textarea,summary,label')) return;
    startY = e.touches[0].clientY;
    isDragging = true;
    dragMode = null;
    startTime = Date.now();
    currentY = 0;
    panel.style.transition = 'none';
  }

  function onTouchMove(e) {
    if (!isDragging) return;
    if (e.touches.length!==1) { onTouchCancel(); return; }
    const delta = e.touches[0].clientY - startY;

    if (dragMode === null) {
      const scrollTop = panel.scrollTop;
      if (delta > 0 && scrollTop > 0) {
        dragMode = 'scroll';
        return;
      }
      if (delta < 0 && scrollTop < panel.scrollHeight - panel.clientHeight - 1) {
        dragMode = 'scroll';
        return;
      }
      if (Math.abs(delta) > 5) {
        dragMode = 'drag';
      } else {
        return;
      }
    }

    if (dragMode === 'drag') {
      e.preventDefault();
      currentY = Math.max(0, delta);
      panel.style.transform = `translateY(${currentY}px)`;
      const progress = currentY / panel.clientHeight;
      overlay.style.background = `rgba(15, 23, 42, ${0.35 * (1 - progress * 0.5)})`;

    }
  }

  function onTouchEnd() {
    if (!isDragging) return;
    isDragging = false;

    if (dragMode !== 'drag') {
      panel.style.transition = '';
      return;
    }

    const elapsed = Date.now() - startTime;
    const velocity = elapsed > 0 ? (currentY / elapsed) * 1000 : 0;
    const progress = currentY / panel.clientHeight;

    panel.style.transition = 'transform 180ms var(--ease-out)';
    overlay.style.transition = 'background 180ms var(--ease-out)';

    if (progress > CLOSE_THRESHOLD || velocity > VELOCITY_THRESHOLD) {
      panel.style.transform = 'translateY(100%)';
      overlay.style.background = 'rgba(15, 23, 42, 0)';
      later(() => {
        closeDetailPanel();
        panel.style.transform = '';
        panel.style.transition = '';
        overlay.style.transition = '';
        overlay.style.background = '';
      });
    } else {
      panel.style.transform = 'translateY(0)';
      overlay.style.background = '';
      later(() => {
        panel.style.transition = '';
        overlay.style.transition = '';
      });
    }

    dragMode = null;
  }

  function onTouchCancel() {
    isDragging = false;
    dragMode = null;
    currentY = 0;
    panel.style.transform = '';
    panel.style.transition = '';
    overlay.style.background = '';
    overlay.style.transition = '';
  }

  panel.addEventListener('touchstart', onTouchStart, { passive: true });
  panel.addEventListener('touchmove', onTouchMove, { passive: false });
  panel.addEventListener('touchend', onTouchEnd, { passive: true });
  panel.addEventListener('touchcancel', onTouchCancel, { passive: true });
  return ()=>{
    for(const id of timers)clearTimeout(id);
    panel.removeEventListener('touchstart',onTouchStart);panel.removeEventListener('touchmove',onTouchMove);
    panel.removeEventListener('touchend',onTouchEnd);panel.removeEventListener('touchcancel',onTouchCancel);
    panel.style.transform='';panel.style.transition='';overlay.style.transition='';overlay.style.background='';
  };
}

function handleRoute() {
  const [hash,query=''] = (location.hash.replace('#/', '') || 'today').split('?',2);
  const route = routes[hash] ? hash : 'today';
  state.routeParams=new URLSearchParams(query);
  if (route === 'agenda' && state.route === 'today') selectAgendaDate(getTodayStr());
  state.route = route;
  refreshGate?.clear();

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
  let lastDate = getTodayStr();
  function tick() {
    state.now = new Date();
    const today = getTodayStr();
    if (today !== lastDate) {
      lastDate = today;
      state.currentWeek = getCurrentWeek(dataManager.getSemesterInfo().semesterStart);
      requestPageRefresh('date');
    }
    document.dispatchEvent(new CustomEvent('app:tick', { detail: { now: state.now } }));
  }
  tick();
  setInterval(tick, 1000);
}

function setupRoutineRefresh() {
  const notice=document.createElement('p');
  notice.className='refresh-notice'; notice.id='page-refresh-notice'; notice.hidden=true;
  notice.setAttribute('role','status');
  document.querySelector('.page-container').prepend(notice);
  const editors=trackEditors(document,()=>refreshGate?.flush());
  refreshGate=createRefreshGate({
    canRefresh:()=>!editors.busy(),
    pending:reasons=>{
      notice.hidden=!reasons.includes('date');
      notice.textContent=notice.hidden?'':'日期已变化。当前编辑已保留，保存或关闭后更新显示。';
    },
    refresh:()=>{
      const selector=focusSelector(document.activeElement), y=window.scrollY, oldTop=document.activeElement?.getBoundingClientRect().top;
      const messages=[...document.querySelectorAll('.page-view.active [data-save-feedback][id]')].map(node=>[node.id,node.textContent]);
      if (state.route==='wardrobe') document.dispatchEvent(new Event('app:refresh-wardrobe'));
      else rerenderCurrentPage();
      for(const [key,value]of messages) { const node=document.getElementById(key);if(node&&value&&!node.textContent)node.textContent=value; }
      const active=document.querySelector('.page-view.active');
      const target=selector&&(active?.querySelector(selector)||(selector.startsWith('#')?document.querySelector(selector):null)||active?.querySelector('[data-today-capture],#personal-add,#agenda-add'));
      target?.focus({preventScroll:true});
      const offset=target&&oldTop>=0&&oldTop<innerHeight?target.getBoundingClientRect().top-oldTop:0;
      window.scrollTo({top:y+offset,behavior:'auto'});
    },
  });
}

export function requestPageRefresh(reason='data') {
  if (refreshGate) refreshGate.request(reason); else rerenderCurrentPage();
}

export function getAppState() { return state; }
export function updateState(partial) { Object.assign(state, partial); }

init();
