const STORAGE_KEY = 'course-dashboard-settings';

const defaults = {
  selectedClass: '26虚拟现实技术应用3',
  timeFormat: '24h',
  showTeacher: true,
  showFullLocation: true,
};

export function getSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(partial) {
  const current = getSettings();
  const updated = { ...current, ...partial };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // localStorage may be unavailable (private mode, etc.)
  }
  return updated;
}

export function getSelectedClass() {
  return getSettings().selectedClass;
}

export function setSelectedClass(className) {
  saveSettings({ selectedClass: className });
}

export function getSetting(key) {
  return getSettings()[key];
}

export function setSetting(key, value) {
  saveSettings({ [key]: value });
}
