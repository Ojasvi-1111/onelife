// The Settings screen: backup, look, behaviour, dropped goals, erase, about.
import {
  state, subscribe, saveSettings, eraseAll, loadDemo, runDayClose, deleteGoal, clock, DEFAULT_QUOTE
} from './store.js';
import { restoreGoal } from './actions.js';
import { act } from './celebrate.js';
import {
  backupFile, csvFiles, deliver, parseBackup, restoreBackup, backupDue, lastBackupText
} from './backup.js';
import { fmtTime, fmtDay, dateToDay } from './time.js';
import { esc, nums, toast } from './ui.js';
import { icon } from './icons.js';

export const VERSION = '1.0';
let persisted = null;   // true, false, or null while unknown
const pad = (n) => (n < 10 ? '0' : '') + n;

function isInstalled() {
  return navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches;
}

function seg(key, value, options) {
  return '<div class="seg">' + options.map((o) => (
    '<button type="button" class="seg-btn' + (o[0] === value ? ' is-on' : '') +
    '" data-set="' + key + '" data-val="' + o[0] + '">' + esc(o[1]) + '</button>'
  )).join('') + '</div>';
}
function btn(what, label, extra, attrs) {
  return '<button type="button" class="btn' + (extra || '') + '" data-s="' + what + '"' + (attrs || '') + '>' + label + '</button>';
}
function row(label, control) {
  return '<div class="set-row"><div class="set-label">' + esc(label) + '</div>' + control + '</div>';
}

function settingsHTML(eraseText) {
  const s = state.settings;
  const canWake = 'wakeLock' in navigator;
  const dropped = state.goals.filter((g) => g.status === 'dropped');
  const onOff = [[true, 'On'], [false, 'Off']];

  let h = '<header class="screen-head">' +
    '<button type="button" class="btn" data-s="back">' + icon('back') + '<span>Board</span></button>' +
    '<div class="screen-title">Settings</div></header>' +
    '<div class="screen-body"><div class="set">';

  // Backup
  h += '<section class="set-sec"><div class="set-h">Backup</div>' +
    (backupDue() ? '<div class="set-banner">A backup is due. Your goals live only on this iPad.</div>' : '') +
    '<div class="actions">' +
      btn('export', 'Export backup', ' btn-primary') +
      btn('import', 'Import backup') +
      btn('csv', 'Export spreadsheet (CSV)') +
    '</div>' +
    '<input type="file" id="import-file" accept=".json,application/json" hidden>' +
    '<div class="set-note">Last backup: ' + nums(lastBackupText()) + '</div>' +
    row('Remind me', seg('backupReminderDays', s.backupReminderDays,
      [[7, 'Every 7 days'], [14, '14 days'], [30, '30 days'], [0, 'Never']])) +
    '</section>';

  // Look
  h += '<section class="set-sec"><div class="set-h">Look</div>' +
    '<div class="set-note">Quote under the name. Leave it empty to hide it.</div>' +
    '<div class="inline fsub">' +
      '<input class="input" type="text" name="quote" maxlength="120" value="' + esc(s.quote) + '">' +
      btn('quotereset', 'Reset') +
    '</div>' +
    row('Smallest box', seg('minBox', s.minBox,
      [['compact', 'Compact'], ['comfortable', 'Comfortable'], ['large', 'Large']])) +
    row('Motion', seg('motion', s.motion, [['full', 'Full'], ['calm', 'Calm'], ['off', 'Off']])) +
    '</section>';

  // Behaviour
  let cutoffOptions = '';
  for (let m = 0; m <= 360; m += 30) {
    const value = pad(Math.floor(m / 60)) + ':' + pad(m % 60);
    cutoffOptions += '<option value="' + value + '"' + (value === s.dayCutoff ? ' selected' : '') + '>' +
      esc(fmtTime(value)) + '</option>';
  }
  h += '<section class="set-sec"><div class="set-h">Behaviour</div>' +
    row('Day ends at', '<select class="input select" name="cutoff">' + cutoffOptions + '</select>') +
    '<div class="set-note">A session not ticked by this time counts as missed.</div>' +
    row('Sound', seg('sound', s.sound, onOff)) +
    row('Power surge', seg('surge', s.surge, onOff)) +
    row('Keep screen awake', canWake ? seg('keepAwake', s.keepAwake, onOff) : '<span class="set-note">Not available on this iPad</span>') +
    '</section>';

  // Dropped goals
  if (dropped.length) {
    h += '<section class="set-sec"><div class="set-h">Dropped goals</div>' +
      dropped.map((g) => (
        '<div class="set-row"><div class="set-label">' + esc(g.title) + '</div>' +
        btn('restore', 'Restore', '', ' data-id="' + esc(g.id) + '"') +
        btn('deletegoal', 'Delete', ' btn-danger', ' data-id="' + esc(g.id) + '"') + '</div>'
      )).join('') + '</section>';
  }

  // Try it out
  h += '<section class="set-sec"><div class="set-h">Sample goals</div>' +
    '<div class="set-note">Nine example goals for trying things out. They are added to what you have.</div>' +
    '<div class="fsub">' + btn('demo', 'Load sample goals') + '</div></section>';

  // Erase
  h += '<section class="set-sec"><div class="set-h">Erase everything</div>' +
    '<div class="set-note">Deletes every goal and all history on this iPad and resets the settings. Type ERASE to allow it.</div>' +
    '<div class="inline fsub">' +
      '<input class="input" type="text" name="erase" autocapitalize="characters" autocomplete="off" placeholder="ERASE" value="' + esc(eraseText) + '">' +
      btn('erase', 'Erase everything', ' btn-danger', eraseText === 'ERASE' ? '' : ' disabled') +
    '</div></section>';

  // About
  h += '<section class="set-sec"><div class="set-h">About</div>' +
    '<div class="set-note">OneLife ' + nums(VERSION) + '</div>' +
    '<div class="set-note">Installed on the Home Screen: ' + (isInstalled() ? 'yes' : 'no') + '</div>' +
    '<div class="set-note">Protected storage: ' + (persisted === null ? 'checking' : persisted ? 'yes' : 'no') + '</div>' +
    '<div class="set-note">To pick up a new version, close the app fully and open it again, or reload here.</div>' +
    '<div class="fsub">' + btn('reload', 'Reload app') + '</div></section>';

  return h + '</div></div>';
}

// Goals whose clock slot lies between the old and the new end of day.
function cutoffBlockers(oldCutoff, newCutoff) {
  const lo = oldCutoff < newCutoff ? oldCutoff : newCutoff;
  const hi = oldCutoff < newCutoff ? newCutoff : oldCutoff;
  const inside = (t) => !!t && t >= lo && t <= hi;
  return state.goals.filter((g) => g.status !== 'finished' && g.repeat.mode === 'days' &&
    g.repeat.slots.some((s) => inside(s.start) || inside(s.end)));
}

export function mountSettings(root, h) {
  let eraseText = '';
  let live = true;

  const render = () => {
    if (!live) return;
    const body = root.querySelector('.screen-body');
    const scroll = body ? body.scrollTop : 0;
    root.innerHTML = settingsHTML(eraseText);
    const next = root.querySelector('.screen-body');
    if (next) next.scrollTop = scroll;
  };
  const stop = subscribe(render);
  render();
  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then((value) => { persisted = !!value; render(); }).catch(() => {});
  } else {
    persisted = false;
  }
  const save = (patch) => saveSettings(patch).catch(() => toast('Could not save. Try again.'));

  // Not async on purpose: the share sheet must open directly from the tap.
  root.onclick = (event) => {
    const t = event.target.closest('button');
    if (!t || t.disabled) return;
    const d = t.dataset;
    if (d.set) {
      const patch = {};
      if (d.set === 'backupReminderDays') patch[d.set] = Number(d.val);
      else if (d.set === 'sound' || d.set === 'surge' || d.set === 'keepAwake') patch[d.set] = d.val === 'true';
      else patch[d.set] = d.val;
      save(patch);
      return;
    }
    const what = d.s;
    if (what === 'back') {
      h.onBack();
    } else if (what === 'export') {
      deliver([backupFile()]).then((how) => {
        if (how === 'cancelled') return;
        save({ lastBackupAt: clock().toISOString() });
        toast(how === 'shared' ? 'Backup saved.' : 'Backup downloaded.');
      });
    } else if (what === 'csv') {
      deliver(csvFiles()).then((how) => {
        if (how !== 'cancelled') toast('Spreadsheet files ready.');
      });
    } else if (what === 'import') {
      const input = root.querySelector('#import-file');
      if (input) input.click();
    } else if (what === 'quotereset') {
      save({ quote: DEFAULT_QUOTE });
    } else if (what === 'restore') {
      act(() => restoreGoal(d.id), null);
    } else if (what === 'deletegoal') {
      if (!window.confirm('Delete this goal and everything recorded for it?')) return;
      deleteGoal(d.id).then(() => toast('Goal deleted.'), () => toast('Could not delete. Try again.'));
    } else if (what === 'demo') {
      loadDemo().then(() => toast('Sample goals loaded.'), () => toast('That did not work. Try again.'));
    } else if (what === 'erase') {
      if (eraseText !== 'ERASE') return;
      eraseText = '';
      eraseAll().then(() => toast('Everything erased.'), () => toast('That did not work. Try again.'));
    } else if (what === 'reload') {
      location.reload();
    }
  };

  root.onchange = (event) => {
    const t = event.target;
    if (t.name === 'quote') {
      save({ quote: t.value.trim().slice(0, 120) });
    } else if (t.name === 'cutoff') {
      const blockers = cutoffBlockers(state.settings.dayCutoff, t.value);
      if (blockers.length) {
        toast('Not changed. These goals have a time slot in between: ' +
          blockers.map((g) => g.title).join(', ') + '.');
        render();
        return;
      }
      saveSettings({ dayCutoff: t.value }).then(() => runDayClose())
        .catch(() => toast('Could not save. Try again.'));
    } else if (t.id === 'import-file' && t.files && t.files[0]) {
      const file = t.files[0];
      file.text().then((text) => {
        let parsed = null;
        try {
          parsed = parseBackup(text);
        } catch (err) {
          toast(err.message || 'This file could not be read.');
          return null;
        }
        const when = parsed.exportedAt
          ? ', saved ' + fmtDay(dateToDay(new Date(parsed.exportedAt)), { day: 'numeric', month: 'short', year: 'numeric' })
          : '';
        const ok = window.confirm('Replace everything on this iPad with this backup?\n\n' +
          parsed.goals.length + ' goals and ' + parsed.entries.length + ' history lines' + when + '.');
        if (!ok) return null;
        return restoreBackup(parsed).then(() => toast('Backup restored.'));
      }).catch(() => toast('The backup could not be restored. Nothing was changed.'))
        .then(() => { t.value = ''; });
    }
  };

  root.oninput = (event) => {
    const t = event.target;
    if (t.name !== 'erase') return;
    eraseText = t.value.trim().toUpperCase();
    const button = root.querySelector('[data-s="erase"]');
    if (button) button.disabled = eraseText !== 'ERASE';
  };

  return () => {
    live = false;
    stop();
    root.onclick = null;
    root.onchange = null;
    root.oninput = null;
  };
}
