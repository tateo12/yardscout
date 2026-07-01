# ADU Fit feature — plan

Goal: when a rep taps a residential lot, show **which ADU models physically fit** in the backyard under
real placement rules, and color the map on a **green→yellow→red fade** by how well it fits. Built on free
county/state geodata. This is a prioritization + sales tool, not a legal/survey guarantee (see Compliance).

## Decisions (locked with Tate, 2026-06-30)

1. **Geometry is auto-detected, rep can nudge.** Pull the existing-house footprint and the street edge from
   free UGRC layers; rep can correct a wrong house/street. (Not manual-first, not fully-auto-no-fix.)
2. **Catalog is a config list; one model now.** Ship against the 40′×13′-4″ (~533 sqft, 1bd/1ba) LaFortune
   model, structured as a list so more sizes/floor plans drop in later.
3. **Fast map zoomed out, exact zoomed in, cached.** Whole-viewport exact geometry is too heavy; run it only
   at block-level zoom and cache each result org-wide so re-views are instant.
4. **Setbacks are editable jurisdiction profiles + a business overlay**, not constants (the law is changing).
5. **Tap result lists which models fit.** No customer website for now. AR stays on the Trailer tab, per model.
6. **Color fade is blended:** clearance (ft) drives it now, how-many-models-fit drives the bands later.

## Data sources (all free, all on the same open ArcGIS org as parcels — CORS `*`, bbox-queryable)

| Layer | URL (org `99lidPhWCzftIe9K`) | Use |
|---|---|---|
| Parcels LIR | `.../Parcels_SaltLake_LIR/FeatureServer/0` | lot polygon (have it) |
| Utah Buildings | `.../Buildings/FeatureServer/0` | existing-house footprint (polygon; `ADDRESS`, `Shape__Area`, `TYPE`, `SRC_YEAR`) |
| Utah Roads | `.../UtahRoads/FeatureServer/0` | street centerlines (`FULLNAME`, address ranges) → front edge |

- House detection = **rank candidate footprints** by (area × overlap-with-parcel) and proximity to the parcel's
  address/road context, not just "largest centroid-inside" (that fails on corner lots, breezeway-attached
  garages, merged/shared footprints, multi-home parcels). Pick the top-ranked; smaller structures = obstacles.
  `PARCEL_ID` on Buildings is often null → join by clipped-overlap, not id.
- Front/street edge = **parcel↔road boundary intersections** combined with address-range directionality (Roads
  carries `FROMADDR/TOADDR`, `PREDIR`), **not** just "nearest road line" (which breaks on flag lots, cul-de-sacs,
  private drives, and two-frontage corner lots). Multiple frontages → treat each as a front.
- **When house or front is ambiguous/low-confidence, don't guess silently — mark the lot "needs check" and prompt
  the rep nudge.** Rep corrections are **first-class stored data** (org-shared), not throwaway.
- Footprints are ML-derived (Microsoft/OSM): good, **not survey-grade** → field-verify (matches ADR-0001).

## Buildable zone (the geometry, via turf.js)

`buildable = parcel ⊖ side/rear setbacks  −  buffer(house, house_separation)  −  region street-ward of the house front line  −  easements(if available)`

- **Every rule is jurisdiction-coded**, tagged `sourced` (from cited code) or `provisional`, and **fails closed**:
  if the parcel's jurisdiction/zone is unknown, the lot is **"needs verification"** (a distinct amber-hatch
  state), never silently green. No blanket defaults applied to a lot we can't place in a known profile.
- **Jurisdiction setback profile** (editable, per city). SLCo/Kearns [`sourced`, verify — see Compliance]:
  rear **10 ft**, front = **10 ft behind the house's front facade**; side **per zone** [`provisional 5 ft` until
  the SLCo zoning layer or the owner sets it].
- **Business overlay** (stricter than code, clearly labeled non-legal): **house_separation = 20 ft** (crane/access
  practice; legal min is 6). Rep can see it's a sales overlay, not code.
- **Lot-size eligibility gate:** parcel < **7,000 sqft** [`sourced` SLCo] → ineligible → **red**. This gate is
  per-profile too (6,000 in PC zone), not a hard global constant.
- **Easements** reduce the zone but aren't in the free feed → rep field-verify flag, not a guarantee.

## Fit test + clearance metric

**Geometry hygiene first:** clean/snap every polygon to a fixed tolerance, dissolve slivers, handle holes, and
**reject pathological parcels** (self-intersecting, tiny, degenerate) to a "needs check" state rather than
trusting a boolean result. Use a robust clipping lib (turf/polygon-clipping) with explicit tolerance.

For each model rectangle (W×L), search placements in `buildable`. **Candidate orientations come from the parcel
and road edge vectors** (not an arbitrary "dominant edge"), sampling enough angles to bound the miss rate. A
model **fits** if any placement is fully inside `buildable`.

- **Clearance (ft)** = how far the placed box can grow outward before it hits the boundary (max inscribed slack
  on the binding axis). Negative = doesn't fit.
- **Placement method** (from clearance to a lot line / side-yard gap): enough side gap → **back-in**; else
  **crane** (ADR-0003). Shown as a tap readout, not encoded in color.

## Color model (blended green→yellow→red)

**One stable score drives the hue** (Codex fix — avoid colors that jump when the catalog changes):
`fitScore(parcel) = normalizedClearance(best-fitting model) = clamp(clearance / modelWidth, 0..1)`, using the
**largest model that fits** as the anchor. Map `fitScore` → hue: 1 → deep green, ~0 (just fits) → yellow,
no model fits → solid red; lot < min-size or "needs verification" → red / amber-hatch.

- **"How many models fit" is a secondary label/badge**, not the hue driver — so editing the catalog never makes
  the map flicker. (More models fitting still trends greener naturally, because a bigger model fitting means more
  clearance.) This honors the "count" intent without the instability of blending it into the color.
- **One model today:** `fitScore` = that model's normalized clearance → the real fade works now.
- Precedence unchanged: a rep flag-wrong-lot override still wins over the computed color (existing `resolveVerdict`).

## Map behavior (perf)

- **Zoom < threshold (~z16):** keep the current fast open-space color for the whole viewport (snappy valley-wide).
- **Zoom ≥ threshold (block level, ~z17+):** fetch Buildings + Roads for the small bbox, compute exact
  buildable + fit + color for the visible lots (~tens, not hundreds), off the main thread if needed.
- **Cache** each lot's result (parcel_id → {fits[], fitScore, method, computed_at}) in Supabase, org-shared like
  `parcel_flags`, so the second view is instant. **Cache key = hash of {parcel geometry, buildings/roads
  `SRC_YEAR`/dataset version, profile version, catalog version, rep-correction version}** — so a corrected house,
  a re-published county layer, a parcel split/merge, or a profile edit all invalidate stale results. On any
  upstream edit (nudge, profile change), recompute and re-broadcast.

## Tap result (side panel on Map tab)

- Lists **which model(s) fit** (name, W×L, beds/baths), and which don't + why ("6 ft too long").
- Shows the **placement method** (back-in / crane) and any **field-verify flags** (easement unknown, parking,
  owner-occupancy, permit, lot near the 7,000 sqft line).
- Rep **nudge**: "House wrong? / Street wrong?" → tap/drag to fix; correction stored per parcel, org-shared, and
  recomputes. (Same shared-cache pattern as flags.)
- Desktop = right rail; mobile = bottom sheet (reps are on phones).

## Catalog data model (config now, editor later)

```
models = [{ id, name, widthFt, lengthFt, heightFt, beds, baths, price?,
            floorPlanImg, glb, usdz }]
```
Floor-plan images + GLB/USDZ per model in `app/public/`. One entry now; owner-editable admin UI is a later phase.
Trailer tab becomes catalog-driven (lists all models; each has 3D preview + AR + floor plan).

## Compliance framing (org policy: no invented legal conclusions; use authoritative sources; verify)

- The tool **narrows the field; it does not certify legality.** Every tap result and the setback profiles carry a
  "verify with Salt Lake County Planning" note. Not legal advice.
- Setback numbers are **editable per jurisdiction** because **SB284** (cities ≥5,000 must permit detached ADUs,
  policies due Oct 2026) is actively changing the rules.
- Sources: SLCo ADU page; County Code Ch. 19.15; Utah Code 17-27a-513 (manufactured homes need a permanent
  foundation — the business builds to this) & 10-9a-530.

## Phasing

- **P1 (this):** Buildings+Roads fetch + house/front detection; buildable zone (SLCo profile + 20 ft overlay +
  7,000 sqft gate); fit + clearance for the one model; blended color at block zoom + cache; tap = fits list +
  method + field-verify flags; rep nudge; keep fast color zoomed out.
- **P2:** full catalog + floor plans; count-based bands; catalog-driven Trailer tab; admin editor.
- **P3:** LiDAR slope/heights; easement/zoning layers if a free source exists; customer website + share link.

## Settings & configuration (city switcher + everything that needs to be tunable)

### Shared vs per-device (the key split, now that data is org-shared)
- **Org-shared (Supabase; OWNER edits, reps read-only via `app_is_owner()` RLS):** anything that changes the
  *truth* of a score — jurisdiction rules, business overlay, catalog + default model, prospect rule. One source
  of truth for the whole crew.
- **Per-device (localStorage, each rep):** cosmetic/navigation only — map style, highlight-rentals, home location.
  Never affects shared results.
- This also fixes a latent bug: today's trailer-size + scoring-strictness live in localStorage and drive the
  score — in a crew that means every rep scores differently. They move to shared config.

### Jurisdiction profiles — the city switcher (NEW table `jurisdiction_profiles`)
One row per city/zone the business works. Columns:
`id, org_id, name, match_cities text[] (PARCEL_CITY values that map here), is_default bool,
min_lot_sqft, rear_ft, side_ft, front_behind_facade_ft, max_adu_sqft, max_adu_pct_of_primary,
height_ft, parking_spaces, owner_occupied bool, side_source (sourced|provisional|heuristic),
notes, active, updated_at`. RLS: org members `select`; owner `insert/update`.
- **How a parcel picks a profile:** `parcel.PARCEL_CITY` → first profile whose `match_cities` contains it →
  else the org **default** profile → else **fail-closed "needs verification"** (never silently green).
- Seeded with the **SLCo/Kearns** profile (the `sourced` numbers: 7,000 sqft, rear 10, front 10-behind-facade)
  plus a conservative provisional default. Owner adds West Valley, Taylorsville, etc. as they expand.
- Every field keeps its source tag → shown on the tap result so a rep sees code vs guess.
- Editing a profile bumps the **profile version** in the fit-cache key → recompute + realtime rebroadcast.

### Business overlay + behavior — `org_settings` (jsonb, one row per org, owner edits)
- `house_separation_ft` (default 20, `heuristic` — your crane/access practice, not code)
- `backin_min_side_gap_ft` (ADR-0003: side-yard gap needed to back in vs. crane; **default 16 ft** =
  ~14 ft biggest unit + maneuvering room to thread it in on a trailer; confirm with Gavin, 18 ft = comfortable)
- `default_model_id` (which catalog model anchors the map color)
- `prospect_rule` (what lands on the knock list — green only vs green+yellow)
- `fastcolor_margin` (the zoomed-out open-space first-pass strictness — kept as a cheap knob)

### Catalog (`adu_models`) — owner-managed shared config
Config list in code now; **P2** = table + admin editor (name, W/L/H, beds/baths, price, floor-plan, glb/usdz,
active). `default_model_id` points here. Editing bumps the **catalog version** in the fit-cache key.

### Migration of existing settings
- trailer W/L/H presets + scoring strictness (per-device, score-affecting today) → **move to shared**
  (catalog + `org_settings`); old localStorage values ignored.
- map style, highlight-rentals, set-home → **stay per-device**.
- export / reset / clear → unchanged (export is already shared-aware).

### Every setting is a DROPDOWN of preset options — no free-text (Tate 2026-06-30)
Owner picks from curated lists; can't type an invalid/unsafe number. Option sets:
- **City / jurisdiction** (the master switch — loads the legal fields below): `Salt Lake County — Kearns`, then
  more cities as the business expands.
- Min lot size: 6,000 / **7,000** / 8,000 / 10,000 sqft · Side: **5** / 8 / 10 · Rear: **10** / 15 / 20 ·
  Behind house front: 5 / **10** / 15 (all default to the selected city's `sourced` value).
- Distance from house (business): 6 / 10 / 15 / **20** / 25 · Back-in vs crane cutoff: 12 / 14 / **16** / 18 / 20.
- Knock list shows: **Green only** / Green + Yellow · Default model: (catalog list).
Legal fields default from the city pick but stay adjustable (dropdown) for when a city differs; business fields
are the owner's to set. Stored per the shared-config model below.

### Settings tab layout — SINGLE-OWNER NOW, per-rep later (Tate 2026-06-30)
Build only what one owner-operator needs. **No per-rep read-only gating UI yet** — that's a later phase when a
real crew exists. RLS still owner-write / org-read at the DB (cheap, future-proof), but the app shows the one
owner everything as editable; don't build the "managed by your admin" rep view now.
- **Company rules** (the one owner edits): Jurisdictions (list; add/edit city profiles; set default), Business
  rules, Catalog + default model, Prospect rule. Writes to Supabase; invalidates the fit cache.
- **My app:** map style, highlight-rentals, set home, export data.
- New DB objects (future migration): `jurisdiction_profiles` table, `org_settings` row, and (P2) `adu_models` —
  owner-write / org-read RLS, mirroring the existing pattern.
- **Per-rep layer (LATER):** read-only rep views, role management, seat-scoped visibility.

## Geometry validation (test fixtures — build against these before trusting output)

Hand-picked real parcels + synthetic cases, with expected buildable-zone / fit asserted:
corner lot (two frontages, e.g. LaFortune), flag/pipestem lot, parcel with a hole/easement notch, rotated/skewed
lot, house footprint missing, two merged/adjacent footprints, breezeway-attached garage, tiny sub-min lot,
self-intersecting/degenerate polygon (must route to "needs check"). CI-style geometry tests, not eyeballing.

## Source-refresh policy

Parcels/Buildings/Roads are fetched per viewport at view time (live), so map reads are always current-ish. The
**cache** is what can go stale: store each layer's dataset version (`SRC_YEAR` etc.) with the cached result;
on a newer dataset version, or a rep correction, invalidate + recompute that parcel and broadcast to the crew.
No blind long-lived cache.

## Legal-data authority map (what's code vs heuristic — shown to the rep)

| Field | Source | Authority |
|---|---|---|
| Min lot size 7,000 sqft (6,000 PC) | SLCo ADU page / Ch. 19.15 | `sourced` |
| Rear 10 ft, front = 10 ft behind facade | SLCo | `sourced` |
| Side setback | zone-specific | `provisional 5 ft` until zoning layer / owner sets |
| House separation 20 ft | business practice | `heuristic` (legal min is 6 ft) — labeled non-legal |
| Easements, parking, owner-occupancy, permit | code, but not in data | `field-verify` (rep checklist) |

The tap result surfaces each rule's tag so a rep never mistakes a sales overlay for the law.

## Risks / open questions (for Codex)

- Rectangle-in-polygon placement search: fast + good enough at block zoom? worker needed, or is on-tap enough?
- House detection failure modes (missing/merged footprints, corner lots w/ two fronts like LaFortune, flag lots).
- Cache invalidation correctness (profile/catalog version in the key); staleness across the crew.
- Is a per-viewport Buildings fetch (≤2000/page) enough coverage, or do we paginate like parcels?
- Setback profile accuracy: side setback is zone-specific — do we need the SLCo zoning layer, or ship a
  conservative default + field-verify and let the owner edit?
