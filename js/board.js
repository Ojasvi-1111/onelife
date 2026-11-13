// The Board: header, floating goal boxes and the bottom bar.
import { state, clock } from './store.js';
import { logicalDay, addDays, diffDays, fmtDay, fmtTime, fmtMinutes } from './time.js';
import {
  repeats, isOverdue, dayState, slotPhase, weeklyAvailable, weekInfo, nextSession, firstDay,
  stepsDone, numberCurrent, nextStep, weekLine, todayScore, clearedIds
} from './sessions.js';
import { urgency, neonLook } from './urgency.js';
import { layout, FLOOR_W } from './layout.js';
import { esc, nums } from './ui.js';
import { icon } from './icons.js';

const boxes = new Map();   // goal id -> box element
let views = new Map();     // goal id -> what the box shows
let handlers = {};
let wrapEl = null;
let boardEl = null;
let emptyEl = null;
let lastKey = '';
let lastLayout = null;
let firstPaint = true;
let resizeTimer = 0;

export function boardContext() {
  const now = clock();
  const cutoff = state.settings.dayCutoff;
  return { now: now, cutoff: cutoff, today: logicalDay(now, cutoff) };
}

const plainNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const compactNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
function fmtNum(v) { return Math.abs(v) >= 10000 ? compactNumber.format(v) : plainNumber.format(v); }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

function progressOf(goal, ge) {
  const m = goal.measure;
  if (m.type === 'steps') {
    const d = stepsDone(goal, ge);
    const t = m.steps.length;
    return {
      long: d + ' of ' + plural(t, 'step', 'steps'), short: d + '/' + t,
      frac: t ? d / t : 0, progress: true
    };
  }
  if (m.type === 'number') {
    const cur = numberCurrent(goal, ge);
    return {
      long: fmtNum(cur) + ' of ' + fmtNum(m.target) + (m.unit ? ' ' + m.unit : ''),
      short: fmtNum(cur) + '/' + fmtNum(m.target),
      frac: m.target > 0 ? Math.max(0, Math.min(1, cur / m.target)) : 0, progress: true
    };
  }
  return null;
}

// The one action the tick button performs, in order of priority.
export function tickAction(goal, ge, c, u) {
  if (u.upcoming) return null;
  const mode = goal.repeat.mode;
  if (mode === 'days' && dayState(goal, ge, c.today, c.today, c.cutoff) === 'pending') {
    return { kind: 'done', icon: 'check', label: 'Mark done for today' };
  }
  if (mode === 'perWeek' && weeklyAvailable(goal, ge, c.today, c.cutoff)) {
    return { kind: 'done', icon: 'check', label: 'Mark a session done' };
  }
  if (u.owed.sessions > 0) return { kind: 'makeup', icon: 'makeup', label: 'Make up one session' };
  if (u.complete) return { kind: 'finish', icon: 'trophy', label: 'Finish goal' };
  const runEnded = !!goal.run.end && c.today > goal.run.end;
  if (!repeats(goal) || runEnded) {
    if (goal.measure.type === 'steps' && nextStep(goal, ge)) {
      return { kind: 'step', icon: 'steps', label: 'Tick the next step' };
    }
    if (goal.measure.type === 'number' && numberCurrent(goal, ge) < goal.measure.target) {
      return { kind: 'number', icon: 'plusone', label: 'Add one' };
    }
  }
  if (goal.measure.type === 'check' && !repeats(goal)) {
    return { kind: 'finish', icon: 'check', label: 'Finish goal' };
  }
  return null;
}

// Status lines in order of priority. Each has a long and a short form.
function statusRows(goal, ge, c, u, overdue, progress) {
  const rows = [];
  const add = (long, short, hot) => rows.push({ long: long, short: short || long, hot: !!hot });
  const today = c.today;
  const cutoff = c.cutoff;

  if (u.upcoming) {
    const d = fmtDay(firstDay(goal, cutoff));
    add('Starts ' + d, 'From ' + d);
    return rows;
  }
  if (overdue) {
    const n = diffDays(goal.run.end, today);
    add('Overdue ' + plural(n, 'day', 'days'), 'Overdue ' + n + 'd', true);
  }
  if (u.owed.sessions > 0) {
    if (u.owed.minutes > 0) add('Owes ' + fmtMinutes(u.owed.minutes), '', true);
    else add('Owes ' + plural(u.owed.sessions, 'session', 'sessions'), 'Owes ' + u.owed.sessions, true);
  }
  const st = goal.repeat.mode === 'days' ? dayState(goal, ge, today, today, cutoff) : null;
  if (st === 'pending') {
    const ph = slotPhase(goal, today, c.now, cutoff);
    if (ph.phase === 'running') add('Now until ' + fmtTime(ph.slot.end), 'Now');
    else if (ph.phase === 'ahead' && ph.minutesToStart < 60) add('In ' + Math.max(1, Math.ceil(ph.minutesToStart)) + ' min');
    else if (ph.phase === 'ahead') add('Today ' + fmtTime(ph.slot.start), fmtTime(ph.slot.start));
    else if (ph.phase === 'late') add('Late, was ' + fmtTime(ph.slot.start), 'Late');
    else add('Today');
  }
  let week = null;
  if (goal.repeat.mode === 'perWeek') {
    week = weekInfo(goal, ge, today, cutoff);
    if (weeklyAvailable(goal, ge, today, cutoff)) add(week.need + ' left this week', week.need + ' left');
  }
  if (u.complete) add('Complete, tap to finish', 'Complete');
  if (st === 'done') add('Done today', 'Done');
  else if (st === 'skipped') add('Skipped today', 'Skipped');
  else if (week && week.required > 0 && week.need === 0) add('Week done');
  else if (week && ge.some((e) => e.day === today && e.kind === 'done')) add('Done today', 'Done');
  if (goal.run.end && today <= goal.run.end) {
    const left = diffDays(today, goal.run.end);
    if (left === 0) add('Due today');
    else add(plural(left, 'day', 'days') + ' left', left + 'd left');
  }
  if (goal.repeat.mode === 'days' && st === null) {
    const nx = nextSession(goal, today, cutoff);
    if (nx) {
      const wd = fmtDay(nx.day, { weekday: 'short' });
      const label = nx.slot && nx.slot.start ? wd + ' ' + fmtTime(nx.slot.start) : wd;
      add('Next: ' + label, label);
    }
  }
  if (progress) rows.push(progress);
  return rows;
}

// The last seven days as states, oldest first.
function stripOf(goal, ge, c) {
  const cleared = clearedIds(ge);
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(c.today, -i);
    const list = ge.filter((e) => e.day === d);
    let s = 'none';
    if (list.some((e) => e.kind === 'done')) s = 'done';
    else if (list.some((e) => e.kind === 'missed' && !cleared.has(e.id))) s = 'missed';
    else if (list.some((e) => e.kind === 'missed')) s = 'madeup';
    else if (list.some((e) => e.kind === 'skipped')) s = 'skipped';
    else if (i === 0 && goal.repeat.mode === 'days' &&
      dayState(goal, ge, d, c.today, c.cutoff) === 'pending') s = 'pending';
    out.push(s);
  }
  return out;
}

export function goalView(goal, c) {
  const ge = state.byGoal.get(goal.id) || [];
  const u = urgency(goal, ge, c);
  const overdue = isOverdue(goal, ge, c.today, c.cutoff);
  const progress = progressOf(goal, ge);
  const rep = repeats(goal);
  let look = 'normal';
  if (u.upcoming) look = 'upcoming';
  else if (overdue || u.owed.sessions > 0) look = 'missed';
  else if (rep && u.T === 0) look = 'done';
  const running = goal.repeat.mode === 'days' &&
    dayState(goal, ge, c.today, c.today, c.cutoff) === 'pending' &&
    slotPhase(goal, c.today, c.now, c.cutoff).phase === 'running';
  return {
    u: u,
    overdue: overdue,
    look: look,
    running: running,
    progress: progress,
    rows: statusRows(goal, ge, c, u, overdue, progress),
    action: tickAction(goal, ge, c, u),
    week: rep ? weekLine(goal, ge, c.today, c.cutoff) : null,
    strip: rep ? stripOf(goal, ge, c) : null
  };
}

// ----- Fitting text: use the long form when it fits on one line, else the short form -----
let measurer = null;
function textWidth(text, px) {
  if (!measurer) measurer = document.createElement('canvas').getContext('2d');
  measurer.font = '400 ' + px + 'px "Avenir Next", -apple-system, "Helvetica Neue", "Segoe UI", sans-serif';
  return measurer.measureText(text).width * 1.1;
}
function fit(row, avail, w) {
  const px = Math.max(14, Math.min(18, 0.055 * w));
  return textWidth(row.long, px) <= avail ? row.long : row.short;
}

function boxInner(goal, v, w) {
  const tier = w >= 320 ? 3 : w >= 230 ? 2 : 1;
  const showProgress = tier >= 2 && !!v.progress;
  const rows = showProgress ? v.rows.filter((r) => !r.progress) : v.rows;
  const first = rows[0] || null;
  const second = tier === 3 ? (rows[1] || null) : null;
  const hasTick = !!v.action;
  let mid = '';
  if (second) {
    mid += '<div class="box-second' + (second.hot ? ' hot' : '') + '">' + nums(fit(second, w - 36, w)) + '</div>';
  }
  if (showProgress) {
    mid += '<div class="box-progress"><span>' + nums(fit(v.progress, w - 80, w)) + '</span>' +
      '<i class="box-bar"><b style="width:' + Math.round(v.progress.frac * 100) + '%"></b></i></div>';
  } else if (tier >= 2 && v.week && v.week.y > 0) {
    mid += '<div class="box-progress"><span>' + nums(v.week.x + ' of ' + v.week.y + ' this week') + '</span></div>';
  }
  if (tier === 3 && v.strip) {
    mid += '<div class="box-strip">' + v.strip.map((s) => '<i class="d-' + s + '"></i>').join('') + '</div>';
  }
  return '<div class="box-tag"></div>' +
    '<div class="box-title">' + esc(goal.title) + '</div>' +
    (mid ? '<div class="box-mid">' + mid + '</div>' : '') +
    '<div class="box-foot">' +
      '<div class="box-status' + (first && first.hot ? ' hot' : '') + '">' +
        (first ? nums(fit(first, w - 36 - (hasTick ? 44 : 0), w)) : '') +
      '</div>' +
      (hasTick
        ? '<button type="button" class="box-tick" aria-label="' + esc(v.action.label) + '"><span>' +
          icon(v.action.icon) + '</span></button>'
        : '') +
    '</div>';
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function paintBox(goal, v, pos) {
  let el = boxes.get(goal.id);
  const isNew = !el;
  if (isNew) {
    el = document.createElement('div');
    el.className = 'box';
    el.dataset.id = goal.id;
    el.innerHTML = '<div class="box-body"></div>';
    const h = hash(goal.id);
    el.style.setProperty('--drift', (9 + h % 6) + 's');
    el.style.setProperty('--phase', '-' + (h % 9) + 's');
    el.style.setProperty('--dx', (h % 2 ? 5 : -5) + 'px');
    el.style.setProperty('--dy', (h % 3 ? 4 : -4) + 'px');
    boxes.set(goal.id, el);
  }
  const look = neonLook(v.u.Uq, v.look);
  el.classList.toggle('is-done', v.look === 'done');
  el.classList.toggle('is-missed', v.look === 'missed');
  el.classList.toggle('is-upcoming', v.look === 'upcoming');
  el.classList.toggle('is-running', v.running);
  el.style.transform = 'translate(' + pos.x + 'px,' + pos.y + 'px)';
  el.style.width = pos.w + 'px';
  el.style.height = pos.h + 'px';
  el.style.setProperty('--neon', look.neon);
  el.style.setProperty('--lit-hi', look.hi.toFixed(2));
  el.style.setProperty('--lit-lo', look.lo.toFixed(2));
  el.style.setProperty('--breath', look.breath.toFixed(1) + 's');
  el.style.setProperty('--tag', 'var(--t' + (goal.color % 8) + ')');
  const body = el.firstChild;
  const html = boxInner(goal, v, pos.w);
  if (body.__html !== html) {
    body.innerHTML = html;
    body.__html = html;
  }
  if (isNew) {
    if (!firstPaint) {
      el.style.opacity = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = ''; }));
    }
    boardEl.appendChild(el);
  }
}

function clockHTML(now) {
  const parts = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).formatToParts(now);
  let main = '';
  let period = '';
  parts.forEach((p) => {
    if (p.type === 'dayPeriod') period = p.value;
    else if (p.type !== 'literal' || p.value.trim() !== '') main += p.value;
  });
  return esc(main) + (period ? '<span class="ampm">' + esc(period) + '</span>' : '');
}

function updateHeader(c, active) {
  const quote = state.settings.quote || '';
  const quoteEl = document.getElementById('quote');
  quoteEl.textContent = quote;
  quoteEl.hidden = !quote;
  document.getElementById('clock').innerHTML = clockHTML(c.now);
  document.getElementById('date').textContent =
    fmtDay(c.today, { weekday: 'short', day: 'numeric', month: 'short' });
  const score = todayScore(active, state.byGoal, c.today, c.cutoff);
  const scoreEl = document.getElementById('score');
  scoreEl.hidden = score.total === 0;
  scoreEl.innerHTML = '<b class="n">' + score.done + '/' + score.total + '</b> done today';
}

export function refreshBoard() {
  if (!wrapEl) return;
  const c = boardContext();
  const active = state.goals.filter((g) => g.status === 'active');
  views = new Map();
  active.forEach((g) => views.set(g.id, goalView(g, c)));
  updateHeader(c, active);
  emptyEl.hidden = active.length > 0;

  const boardW = wrapEl.clientWidth;
  const visibleH = wrapEl.clientHeight;
  if (boardW < 120 || visibleH < 120) return;   // hidden or not laid out yet
  const minW = FLOOR_W[state.settings.minBox] || FLOOR_W.comfortable;
  const items = active.map((g) => ({
    id: g.id, uq: views.get(g.id).u.Uq, importance: g.importance, createdAt: g.createdAt
  }));
  const key = boardW + '|' + visibleH + '|' + minW + '|' +
    items.map((it) => it.id + ':' + it.uq + ':' + it.importance).join(',');
  if (key !== lastKey || !lastLayout) {
    lastLayout = layout(items, { boardW: boardW, visibleH: visibleH, minW: minW });
    lastKey = key;
    boardEl.style.height = lastLayout.boardHeight + 'px';
    if (!lastLayout.scroll) wrapEl.scrollTop = 0;
  }

  if (firstPaint) boardEl.classList.add('no-anim');
  const seen = new Set();
  active.forEach((g) => {
    const pos = lastLayout.boxes.get(g.id);
    if (!pos) return;
    seen.add(g.id);
    paintBox(g, views.get(g.id), pos);
  });
  boxes.forEach((el, id) => {
    if (!seen.has(id)) { el.remove(); boxes.delete(id); }
  });
  if (firstPaint) {
    firstPaint = false;
    requestAnimationFrame(() => requestAnimationFrame(() => boardEl.classList.remove('no-anim')));
  }
}

export function boxElement(id) { return boxes.get(id) || null; }
export function viewFor(id) { return views.get(id) || null; }

// h: { onAdd, onDone, onSettings, onTick(id, action, el), onOpen(id, el) }
export function mountBoard(app, h) {
  handlers = h || {};
  app.innerHTML =
    '<header class="header">' +
      '<div class="brand">' +
        '<div class="brand-name">OneLife</div>' +
        '<div class="brand-quote" id="quote"></div>' +
      '</div>' +
      '<div class="cluster">' +
        '<div class="clock" id="clock"></div>' +
        '<div class="cluster-date" id="date"></div>' +
        '<div class="cluster-score" id="score" hidden></div>' +
      '</div>' +
    '</header>' +
    '<main class="board-wrap" id="wrap">' +
      '<div class="board" id="board"></div>' +
      '<div class="empty" id="empty" hidden>' +
        '<div class="empty-title">Add your first goal</div>' +
        '<div class="empty-sub">Tap the + below.</div>' +
      '</div>' +
    '</main>' +
    '<nav class="bar" id="bar">' +
      '<button type="button" class="bar-btn" data-act="done">' + icon('trophy') + '<span>Done</span></button>' +
      '<button type="button" class="add-btn" data-act="add" aria-label="Add goal">' + icon('plus', 'icon icon-lg') + '</button>' +
      '<button type="button" class="bar-btn" data-act="settings">' + icon('settings') + '<span>Settings</span></button>' +
    '</nav>';
  wrapEl = document.getElementById('wrap');
  boardEl = document.getElementById('board');
  emptyEl = document.getElementById('empty');
  boxes.clear();
  lastKey = '';
  lastLayout = null;
  firstPaint = true;

  wrapEl.addEventListener('click', (event) => {
    const box = event.target.closest('.box');
    if (!box) return;
    const id = box.dataset.id;
    const view = views.get(id);
    if (event.target.closest('.box-tick')) {
      if (handlers.onTick) handlers.onTick(id, view ? view.action : null, box);
    } else if (handlers.onOpen) {
      handlers.onOpen(id, box);
    }
  });
  document.getElementById('bar').addEventListener('click', (event) => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const act = button.dataset.act;
    if (act === 'add' && handlers.onAdd) handlers.onAdd();
    if (act === 'done' && handlers.onDone) handlers.onDone();
    if (act === 'settings' && handlers.onSettings) handlers.onSettings();
  });

  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refreshBoard, 150);
  };
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(wrapEl);
  else window.addEventListener('resize', onResize);

  refreshBoard();
}
