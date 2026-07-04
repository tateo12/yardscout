// ADU catalog + the active jurisdiction/business rules. Config for now; moves to Supabase settings later
// (jurisdiction_profiles + org_settings). See docs/ADU_FIT_PLAN.md.

export const ADU_MODELS = [
  { id: "stratus-24x36", name: "Stratus (24 × 36)", widthFt: 23.333, lengthFt: 36, heightFt: 13.5, beds: 2, baths: 1,
    glb: "stratus-24x36", usdz: "single", floorPlan: "floorplans/stratus-24x36.pdf" },   // Cavco Prestige 24362D, double-wide, 840 sqft
  { id: "bench-14x48", name: "The Bench (14 × 48)", widthFt: 13.333, lengthFt: 48, heightFt: 13.5, beds: 2, baths: 1,
    glb: "bench-14x48", usdz: "single", floorPlan: "floorplans/bench-14x48.pdf" },        // Cavco Broadmore 14482B, 639 sqft
  { id: "favor-14x48", name: "The Favor (14 × 48)", widthFt: 13.333, lengthFt: 48, heightFt: 13.5, beds: 2, baths: 1,
    glb: "favor-14x48", usdz: "single", floorPlan: "floorplans/favor-14x48.pdf" },        // Cavco Pure 14482P, 643 sqft
  { id: "lafortune-40", name: "LaFortune (40 × 13′4″)", widthFt: 13.333, lengthFt: 40, heightFt: 13.5, beds: 1, baths: 1,
    glb: "lafortune-40", usdz: "single", floorPlan: "floorplans/lafortune-40.pdf" },      // permitted plan, 533 sqft
  // widthFt/lengthFt = ACTUAL exterior box (nominal "14" wide = 13'4"). glb is correctly proportioned per footprint.
  // usdz (iOS AR) is still the generic single-wide — off-size on iPhone until real authored models. Android AR + 3D lot view are correct.
];

// Salt Lake County / Kearns profile (sourced from county code — verify; SB284 may change it).
export const KEARNS_PROFILE = {
  name: "Salt Lake County (unincorporated)",   // county 19.15 baseline (Magna, White City, Copperton, etc.); Kearns has its OWN ordinance -> see CITY_RULES
  detachedAllowed: true, // some cities BAN detached ADUs (internal/attached only) -> no product fits; false = hard no
  minLotSqft: 7000,      // sourced
  sideFt: 5,             // provisional (per-zone)
  rearFt: 10,            // sourced
  frontYardFt: 20,       // front-yard setback for the parcel's street edge
  frontBehindFacadeFt: 10, // ADU must sit >= this far behind the house's front facade (sourced)
  maxPctOfPrimary: 0,    // ADU floor area may not exceed this % of the primary home. 0 = NO CAP.
  maxAduSqft: 0,         // absolute ADU floor-area cap (sq ft). 0 = none. Unincorporated SLCo/Kearns caps NEITHER (verified).
  // NOTE: other cities DO cap size — Salt Lake City 50% of primary (excl. garage), Bountiful 40%, South Jordan 35%/1500sf.
  // Add those as CITY_PROFILES when their setbacks are verified; the cap then auto-applies per selected city.
};

// Business practice (not code): the crew's own placement rules.
export const BUSINESS_OVERLAY = {
  houseSeparationFt: 20,     // Gavin's rule (legal min is 6) — crane/access room
  backinMinSideGapFt: 16,    // side-yard width to back a ~14ft unit in vs. crane it
};

// City profiles the owner can switch between (the master dropdown). Add cities as the business expands.
export const CITY_PROFILES = [
  { key: "slco-kearns", name: "Salt Lake County — Kearns", minLotSqft: 7000, sideFt: 5, rearFt: 10, frontYardFt: 20, frontBehindFacadeFt: 10, maxPctOfPrimary: 0, maxAduSqft: 0 },
];

// Curated dropdown options — no free-text. 0 = "no cap" for the size limits.
export const RULE_OPTIONS = {
  minLotSqft: [6000, 7000, 8000, 10000],
  sideFt: [5, 8, 10],
  rearFt: [10, 15, 20],
  frontBehindFacadeFt: [5, 10, 15],
  houseSeparationFt: [6, 10, 15, 20, 25],
  backinMinSideGapFt: [12, 14, 16, 18, 20],
  maxPctOfPrimary: [0, 35, 40, 50, 75],
  maxAduSqft: [0, 800, 1000, 1200, 1500],
};

// ---- Per-jurisdiction rule registry (auto-applied by the parcel's city/county) ----
// Bump when any profile below changes so the fit cache re-judges. Rules are VERIFIED per city, never guessed;
// a city not listed here falls back to its county baseline and is flagged "unverified" in the UI.
export const JURISDICTIONS_VERSION = "utah-slco-2026-07-04d";

// Salt Lake County ordinance = the baseline for all unincorporated SLCo (Kearns + the metro townships).
export const COUNTY_BASELINES = { "Salt Lake County": KEARNS_PROFILE };

// city name (as it appears in PARCEL_CITY, lowercased) -> { profile, verified }.
// Seeded with the unincorporated metro townships, which are genuinely governed by the county code (verified).
// Incorporated cities (Salt Lake City, Murray, West Valley, ...) each set their own code — add them here as verified.
const UNINCORPORATED_SLCO = ["magna", "white city", "emigration canyon", "magna metro township"];   // Kearns + Copperton split out (own ordinances) -> CITY_RULES

// Per-city detached-ADU rules from municipal code (researched 2026-07, cited). Spread over the county baseline;
// override only confirmed fields. detachedAllowed:false = detached units banned (hard no-go). frontBehindFacadeFt 0
// where a city bars front-yard placement without a numeric offset. Zone-dependent setbacks use a representative
// residential value. Always shown with a "verify locally" note. Cities not listed fall back to the county baseline.
const P = (name, o = {}) => ({ ...KEARNS_PROFILE, name, ...o });
const CITY_RULES = {
  // ---- Salt Lake County ----
  // Kearns metro township — its OWN ordinance (Ord. 2020-8-2, Ch. 19.15). Min lot 5,000. §19.15.060 VERBATIM-CONFIRMED
  // (adu-slco-a): ADU floor area must be LESS THAN 40% of the primary residence AND never exceed 1,000 sqft — whichever
  // is less — and applies to DETACHED units (chapter's defined ADU covers "detached building"). No size floor, no
  // exception/variance. BUSINESS IMPACT: on a ~900 sqft primary, 40% ≈ 360 sqft blocks every manufactured unit (533+).
  // Denominator "square footage of primary" is undefined in code (footprint vs finished floor unconfirmed). SB284 may
  // preempt this for detached on lots >=11,000 sqft after Oct 2026, but most Kearns lots are 5-7k so it won't help them.
  "kearns":           P("Kearns",           { minLotSqft: 5000,  sideFt: 5,  rearFt: 10, frontBehindFacadeFt: 0,  maxPctOfPrimary: 40, maxAduSqft: 1000 }),
  "kearns metro township": P("Kearns",      { minLotSqft: 5000,  sideFt: 5,  rearFt: 10, frontBehindFacadeFt: 0,  maxPctOfPrimary: 40, maxAduSqft: 1000 }),
  "salt lake city":   P("Salt Lake City",   { minLotSqft: 0,      sideFt: 3,  rearFt: 3,  frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 1000 }),
  "murray":           P("Murray",           { minLotSqft: 10000,  sideFt: 10, rearFt: 10, frontBehindFacadeFt: 0,  maxPctOfPrimary: 50, maxAduSqft: 1000 }),
  "millcreek":        P("Millcreek",        { minLotSqft: 8000,   sideFt: 5,  rearFt: 5,  frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 1000 }),
  "south salt lake":  P("South Salt Lake",  { minLotSqft: 6000,   sideFt: 5,  rearFt: 5,  frontBehindFacadeFt: 10, maxPctOfPrimary: 50, maxAduSqft: 1000 }),
  "west jordan":      P("West Jordan",      { minLotSqft: 10000,  sideFt: 6,  rearFt: 6,  frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 0 }),
  "west valley city": P("West Valley City", { detachedAllowed: false }),   // detached banned (internal only)
  "taylorsville":     P("Taylorsville",     { detachedAllowed: false }),   // detached banned (internal only)
  "south jordan":     P("South Jordan",     { minLotSqft: 14520, sideFt: 10, rearFt: 10, frontBehindFacadeFt: 0,  maxPctOfPrimary: 35, maxAduSqft: 1500 }),   // conditional, zone-limited
  "draper":           P("Draper",           { minLotSqft: 12000, sideFt: 10, rearFt: 20, frontBehindFacadeFt: 0,  maxPctOfPrimary: 50, maxAduSqft: 0 }),   // R3 representative setbacks
  "riverton":         P("Riverton",         { minLotSqft: 0,     sideFt: 5,  rearFt: 5,  frontBehindFacadeFt: 10, maxPctOfPrimary: 0,  maxAduSqft: 0 }),
  "herriman":         P("Herriman",         { minLotSqft: 6000,  sideFt: 8,  rearFt: 10, frontBehindFacadeFt: 5,  maxPctOfPrimary: 50, maxAduSqft: 1000 }),   // detached legalized May 2026
  "bluffdale":        P("Bluffdale",        { minLotSqft: 0,     sideFt: 10, rearFt: 10, frontBehindFacadeFt: 0,  maxPctOfPrimary: 50, maxAduSqft: 0 }),   // R-1-10 representative setbacks
  "midvale":          P("Midvale",          { minLotSqft: 6001,  sideFt: 2,  rearFt: 2,  frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 0 }),
  "cottonwood heights": P("Cottonwood Heights", { minLotSqft: 0, sideFt: 3,  rearFt: 3,  frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 0 }),   // conditional (R-1/RR-1/F-1)
  "holladay":         P("Holladay",         { minLotSqft: 10000, sideFt: 10, rearFt: 10, frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 0 }),
  "sandy":            P("Sandy",            { detachedAllowed: false }),
  "brighton":         P("Brighton",         { detachedAllowed: false }),   // detached banned town-wide (own Title 19)
  "alta":             P("Alta",             { detachedAllowed: false }),   // no ADU category exists anywhere in code (prohibitory-by-default); SB284 exempts (pop 228)
  "copperton":        P("Copperton",        { minLotSqft: 6000,  sideFt: 5,  rearFt: 10, frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 0 }),   // own Title 19 (no cap, no front offset)   // detached banned today (internal-only)
  // NOTE (SB284, ENACTED — enrolled bill le.utah.gov/Session/2026/bills/enrolled/SB0284.pdf): eff ~Oct 2026, cities
  // pop >=5,000 must PERMIT detached ADUs on single-family lots >=11,000 sqft (smaller lots + setbacks/size stay local).
  // So after Oct 2026 the >=5,000 banned cities (Sandy, West Valley, Taylorsville, Orem, Highland, Saratoga Springs)
  // must allow detached on >=11,000 sqft lots. Brighton/Alta/Copperton (<5,000 pop) are EXEMPT — their bans stand.
  // Bans below are CURRENT (pre-Oct-2026) law; revisit after the effective date.
  // ---- Utah County ----
  "lehi":             P("Lehi",             { minLotSqft: 14520,  sideFt: 5,  rearFt: 5,  frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 1300 }),
  "eagle mountain":   P("Eagle Mountain",   { minLotSqft: 8000,   sideFt: 10, rearFt: 25, frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 1200 }),  // setbacks zone-dependent (representative)
  "lindon":           P("Lindon",           { minLotSqft: 6001,   sideFt: 8,  rearFt: 20, frontBehindFacadeFt: 10, maxPctOfPrimary: 40, maxAduSqft: 1500 }),
  "vineyard":         P("Vineyard",         { minLotSqft: 12000,  sideFt: 3,  rearFt: 3,  frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 1200 }),
  "pleasant grove":   P("Pleasant Grove",   { minLotSqft: 0,      frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 0 }),   // setbacks zone-dependent -> baseline
  "alpine":           P("Alpine",           { minLotSqft: 217800, sideFt: 12, rearFt: 12, frontBehindFacadeFt: 30, maxPctOfPrimary: 0, maxAduSqft: 0 }),   // detached only as conditional guest house, 5-acre min
  "highland":         P("Highland",         { detachedAllowed: false }),   // detached banned (internal/attached only)
  "saratoga springs": P("Saratoga Springs", { detachedAllowed: false }),   // detached banned (internal only)
  "american fork":    P("American Fork",    { detachedAllowed: false }),   // detached NOT permitted today — internal accessory apartment only (§17.12.201(9) "within a one-family dwelling")
  "cedar hills":      P("Cedar Hills",      { minLotSqft: 11000, sideFt: 5,  rearFt: 5,  frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 0 }),   // R-1-11,000; detached allowed via CUP (10-2-1/10-4A), no size cap; SB284 removes the CUP after Oct 2026
  // ---- Utah County (south) ----
  "provo":            P("Provo",            { minLotSqft: 0,      sideFt: 10, rearFt: 10, frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 0 }),
  "orem":             P("Orem",             { detachedAllowed: false }),   // detached banned (internal only)
  "springville":      P("Springville",      { minLotSqft: 0,      sideFt: 10, rearFt: 10, frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 0 }),
  "spanish fork":     P("Spanish Fork",     { minLotSqft: 6000,   sideFt: 5,  rearFt: 5,  frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 1000 }),
  "mapleton":         P("Mapleton",         { minLotSqft: 21780,  frontBehindFacadeFt: 10, maxPctOfPrimary: 40, maxAduSqft: 1000 }),   // setbacks zone-dependent -> baseline
  "elk ridge":        P("Elk Ridge",        { minLotSqft: 0,      sideFt: 8,  rearFt: 8,  frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 0 }),
  "salem":            P("Salem",            { minLotSqft: 87120,  sideFt: 5,  rearFt: 5,  frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 0 }),   // detached only on >2-acre lots, in an accessory structure
  "santaquin":        P("Santaquin",        { minLotSqft: 0,      sideFt: 10, rearFt: 10, frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 1600 }),
  "woodland hills":   P("Woodland Hills",   { minLotSqft: 19000,  sideFt: 20, rearFt: 30, frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 0 }),   // conservative setbacks (internal code conflict); HOA may also bar
  "fairfield":        P("Fairfield",        { minLotSqft: 43560,  sideFt: 15, rearFt: 40, frontBehindFacadeFt: 0,  maxPctOfPrimary: 35, maxAduSqft: 900 }),   // rural, 1-acre min
  "genola":           P("Genola",           { detachedAllowed: false }),   // detached banned (internal only)
  "goshen":           P("Goshen",           { detachedAllowed: false }),   // detached banned (internal only)
  "payson":           P("Payson",           { minLotSqft: 6000,  sideFt: 10, rearFt: 10, frontBehindFacadeFt: 0,  maxPctOfPrimary: 0,  maxAduSqft: 1200 }),   // detached legalized Feb 2024 (§13.20.221)
};
export const JURISDICTIONS = Object.fromEntries([
  ...UNINCORPORATED_SLCO.map((c) => [c, { profile: KEARNS_PROFILE, verified: true }]),
  ...Object.entries(CITY_RULES).map(([c, profile]) => [c, { profile, verified: true }]),
]);

const normCity = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

// Resolve the rule profile for a parcel from its city/county.
// - Listed city (registry) -> its verified profile.
// - Otherwise (verified:false): the owner-tuned baseline `fallback` (Settings, which defaults to the county
//   ordinance) if provided, else the county baseline, else the SLCo default. Never invents city-specific rules.
export function resolveJurisdiction({ city, county, fallback } = {}) {
  const hit = JURISDICTIONS[normCity(city)];
  if (hit) return { name: city, verified: true, profile: hit.profile };
  return { name: city || county || "this area", verified: false, profile: fallback || COUNTY_BASELINES[county] || KEARNS_PROFILE };
}

// Things the map/data can't confirm — the rep verifies these on site before committing.
export const FIELD_CHECKS = [
  "Utility easements on the lot",
  "Room for 1 ADU parking space",
  "Owner lives on-site (owner-occupancy)",
  "Building permit",
];

export const NEEDS_CHECK_LABEL = {
  no_house_found: "couldn't find the house here",
  no_street_found: "couldn't find the street",
  nonconvex_parcel: "unusual lot shape",
  below_min_lot: "lot is under 7,000 sq ft",
  no_room: "no room after setbacks",
  home_size_unknown: "home size unknown (needed for this city's size cap)",
};
