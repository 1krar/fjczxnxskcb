// A relative date stays relative after saving a plan and across midnight.
export function wardrobeDate(view, today) {
  if (view.follow === 'custom') return view.date;
  if (view.follow === 'today') return today;
  const date = new Date(`${today}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function setWardrobeDate(view, date, today) {
  view.date = date;
  view.follow = date === today ? 'today' : date === wardrobeDate({follow:'tomorrow'},today) ? 'tomorrow' : 'custom';
}
export function wardrobeDateLabel(date, today) {
  const prefix = date === today ? '今天' : date === wardrobeDate({follow:'tomorrow'},today) ? '明天' : '所选日期';
  const weekday = new Date(`${date}T12:00:00`).getDay();
  return `${prefix} · ${Number(date.slice(5,7))}月${Number(date.slice(8))}日 周${'日一二三四五六'[weekday]}`;
}
