# Shared-data migration plan (Phase 1a, remaining work)

Goal: move customers/knocks off per-device localStorage onto Supabase so a whole crew shares one
live dataset; add flag-wrong-lot; keep single-session. Auth gate + RLS already shipped and verified.

## DB (migration_2.sql — the SQL the owner runs)
- `profiles.active_session` (single session — already coded in the app).
- `parcel_flags` table (org_id, parcel_id, verdict 'fits'|'no_fit', note, flagged_by; unique per org+parcel) + RLS (org members while active; soft via upsert).
- Add profiles/customers/knocks/parcel_flags to the realtime publication.

## Frontend wiring (App.jsx + lib/data.js)
1. **Replace the localStorage `knocks` blob** with Supabase-backed state, loaded on login:
   - `customers` ← `loadCustomers()`; the Customers tab + map flags render from it.
   - `knocks` (latest outcome per parcel) ← `loadKnocks()`.
   - `flags` (parcel overrides) ← load parcel_flags.
   - `org_id` comes from `profile.org_id` (passed into App), stamped on every write.
2. **Writes go to Supabase** (not localStorage):
   - mark interested/booked or add/edit a customer → `saveCustomer()` (upsert).
   - remove customer → `deleteCustomer()` (soft delete).
   - log a knock outcome → `logKnock()`.
   - flag-wrong-lot → upsert `parcel_flags`.
3. **Realtime:** `subscribeShared(orgId, table => reload(table))` so a teammate's change appears within seconds. Supabase is AUTHORITATIVE; local React state is a cache reconciled from server/realtime after every write — shared data is never written back to localStorage. Customers conflict = last-write-wins on `updated_at`. **Knocks are history rows** (no `updated_at`); "latest per parcel" = `knocked_at desc, id desc`. A single `resolveVerdict(parcelId)` = `parcel_flags.verdict` if present, else the computed green/yellow/red — used everywhere (map color, flag, detail), no scattered precedence logic.
4. **flag-wrong-lot UI:** on the parcel detail, a "Doesn't fit / Does fit" correction. A flagged parcel shows a "rep-corrected" badge and its map color reflects the override (e.g., red if a rep said no_fit, green if fits), so the crew stops trusting a bad computed score.
5. **Settings stays in localStorage** (per-user prefs: trailer size, map style, home) — not shared. CSV export already done.
6. **No data import** from old localStorage (it's demo data) — start fresh per org.

## Risks / open questions (for Codex)
- Async writes vs. snappy UI: optimistic local update then reconcile from realtime, or await each write? (lean optimistic).
- Realtime resync cost: reload whole table on any change vs. apply the single row from the payload (start with reload; small data).
- flag-wrong-lot precedence: an explicit rep override should win over the computed verdict everywhere (map color, flag, detail) — confirm one source of truth (`flags` map keyed by parcel_id).
- Knocks: store every knock (history) or just latest-per-parcel for the UI? (insert history rows; UI reads latest per parcel_id).
- Offline/poor-signal field writes: out of scope for now (online-first); flag if it'll bite.
