// Session rules for OneLife: what is scheduled, done, missed or owed, and when a
// goal is complete. Every function is pure. "ge" always means the entries of one goal.
import {
  addDays, weekdayOf, logicalDay, slotOffsets, weekStart, momentOf, minutesIntoDay, clamp01
} from './time.js';

export function indexEntries(entries) {
  const map = new Map();
  for (const e of entries) {
    let list = map.get(e.goalId);
    if (!list) { list = []; map.set(e.goalId, list); }
    list.push(e);
  }
  return map;
}

export function repeats(goal) { return goal.repeat.mode !== 'none'; }
export function creationDay(goal, cutoff) { return logicalDay(new Date(goal.createdAt), cutoff); }
export function firstDay(goal, cutoff) { return goal.run.start || creationDay(goal, cutoff); }
export function setupMoment(goal) { return new Date(goal.scheduleSetAt || goal.createdAt); }
export function setupDay(goal, cutoff) { return logicalDay(setupMoment(goal), cutoff); }

export function isLive(goal, day, cutoff) {
  if (goal.status !== 'active') return false;
  if (day < firstDay(goal, cutoff)) return false;
  if (goal.run.end && day > goal.run.end) return false;
  return true;
}
export function isUpcoming(goal, today, cutoff) {
  return goal.status === 'active' && today < firstDay(goal, cutoff);
}

// ----- Goals that repeat on set days -----
export function slotFor(goal, day) {
  if (goal.repeat.mode !== 'days') return null;
  const wd = weekdayOf(day);
  return goal.repeat.slots.find((s) => s.weekday === wd) || null;
}
export function sessionMinutes(goal, slot, cutoff) {
  const o = slotOffsets(slot, cutoff);
  if (o) return o.end - o.start;
  return (goal.repeat.mode !== 'none' && goal.repeat.sessionMinutes) || 0;
}
// On the set-up day, a clock slot that had already ended is not scheduled.
export function isScheduled(goal, day, cutoff) {
  if (goal.repeat.mode !== 'days' || !isLive(goal, day, cutoff)) return false;
  const slot = slotFor(goal, day);
  if (!slot) return false;
  if (day === setupDay(goal, cutoff)) {
    const o = slotOffsets(slot, cutoff);
    if (o && momentOf(day, o.end, cutoff).getTime() <= setupMoment(goal).getTime()) return false;
  }
  return true;
}
export function sessionEntry(ge, day) {
  return ge.find((e) => e.day === day &&
    (e.kind === 'done' || e.kind === 'skipped' || e.kind === 'missed')) || null;
}
// 'done' | 'skipped' | 'missed' | 'pending' | null
export function dayState(goal, ge, day, today, cutoff) {
  const e = sessionEntry(ge, day);
  if (e) return e.kind;
  return day === today && isScheduled(goal, day, cutoff) ? 'pending' : null;
}
// Where today's slot stands right now.
export function slotPhase(goal, today, now, cutoff) {
  const slot = slotFor(goal, today);
  const o = slotOffsets(slot, cutoff);
  if (!o) return { phase: 'anytime', slot: slot };
  const m = minutesIntoDay(now, cutoff);
  if (m < o.start) return { phase: 'ahead', minutesToStart: o.start - m, slot: slot };
  if (m < o.end) return { phase: 'running', slot: slot };
  return { phase: 'late', slot: slot };
}
export function nextSession(goal, today, cutoff) {
  if (goal.repeat.mode !== 'days') return null;
  for (let i = 1; i <= 14; i++) {
    const d = addDays(today, i);
    if (isScheduled(goal, d, cutoff)) return { day: d, slot: slotFor(goal, d) };
  }
  return null;
}

// ----- Owed sessions -----
export function clearedIds(ge) {
  const set = new Set();
  for (const e of ge) if (e.kind === 'makeup' && e.clearsEntryId) set.add(e.clearsEntryId);
  return set;
}
export function owed(ge) {
  const cleared = clearedIds(ge);
  const list = ge.filter((e) => e.kind === 'missed' && !cleared.has(e.id));
  list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  let minutes = 0;
  for (const e of list) minutes += e.minutes || 0;
  return { sessions: list.length, minutes: minutes, list: list };
}

// ----- Goals that repeat N times a week -----
export function weekInfo(goal, ge, anyDayInWeek, cutoff) {
  const start = weekStart(anyDayInWeek);
  const end = addDays(start, 6);
  const setup = setupDay(goal, cutoff);
  const liveDays = [];
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    if (isLive(goal, d, cutoff)) {
      liveDays.push(d);
      if (d > setup) n++;
    }
  }
  const times = goal.repeat.mode === 'perWeek' ? goal.repeat.times : 0;
  const base = Math.round(times * n / 7);
  const cleared = clearedIds(ge);
  let done = 0;
  let skipped = 0;
  let missed = 0;
  let madeUp = 0;
  for (const e of ge) {
    if (e.day < start || e.day > end) continue;
    if (e.kind === 'done') done++;
    else if (e.kind === 'skipped') skipped++;
    else if (e.kind === 'missed') { missed++; if (cleared.has(e.id)) madeUp++; }
  }
  const required = Math.max(0, base - skipped);
  const need = Math.max(0, required - done);
  return {
    start: start, end: end, liveDays: liveDays, base: base, required: required,
    done: done, skipped: skipped, missed: missed, madeUp: madeUp, need: need
  };
}
export function weeklyAvailable(goal, ge, today, cutoff) {
  if (goal.repeat.mode !== 'perWeek' || !isLive(goal, today, cutoff)) return false;
  if (weekInfo(goal, ge, today, cutoff).need <= 0) return false;
  return !ge.some((e) => e.day === today && e.kind === 'done');
}

// ----- Steps and numbers -----
export function numberCurrent(goal, ge) {
  if (goal.measure.type !== 'number') return 0;
  let value = goal.measure.startValue;
  for (const e of ge) if (e.kind === 'number') value += e.value || 0;
  return value;
}
export function tickedStepIds(ge) {
  const set = new Set();
  for (const e of ge) if (e.kind === 'step') set.add(e.stepId);
  return set;
}
export function stepsDone(goal, ge) {
  if (goal.measure.type !== 'steps') return 0;
  const ids = tickedStepIds(ge);
  return goal.measure.steps.filter((s) => ids.has(s.id)).length;
}
export function nextStep(goal, ge) {
  if (goal.measure.type !== 'steps') return null;
  const ids = tickedStepIds(ge);
  return goal.measure.steps.find((s) => !ids.has(s.id)) || null;
}
export function measureMet(goal, ge) {
  const m = goal.measure;
  if (m.type === 'steps') return m.steps.length > 0 && stepsDone(goal, ge) === m.steps.length;
  if (m.type === 'number') return numberCurrent(goal, ge) >= m.target;
  return false;
}
// Progress since the goal was created, 0 to 1 (used for pace).
export function measureFraction(goal, ge) {
  const m = goal.measure;
  if (m.type === 'steps') return m.steps.length ? stepsDone(goal, ge) / m.steps.length : 0;
  if (m.type === 'number') {
    const span = m.target - m.startValue;
    return span > 0 ? clamp01((numberCurrent(goal, ge) - m.startValue) / span) : 0;
  }
  return 0;
}

// ----- Life cycle -----
export function isComplete(goal, ge, today, cutoff) {
  if (goal.status !== 'active') return false;
  if (isUpcoming(goal, today, cutoff)) return false;
  if (owed(ge).sessions > 0) return false;
  const rep = repeats(goal);
  if (rep && !goal.run.end) return false;
  if (measureMet(goal, ge)) return true;
  return rep && goal.measure.type === 'check' && !!goal.run.end && today > goal.run.end;
}
export function isOverdue(goal, ge, today, cutoff) {
  return goal.status === 'active' && !!goal.run.end && today > goal.run.end &&
    !isComplete(goal, ge, today, cutoff);
}

// ----- Rates (counted from entries, never from old schedules) -----
export function weekLine(goal, ge, today, cutoff) {
  if (goal.repeat.mode === 'perWeek') {
    const info = weekInfo(goal, ge, today, cutoff);
    return { x: Math.min(info.done, info.required), y: info.required };
  }
  if (goal.repeat.mode !== 'days') return { x: 0, y: 0 };
  const start = weekStart(today);
  const end = addDays(start, 6);
  const cleared = clearedIds(ge);
  let x = 0;
  let y = 0;
  for (const e of ge) {
    if (e.day < start || e.day > end) continue;
    if (e.kind === 'done') { x++; y++; }
    else if (e.kind === 'missed') { y++; if (cleared.has(e.id)) x++; }
  }
  if (dayState(goal, ge, today, today, cutoff) === 'pending') y++;
  for (let d = addDays(today, 1); d <= end; d = addDays(d, 1)) {
    if (isScheduled(goal, d, cutoff)) y++;
  }
  return { x: x, y: y };
}
export function rate30(ge, today) {
  const from = addDays(today, -30);
  const cleared = clearedIds(ge);
  let a = 0;
  let b = 0;
  for (const e of ge) {
    if (e.day < from || e.day >= today) continue;
    if (e.kind === 'done') { a++; b++; }
    else if (e.kind === 'missed') { b++; if (cleared.has(e.id)) a++; }
  }
  return b ? Math.round(100 * a / b) : null;
}
// "3 of 5 done today" for the header.
export function todayScore(goals, byGoal, today, cutoff) {
  let done = 0;
  let total = 0;
  for (const g of goals) {
    if (g.status !== 'active' || g.repeat.mode !== 'days') continue;
    const state = dayState(g, byGoal.get(g.id) || [], today, today, cutoff);
    if (state === 'done') { done++; total++; }
    else if (state === 'pending') total++;
  }
  return { done: done, total: total };
}
