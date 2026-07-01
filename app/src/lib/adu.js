// ADU catalog + the active jurisdiction/business rules. Config for now; moves to Supabase settings later
// (jurisdiction_profiles + org_settings). See docs/ADU_FIT_PLAN.md.

export const ADU_MODELS = [
  { id: "lafortune-40", name: "40′ × 13′4″", widthFt: 13.333, lengthFt: 40, beds: 1, baths: 1 },
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

export const NEEDS_CHECK_LABEL = {
  no_house_found: "couldn't find the house here",
  no_street_found: "couldn't find the street",
  nonconvex_parcel: "unusual lot shape",
  below_min_lot: "lot is under 7,000 sq ft",
  no_room: "no room after setbacks",
};
