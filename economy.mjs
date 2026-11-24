// Ring Sort economy, Task A: wallet, rewards, chapter chests, daily gift, retro grant.
// Pure functions on the save object (no DOM, no storage) so they can be unit-tested.
// Every payout is guarded by a stable ledger key so nothing can ever pay twice:
//   attempt:<attemptId>  win reward     chest:<n>  chapter chest (live and retro)
//   retro:<levelId>      retro level    retro:start  starting 100 coins    daily:<YYYY-MM-DD>  daily gift
export const COIN_CAP = 99999;
export const TOKEN_CAP = 99;
export const LEVELS_PER_CHAPTER = 10;
// ALL reward amounts live here: changing a number in this block retunes the whole economy.
export const REWARDS = {
  START: 500,              // starting balance (new players and the retro grant)
  FIRST_CLEAR_BASE: 30,    // first clear = BASE + PER_STAR x stars
  PER_STAR: 15,
  REPLAY_PER_STAR: 15,     // replay = this x stars above the stored best
  CHEST_BASE: 150,         // chapter chest = BASE + PER_CHAPTER x chapter, plus CHEST_HINTS Hints
  CHEST_PER_CHAPTER: 40,
  CHEST_HINTS: 1,
  DAILY: [100, 100, 125, 125, 150, 150, 300]   // streak day 1..7
};
// Prices and packs are constants only in Task A (no shop or booster UI yet).
export const PRICES = { HINT: 500, UNDO: 300, UNDO_FREE_PER_ATTEMPT: 3, UNDO_PACK_3: 750, REWIND: 700, PEG: 900 };
export const PACKS = [
  { id: "coins-199", usd: 1.99, coins: 1800 },
  { id: "coins-499", usd: 4.99, coins: 5000 },
  { id: "coins-999", usd: 9.99, coins: 11200 },
  { id: "coins-1999", usd: 19.99, coins: 26000 },
  { id: "starter", usd: 2.99, coins: 2000, hints: 3, pegs: 1 }
];
export const START_COINS = REWARDS.START;
export const DAILY_COINS = REWARDS.DAILY;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clampInt = (v, cap) => (Number.isInteger(v) && v > 0 ? Math.min(v, cap) : 0);

export const firstClearCoins = (stars) => REWARDS.FIRST_CLEAR_BASE + REWARDS.PER_STAR * clampStars(stars);
export const replayCoins = (stars, best) => REWARDS.REPLAY_PER_STAR * Math.max(0, clampStars(stars) - clampStars(best));
export const chestCoins = (chapter) => REWARDS.CHEST_BASE + REWARDS.CHEST_PER_CHAPTER * chapter;
export const chapterOf = (levelId) => Math.ceil(levelId / LEVELS_PER_CHAPTER);
function clampStars(s) { return Number.isInteger(s) ? Math.min(3, Math.max(0, s)) : 0; }

export const newWallet = () => ({ coins: 0, hints: 0, pegs: 0, ledger: {}, daily: { last: null, streak: 0 }, stuckCount: {}, pityUsed: {} });

// A damaged wallet never throws and never touches level progress: bad numbers become 0.
export function sanitizeWallet(raw) {
  const w = newWallet();
  if (!isObj(raw)) return w;
  w.coins = clampInt(raw.coins, COIN_CAP);
  w.hints = clampInt(raw.hints, TOKEN_CAP);
  w.pegs = clampInt(raw.pegs, TOKEN_CAP);
  if (isObj(raw.ledger)) w.ledger = { ...raw.ledger };
  if (isObj(raw.daily) && /^\d{4}-\d{2}-\d{2}$/.test(raw.daily.last ?? "") && Number.isInteger(raw.daily.streak)) {
    w.daily = { last: raw.daily.last, streak: Math.min(7, Math.max(1, raw.daily.streak)) };
  }
  if (isObj(raw.stuckCount)) w.stuckCount = { ...raw.stuckCount };
  if (isObj(raw.pityUsed)) w.pityUsed = { ...raw.pityUsed };
  if (isObj(raw.welcome)) w.welcome = raw.welcome;
  return w;
}

// ---- token and coin API (all operate on save.wallet) ----
export function addCoins(save, n) {
  const w = save.wallet;
  const before = w.coins;
  w.coins = Math.min(COIN_CAP, before + clampInt(n, COIN_CAP));
  return w.coins - before;
}
export function addHints(save, n) {
  const w = save.wallet;
  const before = w.hints;
  w.hints = Math.min(TOKEN_CAP, before + clampInt(n, TOKEN_CAP));
  return w.hints - before;
}
export function addPegs(save, n) {
  const w = save.wallet;
  const before = w.pegs;
  w.pegs = Math.min(TOKEN_CAP, before + clampInt(n, TOKEN_CAP));
  return w.pegs - before;
}
export function spendHint(save) {
  if (!(save.wallet.hints > 0)) return false;
  save.wallet.hints--;
  return true;
}
export function spendPeg(save) {
  if (!(save.wallet.pegs > 0)) return false;
  save.wallet.pegs--;
  return true;
}

// ---- win reward ----
// prevBest: best stars stored for this level before this win (null/undefined = first clear).
// Returns the real wallet change in coins; a repeated attempt id pays 0.
export function payWin(save, { attemptId, stars, prevBest = null }) {
  const key = "attempt:" + attemptId;
  const ledger = save.wallet.ledger;
  if (typeof attemptId !== "string" || !attemptId || key in ledger) return { coins: 0, paid: false };
  const want = prevBest == null ? firstClearCoins(stars) : replayCoins(stars, prevBest);
  const coins = addCoins(save, want);
  ledger[key] = coins;
  return { coins, paid: true };
}

// ---- chapter chests ----
// cleared = save.completed plus the keys of save.rewards (older saves have completed ids and no rewards).
export function clearedIds(save) {
  const ids = [...(Array.isArray(save.completed) ? save.completed : []), ...Object.keys(isObj(save.rewards) ? save.rewards : {}).map(Number)];
  return new Set(ids.filter((id) => Number.isInteger(id) && id >= 1));
}
// Stars stored for a cleared level; a level with no rewards entry counts as 1 star (floor).
export const storedStars = (save, id) => clampStars(save.rewards?.[id]?.stars) || 1;
export function chapterCleared(save, n) {
  const cleared = clearedIds(save);
  for (let i = 1; i <= LEVELS_PER_CHAPTER; i++) if (!cleared.has((n - 1) * LEVELS_PER_CHAPTER + i)) return false;
  return true;
}
export function pendingChests(save) {
  const out = [];
  const chapters = new Set([...clearedIds(save)].filter((id) => id > 0).map(chapterOf));
  for (const n of [...chapters].sort((a, b) => a - b)) {
    if (!(`chest:${n}` in save.wallet.ledger) && chapterCleared(save, n)) out.push(n);
  }
  return out;
}
// Pays chest n once (40 + 10 x chapter coins and 1 Hint). Returns null when it was already paid or is not earned.
export function claimChest(save, n) {
  const key = `chest:${n}`;
  if (key in save.wallet.ledger || !chapterCleared(save, n)) return null;
  const coins = addCoins(save, chestCoins(n));
  const hints = addHints(save, REWARDS.CHEST_HINTS);
  save.wallet.ledger[key] = coins;
  return { chapter: n, coins, hints };
}

// ---- daily gift (device local date, YYYY-MM-DD) ----
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const dayNumber = (s) => { const [y, m, d] = s.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
// What today's gift would be, or null when it was already claimed or the clock went backwards.
export function dailyOffer(save, today = localDate()) {
  const { last, streak } = save.wallet.daily;
  if (`daily:${today}` in save.wallet.ledger) return null;
  let day = 1;
  if (last) {
    const gap = dayNumber(today) - dayNumber(last);
    if (gap <= 0) return null;
    day = gap === 1 ? (streak % 7) + 1 : 1;
  }
  return { day, coins: DAILY_COINS[day - 1], date: today };
}
export function claimDaily(save, today = localDate()) {
  const offer = dailyOffer(save, today);
  if (!offer) return null;
  const coins = addCoins(save, offer.coins);
  save.wallet.ledger[`daily:${today}`] = coins;
  save.wallet.daily = { last: today, streak: offer.day };
  return { ...offer, coins };
}

// ---- migration and retro grant ----
// Call right after the save is read and BEFORE any level or save migration that prunes save.rewards:
// it must read the stars stored in the save, so a re-tuned or removed level cannot reduce the grant.
// A save with no wallet gets one: every cleared level (completed ids and rewards keys) pays the first-clear reward for its stored stars, 1-star floor (retro:<id>), each fully
// cleared chapter pays chest:<n>, and the 100 starting coins are added once (retro:start).
// A non-object wallet is repaired to a fresh one and gets the grant; an object with bad fields is sanitized field by field.
//
// paidKeys: the durable marker kept in its own storage key (MARKER_KEY). It lists every retro:* and chest:* ledger key
// ever paid and survives wallet repair, so a repaired wallet never pays those keys (including retro:start) again.
export const MARKER_KEY = "candle-sort-retro-v1";
const markerKey = (k) => /^(retro:|chest:)/.test(k);
export const paidMarker = (save) => Object.keys(save.wallet?.ledger ?? {}).filter(markerKey).sort();
export function parseMarker(text) {
  try { const v = JSON.parse(text); return Array.isArray(v) ? v.filter((k) => typeof k === "string" && markerKey(k)) : []; } catch { return []; }
}
export function migrateWallet(save, paidKeys = []) {
  const paid = paidKeys.filter((k) => typeof k === "string" && markerKey(k));
  // missing or damaged (non-object) wallet: repair to a fresh wallet and run the retro grant
  if (!isObj(save.wallet)) {
    save.wallet = newWallet();
    for (const k of paid) save.wallet.ledger[k] = 0;   // already paid once: skipped below, never paid again
    const parts = { levels: 0, levelCoins: 0, chests: [], hints: 0, start: 0, total: 0 };
    const w = save.wallet;
    for (const id of [...clearedIds(save)].sort((a, b) => a - b)) {
      const key = `retro:${id}`;
      if (key in w.ledger) continue;
      const coins = addCoins(save, firstClearCoins(storedStars(save, id)));
      w.ledger[key] = coins;
      parts.levels++;
      parts.levelCoins += coins;
    }
    for (const n of pendingChests(save)) {
      const c = claimChest(save, n);
      if (c) { parts.chests.push({ chapter: n, coins: c.coins }); parts.hints += c.hints; }
    }
    if (!("retro:start" in w.ledger)) {
      parts.start = addCoins(save, REWARDS.START);
      w.ledger["retro:start"] = parts.start;
    }
    parts.total = parts.levelCoins + parts.chests.reduce((s, c) => s + c.coins, 0) + parts.start;
    if (parts.total > 0 && parts.levels > 0) w.welcome = parts;
  } else {
    save.wallet = sanitizeWallet(save.wallet);
    for (const k of paid) if (!(k in save.wallet.ledger)) save.wallet.ledger[k] = 0;   // ledger damaged: keep paid keys paid
  }
  return save.wallet.welcome ?? null;
}
export function dismissWelcome(save) {
  delete save.wallet.welcome;
}

// ================================================================ Task B: boosters, Undo rule, stuck, pity ====
// All prices come from PRICES above. Every coin spend writes a ledger key, so a double tap or a replayed
// action can never charge twice; a spend can never take the wallet below 0.
export const RULES = {
  UNDO_PAID_FROM: 10,       // levels 1-9: Undo is free and unlimited
  FREE_REWIND_UNTIL: 14,    // Rewind is free on L1-14
  HINT_GIFT_LEVEL: 12,      // one free Hint token
  PEG_GIFT_LEVEL: 15,       // one free +Peg token
  PITY_REWIND_AT: 3,        // 3rd stuck on a level: one free Rewind
  PITY_PEG_AT: 5            // 5th stuck: one +Peg token (once per save)
};

// Per-attempt booster state, kept on save.active.eco; a Restart makes a new attempt, so everything resets.
export const attemptEco = (a) => (a.eco ??= { undos: 0, credits: 0, seq: 0, peg: false, epoch: 0 });

// Charges coins under a unique ledger key. "dup" = already charged, "poor" = balance too low; nothing changes then.
export function spendCoins(save, key, price) {
  const w = save.wallet;
  if (key in w.ledger) return "dup";
  if (!Number.isInteger(price) || price < 0 || w.coins < price) return "poor";
  w.coins -= price;
  w.ledger[key] = price;
  return "ok";
}
export const canAfford = (save, price) => save.wallet.coins >= price;

// ---- toolbar Undo ----
// kind: free (L1-9, unlimited) | free3 (L10+, `left` of 3 per attempt) | credit (bought pack) | pay | blocked (stuck board)
export function undoPlan(levelId, a, stuck) {
  const e = attemptEco(a);
  if (stuck) return { kind: "blocked" };
  if (levelId < RULES.UNDO_PAID_FROM) return { kind: "free" };
  const left = PRICES.UNDO_FREE_PER_ATTEMPT - e.undos;
  if (left > 0) return { kind: "free3", left };
  if (e.credits > 0) return { kind: "credit", credits: e.credits };
  return { kind: "pay", price: PRICES.UNDO, pack: PRICES.UNDO_PACK_3 };
}
// Consumes one Undo. choice "one" | "pack" only matters for kind "pay". Returns { ok, spent } or { ok: false, reason }.
export function takeUndo(save, levelId, a, stuck, choice = "one") {
  const plan = undoPlan(levelId, a, stuck);
  const e = attemptEco(a);
  if (plan.kind === "blocked") return { ok: false, reason: "stuck" };
  if (plan.kind === "free") return { ok: true, spent: 0 };
  if (plan.kind === "free3") { e.undos++; return { ok: true, spent: 0 }; }
  if (plan.kind === "credit") { e.credits--; return { ok: true, spent: 0 }; }
  const pack = choice === "pack";
  const price = pack ? PRICES.UNDO_PACK_3 : PRICES.UNDO;
  const res = spendCoins(save, [pack ? "undopack" : "undo", a.attemptId, e.seq].join(":"), price);
  if (res !== "ok") return { ok: false, reason: res };
  e.seq++;
  if (pack) e.credits += 2;   // 3 Undos bought, this one is used now
  return { ok: true, spent: price };
}

// ---- Hint: token first, else coins; asking again for the same board in the same attempt is free ----
const hintKey = (a) => ["hint", a.attemptId, JSON.stringify(a.board)].join(":");
export function takeHint(save, a) {
  const key = hintKey(a);
  const w = save.wallet;
  if (key in w.ledger) return { ok: true, spent: 0, token: false, repeat: true };
  if (w.hints > 0) { spendHint(save); w.ledger[key] = 0; return { ok: true, spent: 0, token: true }; }
  const res = spendCoins(save, key, PRICES.HINT);
  return res === "ok" ? { ok: true, spent: PRICES.HINT, token: false } : { ok: false, reason: res };
}
// What the next Hint costs: free for a repeat of the same board or when a token is held, else PRICES.HINT.
export function hintCost(save, a) {
  const w = save.wallet;
  if (hintKey(a) in w.ledger) return { price: 0, repeat: true };
  return w.hints > 0 ? { price: 0, token: true } : { price: PRICES.HINT };
}
// Gives a Hint back when the solver could not answer after the charge (no charge for a failed hint).
export function refundHint(save, a, r) {
  delete save.wallet.ledger[hintKey(a)];
  if (r.token) addHints(save, 1); else addCoins(save, r.spent);
}

// ---- +Peg: one per attempt, token first, else coins ----
export function takePeg(save, a) {
  const e = attemptEco(a);
  const key = "peg:" + a.attemptId;
  const w = save.wallet;
  if (e.peg || key in w.ledger) return { ok: false, reason: "dup" };
  if (w.pegs > 0) { spendPeg(save); w.ledger[key] = 0; e.peg = true; e.epoch++; return { ok: true, spent: 0, token: true }; }
  const res = spendCoins(save, key, PRICES.PEG);
  if (res !== "ok") return { ok: false, reason: res };
  e.peg = true; e.epoch++;
  return { ok: true, spent: PRICES.PEG, token: false };
}
export const pegCost = (save) => (save.wallet.pegs > 0 ? { token: true, price: 0 } : { token: false, price: PRICES.PEG });

// ---- Rewind: flat price whatever the depth; free on L1-14 and once per level by pity ----
export function rewindCost(save, levelId) {
  if (levelId <= RULES.FREE_REWIND_UNTIL) return { price: 0, why: "early" };
  if ((save.wallet.stuckCount[levelId] ?? 0) >= RULES.PITY_REWIND_AT && !save.wallet.pityUsed[levelId]) return { price: 0, why: "pity" };
  return { price: PRICES.REWIND, why: null };
}
export function takeRewind(save, levelId, a) {
  const e = attemptEco(a);
  const key = ["rewind", a.attemptId, e.epoch].join(":");
  if (key in save.wallet.ledger) return { ok: false, reason: "dup" };
  const cost = rewindCost(save, levelId);
  if (cost.price === 0) {
    save.wallet.ledger[key] = 0;
    if (cost.why === "pity") save.wallet.pityUsed[levelId] = true;
  } else {
    const res = spendCoins(save, key, cost.price);
    if (res !== "ok") return { ok: false, reason: res };
  }
  e.epoch++;
  return { ok: true, spent: cost.price, why: cost.why };
}

// ---- stuck counter and pity ----
// Call when the stuck screen opens. One count per stuck event (key stuck:<attempt>:<epoch>), so a reload
// that reopens the same screen never counts twice. 5th stuck on a level: +Peg token once per save (pity:peg:L<id>).
export function recordStuck(save, levelId, a) {
  const e = attemptEco(a);
  const w = save.wallet;
  const key = ["stuck", a.attemptId, e.epoch].join(":");
  let pegGranted = false;
  if (!(key in w.ledger)) {
    w.ledger[key] = 1;
    w.stuckCount[levelId] = (w.stuckCount[levelId] ?? 0) + 1;
    const pityKey = "pity:peg:L" + levelId;
    if (w.stuckCount[levelId] >= RULES.PITY_PEG_AT && !(pityKey in w.ledger)) {
      w.ledger[pityKey] = addPegs(save, 1);
      pegGranted = true;
    }
  }
  return { count: w.stuckCount[levelId] ?? 0, pegGranted, freeRewind: rewindCost(save, levelId).why === "pity" };
}
// Counters reset when the level is cleared (pityUsed and the once-per-save peg key stay).
export function clearStuck(save, levelId) { delete save.wallet.stuckCount[levelId]; }

// ---- one-time tutorial tokens: a Hint at L12, a +Peg at L15 ----
export function claimLevelGift(save, levelId) {
  const w = save.wallet;
  if (levelId === RULES.HINT_GIFT_LEVEL && !("gift:hint:L12" in w.ledger)) { w.ledger["gift:hint:L12"] = addHints(save, 1); return { hints: 1, pegs: 0 }; }
  if (levelId === RULES.PEG_GIFT_LEVEL && !("gift:peg:L15" in w.ledger)) { w.ledger["gift:peg:L15"] = addPegs(save, 1); return { hints: 0, pegs: 1 }; }
  return null;
}

// ---- cloud save (docs/team/22): the only numbers the server, the client and the tests read ----
// Names follow the spec; the amounts are the REWARDS / PRICES blocks above (Economy v5).
export const firstClear = (stars) => firstClearCoins(stars);
export const replayPerStar = REWARDS.REPLAY_PER_STAR;
export const chestReward = (n) => ({ coins: chestCoins(n), hints: REWARDS.CHEST_HINTS });
export const GIFT_TABLE = DAILY_COINS;
// pity grants (Economy Task A): a peg after a stuck level; the Rewind pity grants no tokens
export const PITY = { peg: 1, rewind: 0 };
// item = what the player buys or uses; token = which wallet counter it fills (null: coins only, used on the spot)
export const ITEMS = {
  hint: { price: PRICES.HINT, token: "hints" },
  peg: { price: PRICES.PEG, token: "pegs" },
  undo: { price: PRICES.UNDO, token: null },
  undo_pack: { price: PRICES.UNDO_PACK_3, token: null },
  rewind: { price: PRICES.REWIND, token: null }
};

// JS reference of the price rule (section 3). rows: [{levelId, stars}] in pay order, any mix of attempt/retro.
// Returns the coins each row pays. A level's first row (running best 0 / none) pays first clear.
export function priceLevelRows(rows) {
  const best = new Map();
  return rows.map(({ levelId, stars }) => {
    const prev = best.get(levelId) ?? 0;
    best.set(levelId, Math.max(prev, stars));
    return prev === 0 ? firstClear(stars) : replayPerStar * Math.max(0, stars - prev);
  });
}

// The constants for SQL (`p_rules` of apply_sync / merge_users). SQL holds only the formula shape.
export function sqlRules() {
  return {
    start: START_COINS,
    firstClear: { base: REWARDS.FIRST_CLEAR_BASE, perStar: REWARDS.PER_STAR },
    replayPerStar,
    levelsPerChapter: LEVELS_PER_CHAPTER,
    chest: { base: REWARDS.CHEST_BASE, perChapter: REWARDS.CHEST_PER_CHAPTER, hints: REWARDS.CHEST_HINTS },
    gift: [...GIFT_TABLE],
    pity: { ...PITY },
    caps: { coins: COIN_CAP, tokens: TOKEN_CAP },
    items: Object.fromEntries(Object.entries(ITEMS).map(([k, v]) => [k, { ...v }]))
  };
}
