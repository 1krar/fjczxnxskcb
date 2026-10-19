const STORAGE_KEY = 'course-dashboard-class-updates-v1';
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function readStore() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function storeKey(semester, className) {
  return `${semester}::${className}`;
}

export function getSavedUpdate(semester, className) {
  return readStore()[storeKey(semester, className)] || null;
}

function cleanText(value, label, required = false) {
  if (typeof value !== 'string' || value.length > 500 || /[<>]/.test(value)) {
    throw new Error(`${label}包含不支持的内容`);
  }
  const text = value.trim();
  if (required && !text) throw new Error(`${label}不能为空`);
  return text;
}

function expectedDate(start, week, weekday) {
  const day = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) throw new Error('学期开始日期无效');
  day.setUTCDate(day.getUTCDate() + (week - 1) * 7 + weekday - 1);
  return day.toISOString().slice(0, 10);
}

export function validateImportedData(value, dm) {
  const base = dm.baseRaw;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('文件不是课表数据');
  if (value.semester !== base.semester || value.semester_start !== base.semester_start) {
    throw new Error('学期或开学日期与当前程序不一致');
  }
  if (!value.classes || typeof value.classes !== 'object' || Array.isArray(value.classes)) {
    throw new Error('文件缺少班级数据');
  }
  const entries = Object.entries(value.classes);
  if (entries.length !== 1) throw new Error('请选择抓取脚本生成的单班课表文件');
  const [className, cls] = entries[0];
  if (!Object.hasOwn(base.classes, className)) throw new Error('这个班级不在当前程序中');
  if (!cls || !Array.isArray(cls.courses) || cls.courses.length < 1 || cls.courses.length > 1000) {
    throw new Error('课程数量无效');
  }

  const seen = new Set();
  const courses = cls.courses.map((item, index) => {
    const label = `第${index + 1}条课程`;
    if (!item || typeof item !== 'object') throw new Error(`${label}格式无效`);
    const week = item.week;
    const weekday = item.weekday;
    const start = item.start_section;
    const end = item.end_section;
    if (![week, weekday, start, end].every(Number.isInteger) ||
        week < 1 || week > 25 || weekday < 1 || weekday > 7 ||
        start < 1 || end > 10 || start > end) {
      throw new Error(`${label}的周次或节次无效`);
    }
    const date = expectedDate(base.semester_start, week, weekday);
    if (item.date !== date) throw new Error(`${label}的日期与周次不匹配`);
    const name = cleanText(item.course_name, `${label}名称`, true);
    const location = cleanText(item.location || '', `${label}地点`);
    const teacher = cleanText(item.teacher || '', `${label}教师`);
    const courseId = cleanText(item.course_id || '', `${label}编号`);
    const key = [week, weekday, start, end, name, courseId].join('|');
    if (seen.has(key)) throw new Error(`${label}重复`);
    seen.add(key);
    const season = date.slice(5, 7) >= '06' && date.slice(5, 7) <= '09' ? 'summer' : 'winter';
    return {
      course_name: name,
      location,
      teacher,
      class_name: className,
      week,
      weekday,
      start_section: start,
      end_section: end,
      course_id: courseId,
      date,
      season,
      season_name: season === 'summer' ? '夏季' : '冬季',
    };
  });
  return { semester: base.semester, className, courses, sourceUpdatedAt: value.updated_at || '' };
}

function courseKey(course) {
  return [course.week, course.weekday, course.start_section, course.end_section, course.course_name].join('|');
}

export function compareCourses(current, incoming) {
  const oldMap = new Map(current.map(course => [courseKey(course), course]));
  const newMap = new Map(incoming.map(course => [courseKey(course), course]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [key, course] of newMap) {
    const old = oldMap.get(key);
    if (!old) added++;
    else if ((old.teacher || '') !== course.teacher ||
             (old.location || '') !== course.location ||
             (old.course_id || '') !== course.course_id) changed++;
  }
  for (const key of oldMap.keys()) if (!newMap.has(key)) removed++;
  return { added, removed, changed };
}

export function applySavedUpdates(dm) {
  const store = readStore();
  for (const [className] of Object.entries(dm.baseRaw.classes)) {
    const saved = store[storeKey(dm.baseRaw.semester, className)];
    if (!saved) continue;
    try {
      const candidate = validateImportedData({
        semester: dm.baseRaw.semester,
        semester_start: dm.baseRaw.semester_start,
        classes: { [className]: { courses: saved.courses } },
      }, dm);
      dm.setClassCourses(className, candidate.courses);
    } catch (error) {
      console.warn('忽略无效的本机课表数据:', error);
    }
  }
}

export function saveClassUpdate(dm, candidate) {
  const store = readStore();
  store[storeKey(candidate.semester, candidate.className)] = {
    courses: candidate.courses,
    importedAt: new Date().toISOString(),
    sourceUpdatedAt: candidate.sourceUpdatedAt,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  dm.setClassCourses(candidate.className, candidate.courses);
}

export function removeClassUpdate(dm, className) {
  const store = readStore();
  delete store[storeKey(dm.baseRaw.semester, className)];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  dm.restoreClassCourses(className);
}

export async function readUpdateFile(file) {
  if (!file || file.size > MAX_FILE_BYTES) throw new Error('请选择不超过 2 MB 的 JSON 文件');
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
}

export async function readProjectUpdate(semester, className) {
  const name = `${semester}_${className}_个人课表_新抓取.json`;
  const response = await fetch(`data/${encodeURIComponent(name)}?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
    throw new Error('项目目录里没有这个班级的新课表文件');
  }
  return response.json();
}
