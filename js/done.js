// The Done screen: a wall of neon signs for finished goals, a feed of wins, and a calendar.
import { state, subscribe, saveSettings, todayDay, deleteGoal } from './store.js';
import { addDays, splitDay, makeDay, weekdayOf, logicalDay, fmtDay, fmtMinutes } from './time.js';
import { reopenGoal, totalsOf } from './actions.js';
import { act } from './celebrate.js';
import { esc, nums, openSheet, closeSheet, toast } from './ui.js';
import { icon } from './icons.js';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const trimNum = (v) => String(Math.round(v * 100) / 100);

function isWin(e) {
  return e.kind === 'done' || e.kind === 'makeup' || e.kind === 'step' || e.kind === 'finished' ||
    (e.kind === 'number' && e.value > 0);
}
// day -> wins of that day, newest first
function winsByDay() {
  const map = new Map();
  state.entries.forEach((e) => {
    if (!isWin(e)) return;
    let list = map.get(e.day);
    if (!list) { list = []; map.set(e.day, list); }
    list.push(e);
  });
  map.forEach((list) => list.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)));
  return map;
}
function winText(goal, e) {
  if (e.kind === 'done') return 'Done' + (e.minutes ? ', ' + fmtMinutes(e.minutes) : '');
  if (e.kind === 'makeup') return 'Made up' + (e.minutes ? ' ' + fmtMinutes(e.minutes) : '');
  if (e.kind === 'finished') return 'Finished';
  if (e.kind === 'step') {
    const step = goal && goal.measure.type === 'steps' ? goal.measure.steps.find((s) => s.id === e.stepId) : null;
    return 'Step: ' + (step ? step.text : 'a step');
  }
  if (e.kind === 'number') {
    return '+' + trimNum(e.value) + (goal && goal.measure.type === 'number' && goal.measure.unit ? ' ' + goal.measure.unit : '');
  }
  return '';
}
function winRow(goals, e) {
  const goal = goals.get(e.goalId) || null;
  return '<div class="win">' +
    '<span class="win-time">' + nums(timeFormat.format(new Date(e.at))) + '</span>' +
    '<i class="tagdot" style="--tag:var(--t' + (goal ? goal.color % 8 : 7) + ')"></i>' +
    '<span class="win-title">' + esc(goal ? goal.title : 'Deleted goal') + '</span>' +
    '<span class="win-what">' + nums(winText(goal, e)) + '</span>' +
    '</div>';
}
function dayHead(day, list) {
  const minutes = list.reduce((sum, e) => (
    sum + ((e.kind === 'done' || e.kind === 'makeup') ? (e.minutes || 0) : 0)
  ), 0);
  return '<div class="feed-day"><b>' + nums(fmtDay(day, { weekday: 'short', day: 'numeric', month: 'short' })) + '</b>' +
    '<span>' + nums(plural(list.length, 'win', 'wins')) + '</span>' +
    (minutes ? '<span>' + nums(fmtMinutes(minutes)) + '</span>' : '') + '</div>';
}

function wallHTML() {
  const cutoff = state.settings.dayCutoff;
  const finished = state.goals.filter((g) => g.status === 'finished')
    .sort((a, b) => ((a.finishedAt || '') < (b.finishedAt || '') ? 1 : -1));
  if (!finished.length) return '<div class="screen-empty">Finished goals light up here.</div>';
  return '<div class="wall">' + finished.map((g) => {
    const when = g.finishedAt ? logicalDay(new Date(g.finishedAt), cutoff) : todayDay();
    const totals = totalsOf(g);
    return '<button type="button" class="sign" data-d="sign" data-id="' + esc(g.id) +
      '" style="--sign:var(--s' + (g.color % 8) + ')">' +
      '<span class="sign-title">' + esc(g.title) + '</span>' +
      '<span class="sign-meta">' + nums('Finished ' + fmtDay(when, { day: 'numeric', month: 'short', year: 'numeric' })) + '</span>' +
      (totals.length
        ? '<span class="sign-totals">' + totals.map((t) => '<span>' + nums(t) + '</span>').join('') + '</span>'
        : '') +
      '</button>';
  }).join('') + '</div>';
}

function feedHTML(ui, goals, byDay, today) {
  const days = Array.from(byDay.keys()).sort().reverse();
  if (!days.length) return '<div class="screen-empty">Every tick you make shows up here.</div>';
  const limit = addDays(today, -ui.days);
  const shown = days.filter((d) => d > limit);
  let h = shown.map((d) => dayHead(d, byDay.get(d)) + byDay.get(d).map((e) => winRow(goals, e)).join('')).join('');
  if (!shown.length) h += '<div class="screen-empty">No wins in the last ' + ui.days + ' days.</div>';
  if (shown.length < days.length) {
    h += '<div class="fsub"><button type="button" class="btn" data-d="more">Show earlier</button></div>';
  }
  return h;
}

function calendarHTML(ui, goals, byDay, today) {
  const first = makeDay(ui.y, ui.m, 1);
  const offset = (weekdayOf(first) + 6) % 7;                 // Monday first
  const count = new Date(ui.y, ui.m, 0).getDate();           // days in the month
  const label = monthFormat.format(new Date(ui.y, ui.m - 1, 1, 12));
  let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => '<div class="cal-wd">' + d + '</div>').join('');
  for (let i = 0; i < offset; i++) cells += '<div></div>';
  let total = 0;
  for (let d = 1; d <= count; d++) {
    const day = makeDay(ui.y, ui.m, d);
    const n = (byDay.get(day) || []).length;
    total += n;
    const level = n === 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : 4;
    cells += '<button type="button" class="cal-cell' + (level ? ' l' + level : '') +
      (day === today ? ' is-today' : '') + (day === ui.sel ? ' is-sel' : '') +
      '" data-d="day" data-day="' + day + '" aria-label="' + esc(fmtDay(day)) + ', ' + plural(n, 'win', 'wins') + '">' + d + '</button>';
  }
  let h = '<div class="cal"><div class="cal-head">' +
    '<button type="button" class="icon-btn" data-d="prev" aria-label="Previous month">' + icon('back') + '</button>' +
    '<div class="cal-month">' + esc(label) + '</div>' +
    '<button type="button" class="icon-btn" data-d="next" aria-label="Next month">' + icon('chevron') + '</button>' +
    '</div><div class="cal-grid">' + cells + '</div>' +
    '<div class="cal-cap">' + nums(plural(total, 'win', 'wins') + ' this month') + '</div>';
  if (ui.sel) {
    const list = byDay.get(ui.sel) || [];
    h += dayHead(ui.sel, list) +
      (list.length ? list.map((e) => winRow(goals, e)).join('') : '<div class="fnote">Nothing recorded that day.</div>');
  }
  return h + '</div>';
}

function doneHTML(ui) {
  const today = todayDay();
  const goals = new Map(state.goals.map((g) => [g.id, g]));
  const tabs = [['wall', 'Wall'], ['wins', 'Wins'], ['calendar', 'Calendar']];
  let body = '';
  if (ui.tab === 'wall') body = wallHTML();
  else if (ui.tab === 'wins') body = feedHTML(ui, goals, winsByDay(), today);
  else body = calendarHTML(ui, goals, winsByDay(), today);
  return '<header class="screen-head">' +
    '<button type="button" class="btn" data-d="back">' + icon('back') + '<span>Board</span></button>' +
    '<div class="screen-title">Done</div>' +
    '<div class="seg">' + tabs.map((t) => (
      '<button type="button" class="seg-btn' + (ui.tab === t[0] ? ' is-on' : '') +
      '" data-d="tab" data-val="' + t[0] + '">' + t[1] + '</button>'
    )).join('') + '</div></header>' +
    '<div class="screen-body">' + body + '</div>';
}

// A finished goal's sign: its totals, with Reopen and Delete.
function openSign(goal) {
  const totals = totalsOf(goal);
  const sheet = openSheet({
    html:
      '<div class="sheet-title">Finished goal</div>' +
      '<div class="detail-title">' + esc(goal.title) + '</div>' +
      (totals.length
        ? '<div class="finish-totals" style="justify-content:flex-start">' +
          totals.map((t) => '<span>' + nums(t) + '</span>').join('') + '</div>'
        : '') +
      '<div class="sheet-actions">' +
        '<button type="button" class="btn btn-danger" data-g="delete">Delete</button>' +
        '<button type="button" class="btn" data-g="reopen">Reopen</button>' +
        '<button type="button" class="btn btn-primary" data-g="close">Close</button>' +
      '</div>'
  });
  sheet.addEventListener('click', (event) => {
    const button = event.target.closest('[data-g]');
    if (!button) return;
    const what = button.dataset.g;
    if (what === 'close') {
      closeSheet();
    } else if (what === 'reopen') {
      closeSheet();
      act(() => reopenGoal(goal.id), null);
    } else if (what === 'delete') {
      if (!window.confirm('Delete this goal and everything recorded for it?')) return;
      closeSheet();
      deleteGoal(goal.id).then(() => toast('Goal deleted.'), () => toast('Could not delete. Try again.'));
    }
  });
}

export function mountDone(root, h) {
  const now = splitDay(todayDay());
  const tab = state.settings.doneTab;
  const ui = {
    tab: tab === 'wins' || tab === 'calendar' ? tab : 'wall',
    y: now.y, m: now.m, sel: '', days: 30
  };
  let live = true;

  const render = () => {
    if (!live) return;
    const body = root.querySelector('.screen-body');
    const scroll = body ? body.scrollTop : 0;
    try {
      root.innerHTML = doneHTML(ui);
    } catch (err) {
      // Never strand the user on a blank screen.
      root.innerHTML = '<header class="screen-head">' +
        '<button type="button" class="btn" data-d="back">' + icon('back') + '<span>Board</span></button>' +
        '<div class="screen-title">Done</div></header>' +
        '<div class="screen-body"><div class="screen-empty">This screen could not be drawn: ' +
        esc(String((err && err.message) || err)) + '</div></div>';
    }
    const next = root.querySelector('.screen-body');
    if (next) next.scrollTop = scroll;
  };
  const stop = subscribe(render);
  render();

  root.onclick = (event) => {
    const t = event.target.closest('[data-d]');
    if (!t) return;
    const what = t.dataset.d;
    if (what === 'back') {
      h.onBack();
    } else if (what === 'tab') {
      ui.tab = t.dataset.val;
      const body = root.querySelector('.screen-body');
      if (body) body.scrollTop = 0;
      render();
      saveSettings({ doneTab: ui.tab }).catch(() => {});
    } else if (what === 'prev') {
      ui.m -= 1;
      if (ui.m < 1) { ui.m = 12; ui.y -= 1; }
      ui.sel = '';
      render();
    } else if (what === 'next') {
      ui.m += 1;
      if (ui.m > 12) { ui.m = 1; ui.y += 1; }
      ui.sel = '';
      render();
    } else if (what === 'day') {
      ui.sel = ui.sel === t.dataset.day ? '' : t.dataset.day;
      render();
    } else if (what === 'more') {
      ui.days += 30;
      render();
    } else if (what === 'sign') {
      const goal = state.goals.find((g) => g.id === t.dataset.id);
      if (goal) openSign(goal);
    }
  };

  return () => {
    live = false;
    stop();
    root.onclick = null;
  };
}
