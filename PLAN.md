# Yardscout — Implementation Plan

> Working name. A tool for a winter trailer-home placement business in the Salt Lake Valley.
> It answers one question per backyard — **can the trailer home physically go back there?** — and
> drives door-knocking against the yards that qualify. See [CONTEXT.md](./CONTEXT.md) for the
> domain language and `docs/adr/` for locked decisions.

## What it does (one paragraph)

Pull free Utah parcel data for the service area, automatically **Score** each residential
**Parcel** red / yellow / green on whether a **Unit** can fit in the backyard *and* be moved back
there, draw the **property lines** on a satellite map colored by Score, and feed every green
**Prospect** to a door-knocker's phone. The knocker is the real verification: he pulls up, sees
if it truly works, knocks, and records the outcome, which permanently corrects that Parcel and
ground-truths the map over a season. An Office user assigns territory and watches **Knock** history
and progress.

## How the Score works (the heart of the product)

Computed from free geometry, no imagery analysis required for v1. The operator confirmed units are
**backed in when there's access, or craned in when there isn't** — so Access does not gate viability,
it sets the placement *method* and cost (see ADR-0003).

| Input | Question | Computed from |
|------|----------|---------------|
| **Open space** | Is there room to set the unit down? | Parcel polygon area − building footprint area |
| **Access** | Can it be backed in, or must it be craned? | Widest side-yard gap between building footprint and a side lot line, vs. the Unit's required access width |

- **Green-drive**: room AND a wide-enough side gap. Cheapest to fulfill — knock these first.
- **Green-crane**: room but no drive access. Still viable, costs more (crane + an on-site overhead/power-line check). Second tier.
- **Red**: no backyard room to set the unit at all. Skipped.

Per ADR-0001, the Score is a **prioritization, not a guarantee** — fences, sheds, gates, slope,
meters (for driving in) and overhead power lines (for craning) are not in the data. The Field visit
is the only real verification, and each Knock records the confirmed method/outcome so duds drop off.

### Data sources (all free)
- **UGRC Salt Lake County Parcels LIR** — parcel polygons (the property lines) plus `PARCEL_ACRES`,
  `BLDG_SQFT`, `PROP_CLASS` (filter to residential), `PRIMARY_RES` (owner-occupied filter), address.
- **Microsoft Building Footprints** — building outline polygons, needed for the side-gap Access
  geometry (LIR gives building square footage but not its shape).

### Unit thresholds (configurable, calibrated in Phase 0)
Defaults to a single-wide (~14 ft x ~70 ft) with a minimum access width set above the Unit width to
allow maneuvering. These are **Office settings**, not hardcoded, because the right numbers come from
the brother's real-world feedback on the first batch of greens.

### Scoring runs server-side, triggered in-app (not by a developer)
The score engine is part of the product, not a one-off script. The Office user picks a city (or draws
an area) and the app runs the import + score pipeline **server-side** against UGRC + footprints, then
stores the result. UGRC publishes all 29 Utah counties on the identical schema, so adding a new city
is a button, not a code change. (Phase 0 runs the same engine as a throwaway script only to validate
and calibrate the score before the app is built.)

## Phases

### Phase 0 — Prove the Score on Kearns (free, ~a week)
Goal: confirm greens match real viable yards before building any app.
- Import Kearns parcels (Salt Lake County LIR) + Microsoft footprints into PostGIS.
- Compute Open space + Access side-gap, assign red/yellow/green.
- Render property lines colored by Score over a satellite basemap (MapLibre, static page).
- Sit with the friend's brother, drive/eyeball a sample of greens, **calibrate the thresholds**.
- Exit criteria: he agrees the greens are mostly real. If not, tune and repeat.

### Phase 1 — The two-role app (the core product)
- Supabase: Postgres + PostGIS, Auth with **Office**/**Field** roles, row-level security.
- Productionized import + scoring pipeline (re-runnable; monthly data refresh).
- React PWA shell, auth, role-based routing, installable to phone home screen.
- **Office**: scored map with property lines, filters (Score, lot size, city), territory assignment.
- **Field**: the green list, map with my-location, Parcel detail with satellite view + Score
  breakdown, Knock form (outcome, confirmed access, notes).
- Knock history rolls up to Parcel status and removes confirmed duds from the list.
- Exit criteria: brother runs a full day of real knocking from the app.

### Phase 2 — PestRoutes-grade polish
- Route ordering for an efficient walk/drive sequence.
- Follow-up reminders (e.g. "interested, come back next week").
- Season-over-season Knock history per Parcel.
- Office dashboard: knocks/day, conversion, coverage heatmap.
- Vector tiles for a snappy map at valley scale; expand coverage from Kearns to all of Salt Lake
  County and surrounding counties (same data source, more imports).

### Phase 3 — Optional power-ups (only if needed)
- Offline knocking for cell dead zones (service worker + local cache/sync).
- Computer-vision access detection to pre-flag fences and cut down on duds.
- Expand to Utah / Davis / Weber counties (UGRC covers all of them).

## Open items to settle before/at launch
- **Satellite imagery licensing.** Free tiles (Esri World Imagery, etc.) have commercial-use terms;
  MapTiler/Mapbox/Google have free tiers then paid. Vet this before commercial launch — it is the
  one likely recurring cost. (Property-line vectors and parcel data are free and unaffected.)
- **Unit thresholds** — finalize defaults during Phase 0 calibration.
- **Product name** — "Yardscout" is a placeholder.

## Stack summary (ADR-0002)
React PWA · MapLibre GL JS · Supabase (Postgres + PostGIS + Auth + hosting) · free UGRC + Microsoft
data. Cost through Phase 1: effectively $0 aside from imagery-tile vetting.
