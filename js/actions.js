// Everything the user can do to a goal after it exists. Each action is one database write
// and returns { message, undo, win, finished } so the app can celebrate and offer Undo.
import { state, write, clock, newId, todayDay, getGoal } from './store.js';
import {
  owed, nextStep, numberCurrent, measureMet, repeats, slotFor, sessionMinutes, dayState,
  weeklyAvailable, weekInfo, sessionEntry, stepsDone, firstDay, clearedIds
} from './sessions.js';
import { fmtMinutes, fmtDay, diffDays, logicalDay } from './time.js';

function merge(list, puts, removeIds) {
  let out = list;
  if (puts && puts.length) {
    const map = new Map(puts.map((x) => [x.id, x]));
    const seen = new Set();
    out = out.map((x) => {
      if (!map.has(x.id)) return x;
      seen.add(x.id);
      return map.get(x.id);
    });
    puts.forEach((x) => { if (!seen.has(x.id)) out.push(x); });
  }
  if (removeIds && removeIds.length) {
    const gone = new Set(removeIds);
    out = out.filter((x) => !gone.has(x.id));
  }
  return out;
}
async function change(ch) {
  await write(ch, () => {
    state.goals = merge(state.goals, ch.putGoals, ch.deleteGoalIds);
    state.entries = merge(state.entries, ch.putEntries, ch.deleteEntryIds);
  });
}
function fail(message) {
  const err = new Error(message);
  err.friendly = true;
  return err;
}
function need(id) {
  const goal = getGoal(id);
  if (!goal) throw fail('This goal no longer exists.');
  return goal;
}
function entriesOf(id) { return state.byGoal.get(id) || []; }
function mkEntry(goal, kind, extra) {
  return Object.assign(
    { id: newId(), goalId: goal.id, day: todayDay(), at: clock().toISOString(), kind: kind, minutes: 0 },
    extra
  );
}
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const trimNum = (v) => String(Math.round(v * 100) / 100);

function finishParts(goal) {
  const stamp = clock().toISOString();
  return {
    goal: Object.assign({}, goal, { status: 'finished', finishedAt: stamp }),
    entry: { id: newId(), goalId: goal.id, day: todayDay(), at: stamp, kind: 'finished', minutes: 0 }
  };
}

// ----- Sessions -----
export async function tickDone(id) {
  const goal = need(id);
  const ge = entriesOf(id);
  const today = todayDay();
  const cutoff = state.settings.dayCutoff;
  let minutes = 0;
  if (goal.repeat.mode === 'days') {
    if (dayState(goal, ge, today, today, cutoff) !== 'pending') throw fail('Nothing is waiting for today.');
    minutes = sessionMinutes(goal, slotFor(goal, today), cutoff);
  } else if (goal.repeat.mode === 'perWeek') {
    if (!weeklyAvailable(goal, ge, today, cutoff)) throw fail('Nothing is waiting for today.');
    minutes = goal.repeat.sessionMinutes || 0;
  } else {
    throw fail('This goal has no sessions.');
  }
  const e = mkEntry(goal, 'done', { minutes: minutes });
  await change({ putEntries: [e] });
  return {
    message: goal.title + ' done' + (minutes ? ', ' + fmtMinutes(minutes) : ''),
    win: true,
    undo: () => change({ deleteEntryIds: [e.id] })
  };
}

export async function makeUp(id) {
  const goal = need(id);
  const ow = owed(entriesOf(id));
  if (!ow.sessions) throw fail('Nothing is owed.');
  const missed = ow.list[0];
  const e = mkEntry(goal, 'makeup', { minutes: missed.minutes || 0, clearsEntryId: missed.id });
  await change({ putEntries: [e] });
  return {
    message: 'Made up ' + (missed.minutes ? fmtMinutes(missed.minutes) : 'one session') + ' of ' + goal.title,
    win: true,
    undo: () => change({ deleteEntryIds: [e.id] })
  };
}

export async function skipToday(id) {
  const goal = need(id);
  const ge = entriesOf(id);
  const today = todayDay();
  const cutoff = state.settings.dayCutoff;
  const mode = goal.repeat.mode;
  const ok = mode === 'days'
    ? dayState(goal, ge, today, today, cutoff) === 'pending'
    : mode === 'perWeek' && weekInfo(goal, ge, today, cutoff).need > 0;
  if (!ok) throw fail('There is nothing to skip.');
  const e = mkEntry(goal, 'skipped');
  await change({ putEntries: [e] });
  return {
    message: goal.title + ' skipped ' + (mode === 'days' ? 'for today' : 'once this week'),
    win: false,
    undo: () => change({ deleteEntryIds: [e.id] })
  };
}

// ----- Steps, numbers, finishing -----
// Records progress. A goal that does not repeat finishes at once when its measure is met.
async function progress(goal, entry, message) {
  const after = entriesOf(goal.id).concat([entry]);
  if (!repeats(goal) && measureMet(goal, after)) {
    const fin = finishParts(goal);
    await change({ putGoals: [fin.goal], putEntries: [entry, fin.entry] });
    return {
      message: goal.title + ' finished', win: true, finished: true, goal: fin.goal,
      undo: () => change({ putGoals: [goal], deleteEntryIds: [entry.id, fin.entry.id] })
    };
  }
  await change({ putEntries: [entry] });
  return { message: message, win: true, undo: () => change({ deleteEntryIds: [entry.id] }) };
}

export async function tickStep(id, stepId) {
  const goal = need(id);
  if (goal.measure.type !== 'steps') throw fail('This goal has no steps.');
  const ge = entriesOf(id);
  const step = stepId ? goal.measure.steps.find((s) => s.id === stepId) : nextStep(goal, ge);
  if (!step) throw fail('All steps are ticked.');
  if (ge.some((e) => e.kind === 'step' && e.stepId === step.id)) throw fail('That step is already ticked.');
  return progress(goal, mkEntry(goal, 'step', { stepId: step.id }), 'Step done: ' + step.text);
}

export async function untickStep(id, stepId) {
  need(id);
  const e = entriesOf(id).find((x) => x.kind === 'step' && x.stepId === stepId);
  if (!e) return null;
  await change({ deleteEntryIds: [e.id] });
  return { message: 'Step unticked', win: false, undo: () => change({ putEntries: [e] }) };
}

export async function addNumber(id, amount) {
  const goal = need(id);
  if (goal.measure.type !== 'number') throw fail('This goal has no number.');
  const value = Number(amount);
  if (!isFinite(value) || value === 0) throw fail('Enter an amount.');
  if (numberCurrent(goal, entriesOf(id)) + value < goal.measure.startValue) {
    throw fail('That would go below the starting value.');
  }
  const unit = goal.measure.unit ? ' ' + goal.measure.unit : '';
  const res = await progress(
    goal, mkEntry(goal, 'number', { value: value }),
    (value > 0 ? '+' : '') + trimNum(value) + unit + ' on ' + goal.title
  );
  if (value < 0) res.win = false;
  return res;
}

export async function finishGoal(id) {
  const goal = need(id);
  if (goal.status !== 'active') throw fail('This goal is not active.');
  const fin = finishParts(goal);
  await change({ putGoals: [fin.goal], putEntries: [fin.entry] });
  return {
    message: goal.title + ' finished', win: true, finished: true, goal: fin.goal,
    undo: () => change({ putGoals: [goal], deleteEntryIds: [fin.entry.id] })
  };
}

// What the tick square does, by kind.
export function performTick(id, kind) {
  if (kind === 'done') return tickDone(id);
  if (kind === 'makeup') return makeUp(id);
  if (kind === 'finish') return finishGoal(id);
  if (kind === 'step') return tickStep(id, null);
  if (kind === 'number') return addNumber(id, 1);
  return Promise.resolve(null);
}

// ----- Fixing history -----
export async function convertMissed(entryId, to) {
  const old = state.entries.find((e) => e.id === entryId);
  if (!old || old.kind !== 'missed') throw fail('That entry cannot be changed.');
  if (clearedIds(entriesOf(old.goalId)).has(old.id)) throw fail('That day was already made up.');
  const next = Object.assign({}, old, { kind: to === 'done' ? 'done' : 'skipped' });
  if (next.kind === 'skipped') next.minutes = 0;
  await change({ putEntries: [next] });
  return {
    message: to === 'done' ? 'Marked as done' : 'Marked as excused',
    win: false,
    undo: () => change({ putEntries: [old] })
  };
}

export async function excuseEntries(ids) {
  const wanted = new Set(ids);
  const olds = state.entries.filter((e) => wanted.has(e.id) && e.kind === 'missed');
  if (!olds.length) return null;
  const next = olds.map((e) => Object.assign({}, e, { kind: 'skipped', minutes: 0 }));
  await change({ putEntries: next });
  return {
    message: plural(olds.length, 'missed session', 'missed sessions') + ' excused',
    win: false,
    undo: () => change({ putEntries: olds })
  };
}

export async function excuseAllOwed(id) {
  need(id);
  const list = owed(entriesOf(id)).list;
  if (!list.length) throw fail('Nothing is owed.');
  return excuseEntries(list.map((e) => e.id));
}

export async function logPastDay(id, day) {
  const goal = need(id);
  if (!repeats(goal)) throw fail('Only repeating goals have days to log.');
  const today = todayDay();
  const cutoff = state.settings.dayCutoff;
  if (!day || day >= today) throw fail('Pick a day before today.');
  if (day < firstDay(goal, cutoff)) throw fail('That day is before the goal started.');
  if (goal.run.end && day > goal.run.end) throw fail('That day is after the goal ended.');
  const ge = entriesOf(id);
  const taken = goal.repeat.mode === 'days'
    ? !!sessionEntry(ge, day)
    : ge.some((e) => e.day === day && e.kind === 'done');
  if (taken) throw fail('That day already has an entry.');
  const minutes = goal.repeat.mode === 'days'
    ? sessionMinutes(goal, slotFor(goal, day), cutoff)
    : (goal.repeat.sessionMinutes || 0);
  const e = Object.assign(mkEntry(goal, 'done', { minutes: minutes }), { day: day });
  await change({ putEntries: [e] });
  return { message: 'Logged ' + fmtDay(day) + ' as done', win: false, undo: () => change({ deleteEntryIds: [e.id] }) };
}

export async function deleteEntry(entryId) {
  const e = state.entries.find((x) => x.id === entryId);
  if (!e || e.kind === 'missed' || e.kind === 'finished') throw fail('That entry cannot be deleted.');
  await change({ deleteEntryIds: [e.id] });
  return { message: 'Entry deleted', win: false, undo: () => change({ putEntries: [e] }) };
}

export async function editMinutes(entryId, minutes) {
  const e = state.entries.find((x) => x.id === entryId);
  if (!e || (e.kind !== 'done' && e.kind !== 'makeup')) throw fail('That entry has no minutes.');
  const m = Math.round(Number(minutes));
  if (!(m >= 0 && m <= 1440)) throw fail('Minutes must be between 0 and 1440.');
  const next = Object.assign({}, e, { minutes: m });
  await change({ putEntries: [next] });
  return { message: 'Minutes updated', win: false, undo: () => change({ putEntries: [e] }) };
}

// ----- Dropping, restoring, reopening -----
export async function dropGoal(id) {
  const goal = need(id);
  const next = Object.assign({}, goal, { status: 'dropped' });
  await change({ putGoals: [next] });
  return { message: goal.title + ' dropped', win: false, undo: () => change({ putGoals: [goal] }) };
}

export async function restoreGoal(id) {
  const goal = need(id);
  const next = Object.assign({}, goal, { status: 'active' });
  await change({ putGoals: [next] });
  return { message: goal.title + ' restored', win: false, undo: () => change({ putGoals: [goal] }) };
}

export async function reopenGoal(id) {
  const goal = need(id);
  const fin = entriesOf(id).filter((e) => e.kind === 'finished');
  const next = Object.assign({}, goal, { status: 'active', finishedAt: null });
  await change({ putGoals: [next], deleteEntryIds: fin.map((e) => e.id) });
  return {
    message: goal.title + ' reopened', win: false,
    undo: () => change({ putGoals: [goal], putEntries: fin })
  };
}

// Totals for the "goal finished" card and the Done wall.
export function totalsOf(goal) {
  const ge = entriesOf(goal.id);
  const cutoff = state.settings.dayCutoff;
  const sessions = ge.filter((e) => e.kind === 'done' || e.kind === 'makeup');
  const minutes = sessions.reduce((sum, e) => sum + (e.minutes || 0), 0);
  const end = goal.finishedAt ? logicalDay(new Date(goal.finishedAt), cutoff) : todayDay();
  const days = diffDays(firstDay(goal, cutoff), end) + 1;
  const out = [];
  if (days > 1) out.push(days + ' days');
  if (sessions.length) out.push(plural(sessions.length, 'session', 'sessions'));
  if (minutes) out.push(fmtMinutes(minutes));
  if (goal.measure.type === 'steps') {
    out.push(stepsDone(goal, ge) + ' of ' + plural(goal.measure.steps.length, 'step', 'steps'));
  }
  if (goal.measure.type === 'number') {
    out.push(trimNum(numberCurrent(goal, ge)) + (goal.measure.unit ? ' ' + goal.measure.unit : ''));
  }
  return out;
}
