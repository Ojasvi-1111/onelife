// Dates and times for OneLife.
// A Day is a 'YYYY-MM-DD' string in local time. Day arithmetic is done on calendar
// parts, never by parsing strings with Date or by adding 24 hours in milliseconds.
export const DAY_MIN = 1440;

export function pad2(n) { return (n < 10 ? '0' : '') + n; }
export function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

export function makeDay(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
export function splitDay(day) {
  return { y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) };
}
export function dateToDay(date) {
  return makeDay(date.getFullYear(), date.getMonth() + 1, date.getDate());
}
// Local noon of a Day: a safe anchor for calendar maths.
export function dayToDate(day) {
  const p = splitDay(day);
  return new Date(p.y, p.m - 1, p.d, 12, 0, 0, 0);
}
export function addDays(day, n) {
  const p = splitDay(day);
  return dateToDay(new Date(p.y, p.m - 1, p.d + n, 12, 0, 0, 0));
}
export function diffDays(from, to) {
  const a = splitDay(from);
  const b = splitDay(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}
export function weekdayOf(day) { return dayToDate(day).getDay(); }   // 0 = Sunday
export function weekStart(day) { return addDays(day, -((weekdayOf(day) + 6) % 7)); }   // Monday

export function hhmmToMin(hhmm) { return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)); }

// The logical day of a moment: before the cut-off it still belongs to the day before.
export function logicalDay(now, cutoff) {
  const day = dateToDay(now);
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins < hhmmToMin(cutoff) ? addDays(day, -1) : day;
}
// Minutes since the current logical day began.
export function minutesIntoDay(now, cutoff) {
  const mins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  return (mins - hhmmToMin(cutoff) + DAY_MIN) % DAY_MIN;
}
// Position of a clock time inside the logical day, in minutes from the cut-off.
export function offsetOf(hhmm, cutoff) {
  return (hhmmToMin(hhmm) - hhmmToMin(cutoff) + DAY_MIN) % DAY_MIN;
}
// A slot as offsets. An end equal to the cut-off counts as the end of the day.
export function slotOffsets(slot, cutoff) {
  if (!slot || !slot.start || !slot.end) return null;
  const start = offsetOf(slot.start, cutoff);
  let end = offsetOf(slot.end, cutoff);
  if (end === 0) end = DAY_MIN;
  return { start: start, end: end };
}
export function slotValid(slot, cutoff) {
  const o = slotOffsets(slot, cutoff);
  return !!o && o.end > o.start;
}
// The real moment of an offset inside a logical day.
export function momentOf(day, offsetMin, cutoff) {
  const p = splitDay(day);
  return new Date(p.y, p.m - 1, p.d, 0, hhmmToMin(cutoff) + offsetMin, 0, 0);
}

// Text helpers
export function fmtMinutes(min) {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return h + 'h ' + r + 'm';
  if (h) return h + 'h';
  return r + 'm';
}
export function fmtTime(hhmm) {
  const d = new Date(2000, 0, 1, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)));
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
}
export function fmtDay(day, options) {
  return new Intl.DateTimeFormat(undefined, options || { day: 'numeric', month: 'short' }).format(dayToDate(day));
}
