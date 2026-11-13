// OneLife: start-up, screens and wiring.
import { state, load, runDayClose, subscribe, saveSettings } from './store.js';
import { mountBoard, refreshBoard } from './board.js';
import { openGoalForm } from './form.js';
import { openGoalDetail } from './detail.js';
import { performTick, excuseEntries } from './actions.js';
import { act, unlockAudio } from './celebrate.js';
import { backupDue } from './backup.js';
import { mountSettings } from './settings.js';
import { toast, openSheet, closeSheet, sheetOpen, esc } from './ui.js';

const app = document.getElementById('app');
const screen = document.createElement('div');
screen.id = 'screen';
screen.hidden = true;
document.body.insertBefore(screen, document.getElementById('sheet-root'));
let leave = null;   // cleans up the screen that is open

function showFatal(err) {
  app.innerHTML =
    '<div class="empty">' +
      '<div class="empty-title">OneLife could not open its storage</div>' +
      '<div class="empty-sub">' + esc(String((err && err.message) || err)) + '</div>' +
      '<button type="button" class="btn btn-primary" id="retry" style="margin-top:16px">Try again</button>' +
    '</div>';
  document.getElementById('retry').addEventListener('click', () => location.reload());
}

// ----- Motion, backup dot, keep awake -----
let idle = false;
let idleTimer = 0;
function updateChrome() {
  const motion = state.settings.motion;
  document.body.classList.toggle('motion-off', motion === 'off');
  document.body.classList.toggle('motion-calm', motion === 'calm' || (motion === 'full' && idle));
  const button = document.querySelector('.bar-btn[data-act="settings"]');
  if (button) {
    const dot = button.querySelector('.dot');
    const due = backupDue();
    if (due && !dot) {
      const el = document.createElement('i');
      el.className = 'dot';
      button.appendChild(el);
    } else if (!due && dot) {
      dot.remove();
    }
  }
}
// After three minutes without a touch, the boxes drift more calmly.
function touched() {
  if (idle) {
    idle = false;
    updateChrome();
  }
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { idle = true; updateChrome(); }, 180000);
}

let wakeLock = null;
async function syncWakeLock() {
  if (!('wakeLock' in navigator)) return;
  const want = state.settings.keepAwake && !document.hidden;
  try {
    if (want && !wakeLock) {
      const lock = await navigator.wakeLock.request('screen');
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
    } else if (!want && wakeLock) {
      const lock = wakeLock;
      wakeLock = null;
      await lock.release();
    }
  } catch (err) {
    wakeLock = null;
  }
}

// ----- Screens -----
function showBoard() {
  if (leave) { leave(); leave = null; }
  closeSheet(true);
  screen.hidden = true;
  screen.innerHTML = '';
  app.hidden = false;
  refreshBoard();
  updateChrome();
}
function openScreen(mount) {
  if (leave) { leave(); leave = null; }
  closeSheet(true);
  app.hidden = true;
  screen.hidden = false;
  leave = mount(screen, { onBack: showBoard });
}
function showSettings() { openScreen(mountSettings); }
function showDone() {
  import('./done.js')
    .then((m) => openScreen(m.mountDone))
    .catch(() => toast('The Done screen arrives in the next step.'));
}

// ----- Ticks -----
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

// ----- Install hint, for a touch device that opened OneLife in the browser -----
function installHint() {
  const installed = navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches;
  if (installed || !(navigator.maxTouchPoints > 0) || state.settings.installBannerDismissed) return;
  const el = document.createElement('div');
  el.className = 'install';
  el.innerHTML = '<span>Add OneLife to your Home Screen to keep your goals: tap Share, then Add to Home Screen.</span>' +
    '<button type="button" class="btn">Got it</button>';
  el.querySelector('button').addEventListener('click', () => {
    el.remove();
    saveSettings({ installBannerDismissed: true }).catch(() => {});
  });
  document.body.appendChild(el);
}

async function onReturn() {
  if (document.hidden) {
    syncWakeLock();
    return;
  }
  try {
    await load();
    const res = await runDayClose();
    refreshBoard();
    updateChrome();
    syncWakeLock();
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
        updateChrome();
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
    onSettings: showSettings,
    onDone: showDone
  });
  subscribe(() => {
    refreshBoard();
    updateChrome();
    syncWakeLock();
  });
  scheduleMinuteTick();
  document.addEventListener('visibilitychange', onReturn);
  window.addEventListener('pageshow', (event) => { if (event.persisted) onReturn(); });
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('pointerdown', touched);
  touched();
  updateChrome();
  syncWakeLock();
  installHint();
  awayPrompt(closed);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  import('./done.js').catch(() => {});   // warm the Done screen for offline use
}

boot();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
