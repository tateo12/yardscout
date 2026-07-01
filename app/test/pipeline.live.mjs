// End-to-end on REAL Kearns data: parcel -> house footprint -> street -> buildable zone -> fit.
// Run: node test/pipeline.live.mjs   (hits live UGRC ArcGIS; needs network)
import { fetchParcels, fetchBuildings, fetchRoads, pickHouse, frontDirection, prepParcel } from "../src/lib/geo.js";
import { makeFrame, ringToLocal, buildZone, fitModel, fitScore, scoreToColor } from "../src/lib/fit.js";
import { centroid as turfCentroid } from "@turf/turf";

const profile = { sideFt: 5, rearFt: 10, frontYardFt: 20, frontBehindFacadeFt: 10, minLotSqft: 7000 };
const overlay = { houseSeparationFt: 20, backinMinSideGapFt: 16 };
const MODELS = [{ name: "40x13'4\"", widthFt: 13.333, lengthFt: 40 }, { name: "26x13'4\"", widthFt: 13.333, lengthFt: 26 }];

// A residential block in Kearns (around 4165 W 4865 S). Grab a handful of parcels and run each.
const bbox = [-112.006, 40.650, -111.995, 40.660];
console.log("Fetching parcels...");
const parcels = (await fetchParcels(bbox, "PROP_CLASS='Residential' AND PARCEL_ACRES>0.16")).slice(0, 6);
console.log(`Got ${parcels.length} parcels. Fetching buildings + roads for the block...`);
const [buildings, roads] = await Promise.all([fetchBuildings(bbox), fetchRoads(bbox)]);
console.log(`Buildings: ${buildings.length}, Roads: ${roads.length}\n`);

let fitCount = 0, noHouse = 0, needsCheck = 0;
for (const p of parcels) {
  const pr = p.properties;
  const originLngLat = turfCentroid(p).geometry.coordinates;
  const frame = makeFrame(originLngLat);
  const { convex, ring, lotSqft } = prepParcel(p, frame);

  const { house } = pickHouse(p, buildings);
  const { frontDir, road } = frontDirection(p, roads, frame);
  const houseLocal = house ? { ring: ringToLocal(house.geometry.coordinates[0], frame) } : null;
  if (!house) noHouse++;

  const z = !house ? { ok: false, reason: "no_house_found", lotSqft }        // can't apply the rules -> needs-check
    : !frontDir ? { ok: false, reason: "no_street_found", lotSqft }
      : convex ? buildZone({ parcelLocal: ring, lotSqft, house: houseLocal, frontDir, profile })
        : { ok: false, reason: "nonconvex_parcel", lotSqft };
  console.log(`${(pr.PARCEL_ADD || "?").padEnd(22)} ${lotSqft.toFixed(0).padStart(6)}sf  house:${house ? "yes" : "NO "}  st:${(road || "?").slice(0, 14).padEnd(14)}`);
  if (!z.ok) { console.log(`   zone: needs-check (${z.reason})`); needsCheck++; continue; }

  const results = MODELS.map((m) => ({ m, r: fitModel({ zone: z.zone, constraints: z.constraints, house: houseLocal, model: m, overlay }) }));
  const fits = results.filter((x) => x.r.fits);
  const best = fits.sort((a, b) => b.r.clearanceFt - a.r.clearanceFt)[0];
  if (fits.length) {
    fitCount++;
    const color = scoreToColor(fitScore(best.r.clearanceFt, best.m), { fits: true });
    console.log(`   FITS ${fits.map((x) => x.m.name).join(", ")}  | best ${best.m.name} clearance ${best.r.clearanceFt.toFixed(1)}ft ${best.r.method} | color ${color}`);
  } else {
    console.log(`   no model fits (lot ${z.lotSqft.toFixed(0)}sf)`);
  }
}
console.log(`\nSummary: ${parcels.length} parcels | ${fitCount} fit a model | ${needsCheck} needs-check | ${noHouse} no house found`);
