# Yardscout — Owner Qualifying / Equity-Likelihood Plan (Codex-reviewed)

Goal: on top of the existing physical/legal **fit** engine, score each lot by **who to knock** using free live
Salt Lake County owner data. Surface owner name, length of ownership, owner-occupancy segment, home value, and an
equity-likelihood estimate. Both owner-occupants and investors are targets (different pitch), so occupancy never docks score.

## 1. Data source (verified 2026-07-01, real Kearns records)

County full parcel service, public, browser-queryable:
`https://apps.saltlakecounty.gov/slcogis/rest/services/Land/MapServer/1`

- 397,598 parcels, all of Salt Lake County incl. Kearns. ArcGIS query API, `maxRecordCount` 2000.
- **CORS open to the app**: server reflects `Access-Control-Allow-Origin: https://tateo12.github.io`. Live browser query works, no download/proxy.
- Different host than the Esri CDN used for LIR/buildings/roads, so treat as slower + less certain uptime.

Join key: county `parcel_id` == LIR `PARCEL_ID` (verified identical, e.g. `20122550080000` for "5045 W 4985 S").

Fields used: `date_created` (deed/vesting date string, tenure = now − date), `own_name`, `own_addr`, `own_citystate`,
`prop_location`, `taxable_value`, `total_full_mkt` (== `total_assessed` = market value), `full_mkt_total_bldg`/`_land`,
`year_built`, `total_sq_ft`, `parcel_acres`, `num_housing_units`, `lot_use`. Ignore `last_vesting` (recorder entry number).

Measured data quality (Kearns 200-parcel sample): **~57% have a real vesting date**; ~43% show placeholder "Jan 1 1900".
Tenure median 6 yrs, max 45.

## 2. geo.js — enrichment by ID, not by envelope (Codex fix #3)

The app already holds the viewport's LIR parcels (each with `PARCEL_ID`). Enrich by **exact ID set**, so county records
map 1:1 to displayed parcels with no boundary mismatch, no overfetch, no cap surprise:

```
export const COUNTY = "https://apps.saltlakecounty.gov/slcogis/rest/services/Land/MapServer/1";

export async function fetchOwnership(parcelIds) {
  // chunk ids (~200/chunk, well under the 2000 cap), where=parcel_id IN ('..','..'), esri json (no geometry).
  // POST the query if the URL would exceed ~2k chars. Returns Map<parcel_id, OwnerRecord> (+ fetchedAt per record).
  // Any chunk error/timeout -> that chunk missing; NEVER throw. Caller degrades to fit-only for missing ids.
}
```

`OwnerRecord = { ownerName, occupancy, occupancyWhy, tenureYrs|null, marketValue, yearBuilt, sqft, fetchedAt }`.

**Immutable sidecar (Codex fix #5):** keep a separate `Map<PARCEL_ID>` (do NOT mutate parcel features or the fit cache).
UI reads a merged view at render time.

## 3. Parsing + classification (pure, unit-tested)

- `parseVestDate(s)` → Date|null. Collapse whitespace, strip " 12:00AM", `Date.parse`; reject year < 1901 (placeholder).
- `tenureYears(date, now)` → number|null (null when date unknown).
- `classifyOccupancy(rec)` → `{ tag: 'owner-occupant'|'investor'|'unknown', why }` (Codex fix #1, tri-state not bool):
  - Primary: normalized street-number+name of `own_addr` vs `prop_location` match → owner-occupant; clear mismatch or
    LLC/"PROPERTIES"/" LC"/"INC" in `own_name` → investor.
  - Weak tiebreaker only: `taxable_value/total_full_mkt` in [0.45,0.65] nudges toward owner-occupant.
  - Signals absent or disagree → `unknown`. Always keep `why` so the UI never overstates certainty.
- `marketValue` = `total_full_mkt`.

## 4. Scoring — equity-likelihood estimate (honest, Codex fix #2)

Fit stays the hard gate (unchanged). Add `leadScore(rec)` → 0..100, an **estimate of equity + ability to finance**,
explicitly NOT a dollar figure or loan status:

- **Tenure** (0..45): 0yr→0, ≥15yr→45. Unknown → neutral 22 (never penalize the 43% without a date).
- **Value band** (0..30): stable **city-wide** coarse bins (NOT viewport percentiles — those shift on pan). Favor the
  mid-market that fits a manufactured-ADU buyer; both tails taper. Derived from a fixed SLCo/Kearns distribution.
- **Home age** (0..25): older → more likely paid down. Pre-1980→high, newer→low. From `year_built`.

`equityTier` = Hot/Warm/Cool bins, labeled in UI as a **rough sort, not a calibrated probability**.

**Segment (pitch tag, not scored):** owner-occupant → extra income / aging parents / raises home value.
Investor/absentee → add a rentable door, cash-flow, ROI.

## 5. UI

Detail card (below the fit "which units fit"): owner name; "Owned since 1982 (43 yrs)" or "Move-in date unknown";
occupancy chip + one-line pitch; market value; **equity-likelihood tier badge with an "estimate, not actual equity" note**
and a small **"as of <fetchedAt>"** (Codex fix #4). Map: keep only-winners rendering; shade the winners by `equityTier`
(valid here because visibility already means "fits", so tier is pure prioritization, not a conflation — the one point I
kept against Codex #8). Card states "Fits" and the tier plainly so the two never blur.

## 6. Caching / reliability (Codex fix #4, #6)

- Enrich the viewport's IDs once (mirror the `computeFits` batch pattern), cache in `Map<PARCEL_ID>` persisted to
  localStorage with per-record `fetchedAt`.
- Short TTL for live field use (a few days); show data age; a manual **"Refresh this area"** action re-pulls the viewport.
- County fetch is best-effort + time-boxed. On failure, show fit results with owner data absent. Never block fit on it.
- **No bundled owner snapshot** (dropped per review): shipping bulk PII into a static public site is a privacy/maintenance
  hazard. Live fetch + local cache only. Revisit offline resilience later with explicit size/refresh/PII rules if needed.

## 7. Privacy

Owner names/addresses are public record, used for legitimate lead qualification. Store the minimum (viewport cache),
show to the rep only, never export/redistribute a bulk copy. Purpose-limited.

## 8. Honest limits

- Equity is a **likelihood/estimate** (tenure + value + age), not a dollar figure: Utah is non-disclosure, so sale price
  and loan balance are never public.
- Tenure known for ~57% of doors; the rest score on value+age, tenure shown "unknown", never penalized.
- `date_created` is the last vesting/deed date; for owner-occupants ≈ move-in, for others = acquisition date. Label as such.
- Live dependency on the county server; degrade to fit-only if it's down.

## Review resolutions (Codex)

1. Occupancy → tri-state tag + reason (done, §3). 2. Score honest, labeled estimate, no false precision (done, §4/§5).
3. Enrich by parcel-id set not envelope, chunk + POST + partial-ok (done, §2). 4. Per-record fetchedAt, TTL, refresh,
show age (done, §5/§6). 5. Immutable sidecar, no feature mutation (done, §2). 6. Bundled PII snapshot dropped (done, §6).
7. Stable city-wide value bins, not viewport percentiles (done, §4). 8. Kept tier shading — only-winners map means fit is
already encoded by visibility, so tier is prioritization not conflation; card states both (justified deviation, §5).
