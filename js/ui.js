// Shared helpers: safe text, heavy numbers, the toast, sheets and the power surge.
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

// Wrap every number in the heavy number style.
export function nums(s) {
  return String(s == null ? '' : s).split(/(\d+(?:[.,:/]\d+)*)/).map((part, i) => (
    i % 2 ? '<b class="n">' + esc(part) + '</b>' : esc(part)
  )).join('');
}

// ----- Toast -----
let toastTimer = 0;
export function hideToast() {
  clearTimeout(toastTimer);
  document.getElementById('toast').classList.remove('show');
}
export function toast(message, actionLabel, onAction) {
  const el = document.getElementById('toast');
  el.innerHTML = '';
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);
  if (actionLabel && onAction) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = actionLabel;
    button.addEventListener('click', () => { hideToast(); onAction(); });
    el.appendChild(button);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, actionLabel ? 6000 : 2600);
}

// ----- Sheets -----
let current = null;
export function sheetOpen() { return !!current; }
export function closeSheet(silent) {
  if (!current) return;
  const s = current;
  current = null;
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', s.fit);
    window.visualViewport.removeEventListener('scroll', s.fit);
  }
  s.backdrop.remove();
  if (!silent && s.onClose) s.onClose();
}
// opts: { html, className, canClose, onClose }
export function openSheet(opts) {
  closeSheet(true);
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'sheet' + (opts.className ? ' ' + opts.className : '');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.innerHTML = opts.html || '';
  backdrop.appendChild(sheet);
  document.getElementById('sheet-root').appendChild(backdrop);
  backdrop.addEventListener('click', (event) => {
    if (event.target !== backdrop) return;
    if (!opts.canClose || opts.canClose()) closeSheet();
  });
  // Stay inside the visible area when the keyboard is open.
  const fit = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    backdrop.style.top = vv.offsetTop + 'px';
    backdrop.style.height = vv.height + 'px';
  };
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fit);
    window.visualViewport.addEventListener('scroll', fit);
  }
  fit();
  current = { backdrop: backdrop, fit: fit, onClose: opts.onClose };
  return sheet;
}

// ----- Power surge: the element flashes, then rings of light spread across the screen -----
export function surge(el) {
  const fx = document.getElementById('fx');
  const color = getComputedStyle(el).getPropertyValue('--neon').trim() || '#3DFF8A';
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const far = Math.max(
    Math.hypot(cx, cy),
    Math.hypot(window.innerWidth - cx, cy),
    Math.hypot(cx, window.innerHeight - cy),
    Math.hypot(window.innerWidth - cx, window.innerHeight - cy)
  );
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 380);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const wash = document.createElement('div');
  wash.className = 'surge-wash';
  wash.style.background = 'radial-gradient(circle at ' + cx + 'px ' + cy + 'px, ' +
    'color-mix(in srgb, ' + color + ' 30%, transparent), transparent 60%)';
  fx.appendChild(wash);
  wash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, easing: 'ease-out' })
    .onfinish = () => wash.remove();

  const start = Math.round(Math.max(60, r.width * 0.6));
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
