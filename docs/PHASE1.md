# Phase 1 — Accounts, shared data, and billing (the real backend)

> Status: DRAFT for Codex review. Turns Yardscout from a single-device localStorage demo into a
> multi-user product a dealer pays for: logins, an org with rep seats, shared live data, and Stripe
> billing matching the agreed pricing ($25/seat founding → $49 standard, one-time setup, pausable).

## Where we are today
- React + Vite **static** site on GitHub Pages. No server.
- All data (customers, knocks, settings) is per-browser **localStorage**. No login. Map parcels load
  live client-side from the free UGRC service (this stays as-is).
- Pricing model decided: per-seat subscription, one-time setup fee, pause/reactivate, founding rate.

## Target architecture
- **Frontend**: keep the React app on GitHub Pages. It gains a login gate and talks to Supabase.
- **Backend**: **Supabase** — Postgres (+ RLS), Auth, Edge Functions (for Stripe webhooks/checkout),
  Realtime (live shared data). Browser uses the public anon key; **RLS scopes every row to an org**.
- **Billing**: **Stripe** — Checkout for signup, **Customer Portal** for self-serve management (keeps us
  out of PCI scope, no card fields in our app), webhooks → Edge Function → org subscription state.
- No separate always-on server; GitHub Pages + Supabase (+ Stripe) is the whole stack.

## Account model (decided up front — everything depends on it)
**The dealer is the org; reps are seats under it.** Not flat users.
- `orgs` — one per dealer. Holds billing + subscription state.
- `profiles` — one per user; `org_id` + `role` (`owner` | `rep`). Owner manages billing + seats; rep just uses the app.
- Owner signs up → creates the org. Owner **invites reps by email**; rep accepts → joins the org as a seat.

## Data model (Postgres + RLS)
- **orgs**: `id`, `name`, `created_at`, `stripe_customer_id`, `subscription_status`
  (`trialing|active|past_due|paused|canceled`), `plan` (`founding|standard`), `seats`,
  `founding_until` (date the $25 rate ends), `disclaimer_version`.
- **profiles**: `id` (=auth user id), `org_id`, `role`, `name`, `disclaimer_accepted_at`.
- **customers**: existing fields + `org_id`, `created_by`, `updated_at`, `deleted_at` (soft delete).
- **knocks**: existing fields + `org_id`, `knocked_by`, `knocked_at`.
- **invites**: `email`, `org_id`, `token`, `expires_at`.
- **RLS** (designed + tested BEFORE any data moves off localStorage): write an explicit policy matrix for
  every table × {select, insert, update, delete} × {owner, rep, anon}. The tricky write paths get
  **security-definer RPCs / Edge Functions**, not raw table writes: org creation on signup, invite
  acceptance (join org), seat add/remove, profile updates. `delete` is soft-delete only. A hard gate:
  an automated integration test proving an anon/other-org client cannot read or write tenant rows.

## Disclaimer gate (liability shield)
- On first login, a one-time **"I understand fit results are estimates from public county data — verify
  on site"** acceptance, timestamped to `profiles.disclaimer_accepted_at` with a version. Blocks the app
  until accepted. The visible in-detail disclaimer (already shipped) stays too.

## Sequencing — ship the foundation before the billing plumbing
**Phase 1a — accounts + shared data (the ONLY thing in scope first; Stripe deferred entirely):**
1. Supabase project; schema + the full RLS matrix + the security-definer RPCs; the anon-access test passes.
2. Auth = **email + password with reset** (magic link rejected: shared-phone field crew, login-recovery pain).
   Login screen, org creation on owner signup, rep invite-by-email flow.
3. Move customers/knocks from localStorage to Supabase, scoped by `org_id`; Realtime so a knock on one
   phone shows on others; last-write-wins on `updated_at`. **No localStorage import** — start each org
   fresh (existing data is throwaway demo data; importing risks it leaking across accounts).
4. Disclaimer gate on first login (timestamped to the profile).
5. Access gate is **DB-authoritative and RLS-enforced**, not a client-only screen: reads
   `orgs.subscription_status`; RLS denies data when not active. In 1a that status is set **manually**
   (you invoice the first customer by hand); this is the real gate, 1b just automates who sets it.
6. First customer (the friend dealer) runs on **manual billing** through all of 1a — sharing data is the
   value; Stripe is monetization plumbing that must not block multi-user.

**Phase 1b — Stripe billing (only after 1a is solid in real use):**
7. Stripe products/prices: per-seat ($25 founding / $49 standard, monthly + annual), one-time setup
   ($150/$299), one-time reactivation ($99).
8. Signup → **Stripe Checkout** (setup fee + subscription with seat quantity = #reps).
9. **Customer Portal** for the owner: update card, change seats, pause, cancel.
10. **Pause/resume** via Stripe `pause_collection`; resume fires the $99 reactivation charge.
11. **Founding→standard** auto-bump at `founding_until` (Stripe price schedule or scheduled job).
12. **Webhooks** (Supabase Edge Function, signature-verified) are the **single source of truth** for
    subscription state → write `orgs.subscription_status`/`plan`/`seats`. **Seat enforcement lives in
    Supabase/RLS, never the client.** The Customer Portal handles card/cancel UI but does NOT understand
    our org/seat model, so seat counts sync from webhooks, not from the portal alone. Grace window for
    `past_due` (e.g., 7 days → paused).

## Open decisions / risks (for Codex)
- **Stripe deferred** (resolved per Codex): 1a ships with manual billing; build Stripe (1b) only once the
  multi-user data flow is stable in real use. Don't let billing plumbing block multi-user.
- **Auth** (resolved): email + password + reset, not magic link.
- **Migration** (resolved): no import; start each org fresh.
- **Supabase free tier** (500 MB / limits) fine for customers/knocks; parcels stay client-side (not stored).
- **Security is the whole ballgame here**: the frontend is fully public (static Pages + public anon key) —
  put NO secrets in it, and treat the client locked-screen as cosmetic. Every sensitive read/write is
  enforced in Postgres/RLS; the anon/other-org integration test is a release gate. Stripe webhook
  signatures verified server-side.
- **Realtime conflict**: last-write-wins acceptable for a small crew.
- **Out of scope for Phase 1**: route ordering, dashboards, photos, multi-county data licensing, the
  building-footprint (drive/crane) scoring pass.
