// OneLife: start-up and wiring. Stage 4.
import { load, runDayClose, loadDemo, eraseAll, subscribe } from './store.js';
import { mountBoard, refreshBoard } from './board.js';
import { openGoalForm } from './form.js';
import { openGoalDetail } from './detail.js';
import { performTick, excuseEntries } from './actions.js';
import { act, unlockAudio } from './celebrate.js';
import { toast, openSheet, closeSheet, sheetOpen, esc } from './ui.js';

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

// One tap, one action: ignore further ticks on the same goal for half a second.
const busy = new Set();
function onTick(id, action, el) {
  if (!action || busy.has(id)) return;
  busy.add(id);
  setTimeout(() => busy.delete(id), 500);
  act(() => performTick(id, action.kind), el);
}

// After three or more days away, offer to excuse what was missed.
function awayPrompt(res) {
  if (!res || res.closedDays.length < 3 || !res.entries.length || sheetOpen()) return;
  const ids = res.entries.map((e) => e.id);
  const sheet = openSheet({
    html:
      '<div class="sheet-title">You were away for ' + res.closedDays.length + ' days</div>' +
      '<div class="sheet-note">' + ids.length + (ids.length === 1 ? ' session was' : ' sessions were') +
        ' missed in that time.</div>' +
      '<div class="sheet-actions">' +
        '<button type="button" class="btn" data-away="keep">Keep them as missed</button>' +
        '<button type="button" class="btn btn-primary" data-away="excuse">Excuse those days</button>' +
      '</div>'
  });
  sheet.addEventListener('click', (event) => {
    const button = event.target.closest('[data-away]');
    if (!button) return;
    closeSheet();
    if (button.dataset.away === 'excuse') act(() => excuseEntries(ids), null);
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
    const res = await runDayClose();
    refreshBoard();
    awayPrompt(res);
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
  let closed = null;
  try {
    await load();
    closed = await runDayClose();
  } catch (err) {
    showFatal(err);
    return;
  }
  mountBoard(app, {
    onAdd: () => openGoalForm(null),
    onOpen: (id) => openGoalDetail(id),
    onTick: onTick,
    onSettings: openTools,
    onDone: () => toast('The Done screen arrives in Stage 5.')
  });
  subscribe(refreshBoard);
  scheduleMinuteTick();
  document.addEventListener('visibilitychange', onReturn);
  window.addEventListener('pageshow', (event) => { if (event.persisted) onReturn(); });
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  awayPrompt(closed);
}

boot();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
