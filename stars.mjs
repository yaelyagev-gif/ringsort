// Pure star rules, shared by the game (public/game.mjs) and the server. No DOM, no solve().
// starsFor is moved verbatim from game.mjs; parOf reads the par that tools/add-par.mjs stores in content/levels.json.
export function starsFor(moves, par) {
  if (moves <= par) return 3;
  if (moves <= par + Math.max(2, Math.ceil(par / 2))) return 2;
  return 1;
}
// level.par when it is an integer >= 1, else null (a level without par accepts no move proof on the server).
export function parOf(level) {
  return Number.isInteger(level?.par) && level.par >= 1 ? level.par : null;
}
