// Fixture tests for the ADU fit engine. Run: node test/fit.test.mjs
import { buildZone, fitModel, isConvex, fitScore, scoreToColor, aduSizeCap } from "../src/lib/fit.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`FAIL  ${name} ${extra}`); } };

const profile = { sideFt: 5, rearFt: 10, frontYardFt: 20, frontBehindFacadeFt: 10, minLotSqft: 7000 };
const overlay = { houseSeparationFt: 20, backinMinSideGapFt: 12 };
const M40 = { widthFt: 13.333, lengthFt: 40 };   // the LaFortune model

// Local-meters fixtures. Street is to the SOUTH (y=0), so frontDir (house->street) = [0,-1].
const frontDir = [0, -1];
const house = { ring: [[5, 5], [20, 5], [20, 20], [5, 20]] };  // 15x15m house near the street

// --- 1. normal Kearns-ish lot: 25m x 40m (~10,764 sqft), house near street ---
{
  const parcel = [[0, 0], [25, 0], [25, 40], [0, 40]];
  const z = buildZone({ parcelLocal: parcel, house, frontDir, profile });
  ok("normal lot: zone built", z.ok, JSON.stringify(z));
  ok("normal lot: area ~10,764 sqft", z.ok && Math.abs(z.lotSqft - 10764) < 50, z.lotSqft?.toFixed(0));
  if (z.ok) {
    const f = fitModel({ zone: z.zone, constraints: z.constraints, house, model: M40, overlay });
    ok("normal lot: 40ft model fits", f.fits, JSON.stringify(f));
    ok("normal lot: clearance >= 0", f.fits && f.clearanceFt >= 0, f.clearanceFt?.toFixed(1));
    ok("normal lot: method set", f.fits && (f.method === "back-in" || f.method === "crane"), f.method);
    console.log(`      -> fits, clearance ${f.clearanceFt?.toFixed(1)} ft, ${f.method}`);
  }
}

// --- 2. below min lot size: 20m x 22m (~4,736 sqft) ---
{
  const parcel = [[0, 0], [20, 0], [20, 22], [0, 22]];
  const z = buildZone({ parcelLocal: parcel, house, frontDir, profile });
  ok("tiny lot: rejected below_min_lot", !z.ok && z.reason === "below_min_lot", JSON.stringify(z));
}

// --- 3. non-convex (flag) lot -> needs check ---
{
  const flag = [[0, 0], [25, 0], [25, 40], [15, 40], [15, 15], [0, 15]]; // L-shape
  ok("flag lot: detected non-convex", !isConvex(flag));
  const z = buildZone({ parcelLocal: flag, house, frontDir, profile });
  ok("flag lot: routed to nonconvex", !z.ok && z.reason === "nonconvex_parcel", JSON.stringify(z));
}

// --- 4. model too big for the lot: 20ft x 100ft (30.5m) exceeds every zone dimension ---
{
  const parcel = [[0, 0], [25, 0], [25, 40], [0, 40]];
  const z = buildZone({ parcelLocal: parcel, house, frontDir, profile });
  const f = fitModel({ zone: z.zone, constraints: z.constraints, house, model: { widthFt: 20, lengthFt: 100 }, overlay });
  ok("oversized model: does not fit", !f.fits, JSON.stringify(f));
}

// --- 5. deep house leaves no room behind -> 40ft should not fit ---
{
  const parcel = [[0, 0], [25, 0], [25, 40], [0, 40]];
  const bigHouse = { ring: [[3, 5], [22, 5], [22, 33], [3, 33]] }; // house nearly to the rear setback
  const z = buildZone({ parcelLocal: parcel, house: bigHouse, frontDir, profile });
  const f = fitModel({ zone: z.zone, constraints: z.constraints, house: bigHouse, model: M40, overlay });
  ok("deep house: 40ft does not fit", !f.fits, JSON.stringify(f));
}

// --- 6. color mapping sanity ---
{
  ok("color: no-fit is red", scoreToColor(0, { fits: false }) === "#e5372b");
  const s = fitScore(10, M40); // 10 ft clearance on a 13.3 ft model
  ok("color: fitScore in (0,1]", s > 0 && s <= 1, String(s));
  ok("color: high clearance trends emerald", scoreToColor(fitScore(20, M40), { fits: true }) === "#16b866");
}

// --- 7. per-city ADU size cap ---
{
  ok("size cap: uncapped when no rule", aduSizeCap({ maxPctOfPrimary: 0, maxAduSqft: 0 }, 1200) === null);
  ok("size cap: 50% of a 1200sf home = 600", aduSizeCap({ maxPctOfPrimary: 50 }, 1200) === 600);
  ok("size cap: tighter of pct vs absolute wins", aduSizeCap({ maxPctOfPrimary: 50, maxAduSqft: 500 }, 1200) === 500);
  ok("size cap: pct ignored when primary sqft unknown", aduSizeCap({ maxPctOfPrimary: 50 }, 0) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
