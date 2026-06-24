# Responsive web PWA on a Postgres/PostGIS + MapLibre stack

The two users (Office on desktop, Field on an iPhone in the truck) are both served by a single responsive web app installable to the phone home screen, rather than a native mobile app. The Salt Lake Valley has good cell coverage, so online-first is acceptable and offline is deferred. Stack: React frontend; MapLibre GL JS for the map (free, avoids Google Maps billing) with parcel polygons rendered as the property lines; Supabase (Postgres + PostGIS, Auth, hosting) as one backend covering the spatial database, the two-role auth, and the geometry queries.

Considered and rejected for v1: native iOS/Android (double the build and two codebases for a solo developer); Google Maps Platform (per-call billing we don't need when MapLibre + open data covers it).

Consequence: offline knocking in cell dead zones and any native-only capability are out until a later phase. Satellite imagery tiles are the one licensing item to vet before commercial launch (see PLAN.md).
