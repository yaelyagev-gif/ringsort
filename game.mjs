// Ring Sort: mobile game screen. Rules come from rules.mjs (unchanged);
// art from game-art.mjs, layout from game-layout.mjs, motion/sound from game-fx.mjs.
import { capacity, cloneBoard, hasMove, move, solve, solved, validateBoard } from "./rules.mjs";
import { installSprite, drawPeg, ringSprite, ringColors, colorNames, icon, starIcon, RING, ringCentreY, setRingVariant, svgEl } from "./game-art.mjs";
import { computeLayout } from "./game-layout.mjs";
import * as eco from "./economy.mjs";
import * as stuckLib from "./game-stuck.mjs";
import { play, settled, wait, settleAll, setSound, unlockAudio, sound, setHaptics, haptic, canVibrate, starBurst, confetti } from "./game-fx.mjs";

const $ = (id) => document.getElementById(id);
const SAVE_KEY = "candle-sort-v2";
const LEGACY_KEY = "candle-sort-game-v1";
const params = new URLSearchParams(location.search);

const hints = {
  2: "Donuts of one flavor on top travel together.",
  3: "A peg with one free space takes just one donut.",
  4: "Park a donut on an empty peg to free the one below.",
  5: "Try to keep one peg empty for as long as you can.",
  6: "Before you move, check which color is underneath.",
  7: "Finish one color, and the next gets easier.",
  8: "Start with the stack that is almost done.",
  9: "Look for a peg that needs only one more move.",
  10: "Plan two moves ahead before you tap.",
  11: "Dig out buried donuts before you fill a peg.",
  12: "Free Undos run out from here. Plan before you tap."
};
const lines = {
  idle: "Tap a stack, then a matching or empty peg.",
  selected: "Now pick an empty peg or one with the same top donut.",
  illegal: "That peg is full or has a different top donut.",
  empty: "Pick a peg with donuts first.",
  undo: "Move undone.",
  stuck: "No way to finish from here. Go back or restart.",
  win: "Every flavor has its own peg."
};
const firstLesson = [
  [["coral", "coral", "coral", "teal"], ["teal", "teal", "teal"], ["coral"]],
  [["coral", "coral", "coral"], ["teal", "teal", "teal", "teal"], ["coral"]]
].map((board) => JSON.stringify(board));

// ---------------------------------------------------------------- save ----
const defaultSettings = () => ({ sound: true, haptics: true, reduced: false, patterns: false, contrast: false });
const emptySave = () => ({ v: 3, settings: defaultSettings(), completed: [], rewards: {}, active: null, contentVersion: null });
let storageOk = true;
let save = loadSave();
// Retro grant + wallet migration run FIRST, on the save exactly as stored: it reads the stars in save.rewards
// before boot() prunes or alters anything for a re-tuned catalog (see economy.mjs).
eco.migrateWallet(save, eco.parseMarker(readKey(eco.MARKER_KEY)));
save.v = 3;

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function readKey(key) {
  try { return localStorage.getItem(key); } catch { storageOk = false; return null; }
}
function loadSave() {
  const base = emptySave();
  try {
    const raw = JSON.parse(readKey(SAVE_KEY));
    if (raw && (raw.v === 2 || raw.v === 3)) {
      return {
        ...base, ...raw,
        settings: { ...base.settings, ...(raw.settings || {}) },
        completed: Array.isArray(raw.completed) ? raw.completed.filter(Number.isInteger) : [],
        rewards: raw.rewards && typeof raw.rewards === "object" ? raw.rewards : {}
      };
    }
  } catch { /* damaged v2 save: try legacy, then start fresh */ }
  try {
    const legacy = JSON.parse(readKey(LEGACY_KEY));
    if (legacy && Array.isArray(legacy.completed)) {
      base.completed = legacy.completed.filter(Number.isInteger);
      base.settings.reduced = legacy.reduced === true;
      base.settings.patterns = legacy.patterns === true;
      if (legacy.active) base.active = { ...legacy.active, version: 1, attemptId: uuid(), migrated: true };
      base.migratedFrom = LEGACY_KEY;
    }
  } catch { /* ignore */ }
  return base;
}
function persist() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    localStorage.setItem(eco.MARKER_KEY, JSON.stringify(eco.paidMarker(save)));   // survives wallet repair
    return true;
  } catch {
    if (storageOk) toast("Progress can’t be saved in this browser, but you can keep playing.");
    storageOk = false;
    return false;
  }
}

// ----------------------------------------------------------- game state ----
let catalog = [];
let selection = null;
let feedback = "";
let feedbackTimer = 0;
let layout = null;
let token = 0;            // bumps whenever running motion is settled
let busy = false;         // a transfer / celebration sequence is running
let celebrating = false;  // hide the win card until the celebration ends
let introPlaying = false;
let versionNote = null;
let lastVisual = null;
let pendingGift = null;    // free-token pop-up waiting for a quiet moment (no sheet open, before the first move)
let stuckKey = null;      // JSON of the board the solver proved dead (the board is frozen while it is the live board)
let lastChecked = "";     // board JSON last sent to the detector
let marks = null;         // { key, kind: "hint" | "bad", from, to } glow on pegs
let pendingCap = null;   // peg whose done cap waits for its last ring to land

const active = () => save.active;
const level = (id) => catalog.find((l) => l.id === id);
const forceStill = params.get("motion") === "reduce";   // review screenshots: no motion
const reduced = () => forceStill || save.settings.reduced || matchMedia("(prefers-reduced-motion: reduce)").matches;
const contrast = () => save.settings.contrast || matchMedia("(prefers-contrast: more)").matches;
const topRun = (peg) => { if (!peg.length) return 0; let n = 1; while (peg.at(-1 - n) === peg.at(-1)) n++; return n; };
const ringColor = (c) => ringColors[c]?.light ?? "#FFE9A0";
const pegDone = (peg) => peg.length === capacity && peg.every((c) => c === peg[0]);
export function starsFor(moves, par) {
  if (moves <= par) return 3;
  if (moves <= par + Math.max(2, Math.ceil(par / 2))) return 2;
  return 1;
}
function parOf(board) {
  const r = solve(board);
  return r.status === "solved" ? r.moves.length : null;
}

function start(lv, { intro = true } = {}) {
  closeAllDialogs();
  hideLobby(true);
  settle();
  save.active = {
    id: lv.id, name: lv.name, difficulty: lv.difficulty, version: lv.version,
    attemptId: uuid(), initial: cloneBoard(lv.board), board: cloneBoard(lv.board), history: [],
    par: Number.isInteger(lv.par) ? lv.par : null, startedAt: Date.now(),
    ...(typeof lv.teaches === "string" ? { teaches: lv.teaches } : {})
  };
  selection = null;
  feedback = "";
  versionNote = null;
  stuckKey = null;
  lastChecked = "";
  marks = null;
  pendingGift = eco.claimLevelGift(save, lv.id);
  persist();
  render();
  if (intro) playIntro();
  setTimeout(maybeGift, 1500);   // after the intro and splash; maybeGift waits while any sheet is open
  const attemptId = save.active.attemptId;
  if (save.active.par == null) {
    const later = window.requestIdleCallback || ((fn) => setTimeout(fn, 300));
    later(() => {
      const a = active();
      if (a?.attemptId === attemptId && a.par == null) { a.par = parOf(a.initial); persist(); }
    });
  }
}

// Commit a legal move. Board, completion and the one-time reward are written in
// ONE localStorage write, before any animation plays.
function commitMove(from, to) {
  const a = active();
  const next = move(a.board, from, to);
  if (!next) return null;
  const count = a.board[from].length - next[from].length;
  a.history.push(a.board);
  a.board = next;
  const won = solved(next);
  if (won) {
    if (a.par == null) a.par = parOf(a.initial) ?? a.history.length;
    const moves = a.history.length;
    const stars = starsFor(moves, a.par);
    const wasCleared = save.completed.includes(a.id) || !!save.rewards[a.id];
    // an older save can have the id in `completed` with no rewards entry: that is a replay (1-star floor), never a second first clear
    if (wasCleared && !save.rewards[a.id]) save.rewards[a.id] = { attemptId: "legacy", stars: eco.storedStars(save, a.id), contentVersion: a.version, at: new Date().toISOString() };
    const existing = save.rewards[a.id];
    const prevBest = existing ? (Number.isInteger(existing.best) ? existing.best : existing.stars) : null;
    const paid = eco.payWin(save, { attemptId: a.attemptId, stars, prevBest });   // ledger attempt:<id>: pays once
    if (!save.completed.includes(a.id)) save.completed.push(a.id);
    if (!existing) save.rewards[a.id] = { attemptId: a.attemptId, stars, contentVersion: a.version, at: new Date().toISOString() };
    eco.clearStuck(save, a.id);
    const record = save.rewards[a.id];
    record.best = Math.max(record.best ?? 0, record.stars ?? 0, stars);
    a.result = { stars, moves, par: a.par, firstClear: record.attemptId === a.attemptId, keptStars: record.stars, coins: paid.coins };
  }
  persist();
  return { next, count, won };
}

// ------------------------------------------------------------- feedback ----
function say(text, ms = 2200) {
  feedback = text;
  clearTimeout(feedbackTimer);
  if (ms) feedbackTimer = setTimeout(() => { feedback = ""; updateBubble(); }, ms);
  updateBubble();
}
function message() {
  const a = active();
  if (!a) return "Getting the donuts ready.";
  const win = solved(a.board);
  if (feedback) return feedback;
  if (win) return lines.win;
  if (!hasMove(a.board)) return lines.stuck;
  if (selection !== null) {
    if (a.id === 1) {
      const step = firstLesson.indexOf(JSON.stringify(a.board));
      if (step === 0) return "Now tap the middle peg to drop the mint donut.";
      if (step === 1) return "Now tap the right peg to stack the chocolate donuts.";
    }
    return lines.selected;
  }
  if (a.id === 1) {
    const step = firstLesson.indexOf(JSON.stringify(a.board));
    if (step === 0) return "Tap the left stack, then the middle peg to move the mint donut.";
    if (step === 1) return "Now tap the left stack, then the right peg to stack the chocolate donuts.";
  }
  if (!a.history.length && hints[a.id]) return hints[a.id];
  return lines.idle;
}
// Owner decision (product brief §2): after level 1 the chef says nothing unless a level teaches a
// new mode (`teaches` in content, or a client hint keyed by the level's `mechanic`), and then only at
// the start of a first clear. Every message still reaches screen readers through #announce.
const mechanicHints = {};           // e.g. lockedPeg: "A locked peg opens when ..." (future mechanics)
function teachingHint(a) {
  const lv = level(a.id);
  const text = a.teaches ?? lv?.teaches ?? (lv?.mechanic && mechanicHints[lv.mechanic]);
  if (typeof text !== "string" || !text.trim()) return null;
  if (save.completed.includes(a.id) || a.history.length || selection !== null || feedback) return null;
  return text.trim();
}
function bubbleText() {
  const a = active();
  if (!a) return null;
  if (a.id === 1) return solved(a.board) || !hasMove(a.board) ? null : message();
  return solved(a.board) ? null : teachingHint(a);
}

function guideTarget() {
  const a = active();
  if (!a || a.id !== 1 || busy) return null;
  const step = firstLesson.indexOf(JSON.stringify(a.board));
  if (step < 0) return null;
  if (selection === null) return 0;
  if (selection === 0) return step === 0 ? 1 : 2;
  return null;
}

// --------------------------------------------------------------- render ----
let pegSvgs = [];
function measure() {
  const phone = $("phone");
  const probe = $("inset-probe");
  const cs = getComputedStyle(probe);
  let insetTop = parseFloat(cs.paddingTop) || 0, insetBottom = parseFloat(cs.paddingBottom) || 0;
  const n = active()?.board.length ?? 3;
  layout = computeLayout({ w: phone.clientWidth, h: phone.clientHeight, insetTop, insetBottom, n, dpr: devicePixelRatio || 1 });
  phone.classList.toggle("short", layout.short);
  phone.classList.toggle("tiny", layout.caption === 0);
  const { bg } = layout;
  Object.assign($("play-bg").style, { left: bg.x + "px", top: bg.y + "px", width: bg.w + "px", height: bg.h + "px" });
}

function pegLabel(peg, i) {
  const contents = peg.length ? peg.map((c) => colorNames[c] ?? c).join(", ") + " (bottom to top)" : "empty";
  return `Peg ${i + 1}: ${contents}`;
}

function render() {
  const a = active();
  if (!a) return;
  if (!layout || layout.pegs.length !== a.board.length) measure();
  const win = solved(a.board);
  const dead = !win && (!hasMove(a.board) || isStuck());
  setRingVariant({ patterns: save.settings.patterns || contrast(), contrast: contrast() });
  const root = document.documentElement;
  root.classList.toggle("reduced", reduced());
  root.classList.toggle("hc", contrast());
  root.classList.toggle("show-patterns", save.settings.patterns || contrast());
  setSound(save.settings.sound);
  setHaptics(save.settings.haptics);

  $("level-label").textContent = "LEVEL " + a.id;
  $("level-title").textContent = a.name;
  $("moves").textContent = a.history.length;
  $("moves-chip").setAttribute("aria-label", a.history.length + " moves");
  refreshCoins();

  // pegs (visuals) and their hit boxes
  const pegsLayer = $("pegs");
  const board = $("board");
  if (pegSvgs.length !== a.board.length) {
    pegSvgs = a.board.map(() => svgEl("svg", { class: "peg-svg", "aria-hidden": "true" }));
    pegsLayer.replaceChildren(...pegSvgs);
    board.replaceChildren(...a.board.map((_, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "hit";
      b.addEventListener("click", () => onPeg(i));
      return b;
    }));
  }
  a.board.forEach((peg, i) => {
    const p = layout.pegs[i];
    const svg = pegSvgs[i];
    svg.setAttribute("viewBox", `0 0 ${layout.w} ${layout.h}`);
    svg.setAttribute("width", layout.w);
    svg.setAttribute("height", layout.h);
    const lifted = selection === i && !reduced();
    const hidden = lifted ? topRun(peg) : (lastVisual?.hidden?.[i] ?? 0);
    const raised = selection === i && reduced() ? topRun(peg) : 0;
    drawPeg(svg, { x: p.x, yb: p.yb, W: p.W, rings: peg, hidden, raised, lifted });
    const valid = selection !== null && selection !== i && !!move(a.board, selection, i);
    svg.classList.toggle("selected", selection === i);
    svg.classList.toggle("valid", valid);
    svg.classList.toggle("done", pegDone(peg) && !hidden && pendingCap !== i);
    const m = marks && marks.key === boardKey() ? marks : null;
    svg.classList.toggle("mark-from", !!m && m.kind === "hint" && m.from === i);
    svg.classList.toggle("mark-to", !!m && m.kind === "hint" && m.to === i);
    svg.classList.toggle("mark-bad-from", !!m && m.kind === "bad" && m.from === i);
    svg.classList.toggle("mark-bad-to", !!m && m.kind === "bad" && m.to === i);
    svg.classList.toggle("row-back", p.row === 0 && layout.rows.length === 2);
    const hit = board.children[i];
    Object.assign(hit.style, { left: p.hit.x + "px", top: p.hit.y + "px", width: p.hit.w + "px", height: p.hit.h + "px" });
    hit.setAttribute("aria-label", pegLabel(peg, i) + (selection === i ? ", lifted" : valid ? ", can take the donuts" : ""));
    hit.setAttribute("aria-pressed", String(selection === i));
  });
  board.setAttribute("aria-label", `Sorting board, ${a.board.length} pegs`);

  // lifted run (static state; the lift animation is played by onPeg)
  if (!busy) buildLift();
  updateBubble();
  updateGuide();

  renderToolbar(win, dead);
  $("restart").disabled = false;
  updateNote();
  // panels follow the state
  if (!busy && !celebrating) {
    if (win) openWin();
    else if (dead) { if (!stuckKey) stuckKey = boardKey(); openStuck(); }
    else if (!introPlaying) { scheduleDetect(); if (pendingGift) setTimeout(maybeGift, 900); }
  }
  if (!win && $("win-dialog").open) closeDialog($("win-dialog"), true);
  if (!dead && $("stuck-dialog").open) closeDialog($("stuck-dialog"), true);
}

// lifted sprites for the current selection
function ringBoxTop(p, k) { return ringCentreY(p.yb, p.W, k) - RING.centre * p.W; }
function hoverBoxTop(p, j) { return p.hoverBottom - RING.aspect * p.W - j * RING.pitch * p.W; }
function buildLift() {
  const fx = $("fx");
  fx.querySelectorAll(".lift").forEach((n) => n.remove());
  if (selection === null || reduced()) return null;   // reduced motion: the run is raised inside the peg
  const a = active();
  const peg = a.board[selection];
  const p = layout.pegs[selection];
  const n = topRun(peg);
  const wrap = document.createElement("div");
  wrap.className = "lift";
  const sprites = [];
  for (let j = 0; j < n; j++) {
    const s = ringSprite(peg.at(-n + j), p.W, j === n - 1);
    s.style.left = p.x - p.W / 2 + "px";
    s.style.top = hoverBoxTop(p, j) + "px";
    s.dataset.k = peg.length - n + j;
    wrap.append(s);
    sprites.push(s);
  }
  fx.append(wrap);
  if (!reduced()) play(wrap, [{ transform: "translateY(-2px)" }, { transform: "translateY(2px)" }], { duration: 700, iterations: Infinity, direction: "alternate", easing: "ease-in-out" });
  return { wrap, sprites };
}

function updateBubble() {
  const el = $("instruction");
  const said = message();
  const live = $("announce");
  if (live.textContent !== said) live.textContent = said;
  const text = bubbleText();
  el.hidden = !text;
  if (!text) return;
  const t = $("instruction-text");
  if (t.textContent !== text) t.textContent = text;
  if (!layout) return;
  const b = layout.bubble;
  el.style.left = b.left + "px";
  el.style.maxWidth = b.width + "px";
  const h = el.offsetHeight, wBubble = el.offsetWidth;
  const guide = guidePos();
  let bottom = guide && guide.x < b.left + wBubble + 8 ? Math.min(b.bottom, guide.y - 6) : b.bottom;
  // a lifted run hovers above its peg: slide the bubble up so the hint stays readable
  if (selection !== null && !reduced()) {
    const p = layout.pegs[selection];
    const n = topRun(active().board[selection]);
    if (n && p.x + p.W / 2 > b.left && p.x - p.W / 2 < b.left + wBubble) bottom = Math.min(bottom, hoverBoxTop(p, n - 1) - 8);
  }
  el.style.top = Math.max(b.maxTop, bottom - h) + "px";
}
function guidePos() {
  const t = guideTarget();
  if (t === null || !layout) return null;
  const p = layout.pegs[t];
  const top = selection === t ? p.top : p.tip - .32 * p.W;
  return { x: p.x - 20, y: Math.max(layout.hudH, top - 44) };
}
function updateGuide() {
  const g = $("guide");
  const pos = guidePos();
  g.hidden = !pos;
  if (!pos) return;
  g.style.left = pos.x + "px";
  g.style.top = pos.y + "px";
}
function updateNote() {
  const note = $("note");
  note.hidden = !versionNote;
  if (versionNote && layout) note.style.top = layout.hudH + 2 + "px";
}

// ------------------------------------------------------------- interaction ----
function settle() {
  token++;
  pendingCap = null;
  $("instruction").classList.remove("ghost");
  settleAll();
  const fx = $("fx");
  fx.querySelectorAll(".flight").forEach((n) => n.remove());
  if (busy || introPlaying || lastVisual) {
    busy = false;
    introPlaying = false;
    celebrating = false;
    lastVisual = null;
    render();
  }
}

function onPeg(i) {
  unlockAudio();
  const a = active();
  if (!a) return;
  if (busy || introPlaying) settle();
  if (solved(a.board)) { openWin(); return; }
  if (isStuck()) return;                    // the board is frozen while the stuck screen is up
  if (marks) { marks = null; render(); }
  if (selection === i) return deselect();
  if (selection === null) {
    if (!a.board[i].length) {
      say(lines.empty);
      shakePeg(i);
      haptic(15);
      return;
    }
    feedback = "";
    selection = i;
    sound("lift");
    haptic(8);
    render();
    animateLift(i);
    return;
  }
  const from = selection;
  if (!move(a.board, from, i)) return rejectTarget(i);
  transfer(from, i);
}

function animateLift(i) {
  if (reduced()) return;
  const p = layout.pegs[i];
  const peg = active().board[i];
  const sprites = [...$("fx").querySelectorAll(".lift .ring-sprite")];
  const n = sprites.length;
  sprites.forEach((s, j) => {
    const dy = ringBoxTop(p, peg.length - n + j) - hoverBoxTop(p, j);
    play(s, [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
      { duration: 160, delay: (n - 1 - j) * 20, easing: "cubic-bezier(.2,.9,.3,1.2)" });
  });
}

async function deselect(keepFeedback = false) {
  const i = selection;
  const p = layout.pegs[i];
  const peg = active().board[i];
  const sprites = [...$("fx").querySelectorAll(".lift .ring-sprite")];
  const n = sprites.length;
  selection = null;
  if (!keepFeedback) feedback = "";
  const my = ++token;
  if (!reduced() && sprites.length) {
    busy = true;
    $("fx").querySelector(".lift")?.getAnimations().forEach((an) => an.cancel());
    sound("drop");
    const anims = sprites.map((s, j) => {
      const dy = ringBoxTop(p, peg.length - n + j) - parseFloat(s.style.top);
      return play(s, [{ transform: "translateY(0)" }, { transform: `translateY(${dy}px)` }], { duration: 140, delay: j * 12, easing: "cubic-bezier(.5,0,.9,.5)" });
    });
    await Promise.all(anims.map(settled));
    if (my !== token) return;
    busy = false;
    render();
    squashRings(i, peg.length - n, peg.length, .6);
    return;
  }
  render();
}

function shakePeg(i) {
  if (reduced()) return;
  const svg = pegSvgs[i];
  const p = layout.pegs[i];
  svg.style.transformOrigin = `${p.x}px ${p.yb}px`;
  play(svg, [{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(-2px)" }, { transform: "translateX(0)" }], { duration: 260, easing: "ease-out", fill: "none" });
}

async function rejectTarget(i) {
  const svg = pegSvgs[i];
  const p = layout.pegs[i];
  say(lines.illegal, 2600);
  rejectCaption(i);
  sound("bad");
  haptic([12, 40, 12]);
  svg.classList.add("bad");
  const my = token;
  const clearBad = () => svg.classList.remove("bad");
  if (reduced()) {
    setTimeout(clearBad, 600);
    await wait(260);
  } else {
    const dowel = svg.querySelector(".dowel");
    if (dowel) play(dowel, [{ transform: "rotate(0)" }, { transform: "rotate(-2deg)" }, { transform: "rotate(2deg)" }, { transform: "rotate(-2deg)" }, { transform: "rotate(2deg)" }, { transform: "rotate(0)" }], { duration: 240, fill: "none" });
    const lift = $("fx").querySelector(".lift");
    lift?.querySelectorAll(".ring-sprite").forEach((s) => {
      s.style.transformOrigin = "50% 100%";
      play(s, [{ rotate: "0deg" }, { rotate: "-4deg" }, { rotate: "4deg" }, { rotate: "-3deg" }, { rotate: "0deg" }], { duration: 280, fill: "none" });
    });
    setTimeout(clearBad, 600);
    await wait(300);
  }
  if (my !== token || selection === null) { clearBad(); return; }
  deselect(true);
}

// small paper caption under the refused peg, so the reason is readable next to the ✕
function rejectCaption(i) {
  const a = active();
  const p = layout.pegs[i];
  document.querySelectorAll(".reject-cap").forEach((n) => n.remove());
  const cap = document.createElement("div");
  cap.className = "reject-cap";
  cap.setAttribute("aria-hidden", "true");
  cap.textContent = a.board[i].length >= capacity ? "Full" : "Different top";
  cap.style.left = p.x + "px";
  cap.style.top = Math.min(layout.barTop - 30, p.yb + (RING.baseRy + RING.band) * p.W + 6) + "px";
  $("phone").append(cap);
  setTimeout(() => cap.remove(), 1700);
}

function squashRings(i, fromK, toK, amount = 1) {
  if (reduced()) return [];
  const svg = pegSvgs[i];
  const p = layout.pegs[i];
  const anims = [];
  for (const use of svg.querySelectorAll("use.rb, use.rf, use.ao")) {
    const k = Number(use.dataset.k);
    if (k < fromK || k >= toK) continue;
    const bottom = ringCentreY(p.yb, p.W, k) + RING.centre * p.W;
    use.style.transformOrigin = `${p.x}px ${bottom}px`;
    const sx = 1 + .08 * amount, sy = 1 - .14 * amount;
    anims.push(play(use, [
      { transform: "scale(1,1)" }, { transform: `scale(${sx},${sy})`, offset: .29 },
      { transform: `scale(${1 - .02 * amount},${1 + .03 * amount})`, offset: .67 }, { transform: "scale(1,1)" }
    ], { duration: 240, easing: "ease-out", fill: "none" }));
  }
  return anims;
}

async function transfer(from, to) {
  const a = active();
  const before = a.board;
  const pFrom = layout.pegs[from], pTo = layout.pegs[to];
  const run = topRun(before[from]);
  const lift = $("fx").querySelector(".lift");
  const sprites = lift ? [...lift.querySelectorAll(".ring-sprite")] : [];
  const result = commitMove(from, to);           // saved before any motion
  const { count, next, won } = result;
  selection = null;
  feedback = "";
  const my = ++token;
  busy = true;
  celebrating = won;
  lift?.getAnimations().forEach((an) => an.cancel());
  const remaining = run - count;
  const flying = sprites.slice(remaining);      // top `count` rings fly
  const staying = sprites.slice(0, remaining);
  // pegs: source keeps the staying rings hidden while they drop back; target hides arrivals
  sound("tap");
  const destLen = next[to].length;
  if (reduced()) {
    // short fade out of the raised rings at the source, then a fade in at the target
    const leaving = [...pegSvgs[from].querySelectorAll("use.rb, use.rf, use.ao")].filter((u) => Number(u.dataset.k) >= before[from].length - count);
    const fades = leaving.map((u) => play(u, [{ opacity: 1 }, { opacity: 0 }], { duration: 120 }));
    await Promise.all(fades.map(settled));
    if (my !== token) return;
    lastVisual = null;
    if (pegDone(next[to])) pendingCap = to;
    render();
    const uses = [...pegSvgs[to].querySelectorAll("use.rb, use.rf")].filter((u) => Number(u.dataset.k) >= destLen - count);
    const ins = uses.map((u) => play(u, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, fill: "none" }));
    sound("tock");
    await Promise.all(ins.map(settled));
    if (my !== token) return;
    return finishMove(my, to, next, won);
  }
  lastVisual = { hidden: { [from]: remaining, [to]: count } };
  render();
  if (lift) { lift.classList.add("flight"); lift.classList.remove("lift"); }
  // staying rings drop back home
  staying.forEach((s, j) => {
    const dy = ringBoxTop(pFrom, before[from].length - run + j) - parseFloat(s.style.top);
    play(s, [{ transform: "translateY(0)" }, { transform: `translateY(${dy}px)` }], { duration: 160, easing: "cubic-bezier(.5,0,.9,.5)" });
  });
  // arc to the hover line above the target
  const scale = pTo.W / pFrom.W;
  const flights = flying.map((s, j) => {
    const x0 = parseFloat(s.style.left), y0 = parseFloat(s.style.top);
    const x2 = pTo.x - pFrom.W / 2, y2 = hoverBoxTop(pTo, j) + (pTo.W * RING.aspect - pFrom.W * RING.aspect);
    const peak = Math.min(y0, y2) - .6 * pFrom.W;
    const y1 = 2 * peak - (y0 + y2) / 2;
    const dist = Math.hypot(x2 - x0, y2 - y0);
    const dur = Math.min(420, 260 + .25 * dist);
    const dir = Math.sign(x2 - x0) || 1;
    s.style.transformOrigin = "50% 100%";
    const frames = [];
    for (let f = 0; f <= 14; f++) {
      const t = f / 14;
      const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * ((x0 + x2) / 2) + t * t * x2;
      const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * y1 + t * t * y2;
      const tilt = dir * 6 * Math.sin(Math.PI * t) * (j ? 1 : .5);
      frames.push({ transform: `translate(${x - x0}px,${y - y0}px) rotate(${tilt}deg) scale(${1 + (scale - 1) * t})` });
    }
    return play(s, frames, { duration: dur, delay: (flying.length - 1 - j) * 30, easing: "cubic-bezier(.45,0,.25,1)" });
  });
  {
    const bubble = $("instruction");
    const br = bubble.getBoundingClientRect(), pr = $("phone").getBoundingClientRect();
    const xs = [pFrom.x, pTo.x], ys = [hoverBoxTop(pFrom, run), hoverBoxTop(pTo, 0) + pTo.W * RING.aspect, Math.min(hoverBoxTop(pFrom, run), hoverBoxTop(pTo, count)) - .6 * pFrom.W];
    const L = Math.min(...xs) - pFrom.W / 2 + pr.left, R = Math.max(...xs) + pFrom.W / 2 + pr.left;
    const T = Math.min(...ys) + pr.top, B = Math.max(...ys) + pr.top;
    if (!(R < br.left || L > br.right || B < br.top || T > br.bottom)) bubble.classList.add("ghost");
  }
  await Promise.all(flights.map(settled));
  if (my !== token) return;
  $("instruction").classList.remove("ghost");
  // drop down the dowel
  lift?.remove();
  lastVisual = null;
  if (pegDone(next[to])) pendingCap = to;
  render();
  const arrivals = [...pegSvgs[to].querySelectorAll("use.rb, use.rf, use.ao")].filter((u) => Number(u.dataset.k) >= destLen - count);
  const drops = arrivals.map((u) => {
    const k = Number(u.dataset.k);
    const dy = hoverBoxTop(pTo, k - (destLen - count)) - ringBoxTop(pTo, k);
    return play(u, [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: 140, easing: "cubic-bezier(.55,0,1,.45)" });
  });
  await Promise.all(drops.map(settled));
  if (my !== token) return;
  drops.forEach((d) => d?.cancel());
  sound("tock");
  haptic(10);
  squashRings(to, destLen - count, destLen, 1);
  // the rings underneath compress a little
  for (const u of pegSvgs[to].querySelectorAll("use.rb, use.rf, use.ao")) {
    if (Number(u.dataset.k) < destLen - count) play(u, [{ transform: "translateY(0)" }, { transform: "translateY(2px)" }, { transform: "translateY(0)" }], { duration: 180, fill: "none" });
  }
  play(pegSvgs[to].querySelector(".contact"), [{ opacity: 1 }, { opacity: 1.6, offset: .3 }, { opacity: 1 }], { duration: 240, fill: "none" });
  await wait(120);
  if (my !== token) return;
  return finishMove(my, to, next, won);
}

async function finishMove(my, to, next, won) {
  if (pegDone(next[to])) await pegComplete(my, to, next[to][0]);
  if (my !== token) return;
  if (won) return celebrate(my);
  busy = false;
  celebrating = false;
  render();
}

async function pegComplete(my, i, color) {
  const svg = pegSvgs[i];
  const p = layout.pegs[i];
  sound("complete");
  pendingCap = null;
  svg.classList.add("done");
  const cap = svg.querySelector(".cap");
  const rim = svg.querySelector(".base-rim");
  if (rim) play(rim, [{ stroke: ringColor(color), strokeWidth: 4 }, { stroke: "#F5C04A", strokeWidth: 2.2 }], { duration: 320, fill: "none" });
  if (reduced()) {
    play(cap, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, fill: "none" });
    return wait(120);
  }
  const anims = [];
  for (const u of svg.querySelectorAll("use.rb, use.rf, use.ao")) {
    const k = Number(u.dataset.k);
    anims.push(play(u, [{ transform: "translateY(0)" }, { transform: "translateY(-6px)", offset: .4 }, { transform: "translateY(0)" }], { duration: 260, delay: k * 40, easing: "ease-out", fill: "none" }));
  }
  const capW = .44 * p.W;
  cap.style.transformOrigin = `${p.x}px ${p.tip + capW * .12}px`;
  anims.push(play(cap, [
    { transform: `translateY(${-p.W * .9}px)`, opacity: 0 }, { transform: "translateY(0) scale(1,1)", opacity: 1, offset: .62 },
    { transform: "translateY(0) scale(1.15,.82)", offset: .8 }, { transform: "translateY(0) scale(1,1)", opacity: 1 }
  ], { duration: 220, delay: 120, easing: "ease-in", fill: "backwards" }));
  starBurst($("fx"), p.x, ringCentreY(p.yb, p.W, 3) - .1 * p.W, color, p.W);
  await Promise.all(anims.map(settled));
}

async function celebrate(my) {
  const a = active();
  sound("win");
  haptic([20, 60, 30]);
  if (!reduced()) {
    await wait(250);
    if (my !== token) return;
    const order = layout.pegs.map((p, i) => ({ p, i })).sort((x, y) => x.p.x - y.p.x);
    let n = 0;
    order.forEach(({ i }) => {
      if (!a.board[i].length) return;
      const svg = pegSvgs[i];
      const p = layout.pegs[i];
      svg.style.transformOrigin = `${p.x}px ${p.yb}px`;
      play(svg, [{ transform: "translateY(0) scale(1)" }, { transform: "translateY(-10px) scale(1.04)", offset: .4 }, { transform: "translateY(0) scale(1)" }], { duration: 360, delay: n++ * 60, easing: "ease-out", fill: "none" });
    });
    const ys = Math.max(...layout.pegs.map((p) => p.yb));
    confetti($("fx-top"), [[layout.w * .12, ys, 1], [layout.w * .88, ys, -1]]);
    await wait(500);
    if (my !== token) return;
  }
  busy = false;
  celebrating = false;
  render();
}

function playIntro() {
  if (reduced() || !layout) return;
  introPlaying = true;
  const my = token;
  const order = layout.pegs.map((p, i) => ({ p, i })).sort((x, y) => x.p.row - y.p.row || x.p.x - y.p.x);
  const anims = [];
  order.forEach(({ p, i }, n) => {
    const svg = pegSvgs[i];
    svg.style.transformOrigin = `${p.x}px ${p.yb}px`;
    anims.push(play(svg, [{ transform: "scale(.6)", opacity: 0 }, { transform: "scale(1.04)", opacity: 1, offset: .7 }, { transform: "scale(1)", opacity: 1 }], { duration: 180, delay: n * 40, easing: "ease-out", fill: "backwards" }));
    const uses = [...svg.querySelectorAll("use.rb, use.rf, use.ao")];
    uses.forEach((u) => {
      const k = Number(u.dataset.k);
      anims.push(play(u, [{ transform: `translateY(${-p.W * (1 + k * .2)}px)`, opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 120 + k * 25, delay: 260 + n * 70 + k * 30, easing: "cubic-bezier(.5,0,.8,.6)", fill: "backwards" }));
    });
  });
  setTimeout(() => { if (my === token) introPlaying = false; }, 400);
}

// ------------------------------------------------------------- dialogs ----
function placeDialog(d) {
  const r = $("phone").getBoundingClientRect();
  const cs = getComputedStyle($("phone"));
  const bl = parseFloat(cs.borderLeftWidth) || 0, bt = parseFloat(cs.borderTopWidth) || 0;
  Object.assign(d.style, { left: r.left + bl + "px", top: r.top + bt + "px", width: $("phone").clientWidth + "px", height: $("phone").clientHeight + "px" });
}
function openDialog(d, kind = "sheet") {
  if (d.open) return false;
  placeDialog(d);
  d.showModal();
  const card = d.querySelector(".card");
  if (reduced()) {
    play(d, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, fill: "none" });
  } else {
    play(d, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: "none" });
    if (kind === "panel") play(card, [{ transform: "scale(.86)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 320, easing: "cubic-bezier(.2,1.3,.4,1)", fill: "none" });
    else play(card, [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)", fill: "none" });
  }
  return true;
}
async function closeDialog(d, instant = false) {
  if (!d.open) return;
  if (!instant && !reduced()) {
    const card = d.querySelector(".card");
    d.classList.add("closing");
    const an = play(d, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease-in" });
    if (card) play(card, d.classList.contains("panel") ? [{ transform: "scale(1)" }, { transform: "scale(.94)" }] : [{ transform: "translateY(0)" }, { transform: "translateY(60%)" }], { duration: 200, easing: "ease-in" });
    await settled(an);
    d.classList.remove("closing");
    d.getAnimations({ subtree: true }).forEach((x) => x.cancel());
  }
  if (d.open) d.close();
}
function closeAllDialogs() {
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
}

// Coins live in save.wallet (economy.mjs). HUD and lobby show the wallet balance.
const coinsShown = () => save.wallet.coins.toLocaleString("en-US");
function refreshCoins() {
  $("coins").textContent = $("lobby-coins").textContent = coinsShown();
  for (const chip of [$("coins-chip"), $("lobby-coins").parentElement]) chip.setAttribute("aria-label", `${coinsShown()} coins`);
}
function openWin(preview = null) {
  const a = active();
  const d = $("win-dialog");
  const res = preview ?? a.result ?? { stars: 3, moves: a.history.length, par: a.par, firstClear: true };
  const nextLevel = level(a.id + 1);
  $("win-title").textContent = nextLevel ? "Nicely sorted!" : "Bakery complete!";
  $("win-moves").textContent = `Sorted in ${res.moves} move${res.moves === 1 ? "" : "s"}` + (res.par ? ` · best ${res.par}` : "");
  $("win-coins").textContent = "+" + (res.coins ?? 0);
  $("win-coins-row").setAttribute("aria-label", `${res.coins ?? 0} coins earned`);
  const stars = $("win-stars");
  stars.replaceChildren(...[1, 2, 3].map((n) => {
    const s = document.createElement("img");
    s.src = "art/bakery/star.webp";
    s.alt = "";
    s.width = 113; s.height = 109;
    s.className = "star s" + n + (n <= res.stars ? " on" : " off");
    return s;
  }));
  stars.setAttribute("aria-label", `${res.stars} of 3 stars`);
  const kept = $("win-kept");
  kept.hidden = res.firstClear !== false;
  if (!kept.hidden) kept.textContent = `Your first clear earned ${res.keptStars} star${res.keptStars === 1 ? "" : "s"}. Best kept from first clear.`;
  $("win-next-label").textContent = nextLevel ? "Next" : "Replay";
  $("win-next").setAttribute("aria-label", nextLevel ? `Next level, ${nextLevel.id}` : "Replay this level");
  $("win-next").onclick = () => afterWin(() => start(nextLevel ?? level(a.id)));
  $("win-replay").hidden = !nextLevel;
  if (openDialog(d, "panel")) {
    $("win-next").focus({ preventScroll: true });
    if (!reduced()) {
      play(d.querySelector(".win-chef"), [{ transform: "translateY(24px) scale(.9)", opacity: 0 }, { transform: "translateY(-6px) scale(1.02)", opacity: 1, offset: .7 }, { transform: "translateY(0) scale(1)", opacity: 1 }], { duration: 420, delay: 120, easing: "ease-out", fill: "backwards" });
      [...stars.children].forEach((s, n) => {
        if (!s.classList.contains("on")) return;
        play(s, [{ transform: "scale(0) rotate(-30deg)", opacity: 0 }, { transform: "scale(1.25) rotate(8deg)", opacity: 1, offset: .7 }, { transform: "scale(1) rotate(0)", opacity: 1 }], { duration: 360, delay: 260 + n * 140, easing: "ease-out", fill: "backwards" });
      });
    }
  }
}

// ------------------------------------------------- chest, daily gift, welcome back ----
// Chests and the gift are paid when their screen opens (ledger keys make a second call pay nothing),
// so closing the app on the screen never loses or repeats a reward.
function waitScreen(d, button) {
  return new Promise((resolve) => {
    if (!openDialog(d, "panel")) return resolve();
    button.focus({ preventScroll: true });
    button.onclick = async () => { button.onclick = null; await closeDialog(d); resolve(); };
  });
}
function showChest({ chapter, coins, hints }) {
  $("chest-title").textContent = `Chapter ${chapter} chest!`;
  $("chest-coins").textContent = "+" + coins;
  $("chest-hints").textContent = "+" + hints;
  sound("win");
  return waitScreen($("chest-dialog"), $("chest-ok"));
}
async function claimChests() {
  for (const n of eco.pendingChests(save)) {
    const chest = eco.claimChest(save, n);
    if (!chest) continue;
    persist();
    refreshCoins();
    await showChest(chest);
  }
}
let winBusy = false;
async function afterWin(action) {
  if (winBusy) return;
  winBusy = true;
  try { await claimChests(); } finally { winBusy = false; }
  action();
}
function buildGiftDays() {
  $("gift-days").replaceChildren(...eco.DAILY_COINS.map((_, i) => { const e = document.createElement("i"); e.textContent = i + 1; return e; }));
}
function showGift({ day, coins }) {
  $("gift-day").textContent = `Day ${day} of 7${day === 7 ? " · big day!" : ""}`;
  $("gift-coins").textContent = "+" + coins;
  [...$("gift-days").children].forEach((e, i) => { e.className = i + 1 < day ? "done" : i + 1 === day ? "today" : ""; });
  return waitScreen($("gift-dialog"), $("gift-ok"));
}
function showWelcome(w) {
  const lines = [];
  lines.push(`<b>${w.levelCoins} coins</b> for ${w.levels} cleared level${w.levels === 1 ? "" : "s"}`);
  for (const c of w.chests) lines.push(`<b>${c.coins} coins</b> and 1 Hint for the chapter ${c.chapter} chest`);
  if (w.start) lines.push(`<b>${w.start} coins</b> to start`);
  $("welcome-lines").replaceChildren(...lines.map((html) => { const li = document.createElement("li"); li.innerHTML = html; return li; }));
  $("welcome-total").textContent = "+" + w.total;
  const h = $("welcome-hints");
  h.hidden = !w.hints;
  h.textContent = `+ ${w.hints} Hint${w.hints === 1 ? "" : "s"}`;
  return waitScreen($("welcome-dialog"), $("welcome-ok"));
}
// On launch: Welcome back (retro grant, once), then the daily gift, then any chest not yet opened.
async function launchFlow() {
  if (save.wallet.welcome) {
    await showWelcome(save.wallet.welcome);
    eco.dismissWelcome(save);
    persist();
  }
  const gift = eco.claimDaily(save);
  if (gift) { persist(); refreshCoins(); await showGift(gift); }
  if (!$("win-dialog").open) await claimChests();
}

// ------------------------------------------------ Task B: stuck detection, stuck screen, boosters ----
// The solver runs in a Web Worker with a time budget (game-stuck.mjs), so input is never blocked. "unsolvable" from
// solve() (not just "no legal move") freezes the board and opens the stuck screen; "limit" or a timeout skips the move.
const boardKey = () => JSON.stringify(active()?.board);
const isStuck = () => !!stuckKey && stuckKey === boardKey();
const events = [];   // telemetry buffer (B11): also dispatched as a "ringsort:telemetry" event for whatever collects it
function track(name, data = {}) {
  events.push({ name, ...data, at: Date.now() });
  if (events.length > 200) events.shift();
  try { document.dispatchEvent(new CustomEvent("ringsort:telemetry", { detail: { name, ...data } })); } catch { /* ignore */ }
}
const runner = stuckLib.createRunner(new URL("game-worker.mjs", import.meta.url).href);

function scheduleDetect() {
  const a = active();
  if (!a || stuckKey) return;
  const key = boardKey();
  if (key === lastChecked) return;
  lastChecked = key;
  const attemptId = a.attemptId;
  runner({ op: "check", board: a.board }).then((r) => {
    const cur = active();
    if (!cur || cur.attemptId !== attemptId || boardKey() !== key) return;   // the player already moved: ignore the old board
    if (r.timeout || r.status === "limit") { track("solve_limit_hit", { level: cur.id, op: "detect", timeout: !!r.timeout }); return; }
    if (r.status === "unsolvable") { stuckKey = key; if (!busy && !celebrating) render(); }
  });
}

const fmt = (n) => n.toLocaleString("en-US");
function setPrice(el, { token = false, price = 0 } = {}) {
  el.replaceChildren();
  const icon = (src) => { const i = document.createElement("img"); i.src = src; i.alt = ""; i.width = 18; i.height = 18; return i; };
  if (token) el.append(icon("art/bakery/btn-plus.webp"), "token");
  else if (!price) el.textContent = "free";
  else el.append(icon("art/bakery/coin.webp"), fmt(price));
}
// Two taps for anything that costs coins: the first arms the button ("Tap again to pay"), the second pays.
function armed(id, fn) {
  const btn = $(id);
  if (btn.disabled) return;
  if (btn.dataset.price === "0") return fn();
  if (btn.dataset.armed === "1") {
    if (Date.now() - Number(btn.dataset.armedAt) < 350) return;   // a double tap is not a confirm
    disarm(btn);
    return fn();
  }
  const label = btn.querySelector("span");
  btn.dataset.armed = "1";
  btn.dataset.armedAt = Date.now();
  label.dataset.was = label.textContent;
  label.textContent = "Tap again to pay";
  clearTimeout(btn._arm);
  btn._arm = setTimeout(() => disarm(btn), 4000);
}
function disarm(btn) {
  clearTimeout(btn._arm);
  if (btn.dataset.armed !== "1") return;
  btn.dataset.armed = "0";
  const label = btn.querySelector("span");
  label.textContent = label.dataset.was;
}

let stuckOpening = false;
async function openStuck(preview = false) {
  const a = active();
  if (!a || $("stuck-dialog").open || stuckOpening || !isStuck()) return;
  stuckOpening = true;
  selection = null;
  const key = boardKey();
  const info = preview ? { count: 0 } : eco.recordStuck(save, a.id, a);   // one count per stuck event (ledger), so a reload does not recount
  if (!preview) persist();
  track("stuck_shown", { level: a.id, depth: a.history.length, preview });
  if (info.pegGranted) track("pity_triggered", { level: a.id, kind: "peg", count: info.count });
  else if (info.freeRewind) track("pity_triggered", { level: a.id, kind: "rewind", count: info.count });
  // +Peg is offered only where the verifier says one extra peg makes the board solvable
  let rescue = false;
  if (!eco.attemptEco(a).peg && a.board.length < 9) {
    const r = await runner({ op: "rescue", board: a.board }, 2000);
    if (r.timeout) track("solve_limit_hit", { level: a.id, op: "rescue" });
    rescue = !!r.rescues;
  }
  stuckOpening = false;
  if (active() !== a || boardKey() !== key || !isStuck()) return;
  fillStuck(a, info, rescue || (preview && params.get("rewind") === "1"));
  if (openDialog($("stuck-dialog"))) $("stuck-restart").focus({ preventScroll: true });
}
function fillStuck(a, info, rescue) {
  const rc = eco.rewindCost(save, a.id);
  const rewind = $("stuck-rewind"), peg = $("stuck-peg");
  const pc = eco.pegCost(save);
  const coins = save.wallet.coins;
  for (const b of [rewind, peg]) disarm(b);
  const sample = params.get("preview") === "stuck" && params.get("rewind") === "1";   // review sample: history may be empty
  rewind.hidden = !a.history.length && !sample;
  rewind.dataset.price = rc.price;
  rewind.disabled = rc.price > coins;
  setPrice($("stuck-rewind-price"), { price: rc.price });
  peg.hidden = !rescue;
  peg.dataset.price = pc.price;
  peg.disabled = !pc.token && pc.price > coins;
  setPrice($("stuck-peg-price"), pc);
  const poor = (!rewind.hidden && rewind.disabled) || (!peg.hidden && peg.disabled);
  $("stuck-poor").hidden = !poor;
  $("stuck-balance").textContent = fmt(coins) + " coins";
  $("stuck-text").textContent = info.pegGranted ? "A free +Peg token is waiting for you."
    : rc.why === "pity" ? "A free rewind is waiting."
    : rc.why === "early" ? "Going back is free on early levels."
    : "No way to finish from here.";
}

let rewinding = false;
async function doRewind() {
  const a = active();
  if (rewinding || !a || !isStuck()) return;
  rewinding = true;
  const label = $("stuck-rewind").querySelector("span");
  const was = label.textContent;
  label.textContent = "Looking back…";
  try {
    const r = await runner({ op: "rewind", history: a.history, board: a.board }, stuckLib.DEEP_BUDGET_MS);
    if (active() !== a || !isStuck()) return;
    if (r.timeout) { track("solve_limit_hit", { level: a.id, op: "rewind" }); $("stuck-text").textContent = "That took too long. Nothing was charged: try again or restart."; return; }
    if (!r.target) { $("stuck-rewind").hidden = true; $("stuck-text").textContent = "No safe spot found. Restart is free."; return; }
    const paid = eco.takeRewind(save, a.id, a);   // flat price whatever the depth, charged once (ledger)
    if (!paid.ok) { fillStuck(a, { count: 0 }, !$("stuck-peg").hidden); return; }
    const { board, index, wrong } = r.target;
    a.board = board;
    a.history = a.history.slice(0, index);
    selection = null; stuckKey = null; lastChecked = "";
    marks = wrong ? { key: boardKey(), kind: "bad", from: wrong[0], to: wrong[1] } : null;
    persist();
    refreshCoins();
    closeDialog($("stuck-dialog"), true);
    track("stuck_action", { type: "rewind" });
    track("booster_used", { type: "rewind", price: paid.spent });
    if (wrong) { const t = `Not this one: peg ${wrong[0] + 1} to peg ${wrong[1] + 1}`; say(t, 6000); toast(t); }
    render();
  } finally {
    rewinding = false;
    label.textContent = was;
  }
}

function doPeg(source) {
  const a = active();
  if (!a || solved(a.board)) return;
  const res = eco.takePeg(save, a);
  if (!res.ok) { toast(res.reason === "dup" ? "This level already has its extra peg." : "Not enough coins for a peg."); return; }
  a.board = [...a.board.map((p) => [...p]), []];
  a.history = a.history.map((b) => [...b.map((p) => [...p]), []]);   // keep every saved position the same width, so Rewind still works
  selection = null; stuckKey = null; lastChecked = ""; marks = null;
  persist();
  refreshCoins();
  closeDialog($("stuck-dialog"), true);
  if (source === "stuck") track("stuck_action", { type: "peg" });
  track("booster_used", { type: "peg", price: res.spent });
  toast("An extra peg for this try.");
  render();
}

// Small bottom sheet for paying or being told you can't. Options: [{ label, price, token, disabled, run }].
let payDone = false;
function payClose() { closeDialog($("pay-dialog")); }
function openPay({ title, text, options = [], poor = false, restart = false, closeLabel = "Not now" }) {
  $("pay-title").textContent = title;
  $("pay-text").textContent = text;
  $("pay-balance-num").textContent = fmt(save.wallet.coins) + " coins";
  $("pay-balance").hidden = !poor;
  const box = $("pay-actions");
  payDone = false;
  const add = (label, cls, fn, price) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "wide-btn " + cls;
    const s = document.createElement("span");
    s.textContent = label;
    b.append(s);
    if (price !== undefined) { const p = document.createElement("b"); p.className = "price"; setPrice(p, price); b.append(p); }
    b.addEventListener("click", () => { if (payDone) return; payDone = true; fn(); });   // one tap only: no double charge
    box.append(b);
    return b;
  };
  box.replaceChildren();
  if (poor) {
    add("Get coins", "honey", () => { payClose(); openCoins(); });
    if (restart) add("Restart", "mint", () => { payClose(); start(level(active().id) ?? { ...active(), board: active().initial }); });
  } else {
    for (const o of options) {
      const b = add(o.label, "honey", () => { payClose(); o.run(); }, { token: o.token, price: o.price ?? 0 });
      b.disabled = !!o.disabled;
    }
  }
  add(closeLabel, "quiet", payClose);
  if (openDialog($("pay-dialog"))) box.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
}
function openCoins() { openDialog($("coins-dialog")); }   // placeholder: the shop is Task C

// The token is already granted; the pop-up only tells the player. It never opens over another sheet and
// only before the first move, so it cannot stack on the stuck, win or confirm sheets.
function maybeGift() {
  const a = active();
  if (!pendingGift || !a || busy || introPlaying || celebrating) return;
  if (a.history.length || solved(a.board)) { pendingGift = null; return; }
  if (isStuck() || stuckOpening || document.querySelector("dialog[open]") || !$("lobby").hidden || $("splash")) return;
  const gift = pendingGift;
  pendingGift = null;
  showGiftToken(gift);
}
function showGiftToken(gift) {
  const what = gift.hints ? "a free Hint token" : "a free +Peg token";
  openPay({ title: "A gift from the chef", text: `Here is ${what}. It is used before any coins.`, closeLabel: "Thanks!" });
}

let hinting = false;
async function useHint() {
  settle();
  const a = active();
  if (!a || solved(a.board) || isStuck() || hinting) return;
  hinting = true;
  try {
    const key = boardKey();
    const r = await runner({ op: "hint", board: a.board }, 3000);
    if (active() !== a || boardKey() !== key) return;
    if (r.timeout || !r.move) {
      if (r.status === "unsolvable") { stuckKey = key; render(); return; }   // the solver proves a dead end the move check had skipped
      track("solve_limit_hit", { level: a.id, op: "hint" });
      toast("No hint for this board right now. Nothing was charged.");
      return;
    }
    const finish = () => {
      if (active() !== a || boardKey() !== key) return;
      const paid = eco.takeHint(save, a);
      if (!paid.ok) { toast("Not enough coins for a hint."); return; }
      persist();
      refreshCoins();
      marks = { key, kind: "hint", from: r.move[0], to: r.move[1] };
      if (!paid.repeat) track("booster_used", { type: "hint", price: paid.spent, token: paid.token });
      const t = `Hint: peg ${r.move[0] + 1} to peg ${r.move[1] + 1}`;
      say(t, 6000);
      toast(t);
      render();
    };
    const cost = eco.hintCost(save, a);
    if (cost.price === 0) return finish();   // token first, or the same hint again
    if (cost.price > save.wallet.coins) return openPay({ title: "Not enough coins", text: `A hint costs ${fmt(cost.price)} coins.`, poor: true });
    openPay({ title: "Show the next move?", text: "The chef points at the next step.", options: [{ label: "Show hint", price: cost.price, run: finish }] });
  } finally { hinting = false; }
}

function buyPegFromBar() {
  settle();
  const a = active();
  if (!a || solved(a.board) || isStuck()) return;
  if (eco.attemptEco(a).peg) { toast("This level already has its extra peg."); return; }
  const c = eco.pegCost(save);
  if (!c.token && c.price > save.wallet.coins) return openPay({ title: "Not enough coins", text: `An extra peg costs ${fmt(c.price)} coins.`, poor: true, restart: true });
  openPay({ title: "Add an extra peg?", text: "One more empty peg for this try only.", options: [{ label: "Add peg", token: c.token, price: c.price, run: () => doPeg("bar") }] });
}

// Toolbar: the Undo label shows what the next Undo costs; nothing is clickable on a stuck board.
function renderToolbar(win, dead) {
  const a = active();
  const plan = eco.undoPlan(a.id, a, dead);
  let label = "Undo", aria = "Undo";
  if (plan.kind === "free3") { label = "Undo " + plan.left; aria = `Undo, ${plan.left} free left`; }
  else if (plan.kind === "credit") { label = "Undo " + plan.credits; aria = `Undo, ${plan.credits} bought left`; }
  else if (plan.kind === "pay") { label = "Undo " + plan.price; aria = `Undo, ${plan.price} coins`; }
  $("undo-cap").textContent = label;
  $("undo").setAttribute("aria-label", aria);
  $("undo").disabled = win || dead || !a.history.length;
  $("hint").disabled = win || dead;
  const hasPeg = !!eco.attemptEco(a).peg;
  $("add-peg").disabled = win || dead || hasPeg;
  $("add-peg").setAttribute("aria-label", hasPeg ? "Extra peg already added" : "Add a peg");
  const badge = (el, token, count, price) => { el.textContent = token ? String(count) : fmt(price); el.classList.toggle("token", token); };
  badge($("hint-badge"), save.wallet.hints > 0, save.wallet.hints, eco.PRICES.HINT);
  badge($("peg-badge"), save.wallet.pegs > 0, save.wallet.pegs, eco.PRICES.PEG);
  if (hasPeg) $("peg-badge").textContent = "";
}
let confirmResolve = null;
function confirmSheet(title, text, ok) {
  $("confirm-title").textContent = title;
  $("confirm-text").textContent = text;
  $("confirm-ok-label").textContent = ok;
  openDialog($("confirm-dialog"));
  $("confirm-cancel").focus({ preventScroll: true });
  return new Promise((resolve) => { confirmResolve = resolve; });
}
function answerConfirm(value) {
  closeDialog($("confirm-dialog"));
  confirmResolve?.(value);
  confirmResolve = null;
}

// ---------------------------------------------------------------- map ----
// Three painted maps (art/bakery/map-1..3) stacked bottom to top as one long scroll. The cream road's
// centre line was measured on each painting (x as a fraction of image width, 25 samples, top to bottom);
// level nodes are spaced along it by arc length and nudged left/right in turn so they never crowd.
const MAP_ART = ["map-1", "map-2", "map-3"];
// The centre line of the cream road in each painting (fractions of image width/height, bottom to top) is
// traced by tools/art/trace_map_paths.py into art/bakery/map-paths.json. Level nodes sit on it in single
// file at equal arc-length steps.
let mapRoads = null;
async function loadMapRoads() {
  try {
    const r = await fetch("art/bakery/map-paths.json");
    if (r.ok) { const data = await r.json(); mapRoads = MAP_ART.map((n) => data[n]); }
  } catch { /* the map falls back to a straight road */ }
}
// each painting is shown 2.1x the screen width and stretched 20% taller than its own ratio so 33 nodes fit with room
const MAP_SCALE = 2.1, MAP_STRETCH = 1.2, MAP_OVERLAP = .09, NODE_R = 20, TAG_HALF = 92;
const CHAPTERS = ["Sugar Meadow", "Cupcake Grove", "Macaron Lane", "Frosting Hills", "Cocoa Bridge", "Sprinkle Fields", "Gingerbread Row", "Snowy Meringues", "Candy Peaks", "Castle of Cream"];
const MAP_END_Y = .14;    // the last map's road stops here, at the castle

const straightRoad = () => [[.5, 1], [.5, 0]];
function roadX(poly, y) {   // x of the road at height y (poly runs bottom to top, y descending)
  for (let i = 1; i < poly.length; i++) {
    if (poly[i][1] <= y) {
      const [x0, y0] = poly[i - 1], [x1, y1] = poly[i];
      return x0 + (x1 - x0) * ((y0 - y) / ((y0 - y1) || 1));
    }
  }
  return poly.at(-1)[0];
}
// Section geometry: image k sits above image k-1 and overlaps it by `ov`; x offsets keep the road continuous
// across each seam, then the whole road is centred in the window.
function mapGeometry(W) {
  const roads = mapRoads ?? MAP_ART.map(straightRoad);
  const iw = MAP_SCALE * W, ih = iw * 1.5 * MAP_STRETCH, ov = ih * MAP_OVERLAP;
  const secs = [];
  for (let k = 0; k < MAP_ART.length; k++) {
    let left = 0;
    if (k) left = secs[k - 1].left + roadX(roads[k - 1], MAP_OVERLAP) * iw - roadX(roads[k], 1 - MAP_OVERLAP) * iw;
    secs.push({ left, top: (MAP_ART.length - 1 - k) * (ih - ov) });
  }
  const height = MAP_ART.length * ih - (MAP_ART.length - 1) * ov;
  const pts = [];                                   // road from the foot of map 1 up to the castle
  secs.forEach((s, k) => {
    for (const [x, y] of roads[k]) {
      if (k > 0 && y * ih > ih - ov) continue;      // covered by the lower map's top fade
      if (k < secs.length - 1 && y * ih < ov) continue;  // the upper map takes over here
      if (k === secs.length - 1 && y < MAP_END_Y) continue;
      pts.push({ x: s.left + x * iw, y: s.top + y * ih });
    }
  });
  const lo = Math.min(...pts.map((p) => p.x)), hi = Math.max(...pts.map((p) => p.x));
  const shift = W / 2 - (lo + hi) / 2;
  secs.forEach((s) => { s.left += shift; });
  pts.forEach((p) => { p.x += shift; });
  return { iw, ih, ov, secs, height, road: pts };
}
// n node centres at equal arc-length steps along the road
function placeNodes(road, n) {
  const cum = [0];
  for (let i = 1; i < road.length; i++) cum.push(cum[i - 1] + Math.hypot(road[i].x - road[i - 1].x, road[i].y - road[i - 1].y));
  const padStart = 56, padEnd = 24;
  const step = (cum.at(-1) - padStart - padEnd) / (n - 1);
  const at = (d) => {
    let j = 1;
    while (j < cum.length - 1 && cum[j] < d) j++;
    const t = (d - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1);
    return { x: road[j - 1].x + (road[j].x - road[j - 1].x) * t, y: road[j - 1].y + (road[j].y - road[j - 1].y) * t };
  };
  return Array.from({ length: n }, (_, i) => at(padStart + i * step));
}
function chapterTag(num, name, x, y, cls = "") {
  const t = document.createElement("p");
  t.className = "chapter-tag " + cls;
  const small = document.createElement("small");
  small.textContent = `Ch. ${num}`;
  const b = document.createElement("b");
  b.textContent = name;
  t.append(small, b);
  t.style.left = x + "px";
  t.style.top = y + "px";
  return t;
}
function renderMap() {
  // review hook: ?demoDone=N draws levels 1..N as sorted (look only, nothing is saved)
  const demo = Number(params.get("demoDone")) || 0;
  const a = demo ? { id: demo + 1 } : active();
  const done = new Set(demo ? Array.from({ length: demo }, (_, i) => i + 1) : save.completed);
  const starsOf = (id) => (demo ? 1 + (id % 3) : save.rewards[id]?.stars ?? 0);
  // counts come from real progress: sorted levels, and the stars earned on those levels
  const sorted = catalog.filter((l) => done.has(l.id));
  $("map-progress").textContent = `${sorted.length} of ${catalog.length} sorted`;
  $("map-stars").textContent = `${sorted.reduce((s, l) => s + starsOf(l.id), 0)} / ${catalog.length * 3}`;
  const path = $("map-path");
  const W = Math.min($("phone").clientWidth, 430);
  const g = mapGeometry(W);
  const pts = placeNodes(g.road, catalog.length);
  const arts = MAP_ART.map((name, k) => {
    const im = document.createElement("img");
    im.className = "map-art" + (k > 0 ? " fade-bottom" : "");
    im.src = `art/bakery/${name}.webp`;
    im.alt = "";
    im.decoding = "async";
    Object.assign(im.style, { left: g.secs[k].left + "px", top: g.secs[k].top + "px", width: g.iw + "px", height: g.ih + "px" });
    im.style.setProperty("--fade", g.ov + "px");
    return im;
  });
  // chapter labels sit beside the road at each chapter's first node, on whichever side keeps clear of all nodes
  const hitsNode = (x, y) => pts.some((n) => Math.abs(n.x - x) < TAG_HALF + NODE_R + 4 && Math.abs(n.y - y) < 17 + NODE_R + 6);
  const tags = [], tagSpots = [];
  for (let c = 0; c * 10 < catalog.length; c++) {
    const p = pts[c * 10];
    const first = p.x < W / 2 ? 1 : -1;
    let spot = null;
    for (const dist of [112, 132, 158, 186]) for (const side of [first, -first]) {
      const x = p.x + side * dist;
      if (!spot && x >= TAG_HALF && x <= W - TAG_HALF && !hitsNode(x, p.y)) spot = { x, y: p.y };
    }
    if (!spot) for (const dy of [34, -34, 62, -62]) for (const side of [first, -first]) {
      const x = Math.min(Math.max(p.x + side * 112, TAG_HALF), W - TAG_HALF);
      if (!spot && !hitsNode(x, p.y + dy)) spot = { x, y: p.y + dy };
    }
    spot ??= { x: Math.min(Math.max(p.x + first * 112, TAG_HALF), W - TAG_HALF), y: p.y };
    tagSpots.push(spot);
    tags.push(chapterTag(c + 1, CHAPTERS[c] ?? `Chapter ${c + 1}`, spot.x, spot.y));
  }
  const nodes = catalog.map((lv, i) => {
    const complete = done.has(lv.id);
    const unlocked = lv.id === 1 || complete || done.has(lv.id - 1) || a?.id === lv.id;
    const current = a?.id === lv.id;
    const stars = starsOf(lv.id);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "node " + (current ? "current" : complete ? "done" : unlocked ? "open" : "locked");
    b.style.left = pts[i].x + "px";
    b.style.top = pts[i].y + "px";
    b.disabled = !unlocked;
    const state = current ? "current" : complete ? `completed, ${stars} of 3 stars` : unlocked ? "open" : "locked";
    b.setAttribute("aria-label", `Level ${lv.id}, ${lv.name}, ${state}`);
    const face = document.createElement("span");
    face.className = "node-face";
    if (!unlocked) face.append(icon("lock"));
    else { const num = document.createElement("span"); num.textContent = lv.id; face.append(num); }
    b.append(face);
    if (complete) {
      const row = document.createElement("span");
      row.className = "node-stars";
      row.append(...[1, 2, 3].map((n) => { const s = document.createElement("img"); s.src = "art/bakery/star.webp"; s.alt = ""; s.className = n <= stars ? "on" : "off"; return s; }));
      b.append(row);
    }
    if (current) {
      // Mimi stands beside her node, on the side where she covers no other node
      const pin = document.createElement("img");
      pin.className = "pin";
      pin.src = "art/bakery/chef-wave.webp";
      pin.alt = "";
      pin.width = 26; pin.height = 64;
      const me = pts[i];
      // candidate spots beside the node; take the one farthest from every other node
      const gap = (px, py) => Math.min(...pts.filter((_, j) => j !== i).map((n) => Math.hypot(n.x - Math.min(Math.max(n.x, px - 13), px + 13), n.y - Math.min(Math.max(n.y, py - 32), py + 32))));
      let best = { dx: 36, score: -1 };
      for (const dx of [-34, 34, -52, 52, -70, 70]) for (const dy of [-24, 0, 24]) {
        if (me.x + dx < 20 || me.x + dx > W - 20) continue;
        const onTag = tagSpots.some((t) => Math.abs(t.x - (me.x + dx)) < TAG_HALF + 13 && Math.abs(t.y - (me.y - 14 + dy)) < 17 + 32);
        const score = gap(me.x + dx, me.y - 14 + dy) - Math.abs(dx) * .15 - (onTag ? 100 : 0);
        if (score > best.score) best = { dx, dy, score };
      }
      pin.style.left = `calc(50% + ${best.dx}px)`;
      pin.style.bottom = `${7 - (best.dy ?? 0)}px`;
      b.append(pin);
    }
    b.addEventListener("click", () => chooseLevel(lv));
    return b;
  });
  path.replaceChildren(...arts, ...tags, ...nodes);
  path.style.height = g.height + "px";
  path.style.width = W + "px";
}
async function chooseLevel(lv) {
  const a = active();
  if (a?.id === lv.id && !solved(a.board)) { hideLobby(true); closeDialog($("map-dialog")); return; }
  if (a && a.history.length && !solved(a.board)) {
    const ok = await confirmSheet("Leave this level?", `Your moves on level ${a.id} will be lost.`, "Leave");
    if (!ok) return;
  }
  closeDialog($("map-dialog"), true);
  start(lv);
}
function scrollMapTo(where = "current") {
  const scroller = $("map-scroll");
  const path = $("map-path");
  const cur = path.querySelector(".node.current") || [...path.querySelectorAll(".node.open")].pop() || path.querySelector(".node");
  const max = scroller.scrollHeight - scroller.clientHeight;
  if (where === "start") scroller.scrollTop = max;
  else if (where === "end") scroller.scrollTop = 0;
  else if (where === "middle") scroller.scrollTop = max / 2;
  else if (/^0?\.\d+$/.test(where)) scroller.scrollTop = max * Number(where);   // review hook: fraction from the top
  else if (cur) scroller.scrollTop = parseFloat(cur.style.top) - scroller.clientHeight * .55;
  return cur;
}
function openMap(where = "current") {
  settle();
  renderMap();
  if (openDialog($("map-dialog"))) {
    const cur = scrollMapTo(where);
    if (where === "current") (cur ?? $("map-close")).focus({ preventScroll: true });
  }
}

// -------------------------------------------------------------- lobby ----
// Home screen: the game opens here. PLAY continues the current level (the next one once it is sorted).
function playTarget() {
  const a = active();
  if (a && solved(a.board)) return level(a.id + 1) ?? level(a.id);
  return a ? level(a.id) : catalog[0];
}
function showLobby() {
  const target = playTarget();
  $("lobby-level").textContent = `LEVEL ${target?.id ?? 1}`;
  refreshCoins();
  $("lobby").hidden = false;
  $("lobby-play").focus({ preventScroll: true });
}
// Back to the lobby from the play screen. Progress is already saved after every move, so PLAY resumes it.
function goHome() {
  for (const id of ["win-dialog", "stuck-dialog", "confirm-dialog", "settings-dialog", "map-dialog"]) if ($(id).open) closeDialog($(id), true);
  persist();
  showLobby();
}
function hideLobby(instant = false) {
  const l = $("lobby");
  if (l.hidden) return;
  if (instant || reduced()) { l.hidden = true; return; }
  const an = play(l, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-in" });
  settled(an).then(() => { l.hidden = true; });
}
function playFromLobby() {
  const a = active();
  const target = playTarget();
  if (a && target && target.id !== a.id) { hideLobby(true); start(target); return; }
  hideLobby();
  if (a && !a.history.length) playIntro();
}

// ------------------------------------------------------------- splash ----
const splashStart = performance.now();
function hideSplash() {
  const s = $("splash");
  if (!s || params.get("splash") === "hold") return;
  const left = forceStill ? 0 : Math.max(0, 650 - (performance.now() - splashStart));   // show it long enough to be seen
  setTimeout(() => {
    s.classList.add("gone");
    setTimeout(() => s.remove(), 400);
  }, left);
}

// ----------------------------------------------------------- settings ----
const toggles = [
  ["sound", "Sound", "sound"], ["haptics", "Haptics", "haptics"], ["reduced", "Reduce motion", "motion"],
  ["patterns", "Bold toppings", "patterns"], ["contrast", "High contrast", "contrast"]
];
function renderSettings() {
  const list = $("settings-list");
  list.replaceChildren(...toggles.map(([key, label, ic]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toggle";
    b.setAttribute("role", "switch");
    const unavailable = key === "haptics" && !canVibrate;
    const on = unavailable ? false : save.settings[key] === true;
    b.setAttribute("aria-checked", String(on));
    b.disabled = unavailable;
    const text = document.createElement("span");
    text.className = "toggle-label";
    text.textContent = label + (unavailable ? " (not on this device)" : "");
    const track = document.createElement("span");
    track.className = "track";
    track.append(document.createElement("span"));
    b.append(icon(ic, "icon toggle-icon"), text, track);
    b.addEventListener("click", () => {
      save.settings[key] = !save.settings[key];
      persist();
      b.setAttribute("aria-checked", String(save.settings[key]));
      unlockAudio();
      if (key === "sound" && save.settings.sound) { setSound(true); sound("tap"); }
      if (key === "haptics") { setHaptics(save.settings.haptics); haptic(12); }
      pegSvgs = [];
      layout = null;
      render();
    });
    return b;
  }));
}

// ----------------------------------------------------------------- misc ----
let toastTimer = 0;
function toast(text) {
  const t = $("toast");
  if (!t) return;
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}

function wire() {
  $("map-close").append(icon("close"));
  $("settings-close").append(icon("close"));
  for (const el of document.querySelectorAll("#home, .home-face, .stuck-home")) el.prepend(icon("home"));
  $("note-close").append(icon("close", "icon icon-sm"));
  $("rotate-icon").append(icon("rotate", "icon rotate-glyph"));
  $("guide").append(svgEl("svg", { viewBox: "0 0 40 44", class: "guide-arrow", "aria-hidden": "true" }, [
    svgEl("path", { d: "M12 4h16v17h9L20 40 3 21h9z", fill: "#FFD36A", stroke: "#7A4416", "stroke-width": 3, "stroke-linejoin": "round" }),
    svgEl("path", { d: "M16 8h5v12", fill: "none", stroke: "#FFF6D0", "stroke-width": 2.5, "stroke-linecap": "round" })
  ]));
  $("undo").addEventListener("click", undo);
  $("hint").addEventListener("click", useHint);
  $("add-peg").addEventListener("click", buyPegFromBar);
  $("restart").addEventListener("click", async () => {
    settle();
    const a = active();
    if (a.history.length && !solved(a.board)) {
      const ok = await confirmSheet("Restart this level?", "The donuts go back to where they started.", "Restart");
      if (!ok) return;
    }
    start(level(a.id) ?? { ...a, board: a.initial });
  });
  $("map-open").addEventListener("click", () => { closeDialog($("settings-dialog"), true); openMap(); });
  $("lobby-play").addEventListener("click", () => { unlockAudio(); playFromLobby(); });
  $("lobby-levels").addEventListener("click", () => openMap());
  $("lobby-settings").addEventListener("click", () => { renderSettings(); openDialog($("settings-dialog")); });
  $("win-replay").addEventListener("click", () => afterWin(() => start(level(active().id))));
  $("home").addEventListener("click", async () => {
    settle();
    const a = active();
    if (a?.history.length && !solved(a.board)) {
      const ok = await confirmSheet("Leave this level?", "Your progress is saved. Play picks up where you left off.", "Leave");
      if (!ok) return;
    }
    goHome();
  });
  $("win-home").addEventListener("click", () => afterWin(goHome));
  $("stuck-home").addEventListener("click", goHome);
  $("settings-close").addEventListener("click", () => closeDialog($("settings-dialog")));
  $("settings-done").addEventListener("click", () => closeDialog($("settings-dialog")));
  $("map-close").addEventListener("click", () => closeDialog($("map-dialog")));
  $("win-levels").addEventListener("click", () => afterWin(() => { closeDialog($("win-dialog"), true); openMap(); }));
  $("stuck-rewind").addEventListener("click", () => armed("stuck-rewind", doRewind));
  $("stuck-peg").addEventListener("click", () => armed("stuck-peg", () => doPeg("stuck")));
  $("stuck-restart").addEventListener("click", () => { track("stuck_action", { type: "restart" }); closeDialog($("stuck-dialog"), true); start(level(active().id) ?? { ...active(), board: active().initial }); });
  $("stuck-coins").addEventListener("click", openCoins);
  $("coins-back").addEventListener("click", () => closeDialog($("coins-dialog")));
  $("pay-dialog").addEventListener("cancel", () => { payClose(); });
  $("confirm-ok").addEventListener("click", () => answerConfirm(true));
  $("confirm-cancel").addEventListener("click", () => answerConfirm(false));
  $("confirm-dialog").addEventListener("cancel", () => { confirmResolve?.(false); confirmResolve = null; });
  for (const id of ["win-dialog", "chest-dialog", "gift-dialog", "welcome-dialog"]) $(id).addEventListener("cancel", (e) => e.preventDefault());
  $("stuck-dialog").addEventListener("cancel", (e) => e.preventDefault());
  buildGiftDays();
  $("note-restart").addEventListener("click", () => { versionNote = null; start(level(active().id)); });
  $("note-close").addEventListener("click", () => { versionNote = null; updateNote(); });
  for (const d of document.querySelectorAll("dialog")) {
    d.addEventListener("close", () => setTimeout(maybeGift, 300));
    d.addEventListener("click", (e) => { if (e.target === d && (d.id === "settings-dialog" || d.id === "map-dialog")) closeDialog(d); });
  }
  // interruption safety: finish all motion at once; the state is already saved
  const flush = () => { settle(); confettiClear(); };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
    else refreshVersion();
  });
  window.addEventListener("pagehide", flush);
  window.addEventListener("pointerdown", unlockAudio, { once: true });
  let resizeRaf = 0;
  const onResize = () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      if (!active()) return;
      const ph = $("phone");
      if (layout && layout.w === ph.clientWidth && layout.h === ph.clientHeight) return;
      settle();
      layout = null;
      render();
      document.querySelectorAll("dialog[open]").forEach(placeDialog);
    });
  };
  new ResizeObserver(onResize).observe($("phone"));
  window.addEventListener("resize", onResize);
  for (const q of ["(prefers-reduced-motion: reduce)", "(prefers-contrast: more)"]) matchMedia(q).addEventListener?.("change", () => { pegSvgs = []; render(); });
}
function confettiClear() { $("fx-top").replaceChildren(); }

function undo() {
  settle();
  const a = active();
  if (!a.history.length || solved(a.board) || isStuck()) return;   // on a stuck board only Rewind goes back
  const plan = eco.undoPlan(a.id, a, false);
  if (plan.kind !== "pay") return applyUndo("one");
  const coins = save.wallet.coins;
  openPay({
    title: coins < plan.price ? "Not enough coins" : "Out of free Undos",
    text: coins < plan.price ? `An Undo costs ${fmt(plan.price)} coins. You can restart for free.` : "Take back this move?",
    poor: coins < plan.price,
    restart: true,
    options: [
      { label: "Undo once", price: plan.price, disabled: coins < plan.price, run: () => applyUndo("one") },
      { label: "3 Undos", price: plan.pack, disabled: coins < plan.pack, run: () => applyUndo("pack") }
    ]
  });
}
function applyUndo(choice) {
  const a = active();
  if (!a.history.length || solved(a.board) || isStuck()) return;
  const res = eco.takeUndo(save, a.id, a, false, choice);
  if (!res.ok) { toast("Not enough coins for an Undo."); return; }
  a.board = a.history.pop();
  selection = null; marks = null;
  persist();
  refreshCoins();
  if (res.spent) track("booster_used", { type: "undo", price: res.spent });
  say(lines.undo, 1600);
  render();
}
function validActive(a) {
  return a && catalog.some((l) => l.id === a.id) && typeof a.name === "string" && typeof a.attemptId === "string" &&
    !validateBoard(a.initial) && stuckLib.validLive(a.board) && Array.isArray(a.history) &&
    a.history.every((b) => stuckLib.validLive(b) && b.length === a.board.length) && a.board.length === a.initial.length + (a.eco?.peg ? 1 : 0);
}

async function fetchLevels() {
  const response = await fetch("api/levels.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load levels");
  const data = await response.json();
  const list = (data.levels || []).map((l) => ({ ...l, version: Number.isInteger(l.version) ? l.version : 1 }));
  return { list, contentVersion: data.contentVersion ?? null };
}
function checkVersion() {
  const a = active();
  const lv = a && level(a.id);
  versionNote = lv && (a.version ?? 1) !== lv.version && !solved(a.board) ? { from: a.version, to: lv.version } : null;
  updateNote();
}
async function refreshVersion() {
  try {
    const { list, contentVersion } = await fetchLevels();
    catalog = list;
    save.contentVersion = contentVersion;
    checkVersion();
  } catch { /* offline: keep playing */ }
}

async function boot() {
  installSprite();
  wire();
  const ins = params.get("insets");
  if (ins) {
    const [t, b] = ins.split(",").map(Number);
    document.documentElement.style.setProperty("--sat", (t || 0) + "px");
    document.documentElement.style.setProperty("--sab", (b || 0) + "px");
  }
  const { list, contentVersion } = await fetchLevels();
  await loadMapRoads();
  catalog = list;
  save.contentVersion = contentVersion;
  save.completed = [...new Set(save.completed)].filter((id) => catalog.some((l) => l.id === id));
  const a = save.active;
  if (a && !a.attemptId) a.attemptId = uuid();
  if (a && a.version == null) a.version = 1;
  // review hooks (owner / screenshots): ?level=N starts a fresh attempt of level N;
  // ?preview=win|stuck shows that screen for the current board without changing progress
  const pick = level(Number(params.get("level")));
  const preview = params.get("preview");
  const screen = params.get("screen");              // review hooks: play | map | (default: lobby)
  const toLobby = !pick && !preview && screen !== "play" && screen !== "map";
  if (pick) start(pick, { intro: false });
  else if (validActive(a)) {
    persist();
    render();
    checkVersion();
  } else {
    const first = catalog.find((l) => !save.completed.includes(l.id)) ?? catalog[0];
    start(first, { intro: !toLobby });
  }
  document.documentElement.classList.add("ready");
  if (toLobby) showLobby();
  if (screen === "map") { openMap(params.get("at") || "current"); }
  if (preview === "win") { settle(); const st = Number(params.get("stars")) || 3; openWin({ stars: st, moves: 14, par: 12, firstClear: true, coins: eco.firstClearCoins(st) }); }
  else if (preview === "stuck") {
    settle(); stuckKey = boardKey();
    if (params.get("rewind") === "1") { marks = { key: boardKey(), kind: "bad", from: 0, to: 1 }; render(); }   // sample ghost of the wrong move
    openStuck(true);
  }   // review only: counts nothing
  hideSplash();
  refreshCoins();
  persist();
  if (!forceStill && !pick && !preview && !screen && params.get("flow") !== "off") launchFlow();
  // review hooks: ?preview=chest&n=1 | gift&day=3 | welcome show the screen with sample numbers, nothing is paid
  if (preview === "chest") showChest({ chapter: Number(params.get("n")) || 1, coins: eco.chestCoins(Number(params.get("n")) || 1), hints: 1 });
  else if (preview === "gift") { const day = Math.min(7, Math.max(1, Number(params.get("day")) || 3)); showGift({ day, coins: eco.DAILY_COINS[day - 1] }); }
  else if (preview === "welcome") showWelcome({ levels: 14, levelCoins: 240, chests: [{ chapter: 1, coins: 50 }], hints: 1, start: 100, total: 390 });
  // screenshots wait for `html.shot-ready`: fades are over and the painted art is decoded
  if (forceStill) Promise.all([...document.images].map((im) => im.decode?.().catch(() => {}))).then(() => setTimeout(() => document.documentElement.classList.add("shot-ready"), 400));
  if (!storageOk) toast("Progress can’t be saved in this browser, but you can keep playing.");
}

// test hooks (read-only views of state; no rules bypass)
window.candleSort = {
  state: () => JSON.parse(JSON.stringify({ save, selection, busy, celebrating })),
  layout: () => layout,
  events: () => events.slice(),
  settle
};

boot().catch((error) => {
  console.warn(error);
  $("level-title").textContent = "The bakery is unavailable";
  $("instruction").hidden = false;
  $("instruction-text").textContent = "Open Ring Sort using Start Ring Sort.command, then reload this page.";
  $("announce").textContent = $("instruction-text").textContent;
  document.documentElement.classList.add("ready");
  hideSplash();
});
