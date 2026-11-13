// OneLife self-tests. Open test.html to run them.
import * as T from './time.js';
import * as S from './sessions.js';
import { closeDays } from './dayclose.js';
import { urgency, heatColor } from './urgency.js';
import { layout } from './layout.js';

const results = [];
function check(name, ok, detail) { results.push({ name: name, ok: !!ok, detail: detail || '' }); }
function eq(name, got, want) {
  check(name, got === want, 'got ' + JSON.stringify(got) + ', expected ' + JSON.stringify(want));
}
function near(name, got, want) {
  check(name, Math.abs(got - want) <= 0.006, 'got ' + got + ', expected about ' + want);
}
function group(title, fn) {
  try { fn(); } catch (err) { check(title + ' crashed', false, String((err && err.stack) || err)); }
}

// ----- Fixtures -----
const CUT = '04:00';
const NOW = new Date(2026, 10, 13, 18, 40, 0);   // Fri 13 Nov 2026, 18:40
const TODAY = '2026-11-13';
const ctx = { now: NOW, today: TODAY, cutoff: CUT };
const at = (h, m) => ({ now: new Date(2026, 10, 13, h, m, 0), today: TODAY, cutoff: CUT });
let seq = 0;
const nid = () => 't' + (++seq);
const iso = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm, 0).toISOString();
const ALL = [0, 1, 2, 3, 4, 5, 6];
const daily = (start, end, minutes) => ({
  mode: 'days',
  sessionMinutes: minutes || null,
  slots: ALL.map((w) => ({ weekday: w, start: start, end: end }))
});
function goal(over) {
  return Object.assign({
    id: nid(), title: 'Goal', notes: '', color: 0, importance: 3, status: 'active',
    createdAt: iso(2026, 11, 1, 8, 0), finishedAt: null, scheduleSetAt: iso(2026, 11, 1, 8, 0),
    run: { start: null, end: null }, repeat: { mode: 'none' }, measure: { type: 'check' }
  }, over);
}
function entry(g, day, kind, extra) {
  return Object.assign(
    { id: nid(), goalId: g.id, day: day, at: iso(2026, 11, 1, 9, 0), kind: kind, minutes: 0 },
    extra
  );
}
const done = (g, day) => entry(g, day, 'done', { minutes: 60 });
const gym = goal({ run: { start: '2026-11-01', end: null }, repeat: daily('19:00', '20:00') });
const weekly = (d, end) => goal({
  createdAt: iso(2026, 11, d, 8, 0), scheduleSetAt: iso(2026, 11, d, 8, 0),
  run: { start: T.makeDay(2026, 11, d), end: end || null },
  repeat: { mode: 'perWeek', times: 3, sessionMinutes: 30 }
});
const mon = weekly(9);
const closeFrom = (goals, entries, last, now) => closeDays(
  { goals: goals, entries: entries, settings: { dayCutoff: CUT, lastClosedDay: last } }, now, nid
);

// ----- Tests -----
group('time', () => {
  eq('02:30 belongs to the day before', T.logicalDay(new Date(2026, 10, 14, 2, 30), CUT), '2026-11-13');
  eq('04:00 starts the new day', T.logicalDay(new Date(2026, 10, 14, 4, 0), CUT), '2026-11-14');
  eq('add a day across the year end', T.addDays('2026-12-31', 1), '2027-01-01');
  eq('subtract a day across a month', T.addDays('2026-03-01', -1), '2026-02-28');
  eq('difference in days', T.diffDays('2026-11-13', '2026-11-20'), 7);
  eq('13 Nov 2026 is a Friday', T.weekdayOf('2026-11-13'), 5);
  eq('week starts on Monday', T.weekStart('2026-11-13'), '2026-11-09');
  eq('Sunday belongs to the same week', T.weekStart('2026-11-15'), '2026-11-09');
  eq('minutes as text', T.fmtMinutes(90), '1h 30m');
  const oneAm = new Date(2026, 10, 14, 1, 0, 0);
  eq('1 AM is 21 hours into the day', T.minutesIntoDay(oneAm, CUT), 1260);
  const moment = T.momentOf(TODAY, 1260, CUT);
  eq('a late moment falls on the next calendar date', T.dateToDay(moment), '2026-11-14');
  eq('...at 1 AM', moment.getHours(), 1);
});

group('slots', () => {
  const night = T.slotOffsets({ start: '23:00', end: '01:00' }, CUT);
  eq('slot may cross midnight', T.slotValid({ start: '23:00', end: '01:00' }, CUT), true);
  eq('late-night slot length', night.end - night.start, 120);
  eq('slot may not cross the cut-off', T.slotValid({ start: '03:00', end: '05:00' }, CUT), false);
  eq('slot may end exactly at the cut-off', T.slotValid({ start: '02:00', end: '04:00' }, CUT), true);
});

group('scheduling', () => {
  eq('gym is scheduled today', S.isScheduled(gym, TODAY, CUT), true);
  eq('gym is pending today', S.dayState(gym, [], TODAY, TODAY, CUT), 'pending');
  eq('gym session is 60 minutes', S.sessionMinutes(gym, S.slotFor(gym, TODAY), CUT), 60);
  const late = goal({
    createdAt: iso(2026, 11, 13, 22, 0), scheduleSetAt: iso(2026, 11, 13, 22, 0),
    run: { start: TODAY, end: null }, repeat: daily('07:00', '09:00')
  });
  eq('a slot that ended before set-up is not scheduled', S.isScheduled(late, TODAY, CUT), false);
  eq('the same goal is scheduled the next day', S.isScheduled(late, '2026-11-14', CUT), true);
  const later = goal({ run: { start: '2026-11-20', end: null }, repeat: daily('07:00', '09:00') });
  eq('a goal starting later is upcoming', S.isUpcoming(later, TODAY, CUT), true);
  eq('an upcoming goal has no session today', S.isScheduled(later, TODAY, CUT), false);
  const mwf = goal({
    run: { start: '2026-11-01', end: null },
    repeat: {
      mode: 'days', sessionMinutes: null,
      slots: [1, 3, 5].map((w) => ({ weekday: w, start: '18:00', end: '18:30' }))
    }
  });
  eq('a Mon/Wed/Fri goal is scheduled on Friday', S.isScheduled(mwf, TODAY, CUT), true);
  eq('...and not on Saturday', S.isScheduled(mwf, '2026-11-14', CUT), false);
  eq('its next session is Monday', S.nextSession(mwf, TODAY, CUT).day, '2026-11-16');
  const nightOwl = goal({
    createdAt: iso(2026, 11, 13, 23, 30), scheduleSetAt: iso(2026, 11, 13, 23, 30),
    run: { start: TODAY, end: null }, repeat: daily('23:00', '01:00')
  });
  eq('a slot still running at set-up is scheduled', S.isScheduled(nightOwl, TODAY, CUT), true);
  const afterMidnight = goal({
    createdAt: iso(2026, 11, 14, 0, 30), scheduleSetAt: iso(2026, 11, 14, 0, 30),
    run: { start: TODAY, end: null }, repeat: daily('19:00', '20:00')
  });
  eq('created after midnight: the evening slot is already gone', S.isScheduled(afterMidnight, TODAY, CUT), false);
  eq('...and it counts from the next day', S.isScheduled(afterMidnight, '2026-11-14', CUT), true);
  const ended = goal({ run: { start: '2026-11-05', end: '2026-11-12' }, repeat: daily('07:00', '09:00') });
  eq('no sessions after the end date', S.isScheduled(ended, TODAY, CUT), false);
});

group('phases of the day', () => {
  near('gym four hours before: no pull yet', urgency(gym, [], at(15, 0)).S, 0);
  near('gym 90 minutes before', urgency(gym, [], at(17, 30)).S, 0.5);
  near('gym while the slot runs', urgency(gym, [], at(19, 30)).S, 1);
  eq('phase while the slot runs', S.slotPhase(gym, TODAY, at(19, 30).now, CUT).phase, 'running');
  near('gym after the slot, not ticked', urgency(gym, [], at(21, 0)).S, 0.85);
  const oneAm = new Date(2026, 10, 14, 1, 0, 0);
  eq('1 AM still belongs to Friday', T.logicalDay(oneAm, CUT), TODAY);
  near('gym at 1 AM is still open, and late', urgency(gym, [], { now: oneAm, today: TODAY, cutoff: CUT }).S, 0.85);
  const anyTime = goal({ run: { start: '2026-11-01', end: null }, repeat: daily(null, null, 10) });
  near('an any-time goal at 4 PM', urgency(anyTime, [], at(16, 0)).S, 0.6);
});

group('skips', () => {
  const ge = [
    done(gym, '2026-11-09'), done(gym, '2026-11-10'), done(gym, '2026-11-11'), done(gym, '2026-11-12'),
    entry(gym, TODAY, 'skipped')
  ];
  eq('skipped today: state', S.dayState(gym, ge, TODAY, TODAY, CUT), 'skipped');
  near('skipped today: no pull', urgency(gym, ge, ctx).S, 0);
  const line = S.weekLine(gym, ge, TODAY, CUT);
  eq('a skip leaves the week line: done', line.x, 4);
  eq('a skip leaves the week line: out of', line.y, 6);
  const r = closeFrom([gym], [entry(gym, '2026-11-10', 'skipped')], '2026-11-09', NOW);
  eq('a skipped day is never marked missed', r.entries.length, 2);
  const skippedOne = [entry(mon, '2026-11-10', 'skipped')];
  eq('a weekly skip lowers the target', S.weekInfo(mon, skippedOne, TODAY, CUT).required, 2);
});

group('day close', () => {
  const r1 = closeFrom([gym], [], '2026-11-09', NOW);
  eq('three days closed', r1.closedDays.length, 3);
  eq('three missed entries', r1.entries.length, 3);
  eq('a missed entry carries the session minutes', r1.entries[0].minutes, 60);
  eq('marker moves to yesterday', r1.lastClosedDay, '2026-11-12');
  const r2 = closeFrom([gym], r1.entries, '2026-11-09', NOW);
  eq('running it again adds nothing', r2.entries.length, 0);
  const r3 = closeFrom([gym], [], null, NOW);
  eq('the first run closes nothing', r3.entries.length, 0);
  eq('the first run sets the marker', r3.lastClosedDay, '2026-11-12');

  const anyTime = goal({
    createdAt: iso(2026, 11, 13, 23, 0), scheduleSetAt: iso(2026, 11, 13, 23, 0),
    run: { start: TODAY, end: null }, repeat: daily(null, null, 10)
  });
  eq('an any-time goal is pending on its set-up day', S.dayState(anyTime, [], TODAY, TODAY, CUT), 'pending');
  const r4 = closeFrom([anyTime], [], '2026-11-12', new Date(2026, 10, 14, 9, 0));
  eq('no miss for the set-up day', r4.entries.length, 0);
  const r5 = closeFrom([anyTime], [], '2026-11-12', new Date(2026, 10, 15, 9, 0));
  eq('a miss for the day after', r5.entries.length, 1);
  eq('that miss carries the planned minutes', r5.entries.length ? r5.entries[0].minutes : -1, 10);

  const away = closeFrom([gym], [], '2026-10-13', NOW);
  eq('a month away: thirty days closed', away.closedDays.length, 30);
  eq('...with misses only after the set-up day', away.entries.length, 11);
  const finished = goal({
    status: 'finished', run: { start: '2026-11-01', end: null }, repeat: daily('19:00', '20:00')
  });
  eq('finished goals are ignored', closeFrom([finished], [], '2026-11-09', NOW).entries.length, 0);
});

group('weekly goals', () => {
  eq('created on Monday: 3 this week', S.weekInfo(mon, [], TODAY, CUT).required, 3);
  eq('created on Friday: 1 this week', S.weekInfo(weekly(13), [], TODAY, CUT).required, 1);
  eq('created on Sunday: none this week', S.weekInfo(weekly(15), [], '2026-11-15', CUT).required, 0);
  eq('a full later week: 3', S.weekInfo(mon, [], '2026-11-18', CUT).required, 3);
  const oneDone = [entry(mon, '2026-11-10', 'done', { minutes: 30 })];
  eq('weekly session available today', S.weeklyAvailable(mon, oneDone, TODAY, CUT), true);
  const r = closeFrom([mon], oneDone, '2026-11-14', new Date(2026, 10, 16, 9, 0));
  eq('week closes with 2 missed', r.entries.length, 2);
  eq('weekly misses are dated Sunday', r.entries.length ? r.entries[0].day : '', '2026-11-15');

  near('weekly, none done by Friday: S', urgency(mon, [], ctx).S, 0.85);
  near('weekly, none done by Friday: Uq', urgency(mon, [], ctx).Uq, 0.75);
  near('weekly, one done: S', urgency(mon, oneDone, ctx).S, 0.567);
  const doneToday = [entry(mon, TODAY, 'done', { minutes: 30 })];
  near('weekly, done today: S', urgency(mon, doneToday, ctx).S, 0);
  const line = S.weekLine(mon, oneDone, TODAY, CUT);
  eq('weekly line: done', line.x, 1);
  eq('weekly line: out of', line.y, 3);

  const endsWed = weekly(9, '2026-11-11');
  eq('ends on Wednesday: 1 required', S.weekInfo(endsWed, [], '2026-11-11', CUT).required, 1);
  const c1 = closeFrom([endsWed], [], '2026-11-10', new Date(2026, 10, 12, 9, 0));
  eq('the week closes at the end date', c1.entries.length, 1);
  eq('...and the miss is dated that day', c1.entries.length ? c1.entries[0].day : '', '2026-11-11');
  const c2 = closeFrom([endsWed], c1.entries, '2026-11-14', new Date(2026, 10, 16, 9, 0));
  eq('...and not again on Sunday', c2.entries.length, 0);
});

group('owed and rates', () => {
  const m0 = entry(gym, '2026-11-08', 'missed', { minutes: 60 });
  const m1 = entry(gym, '2026-11-10', 'missed', { minutes: 60 });
  const ge = [
    m0,
    done(gym, '2026-11-09'),
    m1,
    entry(gym, '2026-11-11', 'makeup', { minutes: 60, clearsEntryId: m1.id }),
    done(gym, '2026-11-11'),
    done(gym, '2026-11-12')
  ];
  const ow = S.owed(ge);
  eq('one session owed', ow.sessions, 1);
  eq('sixty minutes owed', ow.minutes, 60);
  eq('the oldest owed day', ow.list.length ? ow.list[0].day : '', '2026-11-08');
  const line = S.weekLine(gym, ge, TODAY, CUT);
  eq('week line: done so far', line.x, 4);
  eq('week line: out of', line.y, 7);
  eq('30-day rate', S.rate30(ge, TODAY), 80);
  const early = goal({ run: { start: '2026-11-01', end: null }, repeat: daily('07:00', '08:00') });
  const score = S.todayScore([gym, early, mon], S.indexEntries([done(early, TODAY)]), TODAY, CUT);
  eq('today score: done', score.done, 1);
  eq('today score: out of', score.total, 2);
});

group('steps, numbers and pace', () => {
  const paced = goal({
    run: { start: '2026-11-01', end: '2026-11-30' },
    measure: { type: 'number', target: 30, unit: 'km', startValue: 0 }
  });
  const p = urgency(paced, [entry(paced, '2026-11-10', 'number', { value: 6 })], ctx);
  near('behind pace: P', p.P, 0.4);
  near('behind pace: D', p.D, 0.15);
  near('behind pace: U', p.U, 0.43);
  const headStart = goal({
    createdAt: iso(2026, 11, 13, 8, 0), scheduleSetAt: iso(2026, 11, 13, 8, 0),
    run: { start: '2026-01-01', end: '2026-12-31' },
    measure: { type: 'number', target: 20, unit: 'books', startValue: 12 }
  });
  const h = urgency(headStart, [], ctx);
  near('created mid-run with a head start: not behind', h.P, 0);
  near('...and the deadline is far away', h.D, 0.0588);
  const project = goal({
    measure: {
      type: 'steps',
      steps: [{ id: 's1', text: 'a' }, { id: 's2', text: 'b' }, { id: 's3', text: 'c' }, { id: 's4', text: 'd' }]
    }
  });
  const one = [entry(project, TODAY, 'step', { stepId: 's1' })];
  const next = S.nextStep(project, one);
  eq('one step ticked', S.stepsDone(project, one), 1);
  eq('the next step is the second', next ? next.id : '', 's2');
  near('a quarter done', S.measureFraction(project, one), 0.25);
  eq('not finished yet', S.measureMet(project, one), false);
  const books = goal({ measure: { type: 'number', target: 20, unit: 'books', startValue: 12 } });
  const reads = [
    entry(books, '2026-11-05', 'number', { value: 3 }),
    entry(books, '2026-11-06', 'number', { value: -1 })
  ];
  eq('a number adds up from its starting value', S.numberCurrent(books, reads), 14);
  const allRead = [entry(books, TODAY, 'number', { value: 8 })];
  eq('a number at its target is complete', S.isComplete(books, allRead, TODAY, CUT), true);
  const later = goal({ importance: 5, run: { start: '2026-11-20', end: null }, repeat: daily('07:00', '09:00') });
  near('an upcoming goal: only importance counts', urgency(later, [], ctx).U, 0.3);
});

group('urgency', () => {
  const a = urgency(gym, [], ctx);
  near('gym at 18:40: S', a.S, 0.889);
  near('gym at 18:40: U', a.U, 0.772);
  near('gym at 18:40: Uq', a.Uq, 0.75);
  const b = urgency(gym, [done(gym, TODAY)], ctx);
  near('gym after the tick: U', b.U, 0.15);
  const oneOff = goal({ importance: 5, run: { start: TODAY, end: '2026-11-15' } });
  const c = urgency(oneOff, [], ctx);
  near('one-off due in 2 days: D', c.D, 0.6);
  near('one-off due in 2 days: U', c.U, 0.72);
  near('one-off due in 2 days: Uq', c.Uq, 0.7);
  near('title only, importance 1', urgency(goal({ importance: 1 }), [], ctx).U, 0);
  near('title only, importance 3', urgency(goal({ importance: 3 }), [], ctx).U, 0.15);
  near('title only, importance 5', urgency(goal({ importance: 5 }), [], ctx).U, 0.3);
  const owing = [done(gym, TODAY), entry(gym, '2026-11-12', 'missed', { minutes: 60 })];
  const d = urgency(gym, owing, ctx);
  near('one session owed: P', d.P, 0.7);
  near('one session owed: U', d.U, 0.64);
  near('one session owed: Uq', d.Uq, 0.65);
  eq('calm is blue', heatColor(0), 'rgb(46,139,255)');
  eq('hottest is red', heatColor(1), 'rgb(255,43,43)');
});

group('life cycle', () => {
  const ended = goal({ run: { start: '2026-11-05', end: '2026-11-12' }, repeat: daily('07:00', '09:00') });
  eq('run ended clean: complete', S.isComplete(ended, [], TODAY, CUT), true);
  eq('run ended clean: not overdue', S.isOverdue(ended, [], TODAY, CUT), false);
  near('a complete goal stays visible', urgency(ended, [], ctx).T, 0.8);
  const owes = [entry(ended, '2026-11-12', 'missed', { minutes: 120 })];
  eq('run ended owing: not complete', S.isComplete(ended, owes, TODAY, CUT), false);
  eq('run ended owing: overdue', S.isOverdue(ended, owes, TODAY, CUT), true);
  const steps = { type: 'steps', steps: [{ id: 's1', text: 'One step' }] };
  const forever = goal({ run: { start: '2026-11-01', end: null }, repeat: daily('19:00', '20:00'), measure: steps });
  const ticked = (g) => [entry(g, TODAY, 'step', { stepId: 's1' })];
  eq('a forever goal is never complete', S.isComplete(forever, ticked(forever), TODAY, CUT), false);
  const plain = goal({ measure: steps });
  eq('all steps ticked: complete', S.isComplete(plain, ticked(plain), TODAY, CUT), true);
  const lateOne = goal({ run: { start: '2026-11-05', end: '2026-11-12' } });
  eq('a one-off past its date is overdue', S.isOverdue(lateOne, [], TODAY, CUT), true);
});

group('layout', () => {
  const make = (n, f) => Array.from({ length: n }, (_, i) => ({
    id: 'b' + T.pad2(i), uq: f(i), importance: 3, createdAt: '2026-11-01T00:00:' + T.pad2(i % 60)
  }));
  const judge = (res, boardW, minW) => {
    const list = Array.from(res.boxes.values());
    const out = { overlap: false, outside: false, small: false };
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.w < minW || a.h < Math.round(minW * 2 / 3)) out.small = true;
      if (a.x < 24 || a.y < 24 || a.x + a.w > boardW - 24 || a.y + a.h > res.boardHeight - 24) out.outside = true;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (a.x - 24 < b.x + b.w && a.x + a.w + 24 > b.x && a.y - 24 < b.y + b.h && a.y + a.h + 24 > b.y) {
          out.overlap = true;
        }
      }
    }
    return out;
  };
  const opts = { boardW: 1180, visibleH: 620, minW: 180 };
  const nine = make(9, (i) => [1, 0.8, 0.7, 0.5, 0.25, 0.1, 0.05, 0, 0][i]);
  const a = layout(nine, opts);
  const ja = judge(a, 1180, 180);
  eq('9 goals: all placed', a.boxes.size, 9);
  eq('9 goals: no overlap', ja.overlap, false);
  eq('9 goals: inside the board', ja.outside, false);
  eq('9 goals: none below the floor', ja.small, false);
  eq('9 goals: no scrolling', a.scroll, false);
  const again = layout(nine, opts);
  eq('same input gives the same layout',
    JSON.stringify(Array.from(a.boxes)), JSON.stringify(Array.from(again.boxes)));

  const forty = make(40, (i) => (i % 5) * 0.2);
  const b = layout(forty, opts);
  const jb = judge(b, 1180, 180);
  const top = b.boxes.get('b04');
  eq('40 goals: all placed', b.boxes.size, 40);
  eq('40 goals: no overlap', jb.overlap, false);
  eq('40 goals: inside the board', jb.outside, false);
  eq('40 goals: none below the floor', jb.small, false);
  eq('40 goals: the board scrolls', b.scroll, true);
  eq('40 goals: the most urgent is on the first screen', !!top && top.y + top.h <= 620, true);

  const none = layout([], opts);
  eq('no goals: nothing placed', none.boxes.size, 0);
  eq('no goals: no scrolling', none.scroll, false);
  const solo = layout(make(1, () => 1), opts).boxes.get('b00');
  eq('one urgent goal: full width', solo ? solo.w : -1, 420);
  eq('one urgent goal: centred across', solo ? solo.x : -1, 380);
  eq('one urgent goal: centred down', solo ? solo.y : -1, 170);
  const twelve = make(12, (i) => [1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.1, 0.05, 0, 0][i]);
  const jp = judge(layout(twelve, { boardW: 834, visibleH: 900, minW: 180 }), 834, 180);
  eq('portrait: no overlap', jp.overlap, false);
  eq('portrait: inside the board', jp.outside, false);
  const big = layout(make(15, (i) => (i % 4) * 0.25), { boardW: 1180, visibleH: 620, minW: 208 });
  eq('largest floor setting: none below it', judge(big, 1180, 208).small, false);
});

// ----- Report -----
const failed = results.filter((r) => !r.ok);
const summary = document.getElementById('summary');
const list = document.getElementById('list');
summary.className = failed.length ? 'bad' : 'ok';
summary.textContent = failed.length
  ? failed.length + ' of ' + results.length + ' checks failed'
  : 'All ' + results.length + ' checks passed';
failed.concat(results.filter((r) => r.ok)).forEach((r) => {
  const li = document.createElement('li');
  li.className = r.ok ? '' : 'bad';
  li.textContent = (r.ok ? 'ok: ' : 'FAILED: ') + r.name;
  if (!r.ok && r.detail) {
    const small = document.createElement('small');
    small.textContent = ' (' + r.detail + ')';
    li.appendChild(small);
  }
  list.appendChild(li);
});
