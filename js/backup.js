// Backup: export, import and the spreadsheet files.
import { state, write, defaultSettings, clock } from './store.js';
import { addDays, logicalDay, slotValid } from './time.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const KINDS = ['done', 'missed', 'skipped', 'makeup', 'step', 'number', 'finished'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => (n < 10 ? '0' : '') + n;
const isDay = (v) => typeof v === 'string' && DAY_RE.test(v);
const isTime = (v) => typeof v === 'string' && TIME_RE.test(v);
const isStamp = (v) => typeof v === 'string' && !isNaN(Date.parse(v));
const bad = (message) => new Error(message);

// ----- Reminder -----
export function backupDue() {
  const days = state.settings.backupReminderDays;
  if (!days || !state.goals.length) return false;
  let since = state.settings.lastBackupAt;
  if (!since) {
    since = state.goals.reduce((min, g) => (g.createdAt < min ? g.createdAt : min), state.goals[0].createdAt);
  }
  const t = Date.parse(since);
  if (isNaN(t)) return true;
  return clock().getTime() - t > days * 86400000;
}
export function lastBackupText() {
  const at = state.settings.lastBackupAt;
  if (!at || isNaN(Date.parse(at))) return 'never';
  const days = Math.floor((clock().getTime() - Date.parse(at)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return days + ' days ago';
}

// ----- Building files (no waiting, so the share sheet may open from the tap) -----
export function backupFile() {
  const now = clock();
  const data = {
    app: 'onelife', schemaVersion: 1, exportedAt: now.toISOString(),
    settings: state.settings, goals: state.goals, entries: state.entries
  };
  const name = 'onelife-backup-' + now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + '.json';
  return new File([JSON.stringify(data, null, 1)], name, { type: 'application/json' });
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvFile(name, rows) {
  const text = '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return new File([text], name, { type: 'text/csv' });
}
function scheduleText(g) {
  const r = g.repeat;
  const each = r.sessionMinutes ? ', ' + r.sessionMinutes + ' min' : '';
  if (r.mode === 'perWeek') return r.times + ' times a week' + each;
  if (r.mode === 'days') {
    return r.slots.map((s) => WD[s.weekday] + (s.start ? ' ' + s.start + '-' + s.end : '')).join('; ') + each;
  }
  return '';
}
function measureText(g) {
  const m = g.measure;
  if (m.type === 'steps') return 'steps: ' + m.steps.map((s) => s.text).join(' | ');
  if (m.type === 'number') return 'number: ' + m.startValue + ' to ' + m.target + (m.unit ? ' ' + m.unit : '');
  return 'tick';
}
export function csvFiles() {
  const goalRows = [['id', 'title', 'status', 'importance', 'start', 'end', 'schedule', 'measure', 'created', 'finished']];
  state.goals.forEach((g) => goalRows.push([
    g.id, g.title, g.status, g.importance, g.run.start || '', g.run.end || '',
    scheduleText(g), measureText(g), g.createdAt, g.finishedAt || ''
  ]));
  const byId = new Map(state.goals.map((g) => [g.id, g]));
  const rows = [['day', 'time', 'goal', 'kind', 'minutes', 'value', 'step']];
  state.entries.slice()
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .forEach((e) => {
      const g = byId.get(e.goalId);
      const at = new Date(e.at);
      let step = '';
      if (e.kind === 'step' && g && g.measure.type === 'steps') {
        const s = g.measure.steps.find((x) => x.id === e.stepId);
        step = s ? s.text : '';
      }
      rows.push([
        e.day, pad(at.getHours()) + ':' + pad(at.getMinutes()), g ? g.title : '', e.kind,
        e.minutes || 0, e.kind === 'number' ? e.value : '', step
      ]);
    });
  return [csvFile('goals.csv', goalRows), csvFile('history.csv', rows)];
}

function download(files) {
  files.forEach((file) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
}
// Hand files to the share sheet on touch devices, or download them elsewhere.
// Resolves to 'shared', 'downloaded' or 'cancelled'. Call directly from a tap.
export function deliver(files) {
  const touch = navigator.maxTouchPoints > 0;
  if (touch && navigator.canShare && navigator.canShare({ files: files })) {
    return navigator.share({ files: files }).then(() => 'shared', (err) => {
      if (err && err.name === 'AbortError') return 'cancelled';
      download(files);
      return 'downloaded';
    });
  }
  download(files);
  return Promise.resolve('downloaded');
}

// ----- Reading a backup: check everything before anything is replaced -----
function pickSettings(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.quote === 'string') out.quote = raw.quote.slice(0, 120);
  if (['compact', 'comfortable', 'large'].indexOf(raw.minBox) !== -1) out.minBox = raw.minBox;
  if (['full', 'calm', 'off'].indexOf(raw.motion) !== -1) out.motion = raw.motion;
  ['sound', 'surge', 'keepAwake', 'installBannerDismissed'].forEach((k) => {
    if (typeof raw[k] === 'boolean') out[k] = raw[k];
  });
  if (isTime(raw.dayCutoff) && raw.dayCutoff <= '06:00') out.dayCutoff = raw.dayCutoff;
  if ([0, 7, 14, 30].indexOf(raw.backupReminderDays) !== -1) out.backupReminderDays = raw.backupReminderDays;
  if (['wall', 'wins', 'calendar'].indexOf(raw.doneTab) !== -1) out.doneTab = raw.doneTab;
  return out;
}

// Handwriting: keep the strokes that are sound. Damaged ink is dropped, never the whole backup.
function cleanInk(ink) {
  if (!ink || typeof ink !== 'object' || !Array.isArray(ink.strokes)) return null;
  const w = Number(ink.w);
  const h = Number(ink.h);
  if (!(w > 0) || !(h > 0)) return null;
  const strokes = [];
  let total = 0;
  for (let i = 0; i < ink.strokes.length; i++) {
    const s = ink.strokes[i];
    if (!Array.isArray(s) || s.length < 2 || s.length % 2 !== 0) continue;
    if (!s.every((v) => typeof v === 'number' && isFinite(v))) continue;
    total += s.length;
    if (total > 400000) break;
    strokes.push(s.map((v) => Math.round(v)));
  }
  return strokes.length ? { w: w, h: h, strokes: strokes } : null;
}

function cleanRepeat(r, where, cutoff) {
  if (!r || r.mode === 'none') return { mode: 'none' };
  const minutes = r.sessionMinutes == null ? null : Math.round(Number(r.sessionMinutes));
  const sessionMinutes = minutes !== null && minutes >= 1 && minutes <= 1440 ? minutes : null;
  if (r.mode === 'perWeek') {
    const times = Math.round(Number(r.times));
    if (!(times >= 1 && times <= 7)) throw bad(where + ' has a bad weekly count.');
    return { mode: 'perWeek', times: times, sessionMinutes: sessionMinutes };
  }
  if (r.mode === 'days' && Array.isArray(r.slots) && r.slots.length) {
    const seen = new Set();
    const slots = r.slots.map((s) => {
      const w = s ? s.weekday : -1;
      if (!(w >= 0 && w <= 6) || Math.round(w) !== w || seen.has(w)) throw bad(where + ' has a bad weekday.');
      seen.add(w);
      const start = s.start == null ? null : s.start;
      const end = s.end == null ? null : s.end;
      if ((start === null) !== (end === null)) throw bad(where + ' has a half-set time slot.');
      if (start !== null && (!isTime(start) || !isTime(end) || !slotValid({ start: start, end: end }, cutoff))) {
        throw bad(where + ' has a time slot that does not fit inside one day.');
      }
      return { weekday: w, start: start, end: end };
    });
    slots.sort((a, b) => a.weekday - b.weekday);
    return { mode: 'days', sessionMinutes: sessionMinutes, slots: slots };
  }
  throw bad(where + ' has an unknown schedule.');
}

function cleanMeasure(m, where) {
  if (!m || m.type === 'check') return { type: 'check' };
  if (m.type === 'steps' && Array.isArray(m.steps) && m.steps.length) {
    const seen = new Set();
    return {
      type: 'steps',
      steps: m.steps.map((s) => {
        if (!s || typeof s.id !== 'string' || !s.id || seen.has(s.id) || typeof s.text !== 'string') {
          throw bad(where + ' has a damaged step.');
        }
        seen.add(s.id);
        return { id: s.id, text: s.text.slice(0, 80) };
      })
    };
  }
  if (m.type === 'number') {
    const target = Number(m.target);
    const startValue = Number(m.startValue);
    if (!isFinite(target) || !isFinite(startValue) || !(target > startValue)) {
      throw bad(where + ' has a bad number target.');
    }
    return { type: 'number', target: target, unit: typeof m.unit === 'string' ? m.unit.slice(0, 12) : '', startValue: startValue };
  }
  throw bad(where + ' has an unknown measure.');
}

function cleanGoal(g, i, cutoff, ids) {
  const where = 'Goal ' + (i + 1);
  if (!g || typeof g !== 'object') throw bad(where + ' is damaged.');
  if (typeof g.id !== 'string' || !g.id || ids.has(g.id)) throw bad(where + ' has a bad id.');
  const title = typeof g.title === 'string' ? g.title.trim().slice(0, 80) : '';
  if (!title) throw bad(where + ' has no title.');
  if (['active', 'finished', 'dropped'].indexOf(g.status) === -1) throw bad(where + ' has an unknown status.');
  if (!isStamp(g.createdAt)) throw bad(where + ' has a bad creation time.');
  const run = g.run || {};
  const start = run.start == null ? null : run.start;
  const end = run.end == null ? null : run.end;
  if ((start !== null && !isDay(start)) || (end !== null && !isDay(end)) ||
      (end && !start) || (start && end && end < start)) {
    throw bad(where + ' has bad dates.');
  }
  const repeat = cleanRepeat(g.repeat, where, cutoff);
  if (repeat.mode !== 'none' && !start) throw bad(where + ' repeats but has no start date.');
  const measure = cleanMeasure(g.measure, where);
  ids.add(g.id);
  const importance = Math.round(Number(g.importance));
  const color = Math.round(Number(g.color));
  return {
    id: g.id,
    title: title,
    notes: typeof g.notes === 'string' ? g.notes.slice(0, 2000) : '',
    color: color >= 0 && color <= 7 ? color : 0,
    importance: importance >= 1 && importance <= 5 ? importance : 3,
    status: g.status,
    createdAt: g.createdAt,
    finishedAt: isStamp(g.finishedAt) ? g.finishedAt : null,
    scheduleSetAt: isStamp(g.scheduleSetAt) ? g.scheduleSetAt : g.createdAt,
    run: { start: start, end: end },
    repeat: repeat,
    measure: measure,
    inkTitle: cleanInk(g.inkTitle),
    inkNote: cleanInk(g.inkNote)
  };
}

function cleanEntry(e, i, goalIds, seen) {
  const where = 'History line ' + (i + 1);
  if (!e || typeof e.id !== 'string' || !e.id || seen.has(e.id)) throw bad(where + ' has a bad id.');
  if (!goalIds.has(e.goalId)) throw bad(where + ' belongs to no goal.');
  if (!isDay(e.day) || !isStamp(e.at) || KINDS.indexOf(e.kind) === -1) throw bad(where + ' is damaged.');
  seen.add(e.id);
  const minutes = Math.round(Number(e.minutes));
  const out = {
    id: e.id, goalId: e.goalId, day: e.day, at: e.at, kind: e.kind,
    minutes: minutes >= 0 && minutes <= 1440 ? minutes : 0
  };
  if (e.kind === 'number') {
    const value = Number(e.value);
    if (!isFinite(value)) throw bad(where + ' has a bad amount.');
    out.value = value;
  }
  if (e.kind === 'step') {
    if (typeof e.stepId !== 'string') throw bad(where + ' has no step.');
    out.stepId = e.stepId;
  }
  if (e.kind === 'makeup' && typeof e.clearsEntryId === 'string') out.clearsEntryId = e.clearsEntryId;
  return out;
}

// Returns { goals, entries, settings, exportedAt } or throws an Error with a readable message.
export function parseBackup(text) {
  let data = null;
  try { data = JSON.parse(text); } catch (err) { throw bad('This file is not a OneLife backup.'); }
  if (!data || data.app !== 'onelife' || !Array.isArray(data.goals) || !Array.isArray(data.entries)) {
    throw bad('This file is not a OneLife backup.');
  }
  if (typeof data.schemaVersion !== 'number' || data.schemaVersion > 1) {
    throw bad('This backup comes from a newer version of OneLife.');
  }
  const settings = Object.assign(defaultSettings(), pickSettings(data.settings));
  const goalIds = new Set();
  const goals = data.goals.map((g, i) => cleanGoal(g, i, settings.dayCutoff, goalIds));
  const entryIds = new Set();
  const entries = data.entries.map((e, i) => cleanEntry(e, i, goalIds, entryIds));
  return {
    goals: goals, entries: entries, settings: settings,
    exportedAt: isStamp(data.exportedAt) ? data.exportedAt : null
  };
}

// Replace everything. The days between the export and now are never marked missed.
export async function restoreBackup(parsed) {
  const today = logicalDay(clock(), parsed.settings.dayCutoff);
  const settings = Object.assign({}, parsed.settings, {
    lastClosedDay: addDays(today, -1),
    lastBackupAt: parsed.exportedAt
  });
  await write({ clear: true, putGoals: parsed.goals, putEntries: parsed.entries, settings: settings }, () => {
    state.goals = parsed.goals;
    state.entries = parsed.entries;
    state.settings = settings;
  });
}
