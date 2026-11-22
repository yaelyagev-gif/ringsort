export const capacity = 4;
export const palette = ["coral", "teal", "gold", "violet", "blue", "rose"];
export const cloneBoard = (board) => board.map((peg) => [...peg]);

export function move(board, from, to) {
  const source = board[from];
  const target = board[to];
  if (from === to || !source?.length || !target || target.length >= capacity) return null;
  const color = source.at(-1);
  if (target.length && target.at(-1) !== color) return null;
  let count = 1;
  while (source.at(-1 - count) === color && target.length + count < capacity) count++;
  const next = cloneBoard(board);
  next[to].push(...next[from].splice(-count));
  return next;
}

export function solved(board) {
  return board.every((peg) => !peg.length || (
    peg.length === capacity && peg.every((color) => color === peg[0])
  ));
}

export function hasMove(board) {
  return board.some((_, from) => board.some((_, to) => move(board, from, to)));
}

export function validateBoard(board, { allowSolved = false } = {}) {
  if (!Array.isArray(board) || board.length < 3 || board.length > 8) {
    return "A board needs 3 to 8 pegs.";
  }
  const counts = new Map();
  for (const peg of board) {
    if (!Array.isArray(peg) || peg.length > capacity) return "Each peg holds up to four rings.";
    for (const color of peg) {
      if (!palette.includes(color)) return "Unknown ring color.";
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }
  if (counts.size < 2 || [...counts.values()].some((count) => count !== capacity)) {
    return "Use exactly four rings of each color and at least two colors.";
  }
  if (!allowSolved && solved(board)) return "The initial board must be unsolved.";
  return null;
}

const canonical = (board) => board.map((peg) => peg.join(",")).sort().join("|");

export function solve(board, limit = 60000) {
  if (solved(board)) return { status: "solved", moves: [], visited: 1 };
  const queue = [{ board, previous: null, action: null }];
  const seen = new Set([canonical(board)]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const state = queue[cursor];
    for (let from = 0; from < board.length; from++) {
      for (let to = 0; to < board.length; to++) {
        const next = move(state.board, from, to);
        if (!next) continue;
        const key = canonical(next);
        if (seen.has(key)) continue;
        const node = { board: next, previous: state, action: [from, to] };
        if (solved(next)) {
          const moves = [];
          for (let step = node; step.action; step = step.previous) moves.push(step.action);
          return { status: "solved", moves: moves.reverse(), visited: seen.size + 1 };
        }
        if (seen.size >= limit) return { status: "limit", visited: seen.size };
        seen.add(key);
        queue.push(node);
      }
    }
  }
  return { status: "unsolvable", visited: seen.size };
}

export function generate(seed, colors, minMoves = 3) {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  for (let attempt = 0; attempt < 60; attempt++) {
    const rings = palette.slice(0, colors).flatMap((color) => Array(capacity).fill(color));
    for (let i = rings.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [rings[i], rings[j]] = [rings[j], rings[i]];
    }
    const board = Array.from({ length: colors }, (_, i) => rings.slice(i * capacity, (i + 1) * capacity));
    board.push([], []);
    if (validateBoard(board)) continue;
    const solution = solve(board, 12000);
    if (solution.status === "solved" && solution.moves.length >= minMoves) return { board, solution };
  }
  return null;
}
