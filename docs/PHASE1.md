# Phase 1 — Shared backend (turn the POC into a real multi-user tool)

> Status: DRAFT v2, reconciled with a Codex review. Goal: stop being a single-device demo. Make customers
> and knocks shared and live across devices, behind a login, with the scoring source swappable later.

## Problem today
- All data lives in one browser's `localStorage` (`yardscout.knocks.v2`), and customers + knocks are fused
  into one record shape. Two people don't share data.
- No login; the live site is public.
- The valley score is the lightweight open-space-only version; the back-it-in vs. crane (Access) tiers
  are not computed valley-wide (that needs the building-footprint pass).

## Target architecture
- **Frontend**: keep the existing React + Vite app on GitHub Pages. No rewrite.
- **Backend**: Supabase (managed Postgres + PostGIS, Auth, Realtime). Browser talks to Supabase via the
  JS client with the public anon key (safe **only if** Row-Level Security is correct, see verification step).
- **No separate server.** GitHub Pages (static) + Supabase is the whole stack.

## Data model (Postgres) — customers and knocks are SEPARATE concepts
The app currently fuses them; Phase 1 splits them cleanly.
- **customers** (sales pipeline): `id uuid pk`, `parcel_id text null`, `status` (lead|interested|booked),
  `name`, `phone`, `email`, `addr`, `city`, `method` (backin|crane|tbd), `place_date`, `price`, `notes`,
  `lat`, `lng`, `created_by`, `updated_by`, `created_at`, `updated_at`, `deleted_at null` (soft delete).
- **knocks** (visit events): `id uuid pk`, `parcel_id text`, `outcome`, `notes`, `knocked_by`,
  `knocked_at`, `lat`, `lng`. A parcel has many knocks (season history).
- **parcels** (server-scored cache — Phase 1b only): `parcel_id pk`, `geom`, `city`, `acres`, `bldg_sqft`,
  `primary_res`, `open_sqft`, `tier`, `method`, `scored_at`.

## Auth (right-sized for a small field crew)
- **One shared business login** (email + password the family knows). Avoids the friction of every field
  worker maintaining a magic-link email session on a phone all day. (Codex flagged magic-link friction.)
- **Attribution without per-user accounts**: a lightweight "Who's knocking?" name picker stored on each
  record (`created_by` / `knocked_by`), so you still see who did what without separate accounts.
- RLS: authenticated session required for everything. `select`/`insert`/`update` for the authenticated
  workspace; **`delete` is soft-delete only** (`deleted_at`), so nobody can hard-wipe data from a phone.
- Multi-tenant/org separation is explicitly out of scope (one business).

## The one real design decision: where does scoring live?
**Option A — keep client-side viewport scoring (ship Phase 1 fast).** Map loads parcels live from UGRC per
viewport and scores in the browser. Backend stores customers/knocks only. Smallest change; no parcel table.
**Option B — server-side pre-scored parcels (Phase 1b).** Load parcels + footprints into PostGIS, compute
full drive/crane/no-fit in SQL, store, read pre-scored. Real Access score valley-wide; more work + cost.

**Recommendation (Codex concurs): ship A first, B as a fast-follow.** Sharing data is what makes it a real
tool; the richer score is the next step. **Critical condition:** treat A as an architecture boundary, not a
hack. All scoring goes through one `scoreParcel(props)` function so swapping to server-scored fields in B is
a one-file change, not a rewrite.

## Phase 1 deliverables (Option A)
1. Supabase project; `customers` + `knocks` schema with `created_by/updated_by/updated_at/deleted_at`; RLS.
2. Shared login + "Who's knocking?" name picker; gate the app behind auth.
3. Replace `localStorage` with Supabase queries; **split the fused record into customers vs knocks**.
4. Realtime sync (insert/update/delete) so a knock on one phone appears on others; show "last updated".
   Conflict policy: **last-write-wins on `updated_at`** (fine for a tiny crew).
5. **CSV export** for customers and knocks (cheap insurance for a small business).
6. Wrap the existing `scoreParcel()` as the single scoring boundary.
7. Graceful handling if the UGRC service is slow/down (the map's data source) — show a clear state, retry.
8. Build/deploy: inject `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` via GitHub Actions secrets.
9. **RLS verification**: an explicit test that an un-authed client cannot read/write any table.

## Phase 1b — server-side scoring (run as a SPIKE first, not a blind build)
10. Validate PostGIS scoring (drive/crane via `ST_Difference`/`ST_Buffer`) on a **small subset** first;
    measure geometry storage size and query cost before materializing the whole county.
11. If viable: import parcels + footprints, populate `parcels`, point the map at server-scored data,
    add an "add a city" function. Decide footprint retention (permanent vs transient) based on the spike.

## Risks / open decisions
- **Supabase free tier (500 MB)**: customers/knocks are tiny, fine for Phase 1. Phase 1b parcel geometry
  may exceed it → scope `parcels` to worked cities or take the ~$25/mo tier (already budgeted).
- **Anon key public + RLS**: standard and safe only with correct RLS — hence the explicit verification step.
- **Weak-signal field use**: full offline stays out of scope, but Phase 1 should at least do optimistic
  local writes with a retry queue so a knock on bad coverage isn't silently lost. (Codex risk; right-sized.)
- **Existing localStorage data**: it's demo/test data, no real customers yet → no migration needed. Add an
  optional one-time "import my local data" button only if convenient; not a blocker. (I disagree with
  Codex's framing of this as critical, given there's no production data.)

## Explicitly out of scope for Phase 1
Route ordering, follow-up reminders, season-history UI, dashboards, photos, multi-county, full offline.
