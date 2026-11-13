// Day close: turns sessions that were not ticked before the cut-off into "missed".
// Pure and idempotent: running it twice adds nothing.
import { addDays, logicalDay, weekdayOf } from './time.js';
import {
  indexEntries, isScheduled, sessionEntry, slotFor, sessionMinutes, setupDay, weekInfo
} from './sessions.js';

// state: { goals, entries, settings: { dayCutoff, lastClosedDay } }
// Returns { entries: new entries, closedDays: days it closed, lastClosedDay }.
export function closeDays(state, now, makeId) {
  const cutoff = state.settings.dayCutoff;
  const yesterday = addDays(logicalDay(now, cutoff), -1);
  const last = state.settings.lastClosedDay;
  if (!last) return { entries: [], closedDays: [], lastClosedDay: yesterday };
  if (last >= yesterday) return { entries: [], closedDays: [], lastClosedDay: last };

  const byGoal = indexEntries(state.entries);
  const added = [];
  const closedDays = [];
  const stamp = now.toISOString();

  for (let d = addDays(last, 1); d <= yesterday; d = addDays(d, 1)) {
    closedDays.push(d);
    for (const g of state.goals) {
      if (g.status !== 'active') continue;
      let ge = byGoal.get(g.id);
      if (!ge) { ge = []; byGoal.set(g.id, ge); }

      if (g.repeat.mode === 'days') {
        if (d === setupDay(g, cutoff)) continue;          // the set-up day never causes a miss
        if (!isScheduled(g, d, cutoff)) continue;
        if (sessionEntry(ge, d)) continue;
        const e = {
          id: makeId(), goalId: g.id, day: d, at: stamp, kind: 'missed',
          minutes: sessionMinutes(g, slotFor(g, d), cutoff)
        };
        ge.push(e);
        added.push(e);
      } else if (g.repeat.mode === 'perWeek') {
        if (weekdayOf(d) !== 0 && d !== g.run.end) continue;   // week closes on Sunday or at the end date
        const info = weekInfo(g, ge, d, cutoff);
        if (!info.liveDays.length) continue;
        for (let k = info.missed; k < info.need; k++) {
          const e = {
            id: makeId(), goalId: g.id, day: d, at: stamp, kind: 'missed',
            minutes: g.repeat.sessionMinutes || 0
          };
          ge.push(e);
          added.push(e);
        }
      }
    }
  }
  return { entries: added, closedDays: closedDays, lastClosedDay: yesterday };
}
