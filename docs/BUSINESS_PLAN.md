# Yardscout - Business Plan

_Working doc. Last updated 2026-07-04. Owner: Tate Henricksen. Status: pre-revenue, one design partner (Gavin Jones' family business)._

> This is a living strategy document, not a pitch deck. Numbers marked _(illustrative)_ are assumptions to be validated, not researched facts. Nothing here is legal or financial advice.

---

## 1. Executive summary

Yardscout is a web app that tells a home-improvement sales team **which properties are worth knocking on** and **whether the thing they sell can physically go there** - auto-scored across an entire region from free public data.

Today it is built for **manufactured-home / ADU (accessory dwelling unit) placement businesses**: tap any lot and it computes which ADU models fit in the backyard under that city's real zoning setbacks, shows the property lines on satellite, and scores the owner as a sales lead (owner-occupied vs investor, likely equity). Reps knock the good yards instead of guessing; the office builds and assigns lists.

The strategic insight: **this is not "an ADU CRM." It is a property-feasibility + lead-qualification engine.** ADU fit is the first rule template. Swap the geometry rule and the same engine screens for a pool, an RV pad, a shop, a solar array. That is the difference between a niche tool and a platform.

**Where we are:** working app, live public data pipeline (state + county GIS), 45 Utah jurisdictions loaded with sourced zoning rules, a Supabase backend skeleton for accounts/CRM. Not yet billing, not yet multi-tenant-hardened, one unpaid design partner.

**The plan:** land the first paying ADU dealers in Utah with Gavin's dad as design partner, prove ROI on real placements, then expand along two axes - more Utah/regional dealers, and (later) other canvassing verticals that need the same engine.

---

## 2. The problem

Door-to-door home-improvement sales is enormous and mostly **blind**. Reps walk neighborhoods with no idea:
- whether a given backyard can even physically accommodate the product (setbacks, lot size, existing house footprint),
- whether the owner is a good candidate (owns it, has equity, likely to invest),
- which streets are worth their limited daily door-count.

For ADU/manufactured-home dealers specifically the physical-fit question is a hard gate: most yards simply cannot take a unit under local zoning, and reps burn days discovering that door by door. The zoning rules differ by city and change constantly (Utah's SB284, effective Oct 2026, rewrites detached-ADU rules statewide).

**One extra placement is worth $5,000-$20,000+ in revenue.** So even a modest lift in rep efficiency dwarfs the cost of software. That is the wedge.

---

## 3. The product

### What it does today
- **Fit engine:** given a parcel, computes whether catalog ADU models physically fit the backyard using parcel geometry, the existing house footprint, street frontage, and the city's setback/size rules. Colors the map green->yellow->red by clearance.
- **Property lines + satellite** on a Leaflet/Esri map, valley-wide, loading live as you pan.
- **Owner / equity qualification:** enriches fitting lots with owner data - owner-occupant vs investor, tenure, value band, an equity-likelihood tier (hot/warm/cool). Investors are treated as *good* leads (they understand ROI), not penalized.
- **Two-role CRM:** office builds/assigns prospect lists; field reps knock, drop customer flags, log status (Lead/Interested/Booked), capture contact + job detail. Backed by Supabase.
- **3D + AR:** preview the configured unit and drop it in the yard via phone AR.

### The core asset (the moat)
1. **A per-jurisdiction rule engine** with 45 Utah cities' ADU rules sourced to municipal code, each carrying a citation. This is hard-won, defensible, and constantly-decaying data - which is a moat *if kept fresh* (see §10).
2. **A live public-data pipeline** - parcels + building footprints + roads from Utah's state GIS (UGRC), owner data from county assessors. Free inputs, real geometry, no per-property data cost.
3. **Owner/equity scoring** tuned for a non-disclosure state (Utah publishes no sale prices), so equity is a *likelihood* model from tenure + value + age, not a fabricated dollar figure.
4. **The combination.** Plenty of tools do parcels, or CRM, or lead lists. The value is fit + owner-qualification + canvassing workflow in one loop.

---

## 4. Market and target segments

Ordered by how I'd actually chase them, not by size.

1. **Manufactured-home / ADU dealers (beachhead ICP).** 2-10 rep crews, growth- or ROI-minded, tech-comfortable owners in their 30s-50s. Gavin's dad is the archetype and the design partner. Win these first, in Utah, with proof.
2. **Other home-services canvassing verticals (the expansion).** Solar, roofing, fencing, concrete/RV pads, sheds/shops, pools, landscaping. Same engine, different fit rule = a config change, not a rewrite. Biggest upside, lowest technical lift. Keep the rule engine generic now so this stays cheap later.
3. **Real estate investors / SFR portfolio owners / property managers.** The equity scoring already answers "which of my doors can add a rentable ADU and pencil." They buy data, not hand-holding. This is also the "matchmaking" seed (§6).
4. **Real estate agents / brokerages.** Listing differentiator: "this lot can add an ADU worth $X." Lighter engagement; candidate for a cheap self-serve tier.
5. **Lenders / ADU financing / HELOC providers.** Not buyers - a referral channel. The equity angle is their lead too; co-market.
6. **Municipalities / planning departments.** ADU-capacity screening for housing plans and SB284 compliance; a citizen-facing "can I build an ADU?" tool. Long government sales cycle - not now, but the credibility layer (§10) opens this door later, and a city that *uses* it is implicit endorsement.

---

## 5. Business model

### Primary: per-seat SaaS
Businesses bring their own canvassers and pay per seat. Lean, recurring, keeps us as the software/data layer rather than a labor company.

**Current pricing** (reassessed 2026-06-30):
- Standard **$89/seat/mo** ($74/seat annual)
- Month-1 intro **$49/seat**, then standard
- Founding (first ~3 dealers, 12-mo lock) **$69/seat/mo** ($55 annual)
- **No setup fee.** No seat minimum. Pause/restart is **free** (business is seasonal).

Rationale: one extra placement ($5k-20k) makes $89 a rounding error; the fit-map + owner-scoring combo has no direct competitor in the ADU niche, justifying a premium over a plain canvassing app or a static lead list.

### Add-on: canvassing-as-a-done-for-you service
For dealers who won't staff a field team, offer managed canvassing on top of the software. Higher revenue per account, but it introduces labor ops - offer it as an *add-on*, not the core, until demand is proven. (This is the controlled version of "I supply the canvassers.")

### Secondary / later
- **Filtered lead-list export** as a standalone product - sell the list (viable + owner-occupied + long-tenure) to businesses that don't want the whole app. Revenue without seats.
- **Homeowner self-serve widget** ("check your address") embedded on a dealer's or city's site; captures leads.
- **White-label / channel** - manufacturers (e.g. Cavco) or franchises subsidize seats for their dealer network.
- **Matchmaking marketplace** (your idea) - connect ADU dealers with investors/property managers who want to add doors. Genuinely good, but it is a two-sided marketplace that only works once there's supply on both sides. Park as a phase-3 retention feature, not an acquisition play.
- **Government license** - municipal ADU-capacity tool. Long cycle; later.

### Model tension to hold consciously
**SaaS (lean, software) vs marketplace/labor (more revenue, becomes an ops business).** Recommendation: stay software + data as long as possible; let dealers own the feet on the street. Add managed canvassing only where a paying dealer asks for it.

---

## 6. Go-to-market

1. **Design partner first.** Gavin's dad's business is the reference customer. Ship what makes *them* close more placements this winter. Everything else waits on that proof.
2. **Land 3 founding Utah dealers** at the founding rate, 12-month lock, in exchange for testimonials + placement-count case studies. The whole pitch is ROI: "you knocked X, you would have wasted Y doors on unbuildable yards, you closed Z you'd have missed."
3. **Build the credibility layer** (§10) in parallel - it's a cheap, honest sales asset and it unlocks the city and financing channels later.
4. **Then widen** - more regional ADU dealers, and the first adjacent vertical (likely solar - see the competitive research; if solar SaaS is saturated, pick a less-crowded trade like RV-pad/shop/fence).
5. **Seasonality is real** (winter placement). Free pause/restart is a feature, and the sales calendar should target sign-ups ahead of the season.

---

## 7. Competitive landscape

### ADU / manufactured-home niche
No known tool combines parcel-level ADU fit + owner/equity scoring + canvassing CRM. Competitors are point tools: generic canvassing CRMs (SalesRabbit, SPOTIO), parcel/GIS viewers (Regrid), and static canvassing lead lists. The integrated loop is the gap we fill.

### Solar (adjacent, likely more mature)
Solar residential sales is a much larger, older door-knocking industry, so it almost certainly has more developed tooling. **A dedicated competitive study is in progress** (see the `solar-scout` research task) - it will populate this section with named products, pricing norms, and a white-space read. Key question being answered: do solar teams already have a single tool that scores every roof + qualifies the owner + runs the canvass, or do they stitch separate tools together? The answer tells us whether "Yardscout for solar" is white space or crowded, and what feature/pricing expectations a solar entrant would face.

_(This section to be updated when solar-scout returns.)_

---

## 8. Trust and verification strategy

The rules are the risky asset (legal accuracy, constant change). Trust is built through things we control, not a city's stamp:

- **Provenance per rule** - each city rule cites its ordinance section and a "checked-on" date, surfaced in the UI. The honest version of a certificate; machine-checkable for freshness.
- **"Built on official Utah data" badge** - parcels from state GIS (UGRC), owner data from county assessors. Real authority, no endorsement needed.
- **Not-legal-advice + field-verify disclaimer** - protects us, sets expectations, and paradoxically raises trust by being honest. Fit is "this yard can physically take a unit," not "the permit is automatic."
- **One-time land-use attorney review** of the rule set -> "reviewed by [firm]" is a stronger, more attainable credential than a city certificate, and it's *our* asset.
- **City-as-user, not city-as-certifier.** A planning dept will not certify a private app's code interpretation (liability, constant change). It might *use* it for housing-plan/SB284 work - that's implicit endorsement plus a case study. Aim for "used by," not "certified by."

**A formal city certificate is not a realistic goal; the provenance layer + attorney review + a reference city that uses it delivers the same trust and is achievable.**

---

## 9. Technology and data

- **Frontend:** React + Vite SPA; Leaflet map with Esri satellite tiles.
- **Live public data (no per-property cost):** Utah UGRC ArcGIS - parcels (Salt Lake + Utah county LIR layers), building footprints, statewide roads. County assessor service (Salt Lake) for rich owner data; Utah County falls back to parcel LIR fields (no open owner service, so those leads cap at "warm").
- **Rules:** a committed config module (`adu.js`) - 45 jurisdictions, per-city setbacks/size caps/detached-allowed flags, each sourced. Conservative %-of-primary size-cap handling (basement-inclusive assessor sqft is haircut unless a city's code explicitly counts basement).
- **Backend:** Supabase - `customers`, `knocks`, `parcel_flags` tables + auth skeleton. Multi-user CRM is wired; per-seat billing (Stripe) is not.
- **Client state:** browser local storage for settings, map view, and TTL'd fit/owner caches.

### Known technical gaps / debt
- **Billing not built** (Stripe = the gate to charging per seat).
- **Deploy is broken** (GitHub Pages jams on the large data payload) - needs migration to Cloudflare Pages/Netlify + a real domain.
- **Multi-tenant hardening** - org isolation, roles, RLS need a real pass before paying customers share the backend.
- **Rule freshness** - no automated re-verification of the 45 cities' rules against their sources yet; today it's manual. This is the moat's maintenance cost.
- **Rules live in code**, not a database - a city can't self-edit; changes require deploy.

---

## 10. Roadmap (phases)

- **Phase 0 (now):** calibrate scoring to Gavin's real trailer sizes + placement economics; make the design partner productive this winter.
- **Phase 1 (backend/productize):** finish multi-tenant auth + org isolation, Stripe per-seat billing, fix hosting/domain, provenance/freshness layer on rules.
- **Phase 1b:** owner-name for Utah County (available in a non-LIR layer), rule-refresh automation, feasibility-report PDF (lead magnet).
- **Phase 2 (widen):** more Utah/regional ADU dealers; first adjacent vertical (informed by solar study); canvasser route optimization; lead-list export product.
- **Phase 3 (platform):** generic fit-rule templates for multiple trades; matchmaking marketplace; homeowner self-serve widget; explore municipal channel.

---

## 11. Team, skills, and partner needs

### Founder (Tate) strengths
- **Sells / talks to business owners** - can land design partners and founding dealers directly. This is the scarcest startup skill and it's covered.
- **Can build (vibe-code)** - ships working product fast, iterates on real feedback.
- **Thinks outside the box** - the "it's a feasibility engine, not an ADU CRM" reframe is exactly this.

### Where a partner is actually needed
The right partner depends on which model wins, but the consistent gaps are:

1. **Production/data engineering (most likely need if staying SaaS).** Vibe-coding is great for prototypes and demos; a multi-tenant SaaS that paying dealers depend on needs reliability, auth/security done right, data-pipeline robustness (GIS layers change, assessor endpoints move), billing that doesn't drop payments, and uptime. A partner who can *harden and own the backend* frees the founder to sell and design. **This is the highest-leverage hire/partner for the SaaS path.**
2. **Field operations (needed only if you go the managed-canvassing / marketplace route).** Recruiting, training, scheduling, and managing canvasser labor is a whole discipline and not a founder strength. If you decide to supply canvassers, you need an ops partner - and that changes the company from software to services. Decide the model *before* taking this partner, because it commits you to the labor business.
3. **Not partner-level, get as advisors instead:** land-use/permitting expertise (for rule accuracy + the attorney-review credential), and finance/bizops. These are advisory, not equity co-founder needs, at this stage.

### Recommendation
If you stay software-first (recommended), the partner you most need is a **technical co-founder / senior engineer to own production**, not a field-ops person. Bring an ops partner only if and when you deliberately choose the managed-canvassing model. Keep permitting and finance as advisors. Guard equity: your sales + product-vision role is the hard-to-replace one; a hardening engineer is high-value but more replaceable than a true co-founder, so structure accordingly.

---

## 12. Risks

- **Legal/regulatory reliance.** The rules could be wrong or stale; a bad fit result sends a rep to a dead door or, worse, implies a permit will issue. Mitigation: conservative-by-default rules, provenance + freshness layer, disclaimers, attorney review, field-verify framing.
- **Regulatory churn (SB284).** Statewide ADU rules change Oct 2026; several city bans flip. This is both a risk (rework) and an opportunity (a reason dealers need a tool that stays current - and a wedge into cities scrambling to comply).
- **Single design partner.** Everything is tuned to one business until a second real customer exists. Get a second paying dealer early to avoid overfitting.
- **Seasonality + cash flow.** Winter-concentrated demand; free pause hurts MRR smoothness. Plan the sales calendar around the season.
- **Data-source dependence.** Free public GIS/assessor endpoints can move, throttle, or close (Utah County already lacks an open owner service). Mitigation: cache, county-aware fallbacks, monitor.
- **Deploy/hosting fragility.** Currently can't reliably ship; must be fixed before paying customers.
- **Founder bandwidth / bus factor.** Solo build + solo sales is a ceiling; ties directly to the partner question in §11.

---

## 13. Illustrative unit economics _(assumptions, not researched)_

- Value of one incremental placement to a dealer: **$5,000-$20,000** revenue.
- Seat price: **$89/mo** ($1,068/yr; ~$888/yr annual).
- Breakeven for the dealer: **well under one extra placement per year** makes the tool pay for itself, which is the entire ROI story.
- Our cost to serve is low (free data inputs, cheap hosting, Supabase) - marginal cost per seat is near-zero, so gross margin is high; the real cost is rule-maintenance labor and support.
- These are illustrative and must be validated against Gavin's real placement rate and margin before any external pitch.

---

## 14. Open questions to resolve

- Gavin's real trailer size(s), placements/winter, preferred yard size (blocks scoring calibration).
- Which adjacent vertical is the best second market (pending solar competitive study).
- SaaS-only vs managed-canvassing - decide before taking an ops partner.
- Hosting/domain migration (Cloudflare Pages/Netlify + a domain Tate doesn't yet own).
- Whether to pursue the attorney-review credential now or after first revenue.
