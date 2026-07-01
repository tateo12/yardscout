// ADU fit engine (P1). Pure geometry, no network. See docs/ADU_FIT_PLAN.md.
//
// Everything runs in a LOCAL planar frame in meters (east=x, north=y) about the parcel centroid.
// For a convex parcel the buildable zone is an intersection of inset half-planes, so it stays convex and a
// rectangle fits iff its 4 corners satisfy every constraint. Non-convex (flag/pipestem) lots -> "needs check".
// The business "N ft off the house" rule is enforced as a distance check in the fit test, not a polygon buffer.

const FT = 0.3048; // meters per foot
const ft = (m) => m / FT;

// ---------- projection ----------
export function makeFrame(originLngLat) {
  const [lng0, lat0] = originLngLat;
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return {
    toLocal: ([lng, lat]) => [(lng - lng0) * mPerLng, (lat - lat0) * mPerLat],
    toLngLat: ([x, y]) => [lng0 + x / mPerLng, lat0 + y / mPerLat],
  };
}
export function ringToLocal(ring, frame) { return ring.map(frame.toLocal); }

// ---------- vector helpers ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const perp = (a) => [-a[1], a[0]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];

function polyCentroid(ring) {
  let x = 0, y = 0, n = ring.length;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / n, y / n];
}
function shoelaceArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2; // m^2
}
// closed rings arrive with a repeated last point; strip it
function open(ring) {
  if (ring.length > 1) {
    const a = ring[0], b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  }
  return ring;
}
export function isConvex(ring) {
  const r = open(ring);
  if (r.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], c = r[(i + 2) % r.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s; else if (s !== sign) return false;
  }
  return true;
}

// ---------- half-plane constraints: keep p where dot(p,n) <= c ----------
function edgeConstraints(ring, profile, frontDir) {
  const r = open(ring);
  const c = polyCentroid(r);
  const out = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    let n = unit(perp(sub(b, a)));                 // a normal to the edge
    if (dot(sub(c, a), n) > 0) n = mul(n, -1);     // orient OUTWARD (away from centroid)
    const d = dot(a, n);                           // edge line: dot(p,n) = d
    const frontness = frontDir ? dot(n, frontDir) : 0;
    const setbackFt = frontness > 0.5 ? profile.frontYardFt ?? profile.sideFt
      : frontness < -0.5 ? profile.rearFt
        : profile.sideFt;
    out.push({ n, c: d - setbackFt * FT, kind: frontness > 0.5 ? "front" : frontness < -0.5 ? "rear" : "side" });
  }
  return out;
}

// Sutherland-Hodgman: clip convex subject ring by half-plane {n,c} (keep dot(p,n) <= c)
function clipHalfPlane(ring, { n, c }) {
  const out = [];
  const N = ring.length;
  for (let i = 0; i < N; i++) {
    const A = ring[i], B = ring[(i + 1) % N];
    const da = dot(A, n) - c, db = dot(B, n) - c;
    const ain = da <= 1e-9, bin = db <= 1e-9;
    if (ain) out.push(A);
    if (ain !== bin) {
      const t = da / (da - db);
      out.push([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])]);
    }
  }
  return out;
}

// ---------- build the buildable zone (local meters, convex) ----------
// parcelLocal: ring in meters. house: {ring} in meters or null. frontDir: unit vector house->street (meters) or null.
export function buildZone({ parcelLocal, house, frontDir, profile }) {
  if (!isConvex(parcelLocal)) return { ok: false, reason: "nonconvex_parcel" };
  const lotSqft = ft(1) * ft(1) * shoelaceArea(parcelLocal); // m^2 -> ft^2  (ft(1)^2 factor)
  const minLot = profile.minLotSqft ?? 0;
  if (lotSqft < minLot) return { ok: false, reason: "below_min_lot", lotSqft };

  const constraints = edgeConstraints(parcelLocal, profile, frontDir);
  // behind-the-facade rule: ADU must sit >= frontBehindFacadeFt behind the house's frontmost face
  if (house && frontDir && profile.frontBehindFacadeFt != null) {
    const houseFront = Math.max(...open(house.ring).map((p) => dot(p, frontDir)));
    constraints.push({ n: frontDir, c: houseFront - profile.frontBehindFacadeFt * FT, kind: "facade" });
  }

  let zone = open(parcelLocal).slice();
  for (const con of constraints) { zone = clipHalfPlane(zone, con); if (zone.length < 3) return { ok: false, reason: "no_room", lotSqft }; }
  return { ok: true, zone, constraints, lotSqft };
}

// ---------- geometry for the fit test ----------
function inZone(p, constraints) { return constraints.every((c) => dot(p, c.n) - c.c <= 1e-6); }
function pointToSegDist(p, a, b) {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return len(sub(p, add(a, mul(ab, t))));
}
// separating-axis test: do two convex rings overlap? (boundary distance alone misses containment)
function convexOverlap(A, B) {
  const axesOf = (r) => r.map((p, i) => unit(perp(sub(r[(i + 1) % r.length], p))));
  const proj = (r, ax) => r.reduce((o, p) => { const d = dot(p, ax); return [Math.min(o[0], d), Math.max(o[1], d)]; }, [Infinity, -Infinity]);
  for (const ax of [...axesOf(A), ...axesOf(B)]) {
    const [amin, amax] = proj(A, ax), [bmin, bmax] = proj(B, ax);
    if (amax < bmin - 1e-9 || bmax < amin - 1e-9) return false; // found a separating axis
  }
  return true;
}
function polyDist(ringA, ringB) { // min distance between two non-overlapping convex rings (meters)
  let m = Infinity;
  const A = open(ringA), B = open(ringB);
  for (const p of A) for (let i = 0; i < B.length; i++) m = Math.min(m, pointToSegDist(p, B[i], B[(i + 1) % B.length]));
  for (const p of B) for (let i = 0; i < A.length; i++) m = Math.min(m, pointToSegDist(p, A[i], A[(i + 1) % A.length]));
  return m;
}
function rectCorners(center, uDir, w, l) {
  const u = mul(uDir, w / 2), v = mul(perp(uDir), l / 2);
  return [add(add(center, u), v), add(sub(center, u), v), add(sub(center, u), mul(v, -1)), add(add(center, u), mul(v, -1))];
}
function bboxOf(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}

// candidate orientations: parallel to each parcel edge (rectangle aligned to lot), deduped
function orientations(parcelLocal) {
  const r = open(parcelLocal), set = [];
  for (let i = 0; i < r.length; i++) {
    let u = unit(sub(r[(i + 1) % r.length], r[i]));
    if (u[0] < 0 || (u[0] === 0 && u[1] < 0)) u = mul(u, -1); // canonical
    if (!set.some((s) => Math.abs(dot(s, u)) > 0.999)) set.push(u);
  }
  return set;
}

// ---------- fit one model ----------
// model: {widthFt, lengthFt}. overlay: {houseSeparationFt}. returns {fits, clearanceFt, method}
export function fitModel({ zone, constraints, house, model, overlay, step = 0.6 }) {
  const w = model.widthFt * FT, l = model.lengthFt * FT;
  const sep = (overlay?.houseSeparationFt ?? 0) * FT;
  const [x0, y0, x1, y1] = bboxOf(zone);
  const dirs = orientations(zone);

  const placeable = (center, u, gw, gl) => {
    const corners = rectCorners(center, u, gw, gl);
    if (!corners.every((c) => inZone(c, constraints))) return false;
    if (house) {
      const hr = open(house.ring);
      if (convexOverlap(corners, hr)) return false;                 // ADU can't sit on the house
      if (sep > 0 && polyDist(corners, hr) < sep) return false;      // ...nor within the separation
    }
    return true;
  };

  let best = null;
  for (const u of dirs) {
    for (let cx = x0; cx <= x1; cx += step) {
      for (let cy = y0; cy <= y1; cy += step) {
        const center = [cx, cy];
        if (!placeable(center, u, w, l)) continue;
        // clearance: largest uniform grow (m) that still fits, binary search
        let lo = 0, hi = 12; // up to 12m extra
        for (let k = 0; k < 14; k++) {
          const mid = (lo + hi) / 2;
          if (placeable(center, u, w + 2 * mid, l + 2 * mid)) lo = mid; else hi = mid;
        }
        if (!best || lo > best.clearM) best = { center, u, clearM: lo };
      }
    }
  }
  if (!best) return { fits: false, clearanceFt: null, method: null };
  // method: side gap to the nearest SIDE lot line at the chosen placement
  const method = sideGapFt(best, constraints, w) >= (overlay?.backinMinSideGapFt ?? 12) ? "back-in" : "crane";
  return { fits: true, clearanceFt: ft(best.clearM), method, placement: best };
}

function sideGapFt(best, constraints, w) {
  const corners = rectCorners(best.center, best.u, w, w);
  let minGap = Infinity;
  for (const c of constraints) if (c.kind === "side") for (const p of corners) minGap = Math.min(minGap, c.c - dot(p, c.n));
  return ft(Math.max(0, minGap));
}

// ---------- color ----------
// one stable score per parcel: normalized clearance of the best-fitting model. count is a separate badge.
export function fitScore(clearanceFt, model) {
  if (clearanceFt == null) return 0;
  return Math.max(0, Math.min(1, clearanceFt / (0.4 * model.widthFt)));
}
export function scoreToColor(score, { fits }) {
  if (!fits) return "#dd5145";                    // red
  const s = Math.max(0, Math.min(1, score));
  // yellow (#f5a524) -> green (#1fa36b)
  const a = [0xf5, 0xa5, 0x24], b = [0x1f, 0xa3, 0x6b];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * s));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
