// The goal form: one page for adding and editing a goal. A title alone is enough,
// and the title and a note can also be written by hand.
import { state, getGoal, addGoal, updateGoal, deleteGoal, todayDay, newId } from './store.js';
import { addDays, slotValid, fmtTime } from './time.js';
import { esc, toast, openSheet, closeSheet } from './ui.js';
import { icon } from './icons.js';
import { hasInk, inkSVG, openInkPad } from './ink.js';

const ALL = [0, 1, 2, 3, 4, 5, 6];
const ORDER = [1, 2, 3, 4, 5, 6, 0];   // Monday first
const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HANDWRITTEN = 'Handwritten goal';

function blank(today) {
  return {
    id: null, title: '', inkTitle: null,
    when: 'none', start: today, end: '',
    slot: 'none', timeStart: '07:00', timeEnd: '08:00', weekdays: [1, 2, 3, 4, 5],
    perDay: ALL.map((w) => ({ on: w >= 1 && w <= 5, start: '07:00', end: '08:00' })),
    flex: 'everyday', flexDays: [1, 3, 5], flexTimes: 3, flexMinutes: '',
    measure: 'check', steps: [], target: '', unit: '', startValue: '0',
    importance: 3, color: null, notes: '', inkNote: null
  };
}

// Turn a saved goal back into form values.
function fromGoal(goal, today) {
  const f = blank(today);
  f.id = goal.id;
  f.inkTitle = hasInk(goal.inkTitle) ? goal.inkTitle : null;
  f.inkNote = hasInk(goal.inkNote) ? goal.inkNote : null;
  f.title = f.inkTitle && goal.title === HANDWRITTEN ? '' : goal.title;
  f.notes = goal.notes || '';
  f.importance = goal.importance;
  f.color = goal.color;
  if (goal.run.start && goal.run.end) {
    f.when = 'fixed';
    f.start = goal.run.start;
    f.end = goal.run.end;
  } else if (goal.run.start) {
    f.when = 'forever';
    f.start = goal.run.start;
  }
  const r = goal.repeat;
  if (r.mode === 'perWeek') {
    f.slot = 'flex';
    f.flex = 'times';
    f.flexTimes = r.times;
    f.flexMinutes = r.sessionMinutes ? String(r.sessionMinutes) : '';
  } else if (r.mode === 'days') {
    const slots = r.slots;
    const days = slots.map((s) => s.weekday);
    const timed = slots.filter((s) => s.start && s.end);
    if (!timed.length) {
      f.slot = 'flex';
      f.flex = slots.length === 7 ? 'everyday' : 'weekdays';
      f.flexDays = days;
      f.flexMinutes = r.sessionMinutes ? String(r.sessionMinutes) : '';
    } else {
      const same = timed.length === slots.length &&
        slots.every((s) => s.start === slots[0].start && s.end === slots[0].end);
      if (same) {
        f.slot = slots.length === 7 ? 'daily' : 'weekdays';
        f.weekdays = days;
        f.timeStart = slots[0].start;
        f.timeEnd = slots[0].end;
      } else {
        f.slot = 'perday';
        f.perDay = ALL.map((w) => {
          const s = slots.find((x) => x.weekday === w);
          return s
            ? { on: true, start: s.start || '07:00', end: s.end || '08:00' }
            : { on: false, start: '07:00', end: '08:00' };
        });
      }
    }
  }
  const m = goal.measure;
  f.measure = m.type;
  if (m.type === 'steps') f.steps = m.steps.map((s) => ({ id: s.id, text: s.text }));
  if (m.type === 'number') {
    f.target = String(m.target);
    f.unit = m.unit || '';
    f.startValue = String(m.startValue);
  }
  return f;
}

// Check the form and build the fields of a goal. Returns { errors, fields }.
function build(f, cutoff) {
  const errors = {};
  const inkTitle = hasInk(f.inkTitle) ? f.inkTitle : null;
  const title = f.title.trim().slice(0, 80) || (inkTitle ? HANDWRITTEN : '');
  if (!title) errors.title = 'Give the goal a name, typed or handwritten.';

  let run = { start: null, end: null };
  if (f.when === 'fixed') {
    if (!f.start) errors.start = 'Pick a start date.';
    if (!f.end) errors.end = 'Pick an end date.';
    else if (f.start && f.end < f.start) errors.end = 'The end date is before the start date.';
    run = { start: f.start || null, end: f.end || null };
  } else if (f.when === 'forever') {
    if (!f.start) errors.start = 'Pick a start date.';
    run = { start: f.start || null, end: null };
  }

  const timeProblem = (start, end) => {
    if (!start || !end) return 'Set a start and an end time.';
    if (!slotValid({ start: start, end: end }, cutoff)) {
      return 'The end must come after the start, and a slot cannot cross ' + fmtTime(cutoff) + ', when the day ends.';
    }
    return '';
  };
  const inOrder = (list) => ALL.filter((w) => list.indexOf(w) !== -1);
  const minutes = f.flexMinutes === '' ? null : Math.round(Number(f.flexMinutes));

  let repeat = { mode: 'none' };
  if (f.slot === 'daily' || f.slot === 'weekdays') {
    const days = f.slot === 'daily' ? ALL : inOrder(f.weekdays);
    if (!days.length) errors.days = 'Pick at least one day.';
    const problem = timeProblem(f.timeStart, f.timeEnd);
    if (problem) errors.slot = problem;
    repeat = {
      mode: 'days', sessionMinutes: null,
      slots: days.map((w) => ({ weekday: w, start: f.timeStart, end: f.timeEnd }))
    };
  } else if (f.slot === 'perday') {
    const on = ALL.filter((w) => f.perDay[w].on);
    if (!on.length) errors.days = 'Switch on at least one day.';
    on.forEach((w) => {
      const problem = timeProblem(f.perDay[w].start, f.perDay[w].end);
      if (problem && !errors.slot) errors.slot = DAY_NAME[w] + ': ' + problem;
    });
    repeat = {
      mode: 'days', sessionMinutes: null,
      slots: on.map((w) => ({ weekday: w, start: f.perDay[w].start, end: f.perDay[w].end }))
    };
  } else if (f.slot === 'flex') {
    if (minutes !== null && !(minutes >= 1 && minutes <= 1440)) {
      errors.minutes = 'Minutes per session must be between 1 and 1440.';
    }
    if (f.flex === 'times') {
      const n = Math.round(Number(f.flexTimes));
      if (!(n >= 1 && n <= 7)) errors.days = 'Choose 1 to 7 times a week.';
      repeat = { mode: 'perWeek', times: n, sessionMinutes: minutes };
    } else {
      const days = f.flex === 'everyday' ? ALL : inOrder(f.flexDays);
      if (!days.length) errors.days = 'Pick at least one day.';
      repeat = {
        mode: 'days', sessionMinutes: minutes,
        slots: days.map((w) => ({ weekday: w, start: null, end: null }))
      };
    }
  }
  if (repeat.mode !== 'none' && !run.start && !errors.start) errors.start = 'A repeating goal needs a start date.';

  let measure = { type: 'check' };
  if (f.measure === 'steps') {
    const steps = f.steps.map((s) => ({ id: s.id, text: s.text.trim().slice(0, 80) })).filter((s) => s.text);
    if (!steps.length) errors.steps = 'Add at least one step.';
    measure = { type: 'steps', steps: steps };
  } else if (f.measure === 'number') {
    const target = Number(f.target);
    const startValue = f.startValue === '' ? 0 : Number(f.startValue);
    if (f.target === '' || !isFinite(target)) errors.target = 'Enter a target number.';
    else if (!isFinite(startValue)) errors.target = 'The amount already done must be a number.';
    else if (!(target > startValue)) errors.target = 'The target must be greater than the amount already done.';
    measure = { type: 'number', target: target, unit: f.unit.trim().slice(0, 12), startValue: startValue };
  }

  const fields = {
    title: title, notes: f.notes.trim(), importance: f.importance,
    run: run, repeat: repeat, measure: measure,
    inkTitle: inkTitle, inkNote: hasInk(f.inkNote) ? f.inkNote : null
  };
  if (f.color !== null) fields.color = f.color;
  return { errors: errors, fields: fields };
}

// ----- Drawing the sections -----
function sectionsHTML(f, errors, locked, today) {
  const err = (key) => (errors[key] ? '<div class="field-error">' + esc(errors[key]) + '</div>' : '');
  const seg = (key, value, options, disabled) => '<div class="seg">' + options.map((o) => (
    '<button type="button" class="seg-btn' + (String(o[0]) === String(value) ? ' is-on' : '') +
    '" data-set="' + key + '" data-val="' + o[0] + '"' +
    (disabled && disabled.indexOf(o[0]) !== -1 ? ' disabled' : '') + '>' + esc(o[1]) + '</button>'
  )).join('') + '</div>';
  const field = (label, inner) => '<label class="field"><span>' + esc(label) + '</span>' + inner + '</label>';
  const input = (type, key, value, extra) =>
    '<input class="input" type="' + type + '" data-k="' + key + '" value="' + esc(value) + '"' + (extra || '') + '>';
  const dayChips = (key, list) => '<div class="chips">' + ORDER.map((w) => (
    '<button type="button" class="seg-btn daychip' + (list.indexOf(w) !== -1 ? ' is-on' : '') +
    '" data-toggle="' + key + '" data-val="' + w + '" aria-label="' + DAY_NAME[w] + '">' + DAY_LETTER[w] + '</button>'
  )).join('') + '</div>';
  const times = () => '<div class="frow">' +
    field('From', input('time', 'timeStart', f.timeStart)) +
    field('To', input('time', 'timeEnd', f.timeEnd)) + '</div>';

  let h = '';

  // When
  h += '<section class="fsec"><div class="fsec-label">When</div>' +
    seg('when', f.when, [['none', 'No dates'], ['fixed', 'Fixed dates'], ['forever', 'Forever']],
      f.slot !== 'none' ? ['none'] : null);
  if (f.when === 'fixed') {
    h += '<div class="frow">' +
      field('Start', input('date', 'start', f.start)) +
      field('End', input('date', 'end', f.end)) + '</div>' +
      '<div class="chips"><span class="chips-label">End</span>' +
      [[0, 'Today'], [1, 'Tomorrow'], [7, '+7 days'], [30, '+30 days']].map((c) => (
        '<button type="button" class="seg-btn' + (f.end === addDays(today, c[0]) ? ' is-on' : '') +
        '" data-end="' + c[0] + '">' + c[1] + '</button>'
      )).join('') + '</div>';
  } else if (f.when === 'forever') {
    h += '<div class="frow">' + field('Start', input('date', 'start', f.start)) + '</div>';
  }
  h += err('start') + err('end') + '</section>';

  // Time slot
  h += '<section class="fsec"><div class="fsec-label">Time slot</div>' +
    seg('slot', f.slot, [['none', 'None'], ['daily', 'Same time daily'], ['weekdays', 'Chosen weekdays'],
      ['perday', 'Different per day'], ['flex', 'No fixed time']]);
  if (f.slot === 'daily') {
    h += times();
  } else if (f.slot === 'weekdays') {
    h += dayChips('weekdays', f.weekdays) + times();
  } else if (f.slot === 'perday') {
    h += ORDER.map((w) => {
      const d = f.perDay[w];
      return '<div class="dayrow">' +
        '<button type="button" class="seg-btn dayname' + (d.on ? ' is-on' : '') + '" data-day="' + w + '">' +
          DAY_NAME[w].slice(0, 3) + '</button>' +
        (d.on
          ? '<input class="input" type="time" data-pd="start:' + w + '" value="' + esc(d.start) +
            '" aria-label="' + DAY_NAME[w] + ' from">' +
            '<input class="input" type="time" data-pd="end:' + w + '" value="' + esc(d.end) +
            '" aria-label="' + DAY_NAME[w] + ' to">'
          : '<span class="dayrow-off">Off</span>') +
        '</div>';
    }).join('');
  } else if (f.slot === 'flex') {
    h += '<div class="fsub">' + seg('flex', f.flex,
      [['everyday', 'Every day'], ['weekdays', 'Chosen weekdays'], ['times', 'Times a week']]) + '</div>';
    if (f.flex === 'weekdays') h += dayChips('flexDays', f.flexDays);
    if (f.flex === 'times') {
      h += '<div class="fsub num-seg">' +
        seg('flexTimes', f.flexTimes, [1, 2, 3, 4, 5, 6, 7].map((n) => [n, String(n)])) + '</div>';
    }
    h += '<div class="frow">' + field('Minutes per session (optional)',
      input('number', 'flexMinutes', f.flexMinutes, ' inputmode="numeric" min="1" max="1440" placeholder="30"')) + '</div>';
  }
  h += err('days') + err('slot') + err('minutes') + '</section>';

  // Measure
  const others = ['check', 'steps', 'number'].filter((t) => t !== f.measure);
  h += '<section class="fsec"><div class="fsec-label">Measure</div>' +
    seg('measure', f.measure, [['check', 'Just done'], ['steps', 'Steps'], ['number', 'Number']],
      locked ? others : null) +
    (locked ? '<div class="fnote">The measure cannot change because progress is already recorded.</div>' : '');
  if (f.measure === 'steps') {
    h += f.steps.map((s, i) => (
      '<div class="steprow">' +
        '<input class="input" type="text" data-step="' + i + '" value="' + esc(s.text) +
          '" maxlength="80" placeholder="Step ' + (i + 1) + '" enterkeyhint="next">' +
        '<button type="button" class="icon-btn" data-stepup="' + i + '" aria-label="Move up"' +
          (i === 0 ? ' disabled' : '') + '>' + icon('up') + '</button>' +
        '<button type="button" class="icon-btn" data-stepdown="' + i + '" aria-label="Move down"' +
          (i === f.steps.length - 1 ? ' disabled' : '') + '>' + icon('down') + '</button>' +
        '<button type="button" class="icon-btn" data-stepdel="' + i + '" aria-label="Delete step">' +
          icon('trash') + '</button>' +
      '</div>'
    )).join('') +
      '<div class="fsub"><button type="button" class="btn" data-addstep="1">' + icon('plus') +
      '<span>Add a step</span></button></div>' + err('steps');
  } else if (f.measure === 'number') {
    h += '<div class="frow">' +
      field('Target', input('number', 'target', f.target, ' inputmode="decimal" step="any" placeholder="20"')) +
      field('Unit (optional)', input('text', 'unit', f.unit, ' maxlength="12" placeholder="books"')) +
      field('Already done', input('number', 'startValue', f.startValue, ' inputmode="decimal" step="any"')) +
      '</div>' + err('target');
  }
  h += '</section>';

  // Importance
  h += '<section class="fsec"><div class="fsec-label">Importance</div>' +
    '<div class="scale num-seg"><span>Low</span>' +
    seg('importance', f.importance, [1, 2, 3, 4, 5].map((n) => [n, String(n)])) +
    '<span>High</span></div></section>';

  // Colour tag
  h += '<section class="fsec"><div class="fsec-label">Colour tag</div><div class="swatches">' +
    [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
      '<button type="button" class="swatch' + (f.color === i ? ' is-on' : '') +
      '" data-set="color" data-val="' + i + '" style="--tag:var(--t' + i + ')" aria-label="Colour ' + (i + 1) + '"></button>'
    )).join('') + '</div></section>';

  // Notes, typed and handwritten
  h += '<section class="fsec"><div class="fsec-label">Notes</div>' +
    '<textarea class="input area" data-k="notes" rows="3" maxlength="2000">' + esc(f.notes) + '</textarea>' +
    (hasInk(f.inkNote)
      ? '<div class="ink-preview tall">' + inkSVG(f.inkNote, { label: 'Handwritten note' }) + '</div>' +
        '<div class="ink-row">' +
          '<button type="button" class="btn" data-ink="note">' + icon('edit') + '<span>Edit handwriting</span></button>' +
          '<button type="button" class="btn" data-ink="note-remove">Remove handwriting</button>' +
        '</div>'
      : '<div class="ink-row"><button type="button" class="btn" data-ink="note">' + icon('edit') +
        '<span>Write a note by hand</span></button></div>') +
    '</section>';

  return h;
}

// Open the form. Pass a goal id to edit, or nothing to add.
// Call this directly from a tap, so the iPad opens the keyboard.
export function openGoalForm(goalId) {
  const goal = goalId ? getGoal(goalId) : null;
  const cutoff = state.settings.dayCutoff;
  const today = todayDay();
  const f = goal ? fromGoal(goal, today) : blank(today);
  const locked = !!goal &&
    (state.byGoal.get(goal.id) || []).some((e) => e.kind === 'step' || e.kind === 'number');
  let errors = {};
  let dirty = false;
  const mayLeave = () => !dirty || window.confirm('Discard your changes?');

  const sheet = openSheet({
    className: 'sheet-form',
    canClose: mayLeave,
    html:
      '<form class="form" id="goal-form" autocomplete="off" novalidate>' +
        '<div class="form-head">' +
          '<div class="sheet-title">' + (goal ? 'Edit goal' : 'New goal') + '</div>' +
          '<input class="input input-title" id="f-title" type="text" maxlength="80" ' +
            'placeholder="What is the goal?" enterkeyhint="done">' +
          '<div class="field-error" id="f-title-error"></div>' +
          '<div id="f-ink-title"></div>' +
          (goal ? '' : '<div class="fnote">A name is enough, typed or handwritten. Everything below is optional.</div>') +
        '</div>' +
        '<div class="form-body" id="f-body"></div>' +
        '<div class="form-foot">' +
          (goal ? '<button type="button" class="btn btn-danger" id="f-delete">Delete</button>' : '') +
          '<span class="spacer"></span>' +
          '<button type="button" class="btn" id="f-cancel">Cancel</button>' +
          '<button type="submit" class="btn btn-primary" id="f-save">Save</button>' +
        '</div>' +
      '</form>'
  });

  const form = sheet.querySelector('#goal-form');
  const body = sheet.querySelector('#f-body');
  const titleInput = sheet.querySelector('#f-title');
  const titleError = sheet.querySelector('#f-title-error');
  const inkTitleBox = sheet.querySelector('#f-ink-title');
  const saveButton = sheet.querySelector('#f-save');
  const canSave = () => !!f.title.trim() || hasInk(f.inkTitle);

  const render = () => {
    body.innerHTML = sectionsHTML(f, errors, locked, today);
    titleError.textContent = errors.title || '';
  };
  const renderInkTitle = () => {
    inkTitleBox.innerHTML = hasInk(f.inkTitle)
      ? '<div class="ink-preview">' + inkSVG(f.inkTitle, { label: 'Handwritten title' }) + '</div>' +
        '<div class="ink-row">' +
          '<button type="button" class="btn" data-ink="title">' + icon('edit') + '<span>Edit handwriting</span></button>' +
          '<button type="button" class="btn" data-ink="title-remove">Remove handwriting</button>' +
        '</div>'
      : '<div class="ink-row"><button type="button" class="btn" data-ink="title">' + icon('edit') +
        '<span>Write the title by hand</span></button></div>';
    saveButton.disabled = !canSave();
  };

  // Handwriting: open the pad, or remove what was written.
  const onInk = (what) => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (what === 'title') {
      openInkPad({
        title: 'Goal title', hint: 'Write the goal here', w: 4, h: 1, ink: f.inkTitle,
        onSave: (ink) => { f.inkTitle = ink; dirty = true; renderInkTitle(); }
      });
    } else if (what === 'title-remove') {
      f.inkTitle = null;
      dirty = true;
      renderInkTitle();
    } else if (what === 'note') {
      openInkPad({
        title: 'Handwritten note', hint: 'Write your note here', w: 4, h: 3, ink: f.inkNote,
        onSave: (ink) => { f.inkNote = ink; dirty = true; render(); }
      });
    } else if (what === 'note-remove') {
      f.inkNote = null;
      dirty = true;
      render();
    }
  };

  titleInput.value = f.title;
  render();
  renderInkTitle();
  if (!goal) titleInput.focus();

  titleInput.addEventListener('input', () => {
    f.title = titleInput.value;
    dirty = true;
    saveButton.disabled = !canSave();
  });
  inkTitleBox.addEventListener('click', (event) => {
    const t = event.target.closest('[data-ink]');
    if (t) onInk(t.dataset.ink);
  });

  const onField = (event) => {
    const t = event.target;
    if (!t.dataset) return;
    if (t.dataset.k) {
      f[t.dataset.k] = t.value;
    } else if (t.dataset.step != null) {
      const step = f.steps[Number(t.dataset.step)];
      if (step) step.text = t.value;
    } else if (t.dataset.pd) {
      const parts = t.dataset.pd.split(':');
      f.perDay[Number(parts[1])][parts[0]] = t.value;
    } else {
      return;
    }
    dirty = true;
  };
  body.addEventListener('input', onField);
  body.addEventListener('change', onField);

  body.addEventListener('click', (event) => {
    const t = event.target.closest('button');
    if (!t || t.disabled) return;
    const d = t.dataset;
    if (d.ink) {
      onInk(d.ink);
      return;
    }
    let focusStep = -1;
    if (d.set) {
      const numeric = d.set === 'importance' || d.set === 'color' || d.set === 'flexTimes';
      f[d.set] = numeric ? Number(d.val) : d.val;
      if (d.set === 'slot' && f.slot !== 'none' && f.when === 'none') {
        f.when = 'forever';
        if (!f.start) f.start = today;
      }
    } else if (d.toggle) {
      const list = f[d.toggle];
      const w = Number(d.val);
      const i = list.indexOf(w);
      if (i === -1) list.push(w); else list.splice(i, 1);
    } else if (d.day != null) {
      const row = f.perDay[Number(d.day)];
      row.on = !row.on;
    } else if (d.end != null) {
      f.end = addDays(today, Number(d.end));
    } else if (d.addstep != null) {
      f.steps.push({ id: newId(), text: '' });
      focusStep = f.steps.length - 1;
    } else if (d.stepup != null) {
      const i = Number(d.stepup);
      if (i > 0) f.steps.splice(i - 1, 0, f.steps.splice(i, 1)[0]);
    } else if (d.stepdown != null) {
      const i = Number(d.stepdown);
      if (i < f.steps.length - 1) f.steps.splice(i + 1, 0, f.steps.splice(i, 1)[0]);
    } else if (d.stepdel != null) {
      f.steps.splice(Number(d.stepdel), 1);
    } else {
      return;
    }
    dirty = true;
    render();
    if (focusStep >= 0) {
      const next = body.querySelector('[data-step="' + focusStep + '"]');
      if (next) next.focus();
    }
  });

  // Return saves from the title, adds the next step from a step field, and does nothing elsewhere.
  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const t = event.target;
    if (t === titleInput || t.tagName !== 'INPUT') return;
    event.preventDefault();
    if (t.dataset.step != null) {
      const i = Number(t.dataset.step);
      f.steps.splice(i + 1, 0, { id: newId(), text: '' });
      dirty = true;
      render();
      const next = body.querySelector('[data-step="' + (i + 1) + '"]');
      if (next) next.focus();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const built = build(f, cutoff);
    errors = built.errors;
    render();
    if (Object.keys(errors).length) {
      const first = sheet.querySelector('.field-error:not(:empty)');
      if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center' });
      return;
    }
    saveButton.disabled = true;
    try {
      if (goal) await updateGoal(goal.id, built.fields);
      else await addGoal(built.fields);
      dirty = false;
      closeSheet(true);
    } catch (err) {
      saveButton.disabled = !canSave();
      toast('Could not save. Try again.');
    }
  });

  sheet.querySelector('#f-cancel').addEventListener('click', () => {
    if (mayLeave()) closeSheet(true);
  });

  const deleteButton = sheet.querySelector('#f-delete');
  if (deleteButton) {
    deleteButton.addEventListener('click', async () => {
      if (!window.confirm('Delete this goal and everything recorded for it?')) return;
      try {
        await deleteGoal(goal.id);
        dirty = false;
        closeSheet(true);
        toast('Goal deleted.');
      } catch (err) {
        toast('Could not delete. Try again.');
      }
    });
  }
}
