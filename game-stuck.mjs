// Ring Sort Task B: pure helpers for stuck detection, Rewind, Hint and the +Peg check (no DOM).
// They run in a Web Worker (game-worker.mjs) with a time budget, or inline as a fallback.
import { capacity, cloneBoard, hasMove, move, palette, solve } from "./rules.mjs";

export const DETECT_LIMIT = 20000;    // B1: per-move detection
export const DEEP_LIMIT = 200000;     // "Am I stuck?", Hint and the Rewind walk
export const RESCUE_LIMIT = 60000;    // does one extra peg rescue this board?
export const BUDGET_MS = 1000;        // B2: skip detection that takes longer (at 4x CPU throttle)
export const DEEP_BUDGET_MS = 6000;

export const sameBoard = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const withPeg = (board) => [...cloneBoard(board), []];

// "unsolvable" (a dead end; also no legal move), "solved", or "limit" (not proven either way)
export function checkBoard(board, limit = DETECT_LIMIT) {
  if (!hasMove(board)) return { status: "unsolvable", visited: 0 };
  const r = solve(board, limit);
  return { status: r.status, visited: r.visited };
}
// Does adding one empty peg make this board solvable?
export function pegRescues(board, limit = RESCUE_LIMIT) {
  return solve(withPeg(board), limit).status === "solved";
}
export function moveBetween(from, to) {
  for (let i = 0; i < from.length; i++) for (let j = 0; j < from.length; j++) {
    const r = move(from, i, j);
    if (r && sameBoard(r, to)) return [i, j];
  }
  return null;
}
// Walk back from the newest position to the first one the solver proves solvable.
// history = boards before each move (oldest first), board = current. Returns that position and the wrong move that left it.
export function rewindTarget(history, board, limit = DEEP_LIMIT) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (solve(history[i], limit).status === "solved") {
      return { index: i, board: history[i], wrong: moveBetween(history[i], history[i + 1] ?? board) };
    }
  }
  return null;
}
// First move of a solution, or move null when the board is not proven solvable within the limit.
export function hintMove(board, limit = DEEP_LIMIT) {
  const r = solve(board, limit);
  return r.status === "solved" && r.moves.length ? { move: r.moves[0], status: "solved" } : { move: null, status: r.status };
}
// Same checks as rules.validateBoard minus the 3-8 peg limit (a live board can hold the +Peg: 9 pegs).
export function validLive(board) {
  if (!Array.isArray(board) || board.length < 3 || board.length > 9) return false;
  const counts = new Map();
  for (const peg of board) {
    if (!Array.isArray(peg) || peg.length > capacity) return false;
    for (const c of peg) {
      if (!palette.includes(c)) return false;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  return counts.size >= 2 && [...counts.values()].every((n) => n === capacity);
}

// One entry point for the worker and the inline fallback.
export function runJob(job) {
  switch (job.op) {
    case "check": return checkBoard(job.board, job.limit ?? DETECT_LIMIT);
    case "rescue": return { rescues: pegRescues(job.board, job.limit ?? RESCUE_LIMIT) };
    case "rewind": return { target: rewindTarget(job.history, job.board, job.limit ?? DEEP_LIMIT) };
    case "hint": return hintMove(job.board, job.limit ?? DEEP_LIMIT);
    default: return { error: "unknown job" };
  }
}

// Runs jobs off the main thread with a time budget. A job over budget resolves { timeout: true } (its worker is
// replaced) so input is never blocked and the caller skips and logs `solve_limit_hit`.
// Without Worker support (or if it fails to start) jobs run deferred on the main thread, bounded by their state limit.
export function createRunner(workerUrl) {
  let worker = null, next = 1, broken = false;
  const waiting = new Map();
  const failAll = () => { for (const [id, w] of waiting) { clearTimeout(w.timer); w.resolve({ timeout: true }); waiting.delete(id); } };
  const start = () => {
    try {
      const w = new Worker(workerUrl, { type: "module" });
      w.onmessage = (e) => { const p = waiting.get(e.data.id); if (p) { waiting.delete(e.data.id); clearTimeout(p.timer); p.resolve(e.data.result); } };
      w.onerror = () => { if (worker === w) worker = null; broken = true; failAll(); };   // no module workers here: run inline from now on
      worker = w;
    } catch { worker = null; }
  };
  const inline = (job) => new Promise((resolve) => setTimeout(() => { try { resolve(runJob(job)); } catch { resolve({ timeout: true }); } }, 0));
  return function run(job, budgetMs = BUDGET_MS) {
    if (typeof Worker === "undefined" || broken) return inline(job);
    if (!worker) start();
    if (!worker) return inline(job);
    return new Promise((resolve) => {
      const id = next++;
      const timer = setTimeout(() => {
        waiting.delete(id);
        worker?.terminate();
        worker = null;                 // the runaway solve dies with its worker
        failAll();
        resolve({ timeout: true });
      }, budgetMs);
      waiting.set(id, { resolve, timer });
      worker.postMessage({ ...job, id });
    });
  };
}
