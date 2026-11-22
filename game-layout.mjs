// Board and scene layout for 3-8 pegs, storybook-bakery play screen (task #68, layout C3/C4).
// Pure function: phone size + insets + peg count -> background placement, pegs,
// hit boxes and the hint bubble, all in CSS px of the phone box.
import { RING } from "./game-art.mjs";

// play-bg.webp (1024 x 1536): the marble counter's front lip is at source y 722.
export const PLAY_BG = { w: 1024, h: 1536, counterY: 722 };

const tipAbove = RING.tip;                                   // dowel tip above base (×W)
const stackTop = RING.rest + RING.pitch * 3 + RING.centre;   // full stack top above base (×W)
const runH = (n) => RING.aspect + RING.pitch * (n - 1);
const below = RING.baseRy + RING.band + .12;                 // plate front + shadow below base (×W)

export function hoverTop(yb, W, gap, n = 4) { return yb - tipAbove * W - gap * W - runH(n) * W; }

export function computeLayout({ w, h, insetTop = 0, insetBottom = 0, n }) {
  const short = h < 700;
  const hudH = insetTop + (short ? 62 : 70);
  const btn = short ? 52 : 58;
  const caption = h < 600 ? 0 : 16;
  const barH = insetBottom + btn + caption + (short ? 14 : 22);
  const barTop = h - barH;

  // rows: one row up to 3 pegs, else back row = floor(n/2), front row = ceil(n/2)
  const rows = n <= 3 ? [n] : [Math.floor(n / 2), Math.ceil(n / 2)];
  const two = rows.length === 2;
  const frontCount = rows.at(-1);
  const col = Math.min(.96 * w / frontCount, 150);
  const frontX = Array.from({ length: frontCount }, (_, i) => w / 2 + (i - (frontCount - 1) / 2) * col);
  let backX = [];
  if (two) {
    if (rows[0] < frontCount) backX = frontX.slice(0, -1).map((x, i) => (x + frontX[i + 1]) / 2);
    else backX = frontX.map((x) => w / 2 + (x - w / 2) * .92);
  }
  const back = .9;                                            // back row scale (one camera, slight depth)
  const gap = .16;                                            // lifted run hovers this far over the tip
  const top0 = hudH + 6, bottom0 = barTop - 6;
  const avail = bottom0 - top0;
  // height of the board for front width W (two rows keep the front stack clear of the back row's donuts)
  const rowGap = (W) => stackTop * W + (RING.centre - RING.rest) * W * back + .34 * W;
  const need = (W) => two
    ? (tipAbove + gap + runH(4)) * W * back + rowGap(W) + below * W
    : (tipAbove + gap + runH(4)) * W + below * W;
  let W = Math.min(118, .88 * col);
  while (W > 40 && need(W) > avail) W -= .5;
  const Wb = two ? W * back : W;
  // vertical: sit the board low (on the counter) but keep the lifted run under the HUD
  // spare height: part of it opens the rows up, the rest sits mostly above the board
  let slack = avail - need(W);
  const spread = two ? Math.min(.6 * W, slack * .35) : 0;
  slack -= spread;
  const yFront = bottom0 - below * W - slack * .32;
  const yBack = two ? yFront - rowGap(W) - spread : yFront;

  const pegs = [];
  if (!two) frontX.forEach((x) => pegs.push({ x, yb: yFront, W, row: 0 }));
  else {
    backX.forEach((x) => pegs.push({ x, yb: yBack, W: Wb, row: 0 }));
    frontX.forEach((x) => pegs.push({ x, yb: yFront, W, row: 1 }));
  }
  for (const p of pegs) {
    p.tip = p.yb - tipAbove * p.W;
    p.gap = gap;
    p.hoverBottom = p.tip - gap * p.W;                      // bottom of a lifted run's lowest donut box
    p.top = hoverTop(p.yb, p.W, gap);
  }
  // hit boxes: full column, split at midlines (and between rows)
  const rowOf = (r) => pegs.filter((p) => p.row === r);
  const split = two ? (() => {
    const b = rowOf(0)[0], f = rowOf(1)[0];
    return ((b.yb + (RING.baseRy + RING.band) * b.W + 4) + (f.yb - stackTop * f.W)) / 2;
  })() : null;
  for (const r of two ? [0, 1] : [0]) {
    const list = rowOf(r);
    list.forEach((p, i) => {
      const left = i ? (list[i - 1].x + p.x) / 2 : Math.max(0, p.x - col * .62);
      const right = i < list.length - 1 ? (list[i + 1].x + p.x) / 2 : Math.min(w, p.x + col * .62);
      const top = r === 1 && two ? split : Math.max(hudH, p.top - 4);
      const bottom = r === 0 && two ? split : Math.min(barTop - 2, p.yb + (RING.baseRy + RING.band) * p.W + 10);
      p.hit = { x: left, y: top, w: right - left, h: bottom - top };
    });
  }
  const boardTop = Math.min(...pegs.map((p) => p.tip - .1 * p.W));

  // background: cover, centred, then slid (within its spare height) so the counter's
  // front lip sits a little above the back row's plates
  const s = Math.max(w / PLAY_BG.w, h / PLAY_BG.h) * 1.12;
  const bw = PLAY_BG.w * s, bh = PLAY_BG.h * s;
  const backBase = Math.min(...pegs.map((p) => p.yb));
  const want = backBase - .62 * pegs[0].W;
  const by = Math.min(0, Math.max(h - bh, want - PLAY_BG.counterY * s));
  const bg = { x: (w - bw) / 2, y: by, w: bw, h: bh, counter: by + PLAY_BG.counterY * s };

  // hint bubble: above the board, left-aligned, with the thinking chef beside it
  const bubble = { left: 12, right: w - 12, bottom: Math.max(hudH + 60, boardTop - 10), maxTop: hudH + 4, oneLine: short };
  bubble.width = Math.min(bubble.right - bubble.left, 300);

  return { w, h, hudH, barH, barTop, btn, caption, short, pegs, bg, bubble, rows, boardTop };
}
