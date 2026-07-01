// ADU catalog + the active jurisdiction/business rules. Config for now; moves to Supabase settings later
// (jurisdiction_profiles + org_settings). See docs/ADU_FIT_PLAN.md.

export const ADU_MODELS = [
  { id: "lafortune-40", name: "40′ × 13′4″", widthFt: 13.333, lengthFt: 40, heightFt: 13.5, beds: 1, baths: 1,
    glb: "lafortune-40", usdz: "single", floorPlan: "floorplans/lafortune-40.pdf" },
  // NOTE: glb is correctly sized (40x13'4). usdz (iOS AR) is still the generic 14x66 — needs a proper USD
  // regen (best from a real authored model). Android AR + model-viewer + the 3D lot view are correct.
];

// Salt Lake County / Kearns profile (sourced from county code — verify; SB284 may change it).
export const KEARNS_PROFILE = {
  name: "Salt Lake County — Kearns",
  minLotSqft: 7000,      // sourced
  sideFt: 5,             // provisional (per-zone)
  rearFt: 10,            // sourced
  frontYardFt: 20,       // front-yard setback for the parcel's street edge
  frontBehindFacadeFt: 10, // ADU must sit >= this far behind the house's front facade (sourced)
};

// Business practice (not code): the crew's own placement rules.
export const BUSINESS_OVERLAY = {
  houseSeparationFt: 20,     // Gavin's rule (legal min is 6) — crane/access room
  backinMinSideGapFt: 16,    // side-yard width to back a ~14ft unit in vs. crane it
};

// City profiles the owner can switch between (the master dropdown). Add cities as the business expands.
export const CITY_PROFILES = [
  { key: "slco-kearns", name: "Salt Lake County — Kearns", minLotSqft: 7000, sideFt: 5, rearFt: 10, frontYardFt: 20, frontBehindFacadeFt: 10 },
];

// Curated dropdown options — no free-text.
export const RULE_OPTIONS = {
  minLotSqft: [6000, 7000, 8000, 10000],
  sideFt: [5, 8, 10],
  rearFt: [10, 15, 20],
  frontBehindFacadeFt: [5, 10, 15],
  houseSeparationFt: [6, 10, 15, 20, 25],
  backinMinSideGapFt: [12, 14, 16, 18, 20],
};

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
};
