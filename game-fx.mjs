// Motion, sound and haptics helpers. Every animation goes through `play` so
// that `settleAll` can jump all of them to their end state at once (tap during
// a transfer, app backgrounded, resize).
import { svgEl, ringColors } from "./game-art.mjs";

const running = new Set();
export function play(el, keyframes, options) {
  if (!el || !el.animate) return null;
  const anim = el.animate(keyframes, { fill: "both", ...options });
  running.add(anim);
  const done = () => running.delete(anim);
  anim.finished.then(done, done);
  return anim;
}
export const settled = (anim) => (anim ? anim.finished.then(() => true, () => false) : Promise.resolve(true));
export const wait = (ms) => {
  // a timer that settleAll can fast-forward: a tiny no-op animation
  const holder = document.body;
  const anim = holder.animate([{ opacity: 1 }, { opacity: 1 }], { duration: Math.max(1, ms) });
  running.add(anim);
  const done = () => running.delete(anim);
  anim.finished.then(done, done);
  return settled(anim);
};
export function settleAll() {
  for (const anim of [...running]) {
    try {
      if (anim.effect?.getTiming?.().iterations === Infinity) anim.cancel();
      else anim.finish();
    } catch { anim.cancel(); }
  }
  running.clear();
}
export const busyAnimating = () => running.size > 0;

// --- sound: tiny synthesized cues, no audio files ---
let ctx = null;
let soundOn = true;
export function setSound(on) { soundOn = on; }
export function unlockAudio() {
  if (!soundOn) return;
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
  } catch { ctx = null; }
}
function tone(freq, start, dur, { type = "sine", gain = .14, slide = 0 } = {}) {
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  amp.gain.setValueAtTime(.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + .008);
  amp.gain.exponentialRampToValueAtTime(.0001, t + dur);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + .02);
}
export function sound(name) {
  if (!soundOn || !ctx || ctx.state !== "running") return;
  try {
    if (name === "lift") tone(520, 0, .09, { slide: 1.5, gain: .09 });
    else if (name === "drop") tone(600, 0, .08, { slide: .7, gain: .07 });
    else if (name === "tock") { tone(240, 0, .11, { type: "triangle", gain: .2, slide: .7 }); tone(1400, 0, .025, { type: "square", gain: .025 }); }
    else if (name === "bad") { tone(190, 0, .09, { type: "square", gain: .05 }); tone(150, .1, .12, { type: "square", gain: .05 }); }
    else if (name === "complete") [660, 830, 990].forEach((f, i) => tone(f, i * .07, .16, { gain: .1 }));
    else if (name === "win") [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * .09, .24, { type: i % 2 ? "triangle" : "sine", gain: .11 }));
    else if (name === "tap") tone(880, 0, .04, { gain: .05 });
  } catch { /* audio is optional */ }
}

let hapticsOn = true;
export const canVibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
export function setHaptics(on) { hapticsOn = on; }
export function haptic(pattern) {
  if (hapticsOn && canVibrate) try { navigator.vibrate(pattern); } catch { /* ignore */ }
}

// --- particles ---
function sparkle(color) {
  return svgEl("svg", { class: "particle", viewBox: "-10 -10 20 20", width: 14, height: 14, "aria-hidden": "true" }, [
    svgEl("path", { d: "M0-9C1-3 3-1 9 0 3 1 1 3 0 9-1 3-3 1-9 0-3-1-1-3 0-9Z", fill: color, stroke: "#7A4416", "stroke-opacity": .35, "stroke-width": .8 })
  ]);
}
export function starBurst(layer, x, y, colorName, W = 80) {
  const c = ringColors[colorName]?.light ?? "#FFE9A0";
  const size = Math.max(9, .14 * W);
  const anims = [];
  for (let i = 0; i < 10; i++) {
    const node = sparkle(i % 2 ? "#FFFFFF" : c);
    node.setAttribute("width", size * 1.6);
    node.setAttribute("height", size * 1.6);
    node.style.left = x - size * .8 + "px";
    node.style.top = y - size * .8 + "px";
    layer.append(node);
    const a = (i / 10) * Math.PI * 2 + .2;
    const d = (.42 + (i % 3) * .12) * W;
    const anim = play(node, [
      { transform: "translate(0,0) scale(.3) rotate(0deg)", opacity: 1 },
      { transform: `translate(${Math.cos(a) * d * .7}px,${Math.sin(a) * d * .45 - 6}px) scale(1.15) rotate(90deg)`, opacity: 1, offset: .55 },
      { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d * .6 - 2}px) scale(.4) rotate(160deg)`, opacity: 0 }
    ], { duration: 520, easing: "cubic-bezier(.2,.7,.3,1)" });
    settled(anim).then(() => node.remove());
    anims.push(anim);
  }
  return anims;
}

const confettiColors = Object.values(ringColors).map((c) => c.base).concat(["#E8A867", "#FFE9A0"]);
function confettiPiece(i) {
  const color = confettiColors[i % confettiColors.length];
  const kind = i % 4;
  let kids;
  if (kind === 0) kids = [svgEl("ellipse", { cx: 0, cy: 0, rx: 5.2, ry: 3, fill: "none", stroke: color, "stroke-width": 2.6 }), svgEl("path", { d: "M-3-2.2A5 2.6 0 0 1 4-1.6", stroke: "#fff", "stroke-opacity": .7, "stroke-width": 1, fill: "none" })];
  else if (kind === 1) kids = [svgEl("path", { d: "M-5 3C-5-3 2-5 4-1S0 4-2 1", fill: "none", stroke: "#E8A867", "stroke-width": 2, "stroke-linecap": "round" })];
  else if (kind === 2) kids = [svgEl("path", { d: "M0-5L1.5-1.6 5-1.4 2.3.9 3.1 4.4 0 2.5-3.1 4.4-2.3.9-5-1.4-1.5-1.6Z", fill: "#FFD84A" })];
  else kids = [svgEl("rect", { x: -4, y: -2, width: 8, height: 4, rx: 1, fill: color })];
  return svgEl("svg", { class: "confetti", viewBox: "-7 -7 14 14", width: 14, height: 14, "aria-hidden": "true" }, kids);
}
export function confetti(layer, origins) {
  const out = [];
  let i = 0;
  for (const [ox, oy, dir] of origins) {
    for (let n = 0; n < 18; n++, i++) {
      const node = confettiPiece(i);
      node.style.left = ox - 7 + "px";
      node.style.top = oy - 7 + "px";
      layer.append(node);
      const speed = 600 + Math.random() * 300;
      const ang = (-90 + dir * (12 + Math.random() * 34)) * Math.PI / 180;
      const vx = Math.cos(ang) * speed, vy = Math.sin(ang) * speed, g = 1800;
      const T = 1.6, frames = [];
      const spin = (Math.random() - .5) * 1440;
      for (let k = 0; k <= 16; k++) {
        const t = (k / 16) * T;
        const drag = 1 - Math.min(.55, t * .35);
        frames.push({
          transform: `translate(${vx * t * drag}px,${vy * t + .5 * g * t * t * .55}px) rotate(${spin * t}deg) scale(${1 + (i % 3) * .2})`,
          opacity: t > T - .3 ? Math.max(0, (T - t) / .3) : 1
        });
      }
      const anim = play(node, frames, { duration: T * 1000, delay: n * 6, easing: "linear" });
      settled(anim).then(() => node.remove());
      out.push(anim);
    }
  }
  return out;
}
