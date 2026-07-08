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
    mailingAddr: [a.own_addr, a.own_citystate].filter(Boolean).join(", ") || null,
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
// Utah County stores the current owner's vesting deed as "<recorderEntry>-<YEAR>" (e.g. "72122-2024"). That year is
// the recording year = when this owner acquired the property -> real tenure at YEAR granularity (no month/day).
export function parseVestingYear(doc) {
  const s = String(doc || "");
  const m = s.match(/-\s*((?:19|20)\d{2})\b/) || s.match(/((?:19|20)\d{2})\s*(?:\(MORE\))?\s*$/);
  const y = m ? Number(m[1]) : NaN;
  return y > 1900 && y <= new Date().getFullYear() ? y : null;
}

export function toOwnerRecordUC(a, now = new Date(), fetchedAt = Date.now()) {
  const occ = classifyOccupancyUC(a);
  const value = a.MKT_CUR_VALUE || null;
  const vestYear = parseVestingYear(a.VESTING_DOC);
  const tYrs = vestYear != null ? Math.max(0, now.getFullYear() - vestYear) : null;
  // Real tenure (from the vesting year) -> tenure-based score, so Utah leads can reach "hot" like Salt Lake.
  // Fall back to the age+occupancy+value proxy only when the vesting year is missing.
  const score = vestYear != null
    ? leadScore({ date_created: `Jan 1 ${vestYear}`, total_full_mkt: value, year_built: a.YEARBLT_RES }, now)
    : leadScoreNoTenure({ marketValue: value, yearBuilt: a.YEARBLT_RES, occupancy: occ.tag });
  return {
    parcelId: String(a.PARCELID),
    ownerName: a.OWNER_NAME || null,
    mailingAddr: [a.OWN_STREET_ADDRESS, a.OWN_CITY].filter(Boolean).join(", ") || null,
    occupancy: occ.tag, occupancyWhy: occ.why, pitch: pitchFor(occ.tag),
    tenureYrs: tYrs,
    marketValue: value,
    yearBuilt: a.YEARBLT_RES || null,
    sqft: a.GLA_RES || a.TOTAL_ABOVE_GRADE_AREA || null,
    aboveGradeSqft: a.TOTAL_ABOVE_GRADE_AREA || a.GLA_RES || null,
    score, tier: equityTier(score),
    fetchedAt,
  };
}

// Davis County occupancy. Owner name + mailing address come from the county GIS server; the primary-residence flag
// comes from the parcel's LIR record. Mail written as "1502 EAST TARTAN WAY", situs as "1502 E TARTAN WAY" — collapse
// directionals before comparing. Entity name -> investor; mail matches situs OR primary-res exemption -> owner-occupant;
// owner in a different city -> investor; else unknown. Heuristic (labeled).
const DIRW = { EAST: "E", WEST: "W", NORTH: "N", SOUTH: "S", NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW" };
const normDir = (s) => normAddr(s).split(" ").map((w) => DIRW[w] || w).join(" ");

export function classifyOccupancyDavis(davis, lir = {}) {
  if (ENTITY.test(String(davis.ParcelOwnerName || "").toUpperCase())) return { tag: "investor", why: "entity-owned (LLC/Inc/etc.)" };
  const mail = normDir(davis.ParcelOwnerMailAddressLine1), situs = normDir(davis.ParcelFullSitusAddress);
  if (mail && situs && (mail === situs || situs.startsWith(mail) || mail.startsWith(situs)))
    return { tag: "owner-occupant", why: "owner mails to the property" };
  if (lir.PRIMARY_RES === "Y") return { tag: "owner-occupant", why: "claims the primary-residence exemption" };
  const mc = normAddr(davis.ParcelOwnerMailCity), sc = normAddr(davis.ParcelSitusCity);
  if (mc && sc && mc !== sc) return { tag: "investor", why: "owner lives in a different city" };
  if (lir.PRIMARY_RES === "N") return { tag: "investor", why: "no primary-residence exemption (2nd home / rental)" };
  return { tag: "unknown", why: "insufficient address data" };
}

// Davis lead record: owner name (county GIS) + occupancy + value/age/sqft (LIR). No sale/deed date exists in Davis,
// so tenure stays null and leads cap below "hot" (see docs/DATA_SOURCES.md). `davis` = Davis GIS attrs, `lir` = parcel LIR props.
export function toOwnerRecordDavis(davis, lir = {}, now = new Date(), fetchedAt = Date.now()) {
  const occ = classifyOccupancyDavis(davis, lir);
  const value = lir.TOTAL_MKT_VALUE || null;
  const score = leadScoreNoTenure({ marketValue: value, yearBuilt: lir.BUILT_YR, occupancy: occ.tag });
  return {
    parcelId: String(lir.PARCEL_ID || davis.ParcelTaxID),
    ownerName: davis.ParcelOwnerName || null,
    mailingAddr: [davis.ParcelOwnerMailAddressLine1, davis.ParcelOwnerMailCity, davis.ParcelOwnerMailState].filter(Boolean).join(", ") || null,
    occupancy: occ.tag, occupancyWhy: occ.why, pitch: pitchFor(occ.tag),
    tenureYrs: null,                 // Davis exposes no sale/deed/vesting date -> tenure unknown
    marketValue: value,
    yearBuilt: lir.BUILT_YR || null,
    sqft: lir.BLDG_SQFT || null,
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
    mailingAddr: null,
    occupancy: occ, occupancyWhy: why, pitch: pitchFor(occ),
    tenureYrs: null,
    marketValue: a.TOTAL_MKT_VALUE || null,
    yearBuilt: a.BUILT_YR || null,
    sqft: a.BLDG_SQFT || null,
    score, tier: equityTier(score),
    fetchedAt,
  };
}

// --- portfolio detection -----------------------------------------------------
// Cluster enriched parcels by owner so one landlord holding several ADU-viable homes surfaces as a single lead.
// Normalize the owner name so "SMITH, JOHN - TRUSTEE", "SMITH JOHN", and "Smith, John (MORE)" group together.
// County placeholder names that are NOT a real identity — never group parcels on these.
const OWNER_PLACEHOLDERS = /\bNOT IDENTIFIED\b|\bUNKNOWN\b|\bNONE\b/;
export function normOwnerKey(name) {
  const k = String(name || "")
    .toUpperCase()
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")   // trailing recording dates
    .replace(/\bTRUSTEES?\b/g, " ")
    .replace(/\bET AL\b/g, " ")
    .replace(/\(MORE\)/g, " ")
    .replace(/[.,\-&()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!k || OWNER_PLACEHOLDERS.test(k)) return "";                    // placeholder, not a real owner
  if (/^(TRUST|TRUSTEE|OWNER|ESTATE|LLC|THE)$/.test(k)) return "";    // bare generic term
  return k;
}
// normalize a mailing address for matching (investors mail all their lots to one address)
export function normMail(s) {
  return String(s || "").toUpperCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();
}

const TIER_RANK = { hot: 3, warm: 2, cool: 1 };

// Counties often record several parcels for one home (the house lot + a sliver/driveway/common-area parcel).
// Collapse parcels that share a situs address so one home isn't counted as two; keep the best representative
// (prefer a fitting lot, then the higher assessed value). Parcels with no address fall back to their id (stay distinct).
function dedupeParcels(parcels) {
  const byAddr = new Map();
  for (const pc of parcels) {
    const k = pc.address ? String(pc.address).toUpperCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim() : "#" + pc.parcelId;
    const cur = byAddr.get(k);
    if (!cur) { byAddr.set(k, pc); continue; }
    const better = Number(pc.fits) !== Number(cur.fits) ? pc.fits && !cur.fits : (pc.marketValue || 0) > (cur.marketValue || 0);
    if (better) byAddr.set(k, pc);   // keep the fitting lot, else the higher-value one
  }
  return [...byAddr.values()];
}

// items: [{ ownerName, mailingAddr, parcelId, address, city, county, tier, marketValue, occupancy, fits }]
// Returns owners with 2+ properties, ranked by fitting-property count, then total count, then combined value.
export function groupPortfolios(items = []) {
  const map = new Map();
  for (const it of items) {
    const nk = normOwnerKey(it.ownerName);
    if (!nk) continue;                 // placeholder / junk owner name
    const mk = normMail(it.mailingAddr);
    if (!mk) continue;                 // no mailing address -> can't confirm same owner, don't group
    const key = nk + "||" + mk;        // same owner name AND same mailing address
    let g = map.get(key);
    if (!g) {
      g = { key, owner: it.ownerName, mailingAddr: it.mailingAddr || null, occupancy: it.occupancy || "unknown",
        topTier: null, count: 0, fitCount: 0, totalValue: 0, parcels: [] };
      map.set(key, g);
    }
    g.count += 1;
    if (it.fits) g.fitCount += 1;
    if (it.marketValue) g.totalValue += it.marketValue;
    if (!g.mailingAddr && it.mailingAddr) g.mailingAddr = it.mailingAddr;
    if ((TIER_RANK[it.tier] || 0) > (TIER_RANK[g.topTier] || 0)) g.topTier = it.tier;
    g.parcels.push({ parcelId: it.parcelId, address: it.address, city: it.city, county: it.county,
      tier: it.tier, marketValue: it.marketValue || null, fits: !!it.fits });
  }
  return [...map.values()]
    .map((g) => {
      // collapse duplicate/sliver parcels to distinct homes, then recount from those
      const parcels = dedupeParcels(g.parcels).sort((a, b) => (Number(b.fits) - Number(a.fits)) || ((b.marketValue || 0) - (a.marketValue || 0)));
      return { ...g, parcels, count: parcels.length, fitCount: parcels.filter((p) => p.fits).length, totalValue: parcels.reduce((s, p) => s + (p.marketValue || 0), 0) };
    })
    // a portfolio LEAD = owns 2+ distinct homes here AND at least one is ADU-viable (skip owners with no actionable lot)
    .filter((g) => g.count >= 2 && g.fitCount >= 1)
    .sort((a, b) => (b.fitCount - a.fitCount) || (b.count - a.count) || (b.totalValue - a.totalValue));
}
