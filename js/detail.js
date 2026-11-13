// Goal detail: everything about one goal, and every action on it.
import { state, getGoal, subscribe, todayDay, updateGoal, deleteGoal } from './store.js';
import { addDays, fmtDay, fmtTime, fmtMinutes } from './time.js';
import {
  repeats, clearedIds, dayState, weekInfo, weekLine, rate30, numberCurrent, tickedStepIds
} from './sessions.js';
import * as A from './actions.js';
import { act } from './celebrate.js';
import { boardContext, goalView } from './board.js';
import { esc, nums, openSheet, closeSheet, toast } from './ui.js';
import { icon } from './icons.js';
import { openGoalForm } from './form.js';
import { hasInk, inkSVG, openInkPad } from './ink.js';

const ORDER = [1, 2, 3, 4, 5, 6, 0];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtNum = (v) => String(Math.round(v * 100) / 100);

// The dates and the slot in words.
function scheduleParts(goal) {
  const parts = [];
  const run = goal.run;
  if (run.start && run.end) parts.push(fmtDay(run.start) + ' to ' + fmtDay(run.end));
  else if (run.start) parts.push('From ' + fmtDay(run.start));
  const p = goal.repeat;
  if (p.mode === 'perWeek') {
    parts.push(p.times + (p.times === 1 ? ' time' : ' times') + ' a week' +
      (p.sessionMinutes ? ', ' + fmtMinutes(p.sessionMinutes) + ' each' : ''));
  } else if (p.mode === 'days') {
    const ordered = ORDER.map((w) => p.slots.find((s) => s.weekday === w)).filter(Boolean);
    const names = ordered.length === 7 ? 'Every day' : ordered.map((s) => SHORT[s.weekday]).join(', ');
    const timed = ordered.filter((s) => s.start && s.end);
    if (!timed.length) {
      parts.push(names + ', any time' + (p.sessionMinutes ? ', ' + fmtMinutes(p.sessionMinutes) : ''));
    } else if (timed.length === ordered.length &&
      ordered.every((s) => s.start === ordered[0].start && s.end === ordered[0].end)) {
      parts.push(names + ', ' + fmtTime(ordered[0].start) + ' to ' + fmtTime(ordered[0].end));
    } else {
      parts.push(ordered.map((s) => SHORT[s.weekday] + (s.start ? ' ' + fmtTime(s.start) : '')).join(', '));
    }
  }
  return parts;
}

function stripDays(goal, ge, c, count) {
  const cleared = clearedIds(ge);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
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

function entryRow(goal, e, cleared, ui) {
  const day = fmtDay(e.day, { weekday: 'short', day: 'numeric', month: 'short' });
  const id = esc(e.id);
  const del = '<button type="button" class="icon-btn" data-do="del" data-id="' + id +
    '" aria-label="Delete entry">' + icon('trash') + '</button>';
  let what = '';
  let hot = false;
  let controls = '';
  if (e.kind === 'done' || e.kind === 'makeup') {
    if (ui.editing === e.id) {
      return '<form class="hrow" data-form="minutes" data-id="' + id + '">' +
        '<div class="hrow-day">' + nums(day) + '</div>' +
        '<input class="input" type="number" name="minutes" inputmode="numeric" min="0" max="1440" value="' +
          (e.minutes || 0) + '" aria-label="Minutes">' +
        '<span class="hrow-what">minutes</span>' +
        '<button type="submit" class="btn">Save</button>' +
        '<button type="button" class="btn" data-do="canceledit">Cancel</button>' +
        '</form>';
    }
    what = (e.kind === 'done' ? 'Done' : 'Made up') + (e.minutes ? ', ' + fmtMinutes(e.minutes) : '');
    controls = '<button type="button" class="icon-btn" data-do="editmin" data-id="' + id +
      '" aria-label="Edit minutes">' + icon('edit') + '</button>' + del;
  } else if (e.kind === 'skipped') {
    what = 'Skipped';
    controls = del;
  } else if (e.kind === 'missed') {
    if (cleared.has(e.id)) {
      what = 'Missed, made up later';
    } else {
      hot = true;
      what = 'Missed' + (e.minutes ? ', owes ' + fmtMinutes(e.minutes) : '');
      controls = '<button type="button" class="btn" data-do="did" data-id="' + id + '">I did it</button>' +
        '<button type="button" class="btn" data-do="excuse" data-id="' + id + '">Excused</button>';
    }
  } else if (e.kind === 'step') {
    const step = goal.measure.type === 'steps' ? goal.measure.steps.find((s) => s.id === e.stepId) : null;
    what = 'Step: ' + (step ? step.text : 'removed step');
    controls = del;
  } else if (e.kind === 'number') {
    what = (e.value > 0 ? '+' : '') + fmtNum(e.value) +
      (goal.measure.type === 'number' && goal.measure.unit ? ' ' + goal.measure.unit : '');
    controls = del;
  } else if (e.kind === 'finished') {
    what = 'Finished';
  }
  return '<div class="hrow"><div class="hrow-day">' + nums(day) + '</div>' +
    '<div class="hrow-what' + (hot ? ' hot' : '') + '">' + nums(what) + '</div>' + controls + '</div>';
}

function detailHTML(goal, ui) {
  const c = boardContext();
  const ge = state.byGoal.get(goal.id) || [];
  const v = goalView(goal, c);
  const ow = v.u.owed;
  const cleared = clearedIds(ge);
  const rep = repeats(goal);
  const mode = goal.repeat.mode;
  const pendingToday = mode === 'days' && dayState(goal, ge, c.today, c.today, c.cutoff) === 'pending';
  const week = mode === 'perWeek' ? weekInfo(goal, ge, c.today, c.cutoff) : null;
  const btn = (what, label, extra) =>
    '<button type="button" class="btn' + (extra || '') + '" data-do="' + what + '">' + label + '</button>';

  // The title: your handwriting when the goal has it, otherwise the typed name.
  const title = hasInk(goal.inkTitle)
    ? '<div class="detail-title" style="height:76px">' +
      inkSVG(goal.inkTitle, { label: goal.title, stroke: 2.6 }) + '</div>'
    : '<div class="detail-title">' + esc(goal.title) + '</div>';

  let h = '<div class="form-head detail-head" style="--tag:var(--t' + (goal.color % 8) + ')">' +
    '<div class="detail-tag"></div>' + title +
    '<button type="button" class="icon-btn" data-do="close" aria-label="Close">' + icon('close') + '</button>' +
    '</div><div class="form-body">';

  const words = scheduleParts(goal);
  if (words.length) {
    h += '<div class="detail-sub">' + words.map((w) => '<span>' + nums(w) + '</span>').join('') + '</div>';
  }
  const rows = v.rows.filter((r) => !r.progress);
  if (rows.length) {
    h += '<div class="pills">' + rows.map((r) => (
      '<span class="pill' + (r.hot ? ' hot' : '') + '">' + nums(r.long) + '</span>'
    )).join('') + '</div>';
  }

  // Actions
  const buttons = [];
  const makeupLabel = 'Make up one session' +
    (ow.list[0] && ow.list[0].minutes ? ' (' + fmtMinutes(ow.list[0].minutes) + ')' : '');
  if (v.action) {
    const k = v.action.kind;
    const label = k === 'done' ? (mode === 'perWeek' ? 'Done, one session' : 'Done for today')
      : k === 'makeup' ? makeupLabel
      : k === 'finish' ? 'Finish goal'
      : k === 'step' ? 'Tick the next step' : 'Add 1';
    buttons.push('<button type="button" class="btn btn-primary" data-do="tick" data-kind="' + k + '">' +
      icon(v.action.icon) + '<span>' + esc(label) + '</span></button>');
  }
  if (ow.sessions > 0 && (!v.action || v.action.kind !== 'makeup')) buttons.push(btn('makeup', esc(makeupLabel)));
  if (pendingToday) buttons.push(btn('skip', 'Skip today'));
  if (week && week.need > 0) buttons.push(btn('skip', 'Skip one this week'));
  if (ow.sessions > 0) buttons.push(btn('excuseall', 'Excuse all owed'));
  if (!v.action || v.action.kind !== 'finish') buttons.push(btn('finish', 'Finish goal'));
  h += '<section class="fsec"><div class="actions">' + buttons.join('') + '</div></section>';

  // Importance
  h += '<section class="fsec"><div class="fsec-label">Importance</div>' +
    '<div class="scale num-seg"><span>Low</span><div class="seg">' +
    [1, 2, 3, 4, 5].map((n) => (
      '<button type="button" class="seg-btn' + (goal.importance === n ? ' is-on' : '') +
      '" data-do="imp" data-val="' + n + '">' + n + '</button>'
    )).join('') + '</div><span>High</span></div></section>';

  // Progress
  if (goal.measure.type === 'steps') {
    const ticked = tickedStepIds(ge);
    h += '<section class="fsec"><div class="fsec-label">' + nums(v.progress.long) + '</div>' +
      goal.measure.steps.map((s) => (
        '<button type="button" class="steptick' + (ticked.has(s.id) ? ' is-on' : '') +
        '" data-do="step" data-id="' + esc(s.id) + '"><i>' + icon('check') + '</i><span>' + esc(s.text) + '</span></button>'
      )).join('') + '</section>';
  } else if (goal.measure.type === 'number') {
    const m = goal.measure;
    const cur = numberCurrent(goal, ge);
    const pct = m.target > 0 ? Math.max(0, Math.min(100, Math.round(100 * cur / m.target))) : 0;
    h += '<section class="fsec">' +
      '<div class="bignum"><b>' + esc(fmtNum(cur)) + '</b><span>of ' +
        nums(fmtNum(m.target) + (m.unit ? ' ' + m.unit : '')) + '</span></div>' +
      '<div class="bar-line"><b style="width:' + pct + '%"></b></div>' +
      '<form class="inline fsub" data-form="amount">' +
        '<button type="button" class="btn" data-do="num" data-val="-1"' +
          (cur - 1 < m.startValue ? ' disabled' : '') + '>-1</button>' +
        '<button type="button" class="btn" data-do="num" data-val="1">+1</button>' +
        '<input class="input" name="amount" type="number" inputmode="decimal" step="any" placeholder="Other amount">' +
        '<button type="submit" class="btn">Add</button>' +
      '</form></section>';
  }

  // Stats
  const stats = [];
  if (rep) {
    const line = weekLine(goal, ge, c.today, c.cutoff);
    if (line.y > 0) stats.push([line.x + ' of ' + line.y, 'this week', false]);
    const rate = rate30(ge, c.today);
    if (rate !== null) stats.push([rate + '%', 'last 30 days', false]);
  }
  const logged = ge.reduce((sum, e) => (
    sum + ((e.kind === 'done' || e.kind === 'makeup') ? (e.minutes || 0) : 0)
  ), 0);
  if (logged) stats.push([fmtMinutes(logged), 'time logged', false]);
  if (ow.sessions) {
    stats.push(ow.minutes
      ? [fmtMinutes(ow.minutes), 'owed', true]
      : [String(ow.sessions), ow.sessions === 1 ? 'session owed' : 'sessions owed', true]);
  }
  if (stats.length) {
    h += '<section class="fsec"><div class="stats">' + stats.map((s) => (
      '<div class="stat"><div class="stat-num' + (s[2] ? ' hot' : '') + '">' + esc(s[0]) + '</div>' +
      '<div class="stat-label">' + esc(s[1]) + '</div></div>'
    )).join('') + '</div></section>';
  }

  // Past its end date
  if (v.overdue) {
    h += '<section class="fsec"><div class="fsec-label">This goal is past its end date</div>' +
      '<form class="inline" data-form="extend">' +
        '<input class="input" type="date" name="end" value="' + addDays(c.today, 7) + '" min="' + c.today + '">' +
        '<button type="submit" class="btn">Extend end date</button>' +
      '</form></section>';
  }

  // Notes, typed and handwritten
  h += '<section class="fsec"><div class="fsec-label">Notes</div>' +
    (goal.notes ? '<div class="detail-notes">' + esc(goal.notes) + '</div>' : '') +
    (hasInk(goal.inkNote)
      ? '<div class="ink-preview tall" style="height:260px">' +
        inkSVG(goal.inkNote, { label: 'Handwritten note', stroke: 2.4 }) + '</div>' +
        '<div class="ink-row">' + btn('inknote', 'Edit handwriting') + btn('inknote-remove', 'Remove handwriting') + '</div>'
      : '<div class="ink-row">' + btn('inknote', 'Write a note by hand') + '</div>') +
    '</section>';

  // History
  const list = ge.slice().sort((a, b) => (
    a.day < b.day ? 1 : a.day > b.day ? -1 : a.at < b.at ? 1 : a.at > b.at ? -1 : 0
  ));
  const shown = ui.showAll ? list : list.slice(0, 12);
  h += '<section class="fsec"><div class="fsec-label">History</div>';
  if (rep) {
    h += '<div class="box-strip strip14">' +
      stripDays(goal, ge, c, 14).map((s) => '<i class="d-' + s + '"></i>').join('') + '</div>';
  }
  if (!list.length) h += '<div class="fnote">Nothing recorded yet.</div>';
  h += shown.map((e) => entryRow(goal, e, cleared, ui)).join('');
  if (list.length > shown.length) {
    h += '<div class="fsub">' + btn('more', 'Show all ' + list.length) + '</div>';
  }
  if (rep) {
    const yesterday = addDays(c.today, -1);
    h += '<form class="inline fsub" data-form="log">' +
      '<input class="input" type="date" name="day" value="' + yesterday + '" max="' + yesterday + '">' +
      '<button type="submit" class="btn">Log a past day as done</button></form>';
  }
  h += '</section>';

  h += '</div><div class="form-foot">' +
    btn('delete', 'Delete', ' btn-danger') + btn('drop', 'Drop') +
    '<span class="spacer"></span>' +
    '<button type="button" class="btn" data-do="edit">' + icon('edit') + '<span>Edit</span></button>' +
    '</div>';
  return h;
}

export function openGoalDetail(goalId) {
  const ui = { editing: '', showAll: false };
  let stop = () => {};
  const sheet = openSheet({
    className: 'sheet-form',
    html: '<div class="form" id="detail"></div>',
    onClose: () => stop()
  });
  const root = sheet.querySelector('#detail');

  const render = () => {
    if (!root.isConnected) { stop(); return; }
    const goal = getGoal(goalId);
    if (!goal || goal.status !== 'active') {
      stop();
      closeSheet(true);
      return;
    }
    const body = root.querySelector('.form-body');
    const scroll = body ? body.scrollTop : 0;
    root.innerHTML = detailHTML(goal, ui);
    const next = root.querySelector('.form-body');
    if (next) next.scrollTop = scroll;
  };
  stop = subscribe(render);
  render();

  root.addEventListener('click', async (event) => {
    const t = event.target.closest('[data-do]');
    if (!t || t.disabled) return;
    const what = t.dataset.do;
    const d = t.dataset;
    if (what === 'close') { closeSheet(); return; }
    if (what === 'tick') { await act(() => A.performTick(goalId, d.kind), t); return; }
    if (what === 'makeup') { await act(() => A.makeUp(goalId), t); return; }
    if (what === 'skip') { await act(() => A.skipToday(goalId), t); return; }
    if (what === 'excuseall') {
      if (window.confirm('Excuse everything this goal owes?')) await act(() => A.excuseAllOwed(goalId), t);
      return;
    }
    if (what === 'finish') {
      if (window.confirm('Finish this goal now?')) await act(() => A.finishGoal(goalId), t);
      return;
    }
    if (what === 'imp') {
      try { await updateGoal(goalId, { importance: Number(d.val) }); }
      catch (err) { toast('Could not save. Try again.'); }
      return;
    }
    if (what === 'step') {
      const on = t.classList.contains('is-on');
      await act(() => (on ? A.untickStep(goalId, d.id) : A.tickStep(goalId, d.id)), t);
      return;
    }
    if (what === 'num') { await act(() => A.addNumber(goalId, Number(d.val)), t); return; }
    if (what === 'did') { await act(() => A.convertMissed(d.id, 'done'), t); return; }
    if (what === 'excuse') { await act(() => A.convertMissed(d.id, 'skipped'), t); return; }
    if (what === 'del') { await act(() => A.deleteEntry(d.id), t); return; }
    if (what === 'editmin') {
      ui.editing = d.id;
      render();
      const input = root.querySelector('[data-form="minutes"] input');
      if (input) input.focus();
      return;
    }
    if (what === 'canceledit') { ui.editing = ''; render(); return; }
    if (what === 'more') { ui.showAll = true; render(); return; }
    if (what === 'inknote') {
      const goal = getGoal(goalId);
      if (!goal) return;
      openInkPad({
        title: 'Handwritten note', hint: 'Write your note here', w: 4, h: 3, ink: goal.inkNote,
        onSave: (ink) => {
          updateGoal(goalId, { inkNote: ink }).catch(() => toast('Could not save. Try again.'));
        }
      });
      return;
    }
    if (what === 'inknote-remove') {
      if (!window.confirm('Remove the handwritten note?')) return;
      try { await updateGoal(goalId, { inkNote: null }); }
      catch (err) { toast('Could not save. Try again.'); }
      return;
    }
    if (what === 'edit') { closeSheet(); openGoalForm(goalId); return; }
    if (what === 'drop') {
      if (window.confirm('Drop this goal? Its past wins are kept.')) await act(() => A.dropGoal(goalId), t);
      return;
    }
    if (what === 'delete') {
      if (!window.confirm('Delete this goal and everything recorded for it?')) return;
      try {
        await deleteGoal(goalId);
        toast('Goal deleted.');
      } catch (err) {
        toast('Could not delete. Try again.');
      }
    }
  });

  root.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const kind = form.dataset.form;
    const origin = form.querySelector('button[type="submit"]') || form;
    if (kind === 'amount') {
      const raw = form.elements.amount.value;
      if (raw === '') return;
      await act(() => A.addNumber(goalId, Number(raw)), origin);
    } else if (kind === 'log') {
      const day = form.elements.day.value;
      await act(() => A.logPastDay(goalId, day), origin);
    } else if (kind === 'extend') {
      const end = form.elements.end.value;
      const goal = getGoal(goalId);
      if (!goal || !end) return;
      if (end < todayDay()) { toast('Pick today or a later day.'); return; }
      try {
        await updateGoal(goalId, { run: { start: goal.run.start, end: end } });
        toast('End date moved to ' + fmtDay(end) + '.');
      } catch (err) {
        toast('Could not save. Try again.');
      }
    } else if (kind === 'minutes') {
      const entryId = form.dataset.id;
      const minutes = form.elements.minutes.value;
      ui.editing = '';
      await act(() => A.editMinutes(entryId, minutes), origin);
      render();
    }
  });
}
