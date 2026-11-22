// Code-drawn SVG art for Ring Sort, storybook-bakery look (task #68): donuts
// (puffy dough, thick drippy glaze, a topping pattern per colour, soft
// painterly gloss, no outlines), cream plates with wooden dowels, icons and
// stars. Everything is vector and re-drawn for the real stage size, so nothing
// is ever stretched. Look: references/owner-art/01-style-master.png and
// 09-donut-sheet.png. The torus outline comes from game-ringgeo.mjs.
import { ringGeo as G } from "./game-ringgeo.mjs";

export const NS = "http://www.w3.org/2000/svg";
export function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
}
const r2 = (n) => Math.round(n * 100) / 100;

// Glaze palette from the style master, spread in lightness so every pair stays
// ΔE ≥ 18 under protan, deutan and tritan (python3 tools/art/cvd_check.py).
// Keys are the rule colours (rules.mjs); `name` is what players and screen readers hear.
export const ringColors = {
  gold: { base: "#FFDA5C", light: "#FFF1B0", dark: "#D9A42E", spec: "#FFFDF0", name: "lemon", topping: "pearls", face: "#5A3A1E" },
  rose: { base: "#F07090", light: "#FFC0D0", dark: "#C4486A", spec: "#FFF6FA", name: "strawberry", topping: "sprinkles", face: "#5A2430" },
  coral: { base: "#6E3D28", light: "#9C6646", dark: "#45220F", spec: "#FFE9D6", name: "chocolate", topping: "stripes", face: "#FFF1DC" },
  teal: { base: "#ABE29C", light: "#DDF6CF", dark: "#6FB367", spec: "#F8FFF2", name: "mint", topping: "hearts", face: "#3E4A2A" },
  blue: { base: "#58A2EA", light: "#BBDDFA", dark: "#3A7EC8", spec: "#F2F8FF", name: "blueberry", topping: "zigzag", face: "#1E3456" },
  violet: { base: "#7E50C2", light: "#B796E6", dark: "#4C2690", spec: "#F6EEFF", name: "grape", topping: "stars", face: "#FFF1DC" }
};
export const colorNames = Object.fromEntries(Object.entries(ringColors).map(([k, c]) => [k, c.name]));
const DOUGH = { light: "#F8D08E", base: "#ECAE62", dark: "#C47C38", deep: "#8E5222" };
const PLATE = { top: "#FFF8EC", mid: "#F7E9D2", edge: "#E9D2B0", band: "#E2C49C", trim: "#F2A7B8" };

// Donut / peg proportions (all as a fraction of the donut width W).
export const RING = {
  aspect: G.h / 100,            // box height / width
  centre: G.centre / 100,       // centre line from box top
  rest: 0.141,                  // centre line above the plate's top face
  pitch: 0.26,                  // stack pitch
  dowel: 0.12,
  tip: 1.44,                    // dowel tip above the plate's top face
  baseRx: 0.56, baseRy: 0.23, band: 0.075
};
let variant = "";
export function setRingVariant({ patterns, contrast }) { variant = contrast ? "-h" : patterns ? "-p" : ""; }
export const ringHref = (color, front) => `#ring-${color}${variant}${front ? "-front" : ""}`;
export const faceHref = (color) => `#face-${color}`;
export const ringCentreY = (yb, W, k) => yb - RING.rest * W - RING.pitch * W * k;

function hex(c) { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
export function mix(a, b, t) {
  const x = hex(a), y = hex(b);
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const seedOf = (name) => [...name].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261);

// --- torus helpers (same camera as tools/art/ring_geometry.py) ---
const SE = .41, CE = Math.sqrt(1 - SE * SE), TR = 37, TA = 13, TH = 15.5;
// a point on the top of the tube at distance r from the axis, angle phi (90° = back)
function topPoint(r, phi) {
  const t = Math.acos(Math.max(-1, Math.min(1, (r - TR) / TA)));
  const z = TH * Math.sin(t);
  return { x: 50 + r * Math.cos(phi), y: G.centre - z * CE - r * SE * Math.sin(phi), front: -Math.sin(phi) };
}
const op = G.opening, cr = G.crest;
const inHole = (x, y, pad = 2.5) => ((x - op.cx) / (op.rx + pad)) ** 2 + ((y - op.cy) / (op.ry + pad)) ** 2 < 1;
const inFace = (x, y) => x > 38 && x < 62 && y > 37.5 && y < 48.5;

// lower edge of the glaze: the tube just below its outer equator, with soft drips
function glazeEdge(name) {
  const rand = rng(seedOf(name));
  const drips = Array.from({ length: 7 }, (_, i) => ({ x: 8 + i * 13.5 + (rand() - .5) * 7, h: 2.4 + rand() * 4.4, w: 2.4 + rand() * 1.8 }));
  const cyE = G.centre + 2.45, rxE = 49.8, ryE = 20.4;
  const pts = [];
  for (let i = 0; i <= 72; i++) {
    const x = .5 + 99 * i / 72;
    const u = Math.min(1, Math.abs((x - 50) / rxE));
    const fall = Math.sqrt(1 - u * u);
    let y = cyE + ryE * fall + .5 * Math.sin(x * .45 + rand() * .2);
    for (const d of drips) y += d.h * fall * Math.exp(-(((x - d.x) / d.w) ** 2));
    pts.push([x, y]);
  }
  const line = "M" + pts.map(([x, y]) => r2(x) + " " + r2(y)).join("L");
  return { line, area: line + "L101 30L101 -3L-1 -3L-1 30Z" };
}

const starPath = (cx, cy, R, r) => { let d = ""; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const q = i % 2 ? r : R; d += (i ? "L" : "M") + r2(cx + q * Math.cos(a)) + " " + r2(cy + q * Math.sin(a)); } return d + "Z"; };
const heartPath = "M0 2.2C-.5 1.8-2.7.5-2.7-.9-2.7-1.8-2-2.4-1.3-2.4-.7-2.4-.3-2-0-1.5.3-2 .7-2.4 1.3-2.4 2-2.4 2.7-1.8 2.7-.9 2.7.5.5 1.8 0 2.2Z";

// the topping layer of one donut (inside the glaze clip)
function toppings(name, c, bold) {
  const rand = rng(seedOf(name) ^ 0x9e37);
  const ink = "#3A2216";
  const out = [];
  // top-surface rings plus a front band (r 49) that stays visible on stacked donuts
  const spots = (rings, step, jitter = .35) => {
    const list = [];
    rings.forEach((r, j) => {
      for (let a = (j * .5) * step; a < 360; a += step) {
        const phi = (a + (rand() - .5) * step * jitter) * Math.PI / 180;
        const p = topPoint(r, phi);
        if (!inHole(p.x, p.y) && !inFace(p.x, p.y) && p.x > 4 && p.x < 96) list.push(p);
      }
    });
    for (let a = 203; a <= 337; a += 15.5) {
      const p = topPoint(48.6, (a + (rand() - .5) * 4) * Math.PI / 180);
      if (!inFace(p.x, p.y) && p.x > 5 && p.x < 95) list.push(p);
    }
    return list;
  };
  const k = bold ? 1.25 : 1;
  const sq = (p) => r2(.78 + .22 * Math.max(0, p.front));   // nearer = larger
  if (c.topping === "sprinkles") {
    const cols = ["#FFE27A", "#8CCBF2", "#B5E39C", "#FFFFFF", "#C9A6F0", "#FFB27A"];
    spots([31.5, 38, 44, 47.5], 46).forEach((p, i) => {
      const a = rand() * 180, s = sq(p) * k;
      out.push(svgEl("rect", { x: -2.3, y: -.75, width: 4.6, height: 1.5, rx: .75, fill: cols[i % cols.length], stroke: bold ? ink : "none", "stroke-width": bold ? .45 : 0, transform: `translate(${r2(p.x)} ${r2(p.y)}) scale(${s} ${r2(s * .8)}) rotate(${r2(a)})` }));
    });
  } else if (c.topping === "pearls") {
    spots([33, 41, 47], 40).forEach((p) => {
      const s = sq(p) * k;
      out.push(svgEl("g", { transform: `translate(${r2(p.x)} ${r2(p.y)}) scale(${s} ${r2(s * .85)})` }, [
        svgEl("ellipse", { cx: -.3, cy: .9, rx: 2.2, ry: 1.1, fill: c.dark, "fill-opacity": .45 }),
        svgEl("circle", { r: 2.15, fill: "url(#pearl-g)", stroke: bold ? ink : "none", "stroke-width": bold ? .45 : 0 }),
        svgEl("circle", { cx: .6, cy: -.7, r: .55, fill: "#FFFFFF", "fill-opacity": .9 })
      ]));
    });
  } else if (c.topping === "hearts") {
    spots([35, 44], 52).forEach((p) => {
      const s = sq(p) * k * 1.05;
      out.push(svgEl("path", { d: heartPath, fill: "#F37DA2", stroke: bold ? ink : "#FFFFFF", "stroke-opacity": bold ? 1 : .35, "stroke-width": bold ? .45 : .3, transform: `translate(${r2(p.x)} ${r2(p.y)}) scale(${s} ${r2(s * .8)}) rotate(${r2((rand() - .5) * 30)})` }));
    });
  } else if (c.topping === "stars") {
    spots([35, 44], 52).forEach((p) => {
      const s = sq(p) * k;
      out.push(svgEl("path", { d: starPath(0, 0, 3, 1.35), fill: "#FFD95E", stroke: bold ? ink : "#FFF6C8", "stroke-opacity": bold ? 1 : .6, "stroke-width": bold ? .45 : .3, "stroke-linejoin": "round", transform: `translate(${r2(p.x)} ${r2(p.y)}) scale(${s} ${r2(s * .8)}) rotate(${r2((rand() - .5) * 24)})` }));
    });
  } else if (c.topping === "zigzag") {
    // thick, light-green icing with a darker-green edge: reads on the blue glaze, also on the front band of stacked donuts
    let d = "";
    for (let i = 0; i <= 160; i++) {
      const phi = i / 160 * Math.PI * 2;
      const p = topPoint(40 + 8.5 * Math.sin(phi * 7), phi);
      d += (i ? "L" : "M") + r2(p.x) + " " + r2(p.y);
    }
    out.push(svgEl("path", { d, fill: "none", stroke: bold ? ink : "#2F7F4A", "stroke-width": 5.4 * k, "stroke-linejoin": "round" }));
    out.push(svgEl("path", { d, fill: "none", stroke: "#CFF5B4", "stroke-width": 3.6 * k, "stroke-linejoin": "round" }));
    out.push(svgEl("path", { d, fill: "none", stroke: "#FFFFFF", "stroke-opacity": .75, "stroke-width": 1, transform: "translate(.3 -.5)" }));
  } else if (c.topping === "stripes") {
    const lines = [];
    for (let i = -3; i <= 4; i++) {
      const x0 = 6 + i * 15;
      lines.push(`M${x0} -2C${x0 + 10} 14 ${x0 + 20} 30 ${x0 + 34} 52`);
    }
    const d = lines.join("");
    if (bold) out.push(svgEl("path", { d, fill: "none", stroke: ink, "stroke-width": 4 * k, "stroke-linecap": "round" }));
    out.push(svgEl("path", { d, fill: "none", stroke: "#FFF2DF", "stroke-width": 2.7 * k, "stroke-linecap": "round" }));
    out.push(svgEl("path", { d, fill: "none", stroke: "#FFFFFF", "stroke-opacity": .6, "stroke-width": .8, transform: "translate(.6 -.5)" }));
  }
  return out;
}

// --- icons: 24x24, 2.5 stroke, round caps ---
const icons = {
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5"/><circle cx="12" cy="12" r="6.6"/>',
  undo: '<path d="M8.5 6.5L4 11l4.5 4.5"/><path d="M4.6 11H14a5.5 5.5 0 0 1 0 11h-3"/>',
  restart: '<path d="M19.2 8.4A8 8 0 1 0 20 13"/><path d="M20.2 3.6v5.2H15"/>',
  map: '<path d="M4 6.5l5-2.3 6 2.6 5-2.3v13l-5 2.3-6-2.6-5 2.3z"/><path d="M9 4.2v13M15 6.8v13"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.4a8 8 0 0 1 0 11.2"/>',
  haptics: '<rect x="8" y="3.5" width="8" height="17" rx="2.2"/><path d="M4.5 8.5v7M19.5 8.5v7M2 10.5v3M22 10.5v3"/>',
  motion: '<path d="M3.5 15c3-6 6-6 8.5-3s5.5 3 8.5-3"/><circle cx="20.5" cy="9" r=".6"/>',
  patterns: '<path d="M7 3.8l1.5 3 3.3.5-2.4 2.3.6 3.3L7 11.3l-3 1.6.6-3.3-2.4-2.3 3.3-.5z"/><path d="M14 19.5l3.5-6 3.5 6z"/><circle cx="17.5" cy="6.8" r="3"/><path d="M3 18.2c1.4-1.6 2.8 1.6 4.2 0s2.8 1.6 4.2 0"/>',
  contrast: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17A8.5 8.5 0 0 0 12 3.5z" class="icon-fill"/>',
  star: '<path d="M12 3.6l2.5 5.2 5.6.8-4.1 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z"/>',
  rotate: '<rect x="7.5" y="3" width="9" height="16" rx="2"/><path d="M10.5 16h3"/><path d="M3 13a9 9 0 0 0 7 8.2M21 11a9 9 0 0 0-7-8.2"/><path d="M8.6 18.8l1.4 2.4-2.6.9M15.4 5.2L14 2.8l2.6-.9"/>',
  next: '<path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5"/>',
  home: '<path d="M3.5 11.5L12 4l8.5 7.5"/><path d="M6 10.5V20h12v-9.5"/><path d="M10 20v-5.5h4V20"/>',
  play: '<path d="M8 5.5l10 6.5-10 6.5z"/>'
};

let sprite = null;
export function installSprite() {
  if (sprite) return sprite;
  const defs = svgEl("defs");
  const h = G.h;
  const vb = `0 0 100 ${r2(h)}`;
  defs.append(svgEl("clipPath", { id: "ring-front-clip", clipPathUnits: "userSpaceOnUse" }, [svgEl("path", { d: G.front })]));
  defs.append(svgEl("clipPath", { id: "ring-outer-clip", clipPathUnits: "userSpaceOnUse" }, [svgEl("path", { d: G.outer })]));
  defs.append(svgEl("clipPath", { id: "ring-hole-clip", clipPathUnits: "userSpaceOnUse" }, [svgEl("ellipse", { cx: op.cx, cy: op.cy, rx: op.rx, ry: op.ry })]));
  // shared dough, hole and gloss gradients
  defs.append(svgEl("linearGradient", { id: "dough-g", gradientUnits: "userSpaceOnUse", x1: 0, y1: 30, x2: 0, y2: h }, [
    svgEl("stop", { offset: 0, "stop-color": DOUGH.light }),
    svgEl("stop", { offset: .55, "stop-color": DOUGH.base }),
    svgEl("stop", { offset: 1, "stop-color": DOUGH.dark })
  ]));
  defs.append(svgEl("linearGradient", { id: "dough-side-g", gradientUnits: "userSpaceOnUse", x1: 0, y1: 0, x2: 100, y2: 0 }, [
    svgEl("stop", { offset: 0, "stop-color": DOUGH.deep, "stop-opacity": .28 }),
    svgEl("stop", { offset: .3, "stop-color": DOUGH.deep, "stop-opacity": 0 }),
    svgEl("stop", { offset: .75, "stop-color": "#FFF0C8", "stop-opacity": .18 }),
    svgEl("stop", { offset: 1, "stop-color": DOUGH.deep, "stop-opacity": .12 })
  ]));
  defs.append(svgEl("linearGradient", { id: "hole-g", gradientUnits: "userSpaceOnUse", x1: 0, y1: op.cy - op.ry, x2: 0, y2: op.cy + op.ry }, [
    svgEl("stop", { offset: 0, "stop-color": "#7E4419" }),
    svgEl("stop", { offset: .45, "stop-color": "#BE7A3A" }),
    svgEl("stop", { offset: 1, "stop-color": "#E8B06A" })
  ]));
  defs.append(svgEl("radialGradient", { id: "pearl-g", cx: .62, cy: .32, r: .75 }, [
    svgEl("stop", { offset: 0, "stop-color": "#FFFFFF" }), svgEl("stop", { offset: .6, "stop-color": "#FBF3E6" }), svgEl("stop", { offset: 1, "stop-color": "#D9C6A8" })
  ]));
  defs.append(svgEl("radialGradient", { id: "spec-g" }, [
    svgEl("stop", { offset: 0, "stop-color": "#FFFFFF", "stop-opacity": .95 }),
    svgEl("stop", { offset: .5, "stop-color": "#FFFFFF", "stop-opacity": .5 }),
    svgEl("stop", { offset: 1, "stop-color": "#FFFFFF", "stop-opacity": 0 })
  ]));
  // Contact band a donut casts on the one below it.
  defs.append(svgEl("linearGradient", { id: "ring-ao-g", x1: 0, y1: h * .62, x2: 0, y2: h + 5, gradientUnits: "userSpaceOnUse" }, [
    svgEl("stop", { offset: 0, "stop-color": "#6A3418", "stop-opacity": 0 }),
    svgEl("stop", { offset: .55, "stop-color": "#6A3418", "stop-opacity": .3 }),
    svgEl("stop", { offset: 1, "stop-color": "#6A3418", "stop-opacity": 0 })
  ]));
  defs.append(svgEl("symbol", { id: "ring-ao", viewBox: vb, overflow: "visible" }, [
    svgEl("path", { d: G.bottom, fill: "none", stroke: "url(#ring-ao-g)", "stroke-width": 8, "stroke-linecap": "round", transform: "translate(0 2)" })
  ]));
  const crestFront = `M${cr.cx - cr.rx} ${cr.cy}A${cr.rx} ${cr.ry} 0 0 0 ${cr.cx + cr.rx} ${cr.cy}`;
  for (const [name, c] of Object.entries(ringColors)) {
    const id = (s) => `r-${name}-${s}`;
    const edge = glazeEdge(name);
    defs.append(svgEl("clipPath", { id: id("glaze-clip"), clipPathUnits: "userSpaceOnUse" }, [svgEl("path", { d: edge.area })]));
    defs.append(svgEl("radialGradient", { id: id("glaze"), gradientUnits: "userSpaceOnUse", cx: 64, cy: 14, fx: 70, fy: 8, r: 62 }, [
      svgEl("stop", { offset: 0, "stop-color": c.light }),
      svgEl("stop", { offset: .42, "stop-color": c.base }),
      svgEl("stop", { offset: .82, "stop-color": mix(c.base, c.dark, .55) }),
      svgEl("stop", { offset: 1, "stop-color": c.dark })
    ]));
    for (const v of ["", "-p", "-h"]) {
      const bold = v !== "";
      // body = dough + glaze + toppings + gloss; drawn whole, then the hole, then again
      // clipped to the front of the tube (so the near side covers the hole's lower part)
      const body = svgEl("g", { id: id("body" + v), "clip-path": "url(#ring-outer-clip)" }, [
        svgEl("path", { d: G.outer, fill: "url(#dough-g)" }),
        svgEl("path", { d: G.outer, fill: "url(#dough-side-g)" }),
        svgEl("path", { d: G.bottom, fill: "none", stroke: "#FFE3AE", "stroke-opacity": .45, "stroke-width": 2.6, transform: "translate(0 -4.2)" }),
        svgEl("path", { d: G.bottom, fill: "none", stroke: DOUGH.deep, "stroke-opacity": .3, "stroke-width": 3.4 }),
        // thick glaze: a soft shadow on the dough, the glaze, its rounded lip light
        svgEl("path", { d: edge.line, fill: "none", stroke: DOUGH.deep, "stroke-opacity": .32, "stroke-width": 2.4, "stroke-linecap": "round", transform: "translate(0 1.3)" }),
        svgEl("path", { d: edge.area, fill: `url(#${id("glaze")})` }),
        svgEl("path", { d: edge.line, fill: "none", stroke: c.dark, "stroke-opacity": .35, "stroke-width": 1.6, "stroke-linecap": "round", transform: "translate(0 -.4)" }),
        svgEl("path", { d: edge.line, fill: "none", stroke: c.light, "stroke-opacity": .55, "stroke-width": 1.3, "stroke-linecap": "round", transform: "translate(0 -2)" }),
        svgEl("g", { "clip-path": `url(#${id("glaze-clip")})` }, toppings(name, c, bold)),
        // painterly gloss toward the lamp (upper right)
        svgEl("path", { d: crestFront, fill: "none", stroke: "#FFFFFF", "stroke-opacity": .3, "stroke-width": 3.6, "stroke-linecap": "round", transform: "translate(0 3)", "clip-path": "url(#ring-front-clip)" }),
        svgEl("ellipse", { cx: 71, cy: 6.8, rx: 10, ry: 2.6, fill: "url(#spec-g)", opacity: .85, transform: "rotate(15 71 6.8)" }),
        svgEl("ellipse", { cx: 75, cy: 37.5, rx: 8.5, ry: 2, fill: "url(#spec-g)", opacity: .75, transform: "rotate(-17 75 37.5)" }),
        svgEl("circle", { cx: 86.5, cy: 31.5, r: 1.5, fill: "#FFFFFF", "fill-opacity": .75 }),
        v === "-h" ? svgEl("path", { d: G.outer, fill: "none", stroke: "#1A1A1A", "stroke-width": 2.4 }) : null
      ]);
      const hole = svgEl("g", { "clip-path": "url(#ring-hole-clip)" }, [
        svgEl("ellipse", { cx: op.cx, cy: op.cy, rx: op.rx, ry: op.ry, fill: "url(#hole-g)" }),
        svgEl("ellipse", { cx: op.cx, cy: op.cy - op.ry * .62, rx: op.rx * 1.04, ry: op.ry * .92, fill: mix(c.base, c.dark, .45) }),
        svgEl("ellipse", { cx: op.cx, cy: op.cy - op.ry * .62, rx: op.rx * 1.04, ry: op.ry * .92, fill: "none", stroke: c.light, "stroke-opacity": .35, "stroke-width": 1 }),
        v === "-h" ? svgEl("ellipse", { cx: op.cx, cy: op.cy, rx: op.rx, ry: op.ry, fill: "none", stroke: "#1A1A1A", "stroke-width": 2 }) : null
      ]);
      defs.append(body);
      const art = svgEl("g", { id: id("art" + v) }, [
        svgEl("use", { href: `#${id("body" + v)}` }),
        hole,
        svgEl("use", { href: `#${id("body" + v)}`, "clip-path": "url(#ring-front-clip)" })
      ]);
      defs.append(art);
      defs.append(svgEl("symbol", { id: `ring-${name}${v}`, viewBox: vb, overflow: "visible" }, [svgEl("use", { href: `#${id("art" + v)}` })]));
      defs.append(svgEl("symbol", { id: `ring-${name}${v}-front`, viewBox: vb, overflow: "visible" }, [
        svgEl("use", { href: `#${id("art" + v)}`, "clip-path": "url(#ring-front-clip)" })
      ]));
    }
    // tiny face, shown on the top donut of a stack only
    const blush = name === "rose" ? "#C83A5E" : "#FF7E9A";
    // line toppings (chocolate stripes) get a soft clean-glaze patch so the face stays readable
    const patch = c.topping === "stripes";
    if (patch) defs.append(svgEl("radialGradient", { id: id("patch") }, [
      svgEl("stop", { offset: 0, "stop-color": mix(c.base, c.dark, .2) }), svgEl("stop", { offset: .62, "stop-color": mix(c.base, c.dark, .2) }),
      svgEl("stop", { offset: 1, "stop-color": mix(c.base, c.dark, .2), "stop-opacity": 0 })
    ]));
    defs.append(svgEl("symbol", { id: `face-${name}`, viewBox: vb, overflow: "visible" }, [
      patch ? svgEl("ellipse", { cx: 50, cy: 43.4, rx: 13.5, ry: 6.2, fill: `url(#${id("patch")})` }) : null,
      svgEl("ellipse", { cx: 40.2, cy: 45.2, rx: 2.8, ry: 1.35, fill: blush, "fill-opacity": .42 }),
      svgEl("ellipse", { cx: 59.8, cy: 45.2, rx: 2.8, ry: 1.35, fill: blush, "fill-opacity": .42 }),
      svgEl("ellipse", { cx: 44.3, cy: 42, rx: 1.35, ry: 1.65, fill: c.face }),
      svgEl("ellipse", { cx: 55.7, cy: 42, rx: 1.35, ry: 1.65, fill: c.face }),
      svgEl("circle", { cx: 44.75, cy: 41.4, r: .45, fill: c.face === "#FFF1DC" ? "#45220F" : "#FFFFFF" }),
      svgEl("circle", { cx: 56.15, cy: 41.4, r: .45, fill: c.face === "#FFF1DC" ? "#45220F" : "#FFFFFF" }),
      svgEl("path", { d: "M47.7 44.6Q50 46.9 52.3 44.6", fill: "none", stroke: c.face, "stroke-width": 1, "stroke-linecap": "round" })
    ]));
  }
  // plate + dowel gradients (bounding-box units so they fit any size)
  defs.append(svgEl("linearGradient", { id: "dowel-g", x1: 0, y1: 0, x2: 1, y2: 0 }, [
    svgEl("stop", { offset: 0, "stop-color": "#B87A3C" }), svgEl("stop", { offset: .3, "stop-color": "#DDA35C" }),
    svgEl("stop", { offset: .62, "stop-color": "#FBD9A0" }), svgEl("stop", { offset: .86, "stop-color": "#D2924E" }),
    svgEl("stop", { offset: 1, "stop-color": "#A86C34" })
  ]));
  defs.append(svgEl("radialGradient", { id: "knob-g", cx: .64, cy: .32, r: .75 }, [
    svgEl("stop", { offset: 0, "stop-color": "#FFE7B8" }), svgEl("stop", { offset: .5, "stop-color": "#E2A862" }), svgEl("stop", { offset: 1, "stop-color": "#B07236" })
  ]));
  defs.append(svgEl("radialGradient", { id: "base-top-g", cx: .62, cy: .32, r: .8 }, [
    svgEl("stop", { offset: 0, "stop-color": PLATE.top }), svgEl("stop", { offset: .6, "stop-color": PLATE.mid }),
    svgEl("stop", { offset: 1, "stop-color": PLATE.edge })
  ]));
  defs.append(svgEl("linearGradient", { id: "base-band-g", x1: 0, y1: 0, x2: 1, y2: 0 }, [
    svgEl("stop", { offset: 0, "stop-color": "#D2B188" }), svgEl("stop", { offset: .5, "stop-color": PLATE.band }),
    svgEl("stop", { offset: .8, "stop-color": "#F3E0C4" }), svgEl("stop", { offset: 1, "stop-color": "#D9BC94" })
  ]));
  defs.append(svgEl("radialGradient", { id: "contact-g" }, [
    svgEl("stop", { offset: 0, "stop-color": "#8A4E3A", "stop-opacity": .42 }),
    svgEl("stop", { offset: .6, "stop-color": "#8A4E3A", "stop-opacity": .16 }),
    svgEl("stop", { offset: 1, "stop-color": "#8A4E3A", "stop-opacity": 0 })
  ]));
  defs.append(svgEl("radialGradient", { id: "glow-g" }, [
    svgEl("stop", { offset: 0, "stop-color": "#FFF8D8", "stop-opacity": 1 }),
    svgEl("stop", { offset: .55, "stop-color": "#FFD98A", "stop-opacity": .7 }),
    svgEl("stop", { offset: 1, "stop-color": "#FFD98A", "stop-opacity": 0 })
  ]));
  defs.append(svgEl("radialGradient", { id: "done-g" }, [
    svgEl("stop", { offset: 0, "stop-color": "#FFF2B0", "stop-opacity": .8 }),
    svgEl("stop", { offset: 1, "stop-color": "#F7C86A", "stop-opacity": 0 })
  ]));
  // Stars (level map) 0 0 64 64
  defs.append(svgEl("linearGradient", { id: "star-g", x1: 0, y1: 0, x2: 0, y2: 1 }, [
    svgEl("stop", { offset: 0, "stop-color": "#FFF1A8" }), svgEl("stop", { offset: .45, "stop-color": "#FFD860" }), svgEl("stop", { offset: 1, "stop-color": "#F5A623" })
  ]));
  const starD = starPath(32, 34, 26, 12.5);
  defs.append(svgEl("symbol", { id: "star-on", viewBox: "0 0 64 64" }, [
    svgEl("path", { d: starD, fill: "url(#star-g)", stroke: "#F0B040", "stroke-width": 5, "stroke-linejoin": "round" }),
    svgEl("path", { d: "M22 25C25 19 29 16 31 15", stroke: "#FFFBE0", "stroke-width": 3.4, "stroke-linecap": "round", fill: "none", opacity: .9 })
  ]));
  defs.append(svgEl("symbol", { id: "star-off", viewBox: "0 0 64 64" }, [
    svgEl("path", { d: starD, fill: "#8A5A3E", "fill-opacity": .18, stroke: "#B58A68", "stroke-opacity": .5, "stroke-width": 4, "stroke-linejoin": "round" })
  ]));
  for (const [name, body] of Object.entries(icons)) {
    const symbol = svgEl("symbol", { id: "i-" + name, viewBox: "0 0 24 24" });
    symbol.innerHTML = body;
    defs.append(symbol);
  }
  sprite = svgEl("svg", { class: "sprite", width: 0, height: 0, "aria-hidden": "true", focusable: "false" }, [defs]);
  document.body.prepend(sprite);
  return sprite;
}

export function icon(name, cls = "icon") {
  return svgEl("svg", { class: cls, viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" }, [svgEl("use", { href: "#i-" + name })]);
}
export function starIcon(on, size) {
  return svgEl("svg", { class: "star " + (on ? "on" : "off"), viewBox: "0 0 64 64", width: size, height: size, "aria-hidden": "true" }, [svgEl("use", { href: on ? "#star-on" : "#star-off" })]);
}

// A whole donut as a standalone <svg> (lifted / flying donuts).
export function ringSprite(color, W, face = false) {
  const h = W * RING.aspect;
  return svgEl("svg", { class: "ring-sprite", viewBox: `0 0 100 ${r2(G.h)}`, width: r2(W), height: r2(h), "aria-hidden": "true", overflow: "visible" }, [
    svgEl("use", { href: ringHref(color, false) }),
    face ? svgEl("use", { href: faceHref(color) }) : null
  ]);
}

// --- peg --------------------------------------------------------------------
// Draw one peg into an <svg> whose user units are CSS px of the phone box.
// p = { x, yb, W, rings[], hidden (count of top donuts not drawn), raised, lifted }
export function drawPeg(svg, p) {
  const { x, yb, W } = p;
  const rx = RING.baseRx * W, ry = RING.baseRy * W, band = RING.band * W;
  const dw = RING.dowel * W, tip = yb - RING.tip * W;
  const g = svgEl;
  const nodes = [];
  // soft contact shadow on the counter
  nodes.push(g("ellipse", { class: "contact", cx: r2(x - .03 * W), cy: r2(yb + band + ry * .35), rx: r2(.72 * W), ry: r2(.2 * W), fill: "url(#contact-g)" }));
  nodes.push(g("ellipse", { class: "sel-glow", cx: r2(x), cy: r2(yb + band * .4), rx: r2(1.1 * W), ry: r2(.48 * W), fill: "url(#glow-g)" }));
  nodes.push(g("ellipse", { class: "done-glow", cx: r2(x), cy: r2(yb + band * .4), rx: r2(.92 * W), ry: r2(.4 * W), fill: "url(#done-g)" }));
  // cream plate: side band, top face, a shallow well and a pink trim
  const bandD = `M${r2(x - rx)} ${r2(yb)}A${r2(rx)} ${r2(ry)} 0 0 0 ${r2(x + rx)} ${r2(yb)}V${r2(yb + band)}A${r2(rx)} ${r2(ry)} 0 0 1 ${r2(x - rx)} ${r2(yb + band)}Z`;
  nodes.push(g("path", { class: "base-band", d: bandD, fill: "url(#base-band-g)" }));
  nodes.push(g("ellipse", { class: "base-top", cx: r2(x), cy: r2(yb), rx: r2(rx), ry: r2(ry), fill: "url(#base-top-g)" }));
  nodes.push(g("ellipse", { cx: r2(x), cy: r2(yb + ry * .05), rx: r2(rx * .66), ry: r2(ry * .62), fill: "#E8CFAE", "fill-opacity": .35 }));
  nodes.push(g("ellipse", { cx: r2(x), cy: r2(yb), rx: r2(rx * .86), ry: r2(ry * .84), fill: "none", stroke: PLATE.trim, "stroke-opacity": .6, "stroke-width": r2(Math.max(1, .022 * W)) }));
  nodes.push(g("path", { class: "base-rim", d: `M${r2(x - rx + 1)} ${r2(yb)}A${r2(rx - 1)} ${r2(ry - .8)} 0 0 0 ${r2(x + rx - 1)} ${r2(yb)}`, fill: "none", stroke: "#FFFFFF", "stroke-opacity": .8, "stroke-width": 1.2 }));
  nodes.push(g("ellipse", { cx: r2(x + .01 * W), cy: r2(yb + .008 * W), rx: r2(dw * .9), ry: r2(dw * .38), fill: "#9A6A40", "fill-opacity": .35 }));
  // state rings around the plate
  nodes.push(g("ellipse", { class: "valid-ring", cx: r2(x), cy: r2(yb + band * .5), rx: r2(rx + .08 * W), ry: r2(ry + .06 * W + band * .5), fill: "none" }));
  nodes.push(g("ellipse", { class: "bad-ring", cx: r2(x), cy: r2(yb + band * .5), rx: r2(rx + .08 * W), ry: r2(ry + .06 * W + band * .5), fill: "none" }));
  const rings = p.rings, shown = rings.length - (p.hidden || 0);
  const raisedFrom = shown - (p.raised || 0);
  const lift = (k) => (k >= raisedFrom ? .1 * W : 0);
  const box = (k) => ({ x: r2(x - W / 2), y: r2(ringCentreY(yb, W, k) - lift(k) - RING.centre * W), width: r2(W), height: r2(W * RING.aspect) });
  const backs = g("g", { class: "ring-backs" });
  const fronts = g("g", { class: "ring-fronts" });
  for (let k = 0; k < shown; k++) {
    backs.append(g("use", { href: ringHref(rings[k], false), ...box(k), "data-k": k, class: "rb" }));
    if (!(k === raisedFrom && p.raised)) fronts.append(g("use", { href: "#ring-ao", ...box(k), class: "ao", "data-k": k }));
    fronts.append(g("use", { href: ringHref(rings[k], true), ...box(k), "data-k": k, class: "rf" }));
  }
  // a tiny face on the top donut only
  if (shown > 0) fronts.append(g("use", { href: faceHref(rings[shown - 1]), ...box(shown - 1), "data-k": shown - 1, class: "rf face" }));
  nodes.push(backs);
  // wooden dowel with a round knob
  const kr = dw * .78;
  const dowel = g("g", { class: "dowel" }, [
    g("rect", { x: r2(x - dw / 2), y: r2(tip), width: r2(dw), height: r2(yb - tip), rx: r2(dw * .3), fill: "url(#dowel-g)" }),
    g("path", { d: `M${r2(x + dw * .1)} ${r2(yb - 3)}V${r2(tip + kr)}`, stroke: "#FFF1D6", "stroke-opacity": .6, "stroke-width": r2(Math.max(1, dw * .14)), "stroke-linecap": "round", fill: "none" }),
    g("circle", { cx: r2(x), cy: r2(tip), r: r2(kr), fill: "url(#knob-g)" }),
    g("ellipse", { cx: r2(x + kr * .3), cy: r2(tip - kr * .38), rx: r2(kr * .34), ry: r2(kr * .22), fill: "#FFF6E2", "fill-opacity": .85 })
  ]);
  dowel.style.transformOrigin = `${r2(x)}px ${r2(yb)}px`;
  nodes.push(dowel);
  nodes.push(fronts);
  if (p.lifted) {
    const k = shown - 1;
    const sy = k >= 0 ? ringCentreY(yb, W, k) - .02 * W : yb;
    nodes.push(g("ellipse", { class: "lift-shadow", cx: r2(x - .04 * W), cy: r2(sy), rx: r2(.3 * W), ry: r2(.1 * W), fill: "#6A3418", "fill-opacity": .16 }));
  }
  // finished peg: a golden star (owner UI kit) sits on the knob
  const capW = .5 * W;
  nodes.push(g("image", { class: "cap", href: "art/bakery/star.webp", x: r2(x - capW / 2), y: r2(tip - capW * .78), width: r2(capW), height: r2(capW * 109 / 113), preserveAspectRatio: "xMidYMid meet" }));
  // invalid / valid chips (shape cue, not only colour)
  const chip = (cls, iconName) => g("g", { class: cls, transform: `translate(${r2(x + rx * .78)} ${r2(yb - ry * .2)})` }, [
    g("circle", { r: 9.5 }), g("use", { href: "#i-" + iconName, x: -6.5, y: -6.5, width: 13, height: 13 })
  ]);
  nodes.push(chip("chip chip-bad", "close"), chip("chip chip-ok", "check"));
  svg.replaceChildren(...nodes);
  return { tip, hoverBase: tip };
}
