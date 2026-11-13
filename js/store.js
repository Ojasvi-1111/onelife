// The app's data: one copy in memory, mirrored to the iPad's database.
// The memory copy changes only after the database write has succeeded.
import { loadAll, commit } from './db.js';
import { closeDays } from './dayclose.js';
import { indexEntries } from './sessions.js';
import { logicalDay, addDays, splitDay } from './time.js';

export const DEFAULT_QUOTE = 'One Life - why are you not running towards your goals like you are on fire';

export function defaultSettings() {
  return {
    quote: DEFAULT_QUOTE,
    minBox: 'comfortable',
    motion: 'full',
    sound: true,
    surge: true,
    keepAwake: false,
    dayCutoff: '04:00',
    backupReminderDays: 7,
    lastBackupAt: null,
    lastClosedDay: null,
    installBannerDismissed: false,
    doneTab: 'wall',
    schemaVersion: 1
  };
}

export const state = { goals: [], entries: [], settings: defaultSettings(), byGoal: new Map() };

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed() {
  state.byGoal = indexEntries(state.entries);
  listeners.forEach((fn) => { try { fn(); } catch (err) { console.error(err); } });
}

// One change: database first, then memory, then tell the screen.
export async function write(ops, apply) {
  await commit(ops);
  apply();
  changed();
}

// The one place the app reads the clock. For testing, add ?now=2026-11-13T18:40 to the address.
const forced = new URLSearchParams(location.search).get('now');
const clockOffset = forced && !isNaN(Date.parse(forced)) ? Date.parse(forced) - Date.now() : 0;
export function clock() { return new Date(Date.now() + clockOffset); }
export function todayDay() { return logicalDay(clock(), state.settings.dayCutoff); }

export function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
export function getGoal(id) { return state.goals.find((g) => g.id === id) || null; }

export async function load() {
  const data = await loadAll();
  state.goals = data.goals;
  state.entries = data.entries;
  state.settings = Object.assign(defaultSettings(), data.settings || {});
  state.byGoal = indexEntries(state.entries);
}

// Turns unticked sessions of closed days into "missed". Safe to call at any time.
export async function runDayClose() {
  const res = closeDays(state, clock(), newId);
  if (!res.entries.length && res.lastClosedDay === state.settings.lastClosedDay) return res;
  const settings = Object.assign({}, state.settings, { lastClosedDay: res.lastClosedDay });
  await write({ putEntries: res.entries, settings: settings }, () => {
    state.entries = state.entries.concat(res.entries);
    state.settings = settings;
  });
  return res;
}

function nextColor() {
  const counts = [0, 0, 0, 0, 0, 0, 0, 0];
  state.goals.forEach((g) => { if (g.status === 'active') counts[g.color % 8]++; });
  let best = 0;
  for (let i = 1; i < 8; i++) if (counts[i] < counts[best]) best = i;
  return best;
}

function cleanTitle(title) {
  const t = String(title == null ? '' : title).trim().slice(0, 80);
  if (!t) throw new Error('A goal needs a title');
  return t;
}

// The parts of a goal that decide when its sessions happen.
function scheduleKey(goal) {
  const r = goal.repeat;
  let rep = r.mode;
  if (r.mode === 'perWeek') rep += '|' + r.times + '|' + (r.sessionMinutes || '');
  if (r.mode === 'days') {
    rep += '|' + (r.sessionMinutes || '') + '|' + r.slots.slice()
      .sort((a, b) => a.weekday - b.weekday)
      .map((s) => s.weekday + ':' + (s.start || '') + '-' + (s.end || '')).join(',');
  }
  return (goal.run.start || '') + '|' + (goal.run.end || '') + '|' + rep;
}

export async function addGoal(fields) {
  const stamp = clock().toISOString();
  const goal = Object.assign({
    id: newId(), title: '', notes: '', color: nextColor(), importance: 3, status: 'active',
    createdAt: stamp, finishedAt: null, scheduleSetAt: stamp,
    run: { start: null, end: null }, repeat: { mode: 'none' }, measure: { type: 'check' }
  }, fields);
  goal.title = cleanTitle(goal.title);
  await write({ putGoals: [goal] }, () => { state.goals = state.goals.concat([goal]); });
  return goal;
}

export async function updateGoal(id, fields) {
  const old = getGoal(id);
  if (!old) throw new Error('This goal no longer exists');
  const goal = Object.assign({}, old, fields);
  goal.title = cleanTitle(goal.title);
  const mine = state.entries.filter((e) => e.goalId === id);
  // The measure cannot change once progress is recorded.
  if (goal.measure.type !== old.measure.type && mine.some((e) => e.kind === 'step' || e.kind === 'number')) {
    goal.measure = old.measure;
  }
  // A changed schedule counts from now: today can never become a miss because of it.
  if (scheduleKey(goal) !== scheduleKey(old)) goal.scheduleSetAt = clock().toISOString();
  // Ticks of steps that no longer exist go with them.
  let dropIds = [];
  if (old.measure.type === 'steps') {
    const keep = new Set(goal.measure.type === 'steps' ? goal.measure.steps.map((s) => s.id) : []);
    dropIds = mine.filter((e) => e.kind === 'step' && !keep.has(e.stepId)).map((e) => e.id);
  }
  await write({ putGoals: [goal], deleteEntryIds: dropIds }, () => {
    state.goals = state.goals.map((g) => (g.id === id ? goal : g));
    if (dropIds.length) {
      const gone = new Set(dropIds);
      state.entries = state.entries.filter((e) => !gone.has(e.id));
    }
  });
  return goal;
}

export async function deleteGoal(id) {
  const entryIds = state.entries.filter((e) => e.goalId === id).map((e) => e.id);
  await write({ deleteGoalIds: [id], deleteEntryIds: entryIds }, () => {
    state.goals = state.goals.filter((g) => g.id !== id);
    state.entries = state.entries.filter((e) => e.goalId !== id);
  });
}

export async function saveSettings(patch) {
  const settings = Object.assign({}, state.settings, patch);
  await write({ settings: settings }, () => { state.settings = settings; });
}

export async function eraseAll() {
  const settings = defaultSettings();
  await write({ clear: true, settings: settings }, () => {
    state.goals = [];
    state.entries = [];
    state.settings = settings;
  });
}

// Sample goals for trying things out. Dates are relative to today.
export async function loadDemo() {
  const now = clock();
  const today = logicalDay(now, state.settings.dayCutoff);
  const day = (n) => addDays(today, n);
  const stampOf = (d, hh, mm) => {
    const p = splitDay(d);
    return new Date(p.y, p.m - 1, p.d, hh, mm, 0).toISOString();
  };
  const goals = [];
  const entries = [];
  const make = (title, daysAgo, fields) => {
    const created = daysAgo > 0 ? stampOf(day(-daysAgo), 6, 0) : now.toISOString();
    const goal = Object.assign({
      id: newId(), title: title, notes: '', color: goals.length % 8, importance: 3, status: 'active',
      createdAt: created, finishedAt: null, scheduleSetAt: created,
      run: { start: null, end: null }, repeat: { mode: 'none' }, measure: { type: 'check' }
    }, fields);
    goals.push(goal);
    return goal;
  };
  const log = (goal, d, kind, extra) => {
    entries.push(Object.assign(
      { id: newId(), goalId: goal.id, day: d, at: stampOf(d, 12, 0), kind: kind, minutes: 0 }, extra
    ));
  };
  const everyDay = (start, end, minutes) => ({
    mode: 'days',
    sessionMinutes: minutes || null,
    slots: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, start: start, end: end }))
  });

  const content = make('Content creation setup', 6, {
    importance: 4, run: { start: day(-6), end: day(1) }, repeat: everyDay('07:00', '09:00')
  });
  for (let n = -6; n <= -1; n++) log(content, day(n), n === -2 ? 'missed' : 'done', { minutes: 120 });

  const gym = make('Gym', 14, { run: { start: day(-14), end: null }, repeat: everyDay('19:00', '20:00') });
  for (let n = -13; n <= -1; n++) {
    if (n === -9) log(gym, day(n), 'skipped');
    else if (n !== -5) log(gym, day(n), 'done', { minutes: 60 });
  }

  const books = make('Read 20 books', 14, {
    importance: 2, run: { start: day(-14), end: day(60) },
    measure: { type: 'number', target: 20, unit: 'books', startValue: 12 }
  });
  log(books, day(-3), 'number', { value: 1 });

  const stepNames = ['Pick a name', 'Buy the domain', 'Write the home page', 'Design the logo',
    'Build the pages', 'Test on phones', 'Fix the bugs', 'Go live'];
  const site = make('Launch website', 14, {
    importance: 4, run: { start: day(-14), end: day(7) },
    measure: { type: 'steps', steps: stepNames.map((text) => ({ id: newId(), text: text })) }
  });
  [-12, -10, -7, -4, -1].forEach((n, i) => log(site, day(n), 'step', { stepId: site.measure.steps[i].id }));

  make('Guitar practice', 14, {
    run: { start: day(-14), end: null },
    repeat: {
      mode: 'days', sessionMinutes: null,
      slots: [1, 3, 5].map((w) => ({ weekday: w, start: '18:00', end: '18:30' }))
    }
  });

  const meditate = make('Meditate', 14, { run: { start: day(-14), end: null }, repeat: everyDay(null, null, 10) });
  for (let n = -4; n <= -1; n++) log(meditate, day(n), 'done', { minutes: 10 });
  entries.push({
    id: newId(), goalId: meditate.id, day: today, at: now.toISOString(), kind: 'done', minutes: 10
  });

  make('Run', 14, {
    run: { start: day(-14), end: null }, repeat: { mode: 'perWeek', times: 3, sessionMinutes: 30 }
  });
  make('Call parents', 1, {});
  make('Renew passport', 0, { importance: 5, run: { start: today, end: day(2) } });

  const settings = Object.assign({}, state.settings, { lastClosedDay: day(-1) });
  await write({ putGoals: goals, putEntries: entries, settings: settings }, () => {
    state.goals = state.goals.concat(goals);
    state.entries = state.entries.concat(entries);
    state.settings = settings;
  });
}
