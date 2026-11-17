// The Desk's drawings (ported from the contest winner "The Fix", B/3, art.js). Every drawing is an SVG string with no
// style attribute and no <text>: words are HTML, so nothing can fall under 12 px when a drawing scales, and the strict
// Content-Security-Policy (no inline styles) holds. Stylised illustration, not a map of anything. Browser only: the
// Node tests never import this module.

function r2(n) {
  return Math.round(n * 100) / 100;
}

/** Bearing 0 = up, clockwise, in degrees. */
function pol(cx, cy, r, bearing) {
  const a = ((bearing - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic drawing bits from a key id (16 hex digits). Decoration only: no security rests on it. */
function kidSeed(kid) {
  const bytes = [];
  for (let i = 0; i < 16; i += 2) bytes.push(parseInt(String(kid).slice(i, i + 2), 16) || 0);
  return { bytes, rng: seeded(((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0) };
}

/** A smooth closed blob (quadratic curves through midpoints). */
function blob(cx, cy, rx, ry, rnd, n, wob) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (rnd() - 0.5) * 2 * wob;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const m0 = mid(pts[n - 1], pts[0]);
  let d = `M${r2(m0[0])} ${r2(m0[1])}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const m = mid(p, pts[(i + 1) % n]);
    d += `Q${r2(p[0])} ${r2(p[1])} ${r2(m[0])} ${r2(m[1])}`;
  }
  return `${d}Z`;
}

// ---- state glyphs: a distinct silhouette per state, never colour alone ----
const QMARK = '<path class="gs" d="M18.6 19.2c0-3.4 2.4-5.6 5.5-5.6 3.2 0 5.4 2 5.4 4.8 0 4.4-5.4 4.6-5.4 9.2"/><circle class="gp" cx="24.1" cy="34.4" r="2.2"/>';
const BANG = '<path class="gw" d="M24 14v13"/><circle class="gwp" cx="24" cy="33.5" r="2.3"/>';
const BANG_INK = '<path class="gs" d="M24 17v12"/><circle class="gp" cx="24" cy="35" r="2.2"/>';
const GL = {
  // pass / verified: a solid circle and a tick
  pass: '<circle class="gf" cx="24" cy="24" r="21"/><path class="gw" d="M14 25.5l7.2 7.2L34.5 16"/>',
  // fail / invalid: a solid diamond and a cross
  fail: '<path class="gf" d="M24 2.5L45.5 24 24 45.5 2.5 24z"/><path class="gw" d="M16.5 16.5l15 15M31.5 16.5l-15 15"/>',
  // unavailable / unverifiable: a hollow dashed hexagon and a question mark
  unavailable: `<path class="go gd" d="M24 3l18 10.5v21L24 45 6 34.5v-21z"/>${QMARK}`,
  // drift: note = hollow circle and i; warning = hollow triangle and !; blocking = solid octagon and !
  info: '<circle class="go" cx="24" cy="24" r="20.5"/><path class="gs" d="M24 21.5v12"/><circle class="gp" cx="24" cy="15" r="2.4"/>',
  warn: `<path class="go" d="M24 5L44.5 40.5h-41z"/>${BANG_INK}`,
  block: `<path class="gf" d="M15.5 3h17L45 15.5v17L32.5 45h-17L3 32.5v-17z"/>${BANG}`,
};
GL.verified = GL.pass;
GL.invalid = GL.fail;
GL.unverifiable = GL.unavailable;

/** A state's glyph. Only a known state name reaches the markup; anything else draws the "no verdict" hexagon. */
export function glyph(kind) {
  const k = Object.hasOwn(GL, kind) ? kind : "unavailable";
  return `<svg class="glyph glyph--${k}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${GL[k]}</svg>`;
}

// ---- port emblems: one drawn motif per tool ----
const EM = {
  check:
    '<g class="e-acc-soft"><circle cx="50" cy="30" r="20"/><circle cx="67.3" cy="60" r="20"/><circle cx="32.7" cy="60" r="20"/></g>' +
    '<g class="e-ink"><circle cx="50" cy="30" r="20"/><circle cx="67.3" cy="60" r="20"/><circle cx="32.7" cy="60" r="20"/></g>' +
    '<path class="e-acc" d="M50 44.5l-5.6 9.6h11.2z"/><circle class="e-dot" cx="50" cy="50" r="2.6"/>',
  drift:
    '<path class="e-ink-thin" d="M8 82c8-5 14 5 22 0s14 5 22 0 14 5 22 0 12 4 16 1"/>' +
    '<path class="e-ink e-dash" d="M12 66L88 26"/><path class="e-acc-line" d="M54 46l-6 14"/><path class="e-acc-line" d="M44.5 53.5l3.5 6.5 5-4.2"/>' +
    '<path class="e-paper" d="M32 62h30l-6 10H38z"/><path class="e-acc" d="M46 60V38l14 22z"/><circle class="e-dot" cx="69" cy="42.5" r="2.4"/>',
  verify:
    '<path class="e-paper" d="M24 20h46v54H24z"/><path class="e-paper" d="M18 14c4-4 12-4 12 3v3H18z"/><path class="e-ink-thin" d="M32 34h26M32 42h30M32 50h22"/>' +
    '<path class="e-acc" d="M56 80l-5 14 8-4 3 6 4-14z"/><circle class="e-acc" cx="62" cy="68" r="13"/><circle class="e-ring" cx="62" cy="68" r="7.5"/><circle class="e-ring" cx="62" cy="68" r="3.4"/>',
  key:
    '<path class="e-acc" d="M42 8h16v34H42z"/><path class="e-ink" d="M38 42h24v10H38zM30 52h40v10H30z"/>' +
    '<ellipse class="e-paper" cx="50" cy="82" rx="26" ry="9"/><ellipse class="e-ring2" cx="50" cy="82" rx="19" ry="6"/><ellipse class="e-ring2" cx="50" cy="82" rx="10" ry="3"/><path class="e-ink-thin" d="M50 62v11"/>',
  sign:
    '<path class="e-paper" d="M10 32l40 7v44L10 76zM90 32l-40 7v44l40-7z"/><path class="e-ink-thin" d="M18 46l26 4.5M18 56l26 4.5M18 66l26 4.5M82 46L56 50.5M82 56l-26 4.5M82 66l-26 4.5"/>' +
    '<path class="e-acc" d="M66 10c16 4 20 22 6 42l-4 5-3-5c-6-14-6-28 1-42z"/><path class="e-ink-thin" d="M69 57L58 80"/>',
  about:
    '<circle class="e-paper" cx="50" cy="50" r="34"/><circle class="e-ink-thin" cx="50" cy="50" r="26"/>' +
    '<path class="e-acc" d="M50 18l7 32-7 32-7-32z"/><circle class="e-dot" cx="50" cy="50" r="3"/>',
};

export function emblem(id) {
  const k = Object.hasOwn(EM, id) ? id : "about";
  return `<svg class="emblem emblem--${k}" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${EM[k]}</svg>`;
}

// ---- the compass card (static) ----
export function dialCard() {
  let minor = "";
  let mid = "";
  let major = "";
  for (let i = 0; i < 360; i++) {
    const len = i % 30 === 0 ? 28 : i % 10 === 0 ? 19 : i % 5 === 0 ? 12 : 6;
    const p = pol(500, 500, 480 - len, i);
    const q = pol(500, 500, 480, i);
    const seg = `M${r2(p[0])} ${r2(p[1])}L${r2(q[0])} ${r2(q[1])}`;
    if (i % 30 === 0) major += seg;
    else if (i % 10 === 0) mid += seg;
    else minor += seg;
  }
  let rh = "";
  for (let i = 0; i < 32; i++) {
    const q = pol(500, 500, 436, i * 11.25);
    rh += `M500 500L${r2(q[0])} ${r2(q[1])}`;
  }
  let star = "";
  for (let i = 0; i < 8; i++) {
    const a = pol(500, 500, 436, i * 45);
    const b = pol(500, 500, 70, i * 45 + 22.5);
    const c = pol(500, 500, 70, i * 45 - 22.5);
    star += `M${r2(a[0])} ${r2(a[1])}L${r2(b[0])} ${r2(b[1])}L500 500L${r2(c[0])} ${r2(c[1])}Z`;
  }
  return (
    '<svg class="dial__card" viewBox="0 0 1000 1000" aria-hidden="true" focusable="false">' +
    '<circle class="d-face" cx="500" cy="500" r="440"/>' +
    `<path class="d-rhumb" d="${rh}"/><path class="d-star" d="${star}"/>` +
    '<circle class="d-range" cx="500" cy="500" r="150"/><circle class="d-range" cx="500" cy="500" r="300"/>' +
    '<circle class="d-outer" cx="500" cy="500" r="480" pathLength="1"/><circle class="d-inner" cx="500" cy="500" r="440"/>' +
    `<path class="d-tick d-tick--minor" d="${minor}"/><path class="d-tick d-tick--mid" d="${mid}"/><path class="d-tick d-tick--major" d="${major}"/>` +
    "</svg>"
  );
}

// ---- the fix: three rings, one per checker ----
export const GEOM = { M: [500, 440], D: 175, bearing: { validator: 0, atlas: 120, customs: 240 }, order: ["validator", "atlas", "customs"] };

function station(k) {
  return pol(GEOM.M[0], GEOM.M[1], GEOM.D, GEOM.bearing[k]);
}

function reflect(M, A, B) {
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const t = ((M[0] - A[0]) * dx + (M[1] - A[1]) * dy) / (dx * dx + dy * dy);
  const px = A[0] + t * dx;
  const py = A[1] + t * dy;
  return [2 * px - M[0], 2 * py - M[1]];
}

function arcPath(cx, cy, r, a0, a1) {
  const p = pol(cx, cy, r, a0);
  const q = pol(cx, cy, r, a1);
  const large = (a1 - a0 + 360) % 360 > 180 ? 1 : 0;
  return `M${r2(p[0])} ${r2(p[1])}A${r} ${r} 0 ${large} 1 ${r2(q[0])} ${r2(q[1])}`;
}

function ghostMark(x, y) {
  return `<g class="cand" transform="translate(${r2(x)} ${r2(y)}) scale(1.55)"><path class="cand__hex" d="M0-22l19 11v22L0 22-19 11v-22z"/><g transform="translate(-24 -24)">${QMARK}</g></g>`;
}

/**
 * The navigator's fix of a gate verdict. Pass: the ring passes through the site; fail: the ring misses it, drawn
 * broken; unavailable: a dotted, unfinished ring with a question mark. With states null, only the three stations
 * (no run yet: no fix at all).
 *
 * :param states: {validator, atlas, customs} each pass | fail | unavailable, or null.
 * :param overall: The report's overall state.
 */
export function fix(states, overall) {
  const M = GEOM.M;
  let out = '<g class="fix__bearings">';
  if (states) {
    for (const key of GEOM.order) {
      const c = station(key);
      if (states[key] === "pass") out += `<path class="lop" d="M${r2(c[0])} ${r2(c[1])}L${M[0]} ${M[1]}"/>`;
    }
  }
  out += '</g><g class="fix__rings">';
  if (states) {
    for (const key of GEOM.order) {
      const c = station(key);
      const st = states[key] === "pass" || states[key] === "fail" ? states[key] : "unavailable";
      const u = [(c[0] - M[0]) / GEOM.D, (c[1] - M[1]) / GEOM.D];
      const common = `data-k="${key}" data-state="${st}"`;
      if (st === "pass") {
        out += `<circle class="ring ring--pass" ${common} cx="${r2(c[0])}" cy="${r2(c[1])}" r="${GEOM.D}"/>`;
      } else if (st === "fail") {
        out += `<circle class="ring ring--fail" ${common} cx="${r2(c[0] + u[0] * 52)}" cy="${r2(c[1] + u[1] * 52)}" r="${GEOM.D - 26}"/>`;
      } else {
        const bs = GEOM.bearing[key];
        out += `<path class="ring ring--unavail" ${common} d="${arcPath(c[0], c[1], GEOM.D, bs + 200, bs + 390)}"/>`;
        const e = pol(c[0], c[1], GEOM.D, bs + 390);
        out += `<g class="ring__q" transform="translate(${r2(e[0])} ${r2(e[1])}) scale(1.8) translate(-24 -24)">${QMARK}</g>`;
      }
    }
  }
  out += '</g><g class="fix__stations">';
  for (const key of GEOM.order) {
    const c = station(key);
    out += `<circle class="stn-halo" cx="${r2(c[0])}" cy="${r2(c[1])}" r="19"/><circle class="stn" cx="${r2(c[0])}" cy="${r2(c[1])}" r="7"/>`;
  }
  out += '</g><g class="fix__site">';
  if (states && overall === "pass") {
    const h = [pol(M[0], M[1], 15, 0), pol(M[0], M[1], 15, 120), pol(M[0], M[1], 15, 240)];
    out += `<path class="cocked" d="M${h.map((p) => `${r2(p[0])} ${r2(p[1])}`).join("L")}Z"/><circle class="mk-halo" cx="${M[0]}" cy="${M[1]}" r="30"/><circle class="mk" cx="${M[0]}" cy="${M[1]}" r="6"/>`;
  } else if (states && overall === "unavailable") {
    const solid = GEOM.order.filter((key) => states[key] === "pass");
    out += ghostMark(M[0], M[1]);
    if (solid.length >= 2) {
      const m2 = reflect(M, station(solid[0]), station(solid[1]));
      out += ghostMark(m2[0], m2[1]);
    }
  } else if (states) {
    out += `<g transform="translate(${M[0]} ${M[1]}) scale(1.5) translate(-24 -24)" class="mk-fail">${GL.fail}</g>`;
  }
  out += "</g>";
  return `<svg class="fix__svg" viewBox="0 0 1000 1000" aria-hidden="true" focusable="false">${out}</svg>`;
}

/** Where a station sits, as a percentage of the 1000 box, for the HTML badges. */
export function stationPct(k) {
  const c = station(k);
  return [c[0] / 10, c[1] / 10];
}

// ---- a wax seal drawn from a key id ----
function rosettePaths(kid, R) {
  const { bytes: b, rng } = kidSeed(kid);
  const specs = [
    { k: 6 + (b[0] % 9), u: 0.55 + rng() * 0.4, rot: b[3] },
    { k: 4 + (b[1] % 8), u: 0.5 + rng() * 0.45, rot: b[3] * 0.5 },
    { k: 9 + (b[2] % 8), u: 0.4 + rng() * 0.5, rot: 0 },
  ];
  return specs.map((sp, li) => {
    const Rr = R * (li === 0 ? 0.86 : li === 1 ? 0.6 : 0.34);
    const r = Rr / sp.k;
    const d = r * sp.u * (li === 2 ? 1.4 : 1.05);
    const a = (sp.rot * Math.PI) / 180;
    const pts = [];
    for (let i = 0; i <= 420; i++) {
      const t = (i / 420) * Math.PI * 2;
      const x = (Rr - r) * Math.cos(t) + d * Math.cos(((Rr - r) / r) * t);
      const y = (Rr - r) * Math.sin(t) - d * Math.sin(((Rr - r) / r) * t);
      pts.push([x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
    }
    return `M${pts.map((p) => `${r2(p[0])} ${r2(p[1])}`).join("L")}Z`;
  });
}

/** A wax seal. state: verified | invalid | unverifiable | blank (a die before it is pressed). */
export function seal(kid, state) {
  // The key id may come from a fetched signature: only the numbers parsed from it reach the markup.
  const id = kid || "0000000000000000";
  const { bytes: b } = kidSeed(id);
  const rnd = seeded(b[6] * 256 + b[7] + 17);
  const edge = [];
  const n = 18 + (b[4] % 10);
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const rr = 98 + (i % 2 ? -3.4 : 2.2) + (rnd() - 0.5) * 3;
    edge.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  const d = `M${edge.map((p) => `${r2(p[0])} ${r2(p[1])}`).join("L")}Z`;
  const ros = rosettePaths(id, 80);
  let dots = "";
  const nd = 10 + (b[5] % 14);
  for (let i = 0; i < nd; i++) {
    const pd = pol(0, 0, 90, (360 / nd) * i);
    dots += `<circle cx="${r2(pd[0])}" cy="${r2(pd[1])}" r="1.9"/>`;
  }
  const body =
    '<g class="seal__impress"><circle class="seal__rim" cx="0" cy="0" r="92"/><circle class="seal__rim2" cx="0" cy="0" r="84.5"/>' +
    `<g class="seal__dots">${dots}</g><path class="seal__line seal__line--a" d="${ros[0]}"/><path class="seal__line seal__line--b" d="${ros[1]}"/>` +
    `<path class="seal__line seal__line--c" d="${ros[2]}"/><circle class="seal__core" cx="0" cy="0" r="7"/></g>`;
  const st = ["verified", "invalid", "unverifiable"].includes(state) ? state : "blank";
  const cls = `seal seal--${st}`;
  if (st === "unverifiable" || st === "blank") {
    return `<svg class="${cls}" viewBox="-110 -110 220 220" aria-hidden="true" focusable="false"><path class="seal__ghost" d="${d}"/>${body}<g transform="translate(-24 -24)">${st === "unverifiable" ? QMARK : ""}</g></svg>`;
  }
  let crack = "";
  if (st === "invalid") {
    crack =
      '<path class="seal__crack" d="M-96 -30l30 14-14 18 36 10-12 24 40 6-6 22 28 4"/><path class="seal__crack seal__crack--b" d="M-4 -98l10 26-18 16 22 20-14 20 26 14"/>' +
      '<path class="seal__chip" d="M52 -62l26 22-16 8 10 18-24-6z"/>';
  }
  return `<svg class="${cls}" viewBox="-110 -110 220 220" aria-hidden="true" focusable="false"><path class="seal__wax" d="${d}"/><path class="seal__shine" d="M-70 -50A86 86 0 0 1 20 -84"/>${body}${crack}</svg>`;
}

// ---- the chart paper ----
export function chart() {
  const rnd = seeded(20261117);
  let gr = "";
  for (let i = -200; i <= 1800; i += 100) gr += `M${i} -100V1000`;
  for (let j = -100; j <= 1000; j += 100) gr += `M-200 ${j}H1800`;
  let rh = "";
  for (const node of [[240, 700], [1380, 240]]) {
    for (let i = 0; i < 32; i++) {
      const q = pol(node[0], node[1], 1500, i * 11.25 + 3);
      rh += `M${node[0]} ${node[1]}L${r2(q[0])} ${r2(q[1])}`;
    }
  }
  let cont = "";
  [[1120, 640, 1], [1120, 640, 0.78], [1120, 640, 0.56], [1120, 640, 0.34], [330, 250, 1], [330, 250, 0.7], [330, 250, 0.42]].forEach((c, n) => {
    cont += `<path class="c-contour${n % 2 ? " c-contour--dash" : ""}" d="${blob(c[0], c[1], 330 * c[2], 210 * c[2], rnd, 11, 0.16)}"/>`;
  });
  let land = "";
  for (const L of [[1650, 110, 190, 110], [20, 950, 250, 110], [820, 975, 220, 60]]) {
    const d = blob(L[0], L[1], L[2], L[3], rnd, 10, 0.2);
    land += `<path class="c-land" d="${d}"/><path class="c-hatch" d="${d}"/><path class="c-coast" d="${d}"/>`;
  }
  for (const L of [[690, 120, 34, 18], [1010, 835, 26, 14], [1390, 520, 20, 12], [210, 330, 28, 16], [520, 850, 18, 10]]) {
    const d = blob(L[0], L[1], L[2], L[3], rnd, 8, 0.28);
    land += `<path class="c-land" d="${d}"/><path class="c-hatch" d="${d}"/><path class="c-coast" d="${d}"/>`;
  }
  let marks = "";
  for (let i = 0; i < 26; i++) {
    const x = 80 + rnd() * 1440;
    const y = 70 + rnd() * 760;
    marks += `M${r2(x - 4)} ${r2(y)}h8M${r2(x)} ${r2(y - 4)}v8`;
  }
  const far =
    '<svg class="chart chart--far" viewBox="-100 -60 1800 1020" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">' +
    '<defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><path class="c-hatchline" d="M0 0V7"/></pattern></defs>' +
    `<path class="c-grat" d="${gr}"/><path class="c-rhumb" d="${rh}"/>${cont}<path class="c-marks" d="${marks}"/></svg>`;
  const near = `<svg class="chart chart--near" viewBox="-100 -60 1800 1020" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${land}</svg>`;
  const grain =
    '<svg class="paper__grain" aria-hidden="true" focusable="false"><filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="11" stitchTiles="stitch"/>' +
    '<feColorMatrix values="0 0 0 0 .07 0 0 0 0 .16 0 0 0 0 .29 0 0 0 .42 0"/></filter><rect width="100%" height="100%" filter="url(#grain)"/></svg>';
  return `${far}${near}${grain}<div class="paper__veil"></div><div class="grad grad--t"></div><div class="grad grad--b"></div><div class="grad grad--l"></div><div class="grad grad--r"></div><div class="neat"></div>`;
}

// ---- drift: the plotted course and the drift vector ----
/** mode: info | warn | block, the worst severity of a real reading; null: no reading yet. The vector shows the
 * severity class, not a measured distance. */
export function course(mode) {
  let o = '<path class="cv-wave" d="M20 600c30-14 52 14 82 0s52 14 82 0 52 14 82 0 52 14 82 0 52 14 82 0 52 14 82 0 52 14 82 0 52 14 82 0 52 14 82 0 52 14 82 0"/>';
  o += `<path class="cv-contour" d="${blob(450, 320, 420, 250, seeded(77), 12, 0.1)}"/><path class="cv-contour cv-contour--b" d="${blob(450, 320, 310, 175, seeded(78), 12, 0.1)}"/>`;
  const vessel = (x, y) =>
    `<g class="cv-vessel" transform="translate(${x} ${y}) scale(1.9)"><path class="cv-hull" d="M-28 8h56l-12 18h-32z"/><path class="cv-sail" d="M-4 4V-46L24 4z"/><path class="cv-sail cv-sail--b" d="M-10 4V-30L-26 4z"/></g>`;
  const flag = (x, y) =>
    `<g class="cv-flag" transform="translate(${x} ${y}) scale(1.9)"><path class="cv-pole" d="M0 0V-54"/><path class="cv-pennant" d="M0-54h34l-9 11 9 11H0z"/><circle class="cv-foot" cx="0" cy="0" r="6"/></g>`;
  if (mode === "info") {
    o += '<path class="cv-course" d="M50 470C170 450 250 420 300 390"/><path class="cv-course cv-course--next" d="M300 390C450 300 600 220 850 120"/>';
    o += `${flag(300, 390)}<path class="cv-vec cv-vec--info" d="M312 398L408 440"/><path class="cv-arrow cv-arrow--info" d="M388 425l24 17-28 5"/>${vessel(500, 490)}`;
  } else if (mode === "warn") {
    o += `<path class="cv-course cv-course--none" d="M50 470C170 450 250 420 300 390"/><circle class="cv-lost" cx="300" cy="390" r="44"/><g transform="translate(272 362) scale(1.2)">${QMARK}</g>`;
    o += vessel(560, 440);
  } else if (mode === "block") {
    o += `<path class="cv-course" d="M50 470C170 450 250 420 300 390C450 300 600 220 850 120"/>${flag(300, 390)}`;
    o += `<path class="cv-vec cv-vec--block" d="M312 396C420 440 560 490 700 520"/><path class="cv-arrow cv-arrow--block" d="M672 502l32 20-38 10"/>${vessel(770, 520)}`;
    o += `<g class="cv-hazard" transform="translate(700 330) scale(2.4)">${GL.block}</g>`;
  } else {
    o += `<path class="cv-course cv-course--none" d="M50 470C170 450 250 420 300 390C450 300 600 220 850 120"/>${vessel(300, 420)}`;
  }
  return `<svg class="course__svg" viewBox="0 0 900 640" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${o}</svg>`;
}

// ---- the signet die ----
export function die() {
  return (
    '<svg class="die__svg" viewBox="0 0 400 262" aria-hidden="true" focusable="false">' +
    '<path class="die__handle" d="M158 24c0-14 10-22 42-22s42 8 42 22v128h-84z"/><path class="die__grip" d="M158 64h84M158 92h84M158 120h84"/>' +
    '<path class="die__neck" d="M142 152h116l10 26H132z"/><path class="die__base" d="M110 178h180v38H110z"/><path class="die__face" d="M120 216h160v14c0 8-30 14-80 14s-80-6-80-14z"/>' +
    "</svg>"
  );
}

/** The chat-bubble icon of the Assistant button. */
export function chatIcon() {
  return '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M4 6h24v16H15l-6 5v-5H4z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M16 9l3 4.5h-6z" fill="currentColor"/><path d="M16 18v-4" stroke="currentColor" stroke-width="2.2"/></svg>';
}
