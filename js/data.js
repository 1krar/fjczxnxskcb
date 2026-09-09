import { getCourseStartEnd } from './time.js';

class DataManager {
  constructor() {
    this.raw = null;
    this.normalized = new Map();
    this.errors = [];
  }

  async load(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      this.raw = json;
      this.validate();
      this.normalize();
      return { success: true };
    } catch (err) {
      this.errors.push(`数据加载失败: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  validate() {
    this.errors = [];
    if (!this.raw) { this.errors.push('数据为空'); return; }
    if (!this.raw.classes) { this.errors.push('classes 字段不存在'); return; }

    const classEntries = this._classEntries();
    for (const { className, cls } of classEntries) {
      if (!className) {
        this.errors.push('存在无名称的班级');
      }
      if (!cls.courses) continue;
      for (const c of cls.courses) {
        if (c.start_section && c.end_section && c.start_section > c.end_section) {
          this.errors.push(`课程 ${c.course_name || ''} 的 start_section > end_section`);
        }
        if (c.start_section && (c.start_section < 1 || c.start_section > 10)) {
          this.errors.push(`课程 ${c.course_name || ''} 的 start_section 超出 1-10`);
        }
        if (c.end_section && (c.end_section < 1 || c.end_section > 10)) {
          this.errors.push(`课程 ${c.course_name || ''} 的 end_section 超出 1-10`);
        }
      }
    }
  }

  _classEntries() {
    const classes = this.raw.classes;
    if (Array.isArray(classes)) {
      return classes.map(cls => ({ className: cls.class_name || cls.class_id || '未知班级', cls }));
    }
    const result = [];
    for (const [key, cls] of Object.entries(classes)) {
      const className = cls.class_name || key;
      result.push({ className, cls });
    }
    return result;
  }

  normalize() {
    this.normalized.clear();
    if (!this.raw || !this.raw.classes) return;

    for (const { className, cls } of this._classEntries()) {
      const courses = (cls.courses || []).map(c => this.normalizeCourse(c, className, cls.class_id)).filter(Boolean);
      this.normalized.set(className, courses);
    }
  }

  normalizeCourse(c, className, classId) {
    if (!c) return null;
    const sectionTimes = this.raw?.section_times || {};
    const course = {
      className,
      classId,
      courseName: c.course_name || '未命名课程',
      teacher: c.teacher && c.teacher.trim() ? c.teacher.trim() : '',
      location: c.location && c.location !== '无' && c.location.trim() ? c.location.trim() : '',
      date: c.date || '',
      week: c.week || 0,
      weekday: c.weekday || 1,
      startSection: c.start_section || 1,
      endSection: c.end_section || c.start_section || 1,
      season: c.season || 'summer',
      seasonName: c.season_name || '',
      courseId: c.course_id || '',
      startSectionRaw: c.start_section,
      endSectionRaw: c.end_section,
    };

    const se = getCourseStartEnd(course, sectionTimes);
    if (se) {
      course.startTime = se.startTime;
      course.endTime = se.endTime;
      course.startDateTime = se.startDate;
      course.endDateTime = se.endDate;
    } else {
      course.startTime = '';
      course.endTime = '';
      course.startDateTime = null;
      course.endDateTime = null;
    }
    return course;
  }

  getSemesterInfo() {
    if (!this.raw) return null;
    return {
      semester: this.raw.semester || '',
      semesterStart: this.raw.semester_start || '',
      firstWeek: this.raw.first_week || 1,
      lastWeek: this.raw.last_week || 20,
      updatedAt: this.raw.updated_at || '',
      seasonMode: this.raw.season_mode || 'auto',
      seasonRule: this.raw.season_rule || {},
    };
  }

  getSectionTimes() {
    return this.raw?.section_times || {};
  }

  getClasses() {
    if (!this.raw) return [];
    return this._classEntries().map(({ className, cls }) => ({
      classId: cls.class_id || '',
      className,
    }));
  }

  getClass(className) {
    if (!this.raw) return null;
    const entry = this._classEntries().find(({ className: cn }) => cn === className);
    return entry ? entry.cls : null;
  }

  getCourses(className) {
    return this.normalized.get(className) || [];
  }

  getCoursesByDate(className, dateStr) {
    return this.getCourses(className)
      .filter(c => c.date === dateStr)
      .sort((a, b) => (a.startDateTime || 0) - (b.startDateTime || 0));
  }

  getCoursesByWeek(className, week) {
    return this.getCourses(className)
      .filter(c => c.week === week)
      .sort((a, b) => {
        if (a.weekday !== b.weekday) return a.weekday - b.weekday;
        return (a.startSection || 0) - (b.startSection || 0);
      });
  }

  getCoursesByWeekday(className, week, weekday) {
    return this.getCoursesByWeek(className, week)
      .filter(c => c.weekday === weekday)
      .sort((a, b) => (a.startSection || 0) - (b.startSection || 0));
  }

  getTodayCourses(className) {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return this.getCoursesByDate(className, `${y}-${m}-${d}`);
  }

  getCurrentCourse(className, now) {
    const courses = this.getTodayCourses(className);
    const t = now || new Date();
    return courses.find(c => c.startDateTime && c.endDateTime && t >= c.startDateTime && t < c.endDateTime) || null;
  }

  getNextCourse(className, now) {
    const courses = this.getTodayCourses(className);
    const t = now || new Date();
    return courses.find(c => c.startDateTime && c.startDateTime > t) || null;
  }

  getPreviousCourse(className, now) {
    const courses = this.getTodayCourses(className);
    const t = now || new Date();
    const past = courses.filter(c => c.endDateTime && c.endDateTime <= t);
    if (past.length === 0) return null;
    return past[past.length - 1];
  }

  getTomorrowCourses(className) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const d = String(tomorrow.getDate()).padStart(2, '0');
    return this.getCoursesByDate(className, `${y}-${m}-${d}`);
  }

  getCourseStats(className) {
    const courses = this.getCourses(className);
    const map = new Map();
    const MINUTES_PER_SECTION = 45;
    for (const c of courses) {
      const key = c.courseName;
      if (!map.has(key)) {
        map.set(key, {
          courseName: c.courseName,
          count: 0,
          totalSections: 0,
          totalMinutes: 0,
          teachers: new Set(),
          locations: new Set(),
        });
      }
      const stat = map.get(key);
      stat.count++;
      const sections = c.endSection - c.startSection + 1;
      stat.totalSections += sections;
      if (c.teacher) stat.teachers.add(c.teacher);
      if (c.location) stat.locations.add(c.location);

      // 教学时长按每节 45 分钟计算，不含课间休息
      stat.totalMinutes += sections * MINUTES_PER_SECTION;
    }
    return Array.from(map.values()).map(s => ({
      ...s,
      teachers: Array.from(s.teachers),
      locations: Array.from(s.locations),
      totalHours: Math.round(s.totalMinutes / 60 * 10) / 10,
    })).sort((a, b) => b.totalSections - a.totalSections);
  }

  getTeacherStats(className) {
    const courses = this.getCourses(className);
    const map = new Map();
    for (const c of courses) {
      if (!c.teacher) continue;
      if (!map.has(c.teacher)) {
        map.set(c.teacher, {
          teacher: c.teacher,
          courses: [],
          count: 0,
          locations: new Set(),
        });
      }
      const stat = map.get(c.teacher);
      stat.count++;
      if (c.location) stat.locations.add(c.location);
      if (!stat.courses.find(x => x.courseName === c.courseName && x.date === c.date && x.startSection === c.startSection)) {
        stat.courses.push({
          courseName: c.courseName,
          date: c.date,
          week: c.week,
          weekday: c.weekday,
          startSection: c.startSection,
          endSection: c.endSection,
          location: c.location,
          startTime: c.startTime,
          endTime: c.endTime,
        });
      }
    }
    return Array.from(map.values()).map(s => ({
      ...s,
      locations: Array.from(s.locations),
    })).sort((a, b) => b.count - a.count);
  }

  getRoomStats(className) {
    const courses = this.getCourses(className);
    const map = new Map();
    for (const c of courses) {
      if (!c.location) continue;
      if (!map.has(c.location)) {
        map.set(c.location, {
          room: c.location,
          count: 0,
          courses: [],
          dates: new Set(),
        });
      }
      const stat = map.get(c.location);
      stat.count++;
      stat.dates.add(c.date);
      if (!stat.courses.find(x => x.courseName === c.courseName && x.date === c.date)) {
        stat.courses.push({
          courseName: c.courseName,
          date: c.date,
          week: c.week,
          weekday: c.weekday,
          startSection: c.startSection,
          endSection: c.endSection,
          teacher: c.teacher,
        });
      }
    }
    return Array.from(map.values()).map(s => ({
      ...s,
      dates: Array.from(s.dates),
    })).sort((a, b) => b.count - a.count);
  }

  getWeekStats(className, week) {
    const courses = this.getCoursesByWeek(className, week);
    let totalSections = 0;
    let totalMinutes = 0;
    const byDay = {};
    for (let i = 1; i <= 7; i++) { byDay[i] = { courses: 0, sections: 0, minutes: 0 }; }
    const MINUTES_PER_SECTION = 45;

    for (const c of courses) {
      const sections = c.endSection - c.startSection + 1;
      totalSections += sections;
      // 教学时长按每节 45 分钟计算，不含课间休息
      const mins = sections * MINUTES_PER_SECTION;
      totalMinutes += mins;
      if (!byDay[c.weekday]) byDay[c.weekday] = { courses: 0, sections: 0, minutes: 0 };
      byDay[c.weekday].courses++;
      byDay[c.weekday].sections += sections;
      byDay[c.weekday].minutes += mins;
    }
    return {
      courseCount: courses.length,
      totalSections,
      totalHours: Math.round(totalMinutes / 60 * 10) / 10,
      byDay,
    };
  }

  search(className, query) {
    if (!query || query.trim().length === 0) return [];
    const q = query.trim().toLowerCase();
    const courses = this.getCourses(className);
    return courses.filter(c =>
      (c.courseName && c.courseName.toLowerCase().includes(q)) ||
      (c.teacher && c.teacher.toLowerCase().includes(q)) ||
      (c.location && c.location.toLowerCase().includes(q)) ||
      (c.className && c.className.toLowerCase().includes(q))
    ).sort((a, b) => (a.startDateTime || 0) - (b.startDateTime || 0));
  }

  searchAll(query) {
    if (!query || query.trim().length === 0) return [];
    const q = query.trim().toLowerCase();
    const results = [];
    for (const [className, courses] of this.normalized) {
      for (const c of courses) {
        if (
          (c.courseName && c.courseName.toLowerCase().includes(q)) ||
          (c.teacher && c.teacher.toLowerCase().includes(q)) ||
          (c.location && c.location.toLowerCase().includes(q)) ||
          (c.className && c.className.toLowerCase().includes(q))
        ) {
          results.push({ ...c });
        }
      }
    }
    return results.sort((a, b) => (a.startDateTime || 0) - (b.startDateTime || 0));
  }

  getFreeTimeAnalysis(className, week) {
    const info = this.getSemesterInfo();
    const weekDates = this._getWeekDatesArray(week, info.semesterStart);
    const days = [];

    for (let weekday = 1; weekday <= 5; weekday++) {
      const courses = this.getCoursesByWeekday(className, week, weekday);
      const dateStr = weekDates[weekday - 1];
      days.push(this._analyzeDayFreeTime(courses, dateStr, weekday));
    }
    return days;
  }

  _analyzeDayFreeTime(courses, dateStr, weekday) {
    const sectionTimes = this.getSectionTimes();
    const dayName = ['一', '二', '三', '四', '五'][weekday - 1] || String(weekday);
    if (courses.length === 0) {
      return {
        weekday,
        dayName,
        date: dateStr,
        slots: [{ type: 'free', label: '全天无课', duration: '8h+' }],
        totalFreeMin: 780,
      };
    }

    const firstCourse = courses[0];
    const lastCourse = courses[courses.length - 1];
    const dayStart = new Date(dateStr + 'T08:00:00');
    const dayEnd = new Date(dateStr + 'T21:00:00');
    const slots = [];
    let totalFreeMin = 0;

    if (firstCourse.startDateTime && firstCourse.startDateTime > dayStart) {
      const freeMin = Math.round((firstCourse.startDateTime - dayStart) / 60000);
      if (freeMin > 0) {
        slots.push({ type: 'free', label: '早晨空闲', duration: this._formatMin(freeMin), start: '08:00', end: firstCourse.startTime });
        totalFreeMin += freeMin;
      }
    }

    for (let i = 0; i < courses.length; i++) {
      const c = courses[i];
      slots.push({
        type: 'busy',
        label: c.courseName,
        duration: `${c.startTime}-${c.endTime}`,
        location: c.location,
      });

      if (i < courses.length - 1) {
        const next = courses[i + 1];
        if (c.endDateTime && next.startDateTime) {
          const gapMin = Math.round((next.startDateTime - c.endDateTime) / 60000);
          if (gapMin > 0) {
            const isLunch = c.endDateTime.getHours() <= 12 && next.startDateTime.getHours() >= 13;
            slots.push({
              type: isLunch ? 'lunch' : 'free',
              label: isLunch ? '午休' : '课间空闲',
              duration: this._formatMin(gapMin),
              start: c.endTime,
              end: next.startTime,
            });
            totalFreeMin += gapMin;
          }
        }
      }
    }

    if (lastCourse.endDateTime && lastCourse.endDateTime < dayEnd) {
      const freeMin = Math.round((dayEnd - lastCourse.endDateTime) / 60000);
      if (freeMin > 0) {
        slots.push({ type: 'free', label: '晚间空闲', duration: this._formatMin(freeMin), start: lastCourse.endTime, end: '21:00' });
        totalFreeMin += freeMin;
      }
    }

    return { weekday, dayName, date: dateStr, slots, totalFreeMin };
  }

  _formatMin(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h${m}m`;
  }

  _getWeekDatesArray(week, semesterStart) {
    const start = new Date(semesterStart + 'T00:00:00');
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() + (week - 1) * 7);
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${day}`);
    }
    return dates;
  }

  getFreeTimeSummary(className, week) {
    const analysis = this.getFreeTimeAnalysis(className, week);
    const totalFreeMin = analysis.reduce((sum, d) => sum + d.totalFreeMin, 0);
    return {
      totalFreeMin,
      totalFreeHours: Math.round(totalFreeMin / 60 * 10) / 10,
      days: analysis,
    };
  }

  hasErrors() { return this.errors.length > 0; }
  getErrors() { return this.errors; }
}

export const dataManager = new DataManager();
