// Owner qualifying: pure parsing + classification + lead scoring over Salt Lake County parcel attributes.
// Fed by geo.fetchOwnership (county Land/MapServer/1). See docs/QUALIFY_PLAN.md. No I/O here — unit-testable.

// --- vesting date / tenure ---------------------------------------------------
// date_created looks like "Oct 13 1982 12:00AM". ~43% are the placeholder "Jan 1 1900" = unknown.
export function parseVestDate(s) {
  if (!s) return null;
  const clean = String(s).replace(/\s+/g, " ").replace(/\s*12:00AM$/i, "").trim();
  const t = Date.parse(clean);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return d.getFullYear() < 1901 ? null : d; // reject the 1900 placeholder
}

export function tenureYears(date, now = new Date()) {
  if (!date) return null;
  const yrs = (now - date) / (365.25 * 24 * 3600 * 1000);
  return yrs < 0 ? 0 : Math.floor(yrs);
}

// --- owner-occupancy ---------------------------------------------------------
// Grid addresses dominate Kearns ("5045 W 4985 S"); normalize away punctuation/case for comparison.
const normAddr = (s) => String(s || "").toUpperCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();
const ENTITY = /\b(LLC|L\.?C\.?|INC|CORP|LP|LTD|HOLDINGS|PROPERTIES|PROPERTY|RENTALS?|INVESTMENTS?|CAPITAL|HOMES)\b/;

// tag: 'owner-occupant' | 'investor' | 'unknown', with a `why` so the UI never overstates certainty.
export function classifyOccupancy(rec) {
  const oa = normAddr(rec.own_addr);
  const pl = normAddr(rec.prop_location);
  const addrMatch = !!oa && !!pl && (oa === pl || oa.startsWith(pl) || pl.startsWith(oa));
  const isEntity = ENTITY.test(String(rec.own_name || "").toUpperCase());
  const ratio = rec.total_full_mkt > 0 ? rec.taxable_value / rec.total_full_mkt : null;
  const exemption = ratio != null && ratio >= 0.45 && ratio <= 0.65; // 45% primary-residence exemption applied

  if (isEntity) return { tag: "investor", why: addrMatch ? "entity registered at the property" : "entity-owned, mails elsewhere" };
  if (addrMatch) return { tag: "owner-occupant", why: "mailing address matches property" };
  if (oa && pl) return exemption
    ? { tag: "owner-occupant", why: "residential exemption despite different mailing address" }
    : { tag: "investor", why: "owner mails to a different address" };
  if (exemption) return { tag: "owner-occupant", why: "residential exemption" };
  return { tag: "unknown", why: "insufficient address data" };
}

export const pitchFor = (tag) => tag === "investor"
  ? "Adds a rentable door — cash flow + resale value."
  : "Extra income, room for family, and it raises the home's value.";

// --- lead / equity-likelihood score -----------------------------------------
// Tenure is the spine: in a uniform tract (Kearns) value/age barely vary, so length of ownership is what actually
// discriminates equity. Value/age are nudges. Stable dollar bins (NOT viewport percentiles), so scores compare across pans.
export function valueBandPts(v) {
  if (!v || v <= 0) return 11;
  if (v < 200000) return 11;   // condo / mobile / sliver — thin yard + capacity
  if (v <= 650000) return 22;  // sweet spot: owner-occupied SFR with equity, not luxury
  if (v <= 900000) return 16;
  return 9;                    // luxury — less likely to want a manufactured ADU
}

const UNKNOWN_TENURE_PTS = 18; // ~equiv to owning ~6 yrs: keeps the 43% without a date out of "hot", never penalized to cool

// 0..100 estimate of equity + ability to finance. Explicitly NOT a dollar figure or loan status.
export function leadScore(rec, now = new Date()) {
  const tYrs = tenureYears(parseVestDate(rec.date_created), now);
  const tenurePts = tYrs == null ? UNKNOWN_TENURE_PTS : Math.max(0, Math.min(60, (tYrs / 20) * 60)); // 0..60 over 0..20yr
  const valuePts = valueBandPts(rec.total_full_mkt);
  const yb = rec.year_built || 0;
  const agePts = yb <= 0 ? 9 : yb <= 1980 ? 18 : yb >= 2015 ? 4 : 18 - ((yb - 1980) / 35) * 14;
  return Math.max(0, Math.min(100, Math.round(tenurePts + valuePts + agePts)));
}

// Hot = long-held (deep equity). Cool = recent buyer (fresh mortgage, thin equity). Warm = middle / unknown tenure.
export const equityTier = (score) => (score >= 75 ? "hot" : score >= 50 ? "warm" : "cool");

// Equity-likelihood when tenure is UNKNOWN (Utah County has no sale/deed date). Leans on age (older -> more likely
// paid down), owner-occupancy, and value band, so the map still spreads hot/warm/cool instead of clustering all-warm.
// A proxy, not tenure-proven -- still labeled "estimate" in the UI.
export function leadScoreNoTenure({ marketValue, yearBuilt, occupancy } = {}) {
  // Selective: without tenure, "hot" is reserved for the strongest proxy of deep equity -- a genuinely old,
  // owner-occupied, mid-value home. Most established homes land "warm"; new / luxury / recent absentee land "cool".
  let s = occupancy === "owner-occupant" ? 32 : occupancy === "investor" ? 26 : 16;
  const yb = yearBuilt || 0;
  s += yb <= 0 ? 10 : yb <= 1965 ? 30 : yb <= 1985 ? 22 : yb <= 2005 ? 12 : yb <= 2015 ? 5 : 0;
  const v = marketValue || 0;
  s += v <= 0 ? 8 : v < 150000 ? 4 : v <= 250000 ? 12 : v <= 650000 ? 18 : v <= 900000 ? 10 : 4;
  return Math.max(0, Math.min(100, Math.round(s)));
}

// Raw county attributes -> compact record the UI reads. `fetchedAt` is stamped by the fetch layer.
export function toOwnerRecord(a, now = new Date(), fetchedAt = Date.now()) {
  const occ = classifyOccupancy(a);
  const tYrs = tenureYears(parseVestDate(a.date_created), now);
  const score = leadScore(a, now);
  return {
    parcelId: String(a.parcel_id),
    ownerName: a.own_name || null,
    occupancy: occ.tag,
    occupancyWhy: occ.why,
    pitch: pitchFor(occ.tag),
    tenureYrs: tYrs,
    marketValue: a.total_full_mkt || null,
    yearBuilt: a.year_built || null,
    sqft: a.total_sq_ft || null,
    aboveGradeSqft: a.abv_grnd_sf || null,   // above-grade only; exact %-cap denominator (vs. basement-inclusive total)
    score,
    tier: equityTier(score),
    fetchedAt,
  };
}

// Utah County occupancy: entity name -> investor; owner street matches the property -> owner-occupant;
// residential exemption -> owner-occupant; owner in a different city -> investor; else unknown. Heuristic (labeled).
export function classifyOccupancyUC(a) {
  if (ENTITY.test(String(a.OWNER_NAME || "").toUpperCase())) return { tag: "investor", why: "entity-owned (LLC/Inc/etc.)" };
  const os = normAddr(a.OWN_STREET_ADDRESS), site = normAddr(a.SITE_FULL_ADDRESS);
  if (os && site && os.length > 4 && site.includes(os)) return { tag: "owner-occupant", why: "owner mails to the property" };
  if (/^\s*(Y|YES|TRUE|1)/i.test(String(a.EXEMPT_RES || ""))) return { tag: "owner-occupant", why: "claims the residential exemption" };
  const oc = normAddr(a.OWN_CITY), sc = normAddr(a.SITE_CITY);
  if (oc && sc && oc !== sc) return { tag: "investor", why: "owner lives in a different city" };
  return { tag: "unknown", why: "insufficient address data" };
}

// Utah County lead record from the assessor OwnerParcel layer. Owner name + real occupancy + value + above-grade.
// No tenure exists in Utah County, so tYrs stays null and leads cap below "hot" (see docs/DATA_SOURCES.md).
export function toOwnerRecordUC(a, now = new Date(), fetchedAt = Date.now()) {
  const occ = classifyOccupancyUC(a);
  const value = a.MKT_CUR_VALUE || null;
  const score = leadScoreNoTenure({ marketValue: value, yearBuilt: a.YEARBLT_RES, occupancy: occ.tag });
  return {
    parcelId: String(a.PARCELID),
    ownerName: a.OWNER_NAME || null,
    occupancy: occ.tag, occupancyWhy: occ.why, pitch: pitchFor(occ.tag),
    tenureYrs: null,
    marketValue: value,
    yearBuilt: a.YEARBLT_RES || null,
    sqft: a.GLA_RES || a.TOTAL_ABOVE_GRADE_AREA || null,
    aboveGradeSqft: a.TOTAL_ABOVE_GRADE_AREA || a.GLA_RES || null,
    score, tier: equityTier(score),
    fetchedAt,
  };
}

// Build a lead record from LIR fields alone — for counties with no rich owner/sale service (e.g. Utah County).
// No vesting date (tenure unknown) and no owner name; occupancy comes from the primary-residence exemption flag.
// `a` = the parcel's LIR properties (PRIMARY_RES, TOTAL_MKT_VALUE, BUILT_YR, BLDG_SQFT, PARCEL_ID).
export function toOwnerRecordLIR(a, now = new Date(), fetchedAt = Date.now()) {
  const occ = a.PRIMARY_RES === "Y" ? "owner-occupant" : a.PRIMARY_RES === "N" ? "investor" : "unknown";
  const why = a.PRIMARY_RES === "Y" ? "claims the primary-residence exemption"
    : a.PRIMARY_RES === "N" ? "no primary-residence exemption (2nd home / rental)" : "occupancy unknown";
  const score = leadScoreNoTenure({ marketValue: a.TOTAL_MKT_VALUE, yearBuilt: a.BUILT_YR, occupancy: occ });
  return {
    parcelId: String(a.PARCEL_ID),
    ownerName: null,                 // Utah County exposes no CORS-open owner-name+sale service (tenure unknown)
    occupancy: occ, occupancyWhy: why, pitch: pitchFor(occ),
    tenureYrs: null,
    marketValue: a.TOTAL_MKT_VALUE || null,
    yearBuilt: a.BUILT_YR || null,
    sqft: a.BLDG_SQFT || null,
    score, tier: equityTier(score),
    fetchedAt,
  };
}
