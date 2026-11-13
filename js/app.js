// Stage 1: shell only. This file is replaced in a later stage.
import { icon } from './icons.js';

const DEFAULT_QUOTE = 'One Life - why are you not running towards your goals like you are on fire';
const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function statusText(now) {
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(now);
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now);
  return day + ' \u00B7 ' + time;
}

function render() {
  app.innerHTML =
    '<header class="header">' +
      '<div class="brand">' +
        '<div class="brand-name">OneLife</div>' +
        '<div class="brand-quote">' + esc(DEFAULT_QUOTE) + '</div>' +
      '</div>' +
      '<div class="status-line" id="status-line">' + esc(statusText(new Date())) + '</div>' +
    '</header>' +
    '<main class="board-wrap">' +
      '<div class="empty">' +
        '<div class="empty-title">Add your first goal</div>' +
        '<div class="empty-sub">Stage 1: the shell is working.</div>' +
      '</div>' +
    '</main>' +
    '<nav class="bar"><div class="bar-inner">' +
      '<button class="bar-btn" data-act="done" aria-label="Done">' + icon('trophy') + '<span>Done</span></button>' +
      '<button class="add-btn" data-act="add" aria-label="Add goal">' + icon('plus', 'icon icon-lg') + '</button>' +
      '<button class="bar-btn" data-act="settings" aria-label="Settings">' + icon('settings') + '<span>Settings</span></button>' +
    '</div></nav>';
}

let toastTimer = 0;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
}

app.addEventListener('click', (event) => {
  if (event.target.closest('[data-act]')) toast('This button comes alive in a later stage.');
});

function updateStatus() {
  const el = document.getElementById('status-line');
  if (el) el.textContent = statusText(new Date());
}
function scheduleMinuteTick() {
  const wait = 60000 - (Date.now() % 60000) + 50;
  setTimeout(() => { updateStatus(); scheduleMinuteTick(); }, wait);
}

render();
scheduleMinuteTick();
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateStatus(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
