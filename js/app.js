// OneLife design preview (temporary). Shows the look with sample goals.
// Tap any box to see the power surge. This file is replaced in the next stage.
import { icon } from './icons.js';

const QUOTE = 'One Life - why are you not running towards your goals like you are on fire';
const app = document.getElementById('app');
const fx = document.getElementById('fx');
const toastEl = document.getElementById('toast');

// Heat scale: calm blue, through violet and hot pink, to red.
const HEAT = [
  [0.00, [46, 139, 255]],
  [0.35, [122, 92, 255]],
  [0.60, [192, 77, 255]],
  [0.80, [255, 61, 139]],
  [1.00, [255, 43, 43]]
];
function heatColor(u) {
  const x = Math.max(0, Math.min(1, u));
  for (let i = 1; i < HEAT.length; i++) {
    if (x <= HEAT[i][0]) {
      const p0 = HEAT[i - 1][0];
      const c0 = HEAT[i - 1][1];
      const p1 = HEAT[i][0];
      const c1 = HEAT[i][1];
      const t = (x - p0) / (p1 - p0);
      const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
      return 'rgb(' + c.join(',') + ')';
    }
  }
  return 'rgb(255,43,43)';
}

const SAMPLES = [
  { title: 'Content creation setup', status: 'Owes 2h', u: 1, state: 'missed', tag: 4, tick: 'makeup' },
  { title: 'Gym', status: 'In 20 min', u: 0.8, tag: 2, tick: 'check' },
  { title: 'Renew passport', status: '2 days left', u: 0.7, tag: 3, tick: 'check' },
  { title: 'Launch website', status: '5 of 8 steps', u: 0.48, tag: 0, tick: 'steps' },
  { title: 'Read 20 books', status: '12 of 20 books', u: 0.25, tag: 6, tick: 'plusone' },
  { title: 'Call parents', status: '', u: 0.12, tag: 5, tick: 'check' },
  { title: 'Guitar practice', status: 'Mon 6:00 PM', u: 0.05, tag: 1 },
  { title: 'Meditate', status: 'Done today', u: 0, state: 'done', tag: 7 },
  { title: 'Trip to Japan', status: 'Starts 20 Nov', u: 0, state: 'upcoming', tag: 3 }
];

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

// Wrap every number in the heavy number style.
function nums(s) {
  return String(s).split(/(\d+(?:[.,:/]\d+)*)/).map((part, i) => (
    i % 2 ? '<b class="n">' + esc(part) + '</b>' : esc(part)
  )).join('');
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

function dateText(now) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(now);
}

function boxSize(u, boardW, boardH) {
  const MIN = 180;
  const max = Math.max(MIN, Math.min(420, Math.max(0.36 * boardW, 1.6 * MIN), boardW - 32, 1.5 * (boardH - 32)));
  const w = Math.round(MIN + (max - MIN) * u);
  return [w, Math.round(w * 2 / 3)];
}

function boxHTML(g, i, boardW, boardH) {
  const size = boxSize(g.u, boardW, boardH);
  let neon = heatColor(g.u);
  let hi = 0.5 + 0.5 * g.u;
  let lo = hi * (0.8 - 0.35 * g.u);
  let breath = 7 - 4.2 * g.u;
  let cls = 'box';
  if (g.state === 'done') { neon = heatColor(0); hi = 0.38; lo = 0.22; breath = 8; cls += ' is-done'; }
  if (g.state === 'missed') { neon = heatColor(1); hi = 1; lo = 0.7; breath = 1.8; cls += ' is-missed'; }
  if (g.state === 'upcoming') { neon = '#59606E'; cls += ' is-upcoming'; }
  const style = [
    'position:relative',
    'width:' + size[0] + 'px',
    'height:' + size[1] + 'px',
    '--neon:' + neon,
    '--lit-hi:' + hi.toFixed(2),
    '--lit-lo:' + lo.toFixed(2),
    '--breath:' + breath.toFixed(1) + 's',
    '--tag:var(--t' + g.tag + ')',
    '--drift:' + (9 + (i * 7) % 6) + 's',
    '--phase:-' + ((i * 3) % 9) + 's',
    '--dx:' + (i % 2 ? 5 : -5) + 'px',
    '--dy:' + (i % 3 ? 4 : -4) + 'px'
  ].join(';');
  return '<div class="' + cls + '" style="' + style + '"><div class="box-body">' +
    '<div class="box-tag"></div>' +
    '<div class="box-title">' + esc(g.title) + '</div>' +
    '<div class="box-foot">' +
      '<div class="box-status' + (g.state === 'missed' ? ' hot' : '') + '">' + nums(g.status) + '</div>' +
      (g.tick ? '<button class="box-tick" aria-label="Tick"><span>' + icon(g.tick) + '</span></button>' : '') +
    '</div>' +
  '</div></div>';
}

function render() {
  const now = new Date();
  app.innerHTML =
    '<header class="header">' +
      '<div class="brand">' +
        '<div class="brand-name">OneLife</div>' +
        '<div class="brand-quote">' + esc(QUOTE) + '</div>' +
      '</div>' +
      '<div class="cluster">' +
        '<div class="clock" id="clock">' + clockHTML(now) + '</div>' +
        '<div class="cluster-date" id="date">' + esc(dateText(now)) + '</div>' +
        '<div class="cluster-score"><b class="n">3/5</b> done today</div>' +
      '</div>' +
    '</header>' +
    '<main class="board-wrap" id="wrap">' +
      '<div class="board" id="board" style="display:flex;flex-wrap:wrap;gap:30px;align-items:center;' +
        'align-content:center;justify-content:center;padding:26px;"></div>' +
    '</main>' +
    '<nav class="bar">' +
      '<button class="bar-btn" data-act="done" aria-label="Done">' + icon('trophy') + '<span>Done</span></button>' +
      '<button class="add-btn" data-act="add" aria-label="Add goal">' + icon('plus', 'icon icon-lg') + '</button>' +
      '<button class="bar-btn" data-act="settings" aria-label="Settings">' + icon('settings') + '<span>Settings</span></button>' +
    '</nav>';
  drawBoxes();
}

function drawBoxes() {
  const wrap = document.getElementById('wrap');
  const board = document.getElementById('board');
  if (!wrap || !board) return;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  board.innerHTML = SAMPLES.map((g, i) => boxHTML(g, i, w, h)).join('');
}

// Power surge: the box flashes, then rings of light spread across the screen.
function surge(boxEl) {
  const color = getComputedStyle(boxEl).getPropertyValue('--neon').trim() || '#ffffff';
  const r = boxEl.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const far = Math.max(
    Math.hypot(cx, cy),
    Math.hypot(window.innerWidth - cx, cy),
    Math.hypot(cx, window.innerHeight - cy),
    Math.hypot(window.innerWidth - cx, window.innerHeight - cy)
  );

  boxEl.classList.add('flash');
  setTimeout(() => boxEl.classList.remove('flash'), 380);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const wash = document.createElement('div');
  wash.className = 'surge-wash';
  wash.style.background = 'radial-gradient(circle at ' + cx + 'px ' + cy + 'px, ' +
    'color-mix(in srgb, ' + color + ' 30%, transparent), transparent 60%)';
  fx.appendChild(wash);
  wash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, easing: 'ease-out' })
    .onfinish = () => wash.remove();

  const start = Math.round(r.width * 0.6);
  const end = Math.ceil(far * 2 + 80);
  [0, 150].forEach((delay) => {
    const ring = document.createElement('div');
    ring.className = 'surge';
    ring.style.left = cx + 'px';
    ring.style.top = cy + 'px';
    ring.style.width = '0px';
    ring.style.height = '0px';
    ring.style.opacity = '0';
    ring.style.setProperty('--neon', color);
    fx.appendChild(ring);
    ring.animate(
      [
        { width: start + 'px', height: start + 'px', opacity: 1 },
        { width: end + 'px', height: end + 'px', opacity: 0 }
      ],
      { duration: 950, delay: delay, easing: 'cubic-bezier(0.16, 0.6, 0.3, 1)', fill: 'forwards' }
    ).onfinish = () => ring.remove();
  });
}

let toastTimer = 0;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
}

app.addEventListener('click', (event) => {
  const box = event.target.closest('.box');
  if (box) { surge(box); return; }
  if (event.target.closest('[data-act]')) toast('This button comes alive in a later stage.');
});

function updateClock() {
  const now = new Date();
  const clock = document.getElementById('clock');
  const date = document.getElementById('date');
  if (clock) clock.innerHTML = clockHTML(now);
  if (date) date.textContent = dateText(now);
}
function scheduleMinuteTick() {
  const wait = 60000 - (Date.now() % 60000) + 50;
  setTimeout(() => { updateClock(); scheduleMinuteTick(); }, wait);
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawBoxes, 150);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateClock(); });

render();
scheduleMinuteTick();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
