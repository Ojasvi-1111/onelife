// Board layout: box sizes from urgency, then a deterministic spiral placement.
export const FLOOR_W = { compact: 156, comfortable: 180, large: 208 };
const GAP = 26;      // space between boxes, with room for the neon glow
const MARGIN = 26;   // space to the board edges
const FILL = 0.5;    // share of the board the boxes may cover

export function maxBoxWidth(minW, boardW, visibleH) {
  return Math.max(minW, Math.min(
    420,
    Math.max(0.36 * boardW, 1.6 * minW),
    boardW - 2 * MARGIN,
    1.5 * (visibleH - 2 * MARGIN)
  ));
}

function order(a, b) {
  if (a.uq !== b.uq) return b.uq - a.uq;
  if (a.importance !== b.importance) return b.importance - a.importance;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function hits(rects, x, y, w, h) {
  for (const q of rects) {
    if (x - GAP < q.x + q.w && x + w + GAP > q.x && y - GAP < q.y + q.h && y + h + GAP > q.y) return true;
  }
  return false;
}

// Walk a spiral out from the centre of the first screenful and take the first free spot.
function place(full, f, minW, boardW, boardH, visibleH) {
  const rects = [];
  const ox = boardW / 2;
  const oy = visibleH / 2;
  const stretch = boardW / visibleH;
  const maxR = Math.hypot(boardW, boardH);
  for (let i = 0; i < full.length; i++) {
    const w = Math.round(minW + f * (full[i] - minW));
    const h = Math.round(w * 2 / 3);
    let theta = 0;
    let r = 0;
    let spot = null;
    while (r <= maxR) {
      const x = ox + r * Math.cos(theta) * stretch - w / 2;
      const y = oy + r * Math.sin(theta) - h / 2;
      if (x >= MARGIN && y >= MARGIN && x + w <= boardW - MARGIN && y + h <= boardH - MARGIN &&
          !hits(rects, x, y, w, h)) {
        spot = { x: x, y: y, w: w, h: h };
        break;
      }
      theta += 10 / Math.max(r, 10);
      r = 24 * theta / (2 * Math.PI);
    }
    if (!spot) return null;
    rects.push(spot);
  }
  return rects;
}

// Last resort: plain rows at the floor size.
function stack(count, minW, boardW) {
  const w = minW;
  const h = Math.round(minW * 2 / 3);
  const cols = Math.max(1, Math.floor((boardW - 2 * MARGIN + GAP) / (w + GAP)));
  const rects = [];
  for (let i = 0; i < count; i++) {
    rects.push({ x: MARGIN + (i % cols) * (w + GAP), y: MARGIN + Math.floor(i / cols) * (h + GAP), w: w, h: h });
  }
  return rects;
}

function finish(sorted, rects, boardW, boardH, visibleH) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  const scroll = boardH > visibleH + 0.5;
  let dx = 0;
  let dy = 0;
  if (!scroll) {
    dx = (boardW - (maxX - minX)) / 2 - minX;
    dy = (visibleH - (maxY - minY)) / 2 - minY;
  }
  const boxes = new Map();
  sorted.forEach((item, i) => {
    const r = rects[i];
    boxes.set(item.id, { x: Math.round(r.x + dx), y: Math.round(r.y + dy), w: r.w, h: r.h });
  });
  return {
    boxes: boxes,
    boardHeight: Math.round(scroll ? Math.max(visibleH, maxY + MARGIN) : visibleH),
    scroll: scroll
  };
}

// items: [{ id, uq, importance, createdAt }]
// opts: { boardW, visibleH, minW }
// Returns { boxes: Map of id to { x, y, w, h }, boardHeight, scroll }.
export function layout(items, opts) {
  const boardW = opts.boardW;
  const visibleH = opts.visibleH;
  const minW = opts.minW;
  const sorted = items.slice().sort(order);
  if (!sorted.length) return { boxes: new Map(), boardHeight: visibleH, scroll: false };

  const maxW = maxBoxWidth(minW, boardW, visibleH);
  const full = sorted.map((item) => minW + (maxW - minW) * item.uq);
  const areaAt = (f) => full.reduce((sum, w) => {
    const ww = minW + f * (w - minW);
    return sum + ww * ww * 2 / 3;
  }, 0);

  let boardH = visibleH;
  let f = 1;
  const target = FILL * boardW * boardH;
  if (areaAt(1) > target) {
    if (areaAt(0) > target) {
      f = 0;
      boardH = Math.max(visibleH, areaAt(0) / (FILL * boardW));
    } else {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (areaAt(mid) <= target) lo = mid; else hi = mid;
      }
      f = lo;
    }
  }

  for (let attempt = 0; attempt < 80; attempt++) {
    const rects = place(full, f, minW, boardW, boardH, visibleH);
    if (rects) return finish(sorted, rects, boardW, boardH, visibleH);
    if (f > 0) f = Math.max(0, f - 0.1);
    else boardH *= 1.2;
  }
  return finish(sorted, stack(sorted.length, minW, boardW), boardW, Infinity, visibleH);
}
