// Handwriting for OneLife: a writing pad for the Apple Pencil (or a finger), and
// drawing of saved ink. Ink is stored as pen strokes, not as a picture, so it stays
// small and sharp at any size.
import { esc } from './ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const UNIT = 1000;   // ink is stored in a space 1000 units wide

// Styles live here so that no css file has to change.
const style = document.createElement('style');
style.textContent = [
  '.inkpad{position:fixed;inset:0;z-index:85;display:flex;flex-direction:column;',
  'padding:calc(12px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom));background:rgba(4,4,8,.95)}',
  '.inkpad-head{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding-bottom:12px}',
  '.inkpad-title{flex:1 1 auto;font:800 13px var(--font-num);letter-spacing:.12em;text-transform:uppercase}',
  '.inkpad-area{flex:1 1 auto;min-height:0;display:grid;place-items:center}',
  '.inkpad-surface{position:relative;overflow:hidden;border:1.5px solid var(--hair-2);border-radius:18px;background:#0b0b12;',
  'touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}',
  '.inkpad-surface svg{position:absolute;inset:0;display:block;width:100%;height:100%}',
  '.inkpad-surface path{fill:none;stroke:#f4f4fa;stroke-width:2.6px;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}',
  '.inkpad-hint{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;font-size:15px;color:#7a7a93;pointer-events:none}',
  '.ink{display:block;width:100%;height:100%;overflow:visible}',
  '.ink path{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}',
  '.box .box-title.box-ink{display:block;overflow:visible;height:clamp(40px,22cqw,92px);color:var(--text);filter:drop-shadow(0 0 5px var(--neon))}',
  '.box.is-done .box-title.box-ink{color:var(--text-2);filter:none}',
  '.ink-preview{height:64px;margin-top:10px;padding:8px 12px;border:1px solid var(--hair-2);border-radius:12px;background:var(--bg);color:var(--text)}',
  '.ink-preview.tall{height:200px}',
  '.ink-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}'
].join('');
document.head.appendChild(style);

export function hasInk(ink) {
  return !!(ink && Array.isArray(ink.strokes) && ink.strokes.length);
}

// A smooth line through the points of one stroke.
function strokePath(points) {
  const n = points.length / 2;
  if (n < 1) return '';
  if (n === 1) return 'M' + points[0] + ' ' + points[1] + 'l0.01 0';
  let d = 'M' + points[0] + ' ' + points[1];
  for (let i = 1; i < n - 1; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    const mx = Math.round((x + points[i * 2 + 2]) / 2);
    const my = Math.round((y + points[i * 2 + 3]) / 2);
    d += 'Q' + x + ' ' + y + ' ' + mx + ' ' + my;
  }
  return d + 'L' + points[(n - 1) * 2] + ' ' + points[(n - 1) * 2 + 1];
}

// Saved ink as an inline picture that fills its container and keeps its shape.
// opts: { label, stroke (line thickness in px), align ('xMinYMid' or 'xMidYMid') }
export function inkSVG(ink, opts) {
  if (!hasInk(ink)) return '';
  const o = opts || {};
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  ink.strokes.forEach((s) => {
    for (let i = 0; i + 1 < s.length; i += 2) {
      if (s[i] < minX) minX = s[i];
      if (s[i] > maxX) maxX = s[i];
      if (s[i + 1] < minY) minY = s[i + 1];
      if (s[i + 1] > maxY) maxY = s[i + 1];
    }
  });
  if (!isFinite(minX)) return '';
  const pad = 14;
  const box = [
    Math.floor(minX - pad), Math.floor(minY - pad),
    Math.ceil(maxX - minX + 2 * pad), Math.ceil(maxY - minY + 2 * pad)
  ].join(' ');
  const width = o.stroke || 2.2;
  return '<svg class="ink" viewBox="' + box + '" preserveAspectRatio="' + (o.align || 'xMinYMid') +
    ' meet" role="img" aria-label="' + esc(o.label || 'Handwriting') + '">' +
    ink.strokes.map((s) => '<path d="' + strokePath(s) + '" stroke-width="' + width + '"/>').join('') +
    '</svg>';
}

// Open the writing pad over everything else.
// opts: { title, hint, w, h (shape of the page, for example 4 and 1), ink, onSave(inkOrNull) }
export function openInkPad(opts) {
  const W = UNIT;
  const H = Math.round(UNIT * opts.h / opts.w);
  let strokes = [];
  if (hasInk(opts.ink)) {
    const fx = W / (opts.ink.w || W);
    const fy = H / (opts.ink.h || H);
    strokes = opts.ink.strokes.map((s) => s.map((v, i) => Math.round(v * (i % 2 ? fy : fx))));
  }

  const pad = document.createElement('div');
  pad.className = 'inkpad';
  pad.innerHTML =
    '<div class="inkpad-head">' +
      '<div class="inkpad-title">' + esc(opts.title || 'Write') + '</div>' +
      '<button type="button" class="btn" data-ink="undo">Undo</button>' +
      '<button type="button" class="btn" data-ink="clear">Clear</button>' +
      '<button type="button" class="btn" data-ink="cancel">Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-ink="done">Done</button>' +
    '</div>' +
    '<div class="inkpad-area"><div class="inkpad-surface">' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none"></svg>' +
      '<div class="inkpad-hint">' + esc(opts.hint || 'Write here with the Pencil or a finger') + '</div>' +
    '</div></div>';
  document.body.appendChild(pad);
  const area = pad.querySelector('.inkpad-area');
  const surface = pad.querySelector('.inkpad-surface');
  const svg = pad.querySelector('svg');
  const hint = pad.querySelector('.inkpad-hint');

  // Fit the page into the free space, keeping its shape.
  const fit = () => {
    const scale = Math.min(area.clientWidth / W, area.clientHeight / H);
    surface.style.width = Math.floor(W * scale) + 'px';
    surface.style.height = Math.floor(H * scale) + 'px';
  };
  fit();
  window.addEventListener('resize', fit);

  const redraw = () => {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    strokes.forEach((s) => {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', strokePath(s));
      svg.appendChild(path);
    });
    hint.hidden = strokes.length > 0;
  };
  redraw();

  let current = null;       // points of the stroke being written
  let currentPath = null;
  let activeId = null;
  let penSeen = false;

  const addPoint = (event) => {
    const r = surface.getBoundingClientRect();
    const x = Math.max(0, Math.min(W, Math.round((event.clientX - r.left) / r.width * W)));
    const y = Math.max(0, Math.min(H, Math.round((event.clientY - r.top) / r.height * H)));
    const n = current.length;
    if (n >= 2) {
      const dx = x - current[n - 2];
      const dy = y - current[n - 1];
      if (dx * dx + dy * dy < 4) return;   // skip points that are almost on top of the last one
    }
    current.push(x, y);
  };

  surface.addEventListener('pointerdown', (event) => {
    if (activeId !== null) return;
    if (event.pointerType === 'pen') penSeen = true;
    if (event.pointerType === 'touch' && penSeen) return;   // ignore the palm once a Pencil is in use
    event.preventDefault();
    activeId = event.pointerId;
    try { surface.setPointerCapture(activeId); } catch (err) { /* not essential */ }
    current = [];
    addPoint(event);
    currentPath = document.createElementNS(SVG_NS, 'path');
    currentPath.setAttribute('d', strokePath(current));
    svg.appendChild(currentPath);
    hint.hidden = true;
  });
  surface.addEventListener('pointermove', (event) => {
    if (event.pointerId !== activeId || !current) return;
    event.preventDefault();
    const samples = event.getCoalescedEvents ? event.getCoalescedEvents() : [];
    if (samples.length) samples.forEach(addPoint); else addPoint(event);
    currentPath.setAttribute('d', strokePath(current));
  });
  const endStroke = (event) => {
    if (event.pointerId !== activeId) return;
    activeId = null;
    if (current && current.length >= 2) strokes.push(current);
    current = null;
    currentPath = null;
  };
  surface.addEventListener('pointerup', endStroke);
  surface.addEventListener('pointercancel', endStroke);

  // Stops the iPad's handwriting-to-text feature and scrolling from taking the strokes.
  const block = (event) => event.preventDefault();
  surface.addEventListener('touchstart', block, { passive: false });
  surface.addEventListener('touchmove', block, { passive: false });

  const close = () => {
    window.removeEventListener('resize', fit);
    pad.remove();
  };
  pad.querySelector('.inkpad-head').addEventListener('click', (event) => {
    const button = event.target.closest('[data-ink]');
    if (!button) return;
    const what = button.dataset.ink;
    if (what === 'undo') {
      strokes.pop();
      redraw();
    } else if (what === 'clear') {
      strokes = [];
      redraw();
    } else if (what === 'cancel') {
      close();
    } else if (what === 'done') {
      const ink = strokes.length ? { w: W, h: H, strokes: strokes } : null;
      close();
      if (opts.onSave) opts.onSave(ink);
    }
  });
}
