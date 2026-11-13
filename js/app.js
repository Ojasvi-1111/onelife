// OneLife: start-up and wiring. Stage 3, first half.
import { load, runDayClose, addGoal, loadDemo, eraseAll, subscribe } from './store.js';
import { mountBoard, refreshBoard } from './board.js';
import { toast, openSheet, closeSheet, esc } from './ui.js';

const app = document.getElementById('app');

function showFatal(err) {
  app.innerHTML =
    '<div class="empty">' +
      '<div class="empty-title">OneLife could not open its storage</div>' +
      '<div class="empty-sub">' + esc(String((err && err.message) || err)) + '</div>' +
      '<button type="button" class="btn btn-primary" id="retry" style="margin-top:16px">Try again</button>' +
    '</div>';
  document.getElementById('retry').addEventListener('click', () => location.reload());
}

// Quick add: a title is enough. Opened from the + button, inside the tap, so the keyboard opens.
function openQuickAdd() {
  const sheet = openSheet({
    html:
      '<form id="quick-form" autocomplete="off">' +
        '<div class="sheet-title">New goal</div>' +
        '<input class="input input-title" id="quick-title" type="text" maxlength="80" ' +
          'placeholder="What is the goal?" enterkeyhint="done">' +
        '<div class="sheet-note">Dates, time slots, steps and numbers come with the full form in the next step.</div>' +
        '<div class="sheet-actions">' +
          '<button type="button" class="btn" id="quick-cancel">Cancel</button>' +
          '<button type="submit" class="btn btn-primary" id="quick-save" disabled>Save</button>' +
        '</div>' +
      '</form>'
  });
  const input = sheet.querySelector('#quick-title');
  const save = sheet.querySelector('#quick-save');
  input.focus();
  input.addEventListener('input', () => { save.disabled = !input.value.trim(); });
  sheet.querySelector('#quick-cancel').addEventListener('click', () => closeSheet());
  sheet.querySelector('#quick-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    save.disabled = true;
    try {
      await addGoal({ title: title });
      closeSheet();
    } catch (err) {
      save.disabled = false;
      toast('Could not save. Try again.');
    }
  });
}

// Temporary tools behind the Settings button, until the real Settings screen exists.
function openTools() {
  const sheet = openSheet({
    html:
      '<div class="sheet-title">Tools for now</div>' +
      '<div class="sheet-list">' +
        '<button type="button" class="btn btn-block" data-tool="demo">Load sample goals</button>' +
        '<button type="button" class="btn btn-block btn-danger" data-tool="erase">Erase everything</button>' +
      '</div>' +
      '<div class="sheet-note">The real Settings screen arrives in Stage 5.</div>' +
      '<div class="sheet-actions"><button type="button" class="btn" data-tool="close">Close</button></div>'
  });
  sheet.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-tool]');
    if (!button) return;
    const tool = button.dataset.tool;
    try {
      if (tool === 'demo') {
        await loadDemo();
        closeSheet();
        toast('Sample goals loaded.');
      } else if (tool === 'erase') {
        if (!window.confirm('Erase all goals on this iPad?')) return;
        await eraseAll();
        closeSheet();
        toast('Everything erased.');
      } else {
        closeSheet();
      }
    } catch (err) {
      toast('That did not work. Try again.');
    }
  });
}

async function onReturn() {
  if (document.hidden) return;
  try {
    await load();
    await runDayClose();
    refreshBoard();
  } catch (err) {
    console.error(err);
  }
}

function scheduleMinuteTick() {
  const wait = 60000 - (Date.now() % 60000) + 50;
  setTimeout(async () => {
    try {
      if (!document.hidden) {
        await runDayClose();
        refreshBoard();
      }
    } catch (err) {
      console.error(err);
    }
    scheduleMinuteTick();
  }, wait);
}

async function boot() {
  try {
    await load();
    await runDayClose();
  } catch (err) {
    showFatal(err);
    return;
  }
  mountBoard(app, {
    onAdd: openQuickAdd,
    onSettings: openTools,
    onDone: () => toast('The Done screen arrives in Stage 5.'),
    onTick: () => toast('Ticking arrives in Stage 4.'),
    onOpen: () => toast('Goal details arrive in Stage 4.')
  });
  subscribe(refreshBoard);
  scheduleMinuteTick();
  document.addEventListener('visibilitychange', onReturn);
  window.addEventListener('pageshow', (event) => { if (event.persisted) onReturn(); });
}

boot();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
