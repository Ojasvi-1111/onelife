// Urgency (0 to 1) for each goal, and the neon look that follows from it.
import { clamp01, diffDays, minutesIntoDay, DAY_MIN } from './time.js';
import {
  isUpcoming, isComplete, owed, dayState, slotPhase, weeklyAvailable, weekInfo,
  measureMet, measureFraction, repeats, creationDay
} from './sessions.js';

// ctx: { now: Date, today: Day, cutoff: 'HH:MM' }
export function urgency(goal, ge, ctx) {
  const now = ctx.now;
  const today = ctx.today;
  const cutoff = ctx.cutoff;
  const I = (goal.importance - 1) / 4;
  const upcoming = isUpcoming(goal, today, cutoff);
  const complete = isComplete(goal, ge, today, cutoff);
  const ow = owed(ge);
  const m = goal.measure;
  const measured = m.type === 'steps' || m.type === 'number';
  let S = 0;
  let P = 0;
  let D = 0;

  if (!upcoming) {
    // S: today's session
    if (goal.repeat.mode === 'days') {
      if (dayState(goal, ge, today, today, cutoff) === 'pending') {
        const ph = slotPhase(goal, today, now, cutoff);
        if (ph.phase === 'ahead') S = clamp01(1 - ph.minutesToStart / 180);
        else if (ph.phase === 'running') S = 1;
        else if (ph.phase === 'late') S = 0.85;
        else S = 0.35 + 0.5 * (minutesIntoDay(now, cutoff) / DAY_MIN);
      }
    } else if (goal.repeat.mode === 'perWeek' && weeklyAvailable(goal, ge, today, cutoff)) {
      const info = weekInfo(goal, ge, today, cutoff);
      const left = info.liveDays.filter((d) => d >= today).length;
      S = 0.85 * Math.min(1, info.need / Math.max(1, left));
    }

    // P: pace (owed sessions, or steps and numbers behind schedule)
    const Po = ow.sessions ? Math.min(1, 0.55 + 0.15 * ow.sessions) : 0;
    let Pm = 0;
    if (measured && goal.run.end) {
      const created = creationDay(goal, cutoff);
      const paceStart = goal.run.start && goal.run.start > created ? goal.run.start : created;
      const total = diffDays(paceStart, goal.run.end) + 1;
      if (total > 0) {
        const expected = clamp01(diffDays(paceStart, today) / total);
        Pm = clamp01(2 * (expected - measureFraction(goal, ge)));
      }
    }
    P = Math.max(Po, Pm);

    // D: deadline, only while work is still open
    if (goal.run.end) {
      const open = measured ? !measureMet(goal, ge) : !repeats(goal);
      if (open || ow.sessions > 0) {
        const left = diffDays(today, goal.run.end);
        D = left <= 0 ? 1 : 1 / (1 + left / 3);
      }
    }
  }

  let T = Math.max(S, P, D);
  if (complete) T = Math.max(S, 0.8);
  if (upcoming) T = 0;
  const U = 0.7 * T + 0.3 * I;
  return {
    I: I, S: S, P: P, D: D, T: T, U: U, Uq: Math.round(U * 20) / 20,
    upcoming: upcoming, complete: complete, owed: ow
  };
}

// Heat scale: calm blue, through violet and hot pink, to red.
const HEAT = [
  [0.00, [46, 139, 255]],
  [0.35, [122, 92, 255]],
  [0.60, [192, 77, 255]],
  [0.80, [255, 61, 139]],
  [1.00, [255, 43, 43]]
];
export function heatColor(u) {
  const x = clamp01(u);
  for (let i = 1; i < HEAT.length; i++) {
    if (x <= HEAT[i][0]) {
      const p0 = HEAT[i - 1][0];
      const c0 = HEAT[i - 1][1];
      const p1 = HEAT[i][0];
      const c1 = HEAT[i][1];
      const t = (x - p0) / (p1 - p0);
      const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
      return 'rgb(' + c.join(',') + ')';
    }
  }
  return 'rgb(255,43,43)';
}

// state: 'normal' | 'done' | 'missed' | 'upcoming'
export function neonLook(u, state) {
  if (state === 'upcoming') return { neon: '#59606E', hi: 0, lo: 0, breath: 8 };
  if (state === 'done') return { neon: heatColor(0), hi: 0.38, lo: 0.22, breath: 8 };
  if (state === 'missed') return { neon: heatColor(1), hi: 1, lo: 0.7, breath: 1.8 };
  const hi = 0.5 + 0.5 * u;
  return { neon: heatColor(u), hi: hi, lo: hi * (0.8 - 0.35 * u), breath: 7 - 4.2 * u };
}
