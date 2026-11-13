// Celebrations: the power surge, sounds and the "goal finished" card. Also the shared
// flow "do it, celebrate, offer Undo" used by the board and the goal detail.
import { state } from './store.js';
import { surge, toast, esc, nums } from './ui.js';
import { totalsOf } from './actions.js';

// ----- Sound: short synthesised notes, no audio files -----
let audio = null;
function audioContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audio) {
    try { audio = new AC(); } catch (err) { return null; }
  }
  if (audio.state !== 'running' && audio.resume) audio.resume().catch(() => {});
  return audio;
}
// Call on the first touch, so the iPad allows sound later.
export function unlockAudio() { audioContext(); }

function note(ac, freq, at, length, level) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(level, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(at);
  osc.stop(at + length + 0.05);
}
function chime(big) {
  if (!state.settings.sound) return;
  const ac = audioContext();
  if (!ac) return;
  const t = ac.currentTime + 0.02;
  if (big) {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => note(ac, f, t + i * 0.11, 0.5, 0.16));
  } else {
    note(ac, 783.99, t, 0.22, 0.14);
    note(ac, 1174.66, t + 0.09, 0.34, 0.14);
  }
}

// An invisible stand-in for an element, so a surge can start from where it was
// even after the element has gone from the screen.
function ghostOf(el) {
  const r = el.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.style.cssText = 'position:fixed;pointer-events:none;left:' + r.left + 'px;top:' + r.top +
    'px;width:' + r.width + 'px;height:' + r.height + 'px;';
  ghost.style.setProperty('--neon', getComputedStyle(el).getPropertyValue('--neon').trim() || '#3DFF8A');
  document.getElementById('fx').appendChild(ghost);
  setTimeout(() => ghost.remove(), 2500);
  return ghost;
}

function finishCard(goal) {
  const totals = totalsOf(goal);
  const layer = document.createElement('div');
  layer.className = 'finish';
  layer.innerHTML =
    '<div class="finish-card">' +
      '<div class="finish-label">Goal finished</div>' +
      '<div class="finish-title">' + esc(goal.title) + '</div>' +
      (totals.length
        ? '<div class="finish-totals">' + totals.map((t) => '<span>' + nums(t) + '</span>').join('') + '</div>'
        : '') +
    '</div>';
  document.body.appendChild(layer);
  let timer = 0;
  const close = () => { clearTimeout(timer); layer.remove(); };
  timer = setTimeout(close, 4000);
  layer.addEventListener('click', close);
}

function celebrate(originEl, ghost, res) {
  const target = originEl && originEl.isConnected ? originEl : ghost;
  if (state.settings.surge && target) {
    if (res.finished) {
      const from = ghost || target;
      surge(from);
      setTimeout(() => surge(from), 220);
      setTimeout(() => surge(from), 440);
    } else {
      surge(target);
    }
  }
  chime(!!res.finished);
  if (res.finished && res.goal) finishCard(res.goal);
}

// Run an action, celebrate a win, and offer Undo.
export async function act(run, originEl) {
  const ghost = originEl && originEl.isConnected ? ghostOf(originEl) : null;
  let res = null;
  try {
    res = await run();
  } catch (err) {
    toast(err && err.friendly ? err.message : 'That did not work. Try again.');
    return null;
  }
  if (!res) return null;
  if (res.win) celebrate(originEl, ghost, res);
  if (res.undo) {
    toast(res.message, 'Undo', () => { res.undo().catch(() => toast('Could not undo.')); });
  } else {
    toast(res.message);
  }
  return res;
}
