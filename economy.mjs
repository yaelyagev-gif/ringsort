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
