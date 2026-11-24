// Ring Sort cloud save client (docs/team/22, P1-C). Offline first: the game never waits for this file.
// Pure of the DOM and of globals: everything it touches is injected, so tests run it with a fake fetch,
// storage and clock.  createSync({ fetch, storage, now, setTimer, apiBase, random }, hooks)
//   setTimer(fn, ms) -> cancel function      random() -> a uuid string
//   hooks (all optional): getSave, persist, canSend, canApply, onApplied, onStatus, toast, hasLevel
// candle-sort-v2 is written ONLY by hooks.persist() (the game's own persist); this file never writes it.
// No coin amount lives here: amounts come from economy.mjs or from the server.
import * as eco from "./economy.mjs";

export const GUEST_KEY = "candle-sort-guest-v1";
export const SYNC_KEY = "candle-sort-sync-v1";
export const MAX_EVENTS = 100;
export const MAX_BYTES = 48000;
export const DEBOUNCE_MS = 5000;
export const PERIODIC_MS = 60000;
export const BACKOFF_MS = [5000, 15000, 60000, 300000];
const SETTING_KEYS = ["sound", "haptics", "reduced", "patterns", "contrast"];
const DEFAULT_SETTINGS = { sound: true, haptics: true, reduced: false, patterns: false, contrast: false };
const KINDS = ["start", "attempt", "retro", "chest", "gift", "pity", "spend", "buy", "use"];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const UUID_KEY = /^[0-9a-f-]{36}$/;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
const iso = (ms) => new Date(ms).toISOString();
const bytes = (text) => new TextEncoder().encode(text).length;
const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };
const emptyOutbox = () => ({ progress: [], ledger: [], settings: null });
const emptyState = () => ({ v: 1, cursor: 0, cursorUser: null, outbox: emptyOutbox(), lastOkAt: 0,
  known: {}, sentProgress: {}, localOnly: {}, settingsSent: null, settingsUpdatedAt: "" });

// a stable uuid-shaped id for a local ledger key (the server wants spend:<uuid>); not secret, only an idempotency key
export function uuidFromKey(text) {
  let out = "";
  for (let seed = 0; seed < 4; seed++) {
    let h = (0x811c9dc5 ^ (seed * 0x9e3779b1)) >>> 0;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
}

// ---- local ledger key -> server event ----
// The local ledger (economy.mjs) keeps its own key shapes; the server wants the spec shapes. One table, here.
// Returns { ev, d } (an event with its local wallet delta [coins, hints, pegs]), { local, d } for grants the
// server has no kind for, or null (nothing to sync, e.g. free actions and stuck counters).
export function mapLedger(lk, v, save) {
  const val = isInt(v) && v > 0 ? v : 0;
  let m;
  if (lk === "retro:start") return { ev: { kind: "start", key: "start" }, d: [val, 0, 0] };
  if ((m = /^retro:(\d{1,4})$/.exec(lk))) {
    const id = Number(m[1]);
    return id >= 1 ? { ev: { kind: "retro", key: lk, levelId: id, stars: eco.storedStars(save, id) }, d: [val, 0, 0] } : null;
  }
  if ((m = /^chest:(\d{1,3})$/.exec(lk))) return { ev: { kind: "chest", key: lk }, d: [val, eco.chestReward(Number(m[1])).hints, 0] };
  if ((m = /^daily:(\d{4}-\d{2}-\d{2})$/.exec(lk))) return { ev: { kind: "gift", key: `gift:${m[1]}` }, d: [val, 0, 0] };
  if ((m = /^pity:peg:L(\d{1,4})$/.exec(lk))) return { ev: { kind: "pity", key: `pity:${Number(m[1])}:peg` }, d: [0, 0, Math.max(1, val)] };
  if ((m = /^attempt:(.+)$/.exec(lk))) {
    if (!UUID_KEY.test(lk.slice(8))) return null;
    const a = save.active;
    let info = null;
    if (a && a.attemptId === m[1] && a.result && isInt(a.result.stars)) info = { levelId: a.id, stars: a.result.stars };
    else for (const [id, r] of Object.entries(save.rewards ?? {})) if (r && r.attemptId === m[1]) info = { levelId: Number(id), stars: r.stars };
    if (!info || !isInt(info.levelId) || !(info.stars >= 1 && info.stars <= 3)) return null;
    return { ev: { kind: "attempt", key: lk, ...info }, d: [val, 0, 0] };
  }
  if (lk === "gift:hint:L12") return { local: true, d: [0, Math.max(1, val), 0] };
  if (lk === "gift:peg:L15") return { local: true, d: [0, 0, Math.max(1, val)] };
  // boosters: coins > 0 is a spend on the spot; 0 on hint / peg is a wallet token used; other zeros were free
  const item = /^hint:/.test(lk) ? "hint" : /^peg:/.test(lk) ? "peg" : /^undopack:/.test(lk) ? "undo_pack" : /^undo:/.test(lk) ? "undo" : /^rewind:/.test(lk) ? "rewind" : null;
  if (!item) return null;
  if (val > 0) return { ev: { kind: "spend", key: `spend:${uuidFromKey(lk)}`, item }, d: [-val, 0, 0] };
  if (item === "hint") return { ev: { kind: "use", key: `use:${uuidFromKey(lk)}`, item }, d: [0, -1, 0] };
  if (item === "peg") return { ev: { kind: "use", key: `use:${uuidFromKey(lk)}`, item }, d: [0, 0, -1] };
  return null;
}
// server ledger row -> local ledger key and stored value (so a pulled start / retro / chest / gift row marks that grant as paid)
function localKeyOf(row) {
  const { key, kind } = row;
  if (kind === "start") return ["retro:start", row.dCoins];
  if (kind === "retro" || kind === "chest" || kind === "attempt") return [key, row.dCoins];
  if (kind === "gift") { const m = /^gift:(\d{4}-\d{2}-\d{2})$/.exec(key); return m ? [`daily:${m[1]}`, row.dCoins] : null; }
  if (kind === "pity") { const m = /^pity:(\d{1,4}):peg$/.exec(key); return m ? [`pity:peg:L${m[1]}`, row.dPegs] : null; }
  return null;   // spend / buy / use: local keys cannot be rebuilt and nothing local depends on them
}

// ---- batch building: <= 100 events and <= 48,000 bytes of JSON; the rest stays in the outbox ----
export function buildBatch(outbox, { deviceId, cursor }, { maxEvents = MAX_EVENTS, maxBytes = MAX_BYTES } = {}) {
  const body = { deviceId, cursor, progress: [], ledger: [] };
  if (outbox.settings) body.settings = outbox.settings;
  const sent = { progress: [], ledger: [], settings: !!outbox.settings };
  let count = 0;
  const add = (list, item) => {
    if (count >= maxEvents) return false;
    list.push(item);
    if (bytes(JSON.stringify(body)) > maxBytes) { list.pop(); return false; }
    count++;
    return true;
  };
  for (const p of outbox.progress) { if (!add(body.progress, p)) break; sent.progress.push(p.levelId); }
  for (const e of outbox.ledger) {
    const { src, d, ...wire } = e;
    if (!add(body.ledger, wire)) break;
    sent.ledger.push(e.key);
  }
  return { body, sent, count };
}

// balance = server wallet (display-clamped) + events still in the outbox + grants the server does not know (4.1)
export function balance(serverWallet, outbox, localOnly = {}) {
  const sum = [0, 0, 0];
  for (const e of outbox?.ledger ?? []) if (Array.isArray(e.d)) for (let i = 0; i < 3; i++) sum[i] += e.d[i] || 0;
  for (const d of Object.values(localOnly)) if (Array.isArray(d)) for (let i = 0; i < 3; i++) sum[i] += d[i] || 0;
  const w = serverWallet ?? {};
  const fix = (v, extra, cap) => Math.min(cap, Math.max(0, (isInt(v) ? v : 0) + extra));
  return { coins: fix(w.coins, sum[0], eco.COIN_CAP), hints: fix(w.hints, sum[1], eco.TOKEN_CAP), pegs: fix(w.pegs, sum[2], eco.TOKEN_CAP) };
}

// ---- applyPull (4.6): the one place pulled data enters the local save ----
// Builds the new values in memory, then assigns them. Never touches save.active, never raises a win / chest / welcome.
// opts: { outbox, localOnly, hasLevel, now, settingsUpdatedAt }.  Malformed rows are skipped, never thrown.
export function applyPull(save, reply, opts = {}) {
  const out = { levels: 0, rows: 0, settingsUpdatedAt: null, wallet: false };
  if (!isObj(save) || !isObj(reply)) return out;
  const hasLevel = opts.hasLevel ?? ((id) => isInt(id) && id >= 1 && id <= 1000);
  const now = opts.now ?? Date.now();
  const completed = Array.isArray(save.completed) ? [...save.completed] : [];
  const rewards = { ...(isObj(save.rewards) ? save.rewards : {}) };
  const base = isObj(save.wallet) ? save.wallet : eco.newWallet();
  const wallet = { ...base, ledger: { ...(isObj(base.ledger) ? base.ledger : {}) } };
  const have = new Set(completed);

  for (const p of Array.isArray(reply.progress) ? reply.progress : []) {
    if (!isObj(p) || !isInt(p.levelId) || !hasLevel(p.levelId) || !isInt(p.stars) || p.stars < 1 || p.stars > 3) continue;
    const bm = isInt(p.bestMoves) && p.bestMoves >= 1 && p.bestMoves <= 5000 ? p.bestMoves : null;
    const at = typeof p.clearedAt === "string" && !Number.isNaN(Date.parse(p.clearedAt)) ? p.clearedAt : iso(now);
    if (!have.has(p.levelId)) { completed.push(p.levelId); have.add(p.levelId); out.levels++; }
    const old = rewards[p.levelId];
    if (!isObj(old)) {
      rewards[p.levelId] = { attemptId: null, stars: p.stars, contentVersion: null, at, fromCloud: true, best: p.stars, ...(bm ? { bestMoves: bm } : {}) };
    } else {
      const next = { ...old, stars: Math.max(eco.storedStars({ rewards: { [p.levelId]: old } }, p.levelId), p.stars) };
      next.best = Math.max(isInt(old.best) ? old.best : 0, next.stars);
      const mine = isInt(old.bestMoves) ? old.bestMoves : null;
      const best = mine === null ? bm : bm === null ? mine : Math.min(mine, bm);
      if (best !== null) next.bestMoves = best;
      rewards[p.levelId] = next;
    }
    out.rows++;
  }

  for (const r of Array.isArray(reply.ledger) ? reply.ledger : []) {
    if (!isObj(r) || typeof r.key !== "string" || r.key.length > 120 || !KINDS.includes(r.kind)) continue;
    if (![r.dCoins, r.dHints, r.dPegs].every((n) => isInt(n))) continue;
    const mapped = localKeyOf(r);
    if (mapped && wallet.ledger[mapped[0]] !== mapped[1]) wallet.ledger[mapped[0]] = mapped[1];   // new key, or a re-priced row replaces the local one
    out.rows++;
  }

  const w = reply.wallet;
  if (isObj(w) && [w.coins, w.hints, w.pegs].every((n) => isInt(n) && n >= 0)) {
    Object.assign(wallet, balance(w, opts.outbox, opts.localOnly));
    out.wallet = true;
  }

  const s = reply.settings;
  if (isObj(s) && isObj(s.data) && typeof s.updatedAt === "string" && !Number.isNaN(Date.parse(s.updatedAt)) && Date.parse(s.updatedAt) > Date.parse(opts.settingsUpdatedAt || 0)) {
    const nextSettings = { ...(isObj(save.settings) ? save.settings : {}) };
    let any = false;
    for (const k of SETTING_KEYS) if (typeof s.data[k] === "boolean") { nextSettings[k] = s.data[k]; any = true; }
    if (any) { save.settings = nextSettings; out.settingsUpdatedAt = s.updatedAt; }
  }

  save.completed = completed;
  save.rewards = rewards;
  save.wallet = wallet;
  return out;
}

const subOf = (token) => {
  try {
    const part = String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const sub = JSON.parse(atob(part + "=".repeat((4 - (part.length % 4)) % 4))).sub;
    return typeof sub === "string" ? sub : null;
  } catch { return null; }
};

export function createSync(deps, hooks = {}) {
  const { fetch: doFetch, storage, now, setTimer, random } = deps;
  const apiBase = String(deps.apiBase ?? "").replace(/\/+$/, "");
  const canSend = hooks.canSend ?? (() => true);
  const canApply = hooks.canApply ?? (() => true);
  let guest = null, S = null, disabled = false, started = false;
  let cloud = null;                 // null = config not read yet, true / false after
  let busy = false, flushing = false, waiting = false;
  let failures = 0, retryAt = 0, offline = false;
  let pending = null;               // a reply that arrived but waits for an idle moment: { reply, sent, pulled }
  let cancelDebounce = null, cancelPeriodic = null, pulledThisRun = false, periodicOn = false;

  const notify = () => { try { hooks.onStatus?.(status()); } catch { /* never break the game */ } };
  const mine = () => { try { return hooks.getSave?.() ?? null; } catch { return null; } };

  // ---- ids and stored state ----
  function init() {
    if (S || disabled) return;
    try {
      if (!storage) throw new Error("no storage");
      let g = parse(storage.getItem(GUEST_KEY));
      if (!isObj(g) || typeof g.guestId !== "string" || typeof g.deviceId !== "string") {
        g = { guestId: random(), deviceId: random(), token: null, tokenExp: 0 };
        storage.setItem(GUEST_KEY, JSON.stringify(g));
      }
      guest = g;
      const st = parse(storage.getItem(SYNC_KEY));
      S = { ...emptyState(), ...(isObj(st) ? st : {}) };
      S.outbox = { ...emptyOutbox(), ...(isObj(S.outbox) ? S.outbox : {}) };
      for (const k of ["known", "sentProgress", "localOnly"]) if (!isObj(S[k])) S[k] = {};
      for (const k of ["progress", "ledger"]) if (!Array.isArray(S.outbox[k])) S.outbox[k] = [];
    } catch { disabled = true; S = null; guest = null; }
  }
  const saveGuest = () => { try { storage.setItem(GUEST_KEY, JSON.stringify(guest)); return true; } catch { disabled = true; return false; } };
  const saveState = () => { try { storage.setItem(SYNC_KEY, JSON.stringify(S)); return true; } catch { return false; } };

  // a fresh guest: new ids, the server record is empty, so everything local is announced again
  function newGuest() {
    guest = { guestId: random(), deviceId: random(), token: null, tokenExp: 0 };
    S.cursor = 0; S.cursorUser = null; S.known = {}; S.sentProgress = {}; S.lastOkAt = 0;
    for (const e of S.outbox.ledger) S.known[e.key] = 1;   // events already waiting stay as they are
    saveGuest(); saveState();
  }

  // ---- outbox: events are derived from the save at every persist ----
  function collect(save) {
    if (!S || !isObj(save) || !isObj(save.wallet)) return;
    const led = isObj(save.wallet.ledger) ? save.wallet.ledger : {};
    const keep = [];
    for (const e of S.outbox.ledger) {   // a refunded hint disappears from the ledger before it was ever sent
      if (e.src && !(e.src in led)) delete S.known[e.key]; else keep.push(e);
    }
    S.outbox.ledger = keep;
    for (const [lk, v] of Object.entries(led)) {
      const m = mapLedger(lk, v, save);
      if (!m) continue;
      if (m.local) { if (!(lk in S.localOnly)) S.localOnly[lk] = m.d; continue; }
      if (S.known[m.ev.key]) continue;
      S.known[m.ev.key] = 1;
      S.outbox.ledger.push({ ...m.ev, src: lk, d: m.d });
    }
    for (const id of eco.clearedIds(save)) {
      const r = save.rewards?.[id];
      const stars = eco.storedStars(save, id);
      const bm = isInt(r?.bestMoves) ? r.bestMoves : null;
      const sig = `${stars}|${bm}`;
      if (S.sentProgress[id] === sig) continue;
      S.sentProgress[id] = sig;
      S.outbox.progress = S.outbox.progress.filter((p) => p.levelId !== id);
      const at = typeof r?.at === "string" && ISO.test(r.at) ? r.at : iso(now());
      S.outbox.progress.push({ levelId: id, stars, bestMoves: bm, clearedAt: at });
    }
    const cur = {};
    for (const k of SETTING_KEYS) cur[k] = typeof save.settings?.[k] === "boolean" ? save.settings[k] : DEFAULT_SETTINGS[k];
    const text = JSON.stringify(cur);
    if (S.settingsSent === null) {
      S.settingsSent = text;
      if (text !== JSON.stringify(DEFAULT_SETTINGS)) { S.settingsUpdatedAt = iso(now()); S.outbox.settings = { data: cur, updatedAt: S.settingsUpdatedAt }; }
    } else if (text !== S.settingsSent) {
      S.settingsSent = text;
      S.settingsUpdatedAt = iso(now());
      S.outbox.settings = { data: cur, updatedAt: S.settingsUpdatedAt };
    }
  }
  const dirty = () => !!S && (S.outbox.progress.length > 0 || S.outbox.ledger.length > 0 || !!S.outbox.settings);

  // ---- http ----
  async function call(path, { method = "GET", body, keepalive = false } = {}) {
    const headers = {};
    if (guest?.token) headers.authorization = `Bearer ${guest.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const init = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (keepalive) init.keepalive = true;
    const res = await doFetch(apiBase + path, init);
    let json = null;
    try { json = await res.json(); } catch { /* empty or not json */ }
    return { status: res.status, ok: !!res.ok, json };
  }
  const fail = (res) => Object.assign(new Error(`http ${res.status}`), { status: res.status });

  async function ensureSession(force = false) {
    const fresh = guest.token && guest.tokenExp * 1000 > now() + 86400000;
    if (fresh && !force) return;
    for (let tries = 0; tries < 2; tries++) {
      const res = await call("/api/session", { method: "POST", body: { guestId: guest.guestId, deviceId: guest.deviceId, platform: deps.platform ?? "web" } });
      if (res.ok && res.json?.token) {
        guest.token = res.json.token; guest.tokenExp = Number(res.json.exp) || 0; guest.userId = res.json.userId ?? subOf(res.json.token);
        saveGuest();
        return;
      }
      if (res.status === 401) { guest.token = null; newGuest(); continue; }   // needs_recovery: a new guest, local progress still uploads
      throw fail(res);
    }
    throw new Error("session");
  }
  const currentUser = () => subOf(guest.token) ?? guest.userId ?? null;
  const needsFullPull = () => S.cursorUser === null || S.cursorUser !== currentUser();

  // ---- processing a reply: the only place the outbox shrinks and the cursor moves ----
  // p = { reply, sent }. Returns true when applied, false when it must be repeated (cursor and outbox untouched).
  function process({ reply, sent }) {
    if (reply.resetCursor) { S.cursor = 0; S.cursorUser = null; saveState(); return false; }   // pull everything first, outbox untouched
    const save = mine();
    const rejected = Array.isArray(reply.rejected) ? reply.rejected.filter((r) => isObj(r) && typeof r.key === "string") : [];
    const rejKeys = new Set(rejected.map((r) => r.key));
    const sentKeys = new Set(sent?.ledger ?? []);
    const next = {
      progress: S.outbox.progress.filter((p) => !(sent?.progress ?? []).includes(p.levelId) && !rejKeys.has(`progress:${p.levelId}`)),
      ledger: S.outbox.ledger.filter((e) => !sentKeys.has(e.key) && !rejKeys.has(e.key)),
      settings: sent?.settings ? null : S.outbox.settings
    };
    const localOnly = { ...S.localOnly };
    for (const r of rejected) {   // a token that was a local gift cannot be used on the server: that use stays local
      const e = S.outbox.ledger.find((x) => x.key === r.key);
      if (e && e.kind === "use" && r.reason === "insufficient") localOnly[e.src ?? e.key] = e.d;
    }
    let summary = null;
    if (save) {
      const view = { ...save };
      summary = applyPull(view, reply, { outbox: next, localOnly, hasLevel: hooks.hasLevel, now: now(), settingsUpdatedAt: S.settingsUpdatedAt });
      Object.assign(save, view);
      if (hooks.persist && hooks.persist() === false) return false;   // not saved: the cursor stays, the pull repeats
    }
    S.outbox = next; S.localOnly = localOnly;
    if (summary?.settingsUpdatedAt) {
      S.settingsUpdatedAt = summary.settingsUpdatedAt;
      S.settingsSent = JSON.stringify(Object.fromEntries(SETTING_KEYS.map((k) => [k, typeof save.settings[k] === "boolean" ? save.settings[k] : DEFAULT_SETTINGS[k]])));
    }
    if (save) for (const p of Array.isArray(reply.progress) ? reply.progress : []) {   // pulled rows are not echoed back
      if (isObj(p) && isInt(p.levelId)) S.sentProgress[p.levelId] = `${eco.storedStars(save, p.levelId)}|${isInt(save.rewards?.[p.levelId]?.bestMoves) ? save.rewards[p.levelId].bestMoves : null}`;
    }
    for (const r of Array.isArray(reply.ledger) ? reply.ledger : []) if (isObj(r) && typeof r.key === "string") S.known[r.key] = 1;
    if (isInt(reply.rev) && !reply.hasMore) { S.cursor = reply.rev; S.cursorUser = reply.userId ?? currentUser(); }
    S.lastOkAt = now();
    if (reply.token) { guest.token = reply.token; guest.tokenExp = Number(reply.tokenExp) || guest.tokenExp; saveGuest(); }
    saveState();
    for (const r of rejected) if (r.reason === "bad_proof" || r.reason === "no_progress") hooks.telemetry?.("sync_rejected", { reason: r.reason });
    if (rejected.length) hooks.toast?.("Balance updated");   // at most one per sync
    if (summary && (summary.levels || summary.rows || summary.wallet)) { try { hooks.onApplied?.(summary); } catch { /* never break the game */ } }
    return true;
  }
  // a reply that arrived while a level is open waits in memory; the outbox is cleared only when it is processed
  function settle() {
    if (!pending || !canApply()) return;
    const p = pending;
    pending = null;
    process(p);
  }
  const deliver = (p) => { pulledThisRun = true; if (canApply()) { if (!process(p)) throw new Error("not applied"); } else pending = p; };

  // ---- one cycle: config, session, pull if needed, then push ----
  async function probe() {
    const res = await call("/api/config");
    if (!res.ok || !isObj(res.json)) throw fail(res);
    cloud = res.json.cloudSave === true;
  }
  async function step(depth = 0) {
    if (cloud === null) await probe();
    if (!cloud) return;
    await ensureSession();
    settle();
    if (pending) return;           // a reply still waits for the level select: do not send over it
    const save = mine();
    if (save) collect(save);
    try {
      if (needsFullPull()) {
        const merged = await pullPages(0, { progress: [], ledger: [], settings: null, wallet: null, rev: 0, userId: null });
        deliver({ reply: merged, sent: null });
        if (pending) return;
      }
      for (let guard = 0; guard < 50 && dirty(); guard++) {
        if (!canSend()) return;
        const batch = buildBatch(S.outbox, { deviceId: guest.deviceId, cursor: S.cursor });
        const res = await call("/api/sync", { method: "POST", body: batch.body });
        if (res.status === 401) throw Object.assign(fail(res), { auth: res.json?.error ?? "unauthorized" });
        if (!res.ok || !isObj(res.json)) throw fail(res);
        if (res.json.resetCursor) { S.cursor = 0; S.cursorUser = null; saveState(); if (depth < 2) return step(depth + 1); throw new Error("cursor reset loop"); }
        const reply = res.json.hasMore ? await pullPages(res.json.rev, { ...res.json }) : res.json;
        deliver({ reply, sent: batch.sent });
        if (pending) return;
      }
      if (!pulledThisRun && !dirty()) {   // nothing to push: one pull per launch picks up other devices' changes
        pulledThisRun = true;
        const merged = await pullPages(S.cursor, { progress: [], ledger: [], settings: null, wallet: null, rev: S.cursor, userId: S.cursorUser });
        deliver({ reply: merged, sent: null });
      }
    } catch (error) {
      if (!error.auth) throw error;
      if (error.auth === "needs_recovery") { guest.token = null; newGuest(); } else await ensureSession(true);
      if (depth < 2) return step(depth + 1);
      throw error;
    }
  }
  // GET /api/sync?cursor= page after page until hasMore is false; the pages are merged into one reply
  async function pullPages(from, merged) {
    let cursor = from;
    merged.progress = [...(merged.progress ?? [])]; merged.ledger = [...(merged.ledger ?? [])];
    merged.hasMore = false;
    for (let page = 0; page < 200; page++) {
      const res = await call(`/api/sync?cursor=${cursor}`);
      if (res.status === 401) throw Object.assign(fail(res), { auth: res.json?.error ?? "unauthorized" });
      if (!res.ok || !isObj(res.json)) throw fail(res);
      const j = res.json;
      merged.progress.push(...(Array.isArray(j.progress) ? j.progress : []));
      merged.ledger.push(...(Array.isArray(j.ledger) ? j.ledger : []));
      if (j.settings) merged.settings = j.settings;
      if (j.wallet) merged.wallet = j.wallet;
      if (j.token) { merged.token = j.token; merged.tokenExp = j.tokenExp; }
      merged.rev = isInt(j.rev) ? j.rev : merged.rev;
      merged.userId = j.userId ?? merged.userId;
      if (!j.hasMore) return merged;
      if (!isInt(j.rev) || j.rev <= cursor) throw new Error("cursor did not advance");
      cursor = j.rev;
    }
    throw new Error("too many pages");
  }

  async function run() {
    if (disabled || busy || cloud === false) return;
    if (cloud === null) {
      try { if (!storage) throw new Error("no storage"); storage.getItem(GUEST_KEY); } catch { disabled = true; return; }   // no storage, no cloud save, no call
      // the release flag first: with cloud save off nothing is stored, nothing but this one GET is sent
      if (now() < retryAt) { arm(retryAt - now()); return; }
      busy = true;
      try { await probe(); failures = 0; retryAt = 0; }
      catch { failures++; const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]; retryAt = now() + wait; arm(wait); return; }
      finally { busy = false; }
      if (cloud !== true) return;
    }
    init();
    if (disabled || !S) return;
    if (!periodicOn) { periodicOn = true; const save = mine(); if (save) collect(save); saveState(); periodic(); }
    if (!canSend()) { waiting = true; return; }
    if (now() < retryAt) { arm(retryAt - now()); return; }
    waiting = false;
    busy = true;
    try {
      await step();
      failures = 0; retryAt = 0; offline = false;
    } catch (error) {
      offline = !error?.status || error.status >= 500 || error.status === 429;
      failures++;
      const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1];
      retryAt = now() + wait;
      arm(wait);
    } finally { busy = false; notify(); }
    if (!disabled && cloud && dirty() && !pending && !retryAt) arm(DEBOUNCE_MS);   // leftovers of a long outbox go out next
  }
  function arm(ms) {
    cancelDebounce?.();
    cancelDebounce = setTimer(() => { cancelDebounce = null; run(); }, ms);
  }
  function periodic() {
    cancelPeriodic = setTimer(() => { periodic(); if (cloud !== false && (dirty() || pending)) run(); }, PERIODIC_MS);
  }

  // ---- public API ----
  function status() {
    if (disabled || cloud !== true || !S) return { state: "off", text: null };
    const n = S.outbox.progress.length + S.outbox.ledger.length + (S.outbox.settings ? 1 : 0);
    if (busy) return { state: "saving", text: "Saving to cloud…" };
    if (failures > 0 && (n > 0 || !S.lastOkAt)) return { state: "offline", text: "Offline. Your progress is safe on this device and will upload when you are online." };
    if (n > 0 || pending) return { state: "waiting", text: "Waiting to save to cloud" };
    return S.lastOkAt ? { state: "saved", text: "Saved to cloud" } : { state: "waiting", text: "Waiting to save to cloud" };
  }
  return {
    // call once, after the first screen is idle: makes the ids and schedules the launch cycle
    start() {
      if (started) return;
      started = true;
      run();   // reads the release flag first; ids and stored state are made only when cloud save is on
    },
    // call after every persist() of the game: derives events, debounces one batch
    onPersist(save) {
      if (disabled || !started || cloud !== true) return;   // off or not known yet: step() collects from the save later
      init();
      if (!S) return;
      collect(save ?? mine());
      saveState();
      if (cloud !== false && dirty()) arm(DEBOUNCE_MS);
      notify();
    },
    // the screen became idle (level select, win card): apply a waiting reply, run a deferred cycle
    idle() {
      if (disabled || !started) return;
      settle();
      notify();
      if (waiting || (cloud !== false && (dirty() || pending || !pulledThisRun))) run();
    },
    onVisible() { flushing = false; pulledThisRun = false; this.idle(); },   // coming back: pick up other devices' changes at the next idle moment
    // page hidden (visibilitychange, pagehide, Android pause): ONE keepalive request of what is already in the outbox
    flushHidden() {
      if (disabled || !started || cloud !== true || busy || flushing || pending || !S || !guest?.token) return;
      const save = mine();
      if (save) collect(save);
      if (!dirty() || needsFullPull()) return;
      const batch = buildBatch(S.outbox, { deviceId: guest.deviceId, cursor: S.cursor });
      if (!batch.count && !batch.sent.settings) return;
      flushing = true;
      call("/api/sync", { method: "POST", body: batch.body, keepalive: true }).then((res) => {
        flushing = false;
        // not applied now (the page may be frozen): kept until the next idle moment, which also clears the outbox
        if (res.ok && isObj(res.json) && !pending) pending = { reply: res.json, sent: batch.sent };
      }).catch(() => { flushing = false; });
    },
    // after a recovery restore (P1-D) or any reply that says the cursor is meaningless
    resetCursor() { if (!S) return; S.cursor = 0; S.cursorUser = null; saveState(); },
    // ---- P1-D: recovery code and "delete my cloud data". Settings only, never during a level. ----
    // Each returns { ok:true, ... } or { ok:false, reason: "offline" | "invalid" | "later" | "error" }.
    available: () => !disabled && cloud === true && !!S && !!guest,
    async showRecovery() {   // the old code stops working; the new one is returned once
      if (!this.available()) return { ok: false, reason: "offline" };
      try {
        await ensureSession();
        const res = await call("/api/recover", { method: "PUT" });
        if (res.ok && typeof res.json?.code === "string") return { ok: true, code: res.json.code };
        return { ok: false, reason: res.status === 429 ? "later" : "error" };
      } catch { return { ok: false, reason: "offline" }; }
    },
    async restore(code) {
      if (!this.available()) return { ok: false, reason: "offline" };
      try {
        await ensureSession();
        const res = await call("/api/recover", { method: "POST", body: { code: String(code ?? ""), deviceId: guest.deviceId } });
        if (res.status === 429) return { ok: false, reason: "later" };
        if (!res.ok || typeof res.json?.token !== "string") return { ok: false, reason: res.status === 400 ? "invalid" : "error" };
        // the cursor belongs to the old throwaway user: pull everything under the new token, outbox untouched
        guest.token = res.json.token; guest.tokenExp = Number(res.json.exp) || 0; guest.userId = res.json.userId ?? subOf(res.json.token);
        saveGuest();
        S.cursor = 0; S.cursorUser = null; S.lastOkAt = 0; pulledThisRun = false;
        saveState();
        notify();
        run();
        return { ok: true };
      } catch { return { ok: false, reason: "offline" }; }
    },
    // After a 200 the cloud copy and its merged rows are gone. Sync stops for this session (nothing is re-uploaded);
    // the ids are removed, so the next launch starts a new guest. Local progress is untouched here.
    async deleteCloud() {
      if (!this.available()) return { ok: false, reason: "offline" };
      try {
        await ensureSession();
        const res = await call("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
        if (res.status === 429) return { ok: false, reason: "later" };
        if (!res.ok) return { ok: false, reason: "error" };
      } catch { return { ok: false, reason: "offline" }; }
      try { cancelDebounce?.(); cancelPeriodic?.(); } catch { /* ignore */ }
      cancelDebounce = cancelPeriodic = null; pending = null;
      try { storage.removeItem(GUEST_KEY); storage.removeItem(SYNC_KEY); } catch { /* ignore */ }
      disabled = true; S = null; guest = null;
      notify();
      return { ok: true };
    },
    status,
    balance: (w) => balance(w, S?.outbox, S?.localOnly),
    // test and diagnostics views
    debug: () => ({ guest, state: S, disabled, cloud, pending: !!pending })
  };
}
