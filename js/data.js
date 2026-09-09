// ========== Data Manager ==========
// Loads and normalizes course data from JSON files

import { getWeekDates, getSectionTime } from './time.js';

class DataManager {
  constructor() {
    this.data = null;
    this.loaded = false;
  }

  async load() {
    try {
      // Try to load all class data files
      const response = await fetch('data/courses.json');
      if (!response.ok) throw new Error('Failed to load courses.json');
      this.data = await response.json();
      this.loaded = true;
      this._normalize();
      return true;
    } catch (e) {
      console.error('Data load error:', e);
      return false;
    }
  }

  _normalize() {
    if (!this.data?.classes) return;

    const sectionTimes = this.data.sectionTimes || {};

    for (const cls of this.data.classes) {
      if (!cls.courses) cls.courses = [];
      for (const c of cls.courses) {
        // Ensure date format
        if (c.date) {
          c.date = String(c.date);
        }
        // Ensure sections are numbers
        c.startSection = Number(c.startSection);
        c.endSection = Number(c.endSection);

        // Compute Date objects for start/end
        if (c.date && sectionTimes[c.season]) {
          const times = sectionTimes[c.season];
          const startInfo = times[String(c.startSection)];
          const endInfo = times[String(c.endSection)];
          if (startInfo && endInfo) {
            c.startDateTime = new Date(c.date + 'T' + startInfo.start + ':00');
            c.endDateTime = new Date(c.date + 'T' + endInfo.end + ':00');
            c.startTime = startInfo.start;
            c.endTime = endInfo.end;
          }
        }

        // Compute weekday if missing
        if (c.date && !c.weekday) {
          const d = new Date(c.date + 'T00:00:00');
          c.weekday = d.getDay() === 0 ? 7 : d.getDay();
        }

        // Compute week if missing
        if (!c.week && c.date && this.data.semesterStart) {
          const start = new Date(this.data.semesterStart + 'T00:00:00');
          const courseDate = new Date(c.date + 'T00:00:00');
          const diffDays = Math.floor((courseDate - start) / 86400000);
          c.week = Math.floor(diffDays / 7) + 1;
        }

        // Add className reference
        c.className = cls.className;
      }
    }
  }

  getSemesterInfo() {
    if (!this.data) return null;
    return {
      semesterName: this.data.semesterName || '',
      semesterStart: this.data.semesterStart || '',
      semesterEnd: this.data.semesterEnd || '',
      firstWeek: this.data.firstWeek || 1,
      lastWeek: this.data.lastWeek || 20,
      totalWeeks: this.data.totalWeeks || 20,
      sectionTimes: this.data.sectionTimes || {},
      season: this.data.season || 'summer',
    };
  }

  getSectionTimes() {
    return this.data?.sectionTimes || {};
  }

  getClasses() {
    if (!this.data?.classes) return [];
    return this.data.classes.map(c => ({
      className: c.className,
      classId: c.classId,
    }));
  }

  getCourses(className) {
    if (!this.data?.classes) return [];
    const cls = this.data.classes.find(c => c.className === className);
    return cls?.courses || [];
  }

  getCoursesByWeek(className, week) {
    return this.getCourses(className).filter(c => c.week === week);
  }

  getCoursesByWeekday(className, week, weekday) {
    return this.getCoursesByWeek(className, week)
      .filter(c => c.weekday === weekday)
      .sort((a, b) => a.startSection - b.startSection);
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
          startTime: c.startTime,
          endTime: c.endTime,
          location: c.location,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
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
        });
      }
      const stat = map.get(c.location);
      stat.count++;
      if (!stat.courses.find(x => x.courseName === c.courseName && x.date === c.date && x.startSection === c.startSection)) {
        stat.courses.push({
          courseName: c.courseName,
          date: c.date,
          startSection: c.startSection,
          endSection: c.endSection,
          teacher: c.teacher,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
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

  getFreeTimeAnalysis(className, week) {
    const courses = this.getCoursesByWeek(className, week);
    const sectionTimes = this.getSectionTimes();
    const season = this.data?.season || 'summer';
    const times = sectionTimes[season];
    if (!times) return { byDay: {} };

    const byDay = {};
    for (let d = 1; d <= 5; d++) {
      const dayCourses = courses.filter(c => c.weekday === d).sort((a, b) => a.startSection - b.startSection);
      const intervals = [];

      // Day boundaries: section 1 start to section 10 end
      const dayStart = times['1']?.start || '08:00';
      const dayEnd = times['10']?.end || '21:00';

      let lastEnd = dayStart;
      for (const c of dayCourses) {
        const cStart = times[String(c.startSection)]?.start;
        const cEnd = times[String(c.endSection)]?.end;
        if (!cStart || !cEnd) continue;

        if (cStart > lastEnd) {
          intervals.push({
            start: lastEnd,
            end: cStart,
            duration: this._timeDiff(cStart, lastEnd),
          });
        }
        lastEnd = cEnd > lastEnd ? cEnd : lastEnd;
      }

      if (dayEnd > lastEnd) {
        intervals.push({
          start: lastEnd,
          end: dayEnd,
          duration: this._timeDiff(dayEnd, lastEnd),
        });
      }

      byDay[d] = {
        intervals,
        totalFreeMin: intervals.reduce((s, i) => s + i.duration, 0),
      };
    }

    return { byDay };
  }

  _timeDiff(later, earlier) {
    const [h1, m1] = later.split(':').map(Number);
    const [h2, m2] = earlier.split(':').map(Number);
    return (h1 * 60 + m1) - (h2 * 60 + m2);
  }

  getFreeTimeSummary(className, week) {
    const analysis = this.getFreeTimeAnalysis(className, week);
    let totalFreeMin = 0;
    let busiestDay = 1;
    let leastFree = Infinity;
    for (let d = 1; d <= 5; d++) {
      const min = analysis.byDay[d]?.totalFreeMin || 0;
      totalFreeMin += min;
      if (min < leastFree) {
        leastFree = min;
        busiestDay = d;
      }
    }
    return {
      totalFreeMin,
      totalFreeHours: Math.round(totalFreeMin / 60 * 10) / 10,
      busiestDay,
      avgFreePerDay: Math.round(totalFreeMin / 5),
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

  validateData() {
    const issues = [];
    if (!this.data?.classes) {
      issues.push('没有找到班级数据');
      return issues;
    }
    for (const cls of this.data.classes) {
      if (!cls.courses || cls.courses.length === 0) {
        issues.push(`${cls.className}: 没有课程数据`);
        continue;
      }
      for (const c of cls.courses) {
        if (!c.courseName) issues.push(`${cls.className}: 存在无名称课程`);
        if (!c.date) issues.push(`${cls.className}: ${c.courseName || '某课程'} 缺少日期`);
        if (!c.startSection || !c.endSection) {
          issues.push(`${cls.className}: ${c.courseName || '某课程'} 缺少节次信息`);
        }
        if (c.startSection > c.endSection) {
          issues.push(`${cls.className}: ${c.courseName} 节次范围异常`);
        }
      }
    }
    return issues;
  }
}

export const dm = new DataManager();
export default dm;
