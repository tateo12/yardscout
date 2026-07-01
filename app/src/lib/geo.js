// Live geodata for the ADU fit engine: parcels, existing-house footprints, street direction.
// All three layers are free UGRC ArcGIS services on the same org (open CORS). Works in browser + node (global fetch).
import { area as turfArea, convex as turfConvex, booleanPointInPolygon, centroid as turfCentroid, nearestPointOnLine, point, polygon as turfPolygon, lineString } from "@turf/turf";
import { makeFrame, ringToLocal, buildZone, fitModel, fitScore, scoreToColor } from "./fit.js";

const SQFT_PER_M2 = 10.7639104;

// Real parcels are dense (100+ vertices, curved edges). Get true area from turf and decide convexity by the
// convex-hull-to-area ratio: a rectangular lot's hull ~ the lot; a real L/flag lot's hull is much bigger.
// Returns a CLEAN convex local ring for the fit engine, or convex:false -> needs-check.
export function prepParcel(parcel, frame, maxHullRatio = 1.06) {
  const trueM2 = turfArea(parcel);
  const lotSqft = trueM2 * SQFT_PER_M2;
  let hull;
  try { hull = turfConvex(parcel); } catch { hull = null; }
  if (!hull) return { convex: false, ring: null, lotSqft, reason: "nonconvex_parcel" };
  if (turfArea(hull) / trueM2 > maxHullRatio) return { convex: false, ring: null, lotSqft, reason: "nonconvex_parcel" };
  return { convex: true, ring: ringToLocal(hull.geometry.coordinates[0], frame), lotSqft, reason: null };
}

const ORG = "https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services";
export const LAYERS = {
  parcels: `${ORG}/Parcels_SaltLake_LIR/FeatureServer/0`,
  buildings: `${ORG}/Buildings/FeatureServer/0`,
  roads: `${ORG}/UtahRoads/FeatureServer/0`,
};

async function esriGeojson(url, extra) {
  const params = new URLSearchParams({
    f: "geojson", outSR: "4326", inSR: "4326", returnGeometry: "true",
    geometryType: "esriGeometryEnvelope", spatialRel: "esriSpatialRelIntersects", ...extra,
  });
  const r = await fetch(`${url}/query?${params}`);
  if (!r.ok) throw new Error(`ArcGIS ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`ArcGIS: ${j.error.message}`);
  return j.features || [];
}
const bboxStr = (b) => b.join(","); // [xmin,ymin,xmax,ymax]

export function parcelBbox(parcel) {
  const ring = parcel.geometry.coordinates[0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}
const pad = (b, dLng, dLat) => [b[0] - dLng, b[1] - dLat, b[2] + dLng, b[3] + dLat];

export async function fetchParcels(bbox, where = "PROP_CLASS='Residential'") {
  return esriGeojson(LAYERS.parcels, {
    geometry: bboxStr(bbox), where,
    outFields: "PARCEL_ID,PARCEL_ADD,PARCEL_CITY,PARCEL_ACRES,BLDG_SQFT,PRIMARY_RES",
  });
}
export async function fetchBuildings(bbox) {
  return esriGeojson(LAYERS.buildings, { geometry: bboxStr(bbox), where: "1=1", outFields: "OBJECTID,TYPE,SRC_YEAR" });
}
export async function fetchRoads(bbox) {
  return esriGeojson(LAYERS.roads, { geometry: bboxStr(pad(bbox, 0.0008, 0.0008)), where: "1=1", outFields: "FULLNAME" });
}

// Pick the existing house: rank candidate footprints by area, keep those meaningfully inside the parcel.
// Returns { house: feature|null, others: feature[] }.
export function pickHouse(parcel, buildings) {
  const poly = turfPolygon(parcel.geometry.coordinates);
  const inside = [];
  for (const b of buildings) {
    if (b.geometry?.type !== "Polygon") continue;
    let c;
    try { c = turfCentroid(b); } catch { continue; }
    if (!booleanPointInPolygon(c, poly)) continue;
    inside.push({ f: b, area: turfArea(b) });
  }
  inside.sort((a, b) => b.area - a.area);
  return { house: inside[0]?.f || null, others: inside.slice(1).map((x) => x.f) };
}

// One call for a tapped parcel: fetch its footprints + roads, detect house/street, build the zone, and test
// every model. Returns a UI-ready result. Fails closed to needs-check when we can't apply the rules.
export async function computeParcelFit(parcel, { models, profile, overlay }) {
  const bbox = parcelBbox(parcel);
  const frame = makeFrame(turfCentroid(parcel).geometry.coordinates);
  const [buildings, roads] = await Promise.all([fetchBuildings(bbox), fetchRoads(bbox)]);

  const { convex, ring, lotSqft } = prepParcel(parcel, frame);
  const base = { lotSqft, road: null };
  // hard eligibility gate FIRST: too-small lot is a flat no, regardless of what's back there.
  if (lotSqft < (profile.minLotSqft ?? 0)) return { status: "not-eligible", reason: "below_min_lot", ...base };

  const { house } = pickHouse(parcel, buildings);
  const { frontDir, road } = frontDirection(parcel, roads, frame);
  base.road = road;
  if (!house) return { status: "needs-check", reason: "no_house_found", ...base };
  if (!frontDir) return { status: "needs-check", reason: "no_street_found", ...base };
  if (!convex) return { status: "needs-check", reason: "nonconvex_parcel", ...base };

  const houseLocal = { ring: ringToLocal(house.geometry.coordinates[0], frame) };
  const z = buildZone({ parcelLocal: ring, lotSqft, house: houseLocal, frontDir, profile });
  if (!z.ok) return { status: "needs-check", reason: z.reason, ...base };

  const results = models.map((m) => ({ model: m, ...fitModel({ zone: z.zone, constraints: z.constraints, house: houseLocal, model: m, overlay }) }));
  const fits = results.filter((r) => r.fits).sort((a, b) => b.clearanceFt - a.clearanceFt);
  const best = fits[0] || null;
  const color = best ? scoreToColor(fitScore(best.clearanceFt, best.model), { fits: true }) : "#dd5145";
  return { status: fits.length ? "fits" : "no-fit", fits, results, best, color, ...base };
}

// Street direction as a LOCAL-meters unit vector (house -> street), from the parcel centroid toward the
// nearest road. frame = fit.makeFrame(parcelCentroidLngLat).
export function frontDirection(parcel, roads, frame) {
  const c = turfCentroid(parcel);
  let best = null;
  for (const rd of roads) {
    const geom = rd.geometry;
    const lines = geom?.type === "MultiLineString" ? geom.coordinates : geom?.type === "LineString" ? [geom.coordinates] : [];
    for (const coords of lines) {
      if (coords.length < 2) continue;
      const np = nearestPointOnLine(lineString(coords), c);
      const d = np.properties.dist; // km
      if (!best || d < best.d) best = { d, pt: np.geometry.coordinates, name: rd.properties?.FULLNAME };
    }
  }
  if (!best) return { frontDir: null, road: null };
  const c0 = frame.toLocal(c.geometry.coordinates);
  const p1 = frame.toLocal(best.pt);
  const v = [p1[0] - c0[0], p1[1] - c0[1]];
  const l = Math.hypot(v[0], v[1]) || 1;
  return { frontDir: [v[0] / l, v[1] / l], road: best.name, roadDistM: best.d * 1000 };
}
