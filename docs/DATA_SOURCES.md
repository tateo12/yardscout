# Yardscout - Available Parcel/Owner Data (both valleys)

_Verified live 2026-07-04 by probing the actual services. All are free public data. Not legal advice._

Three sources, ranked by richness. We currently use UGRC for geometry (both counties) + SLCo for owner data; **Utah County is on thin UGRC LIR fields and should move to the county service below.**

---

## 1. Salt Lake County — `apps.saltlakecounty.gov/slcogis/rest/services/Land/MapServer`
CORS-open, no key, no special headers. **The richest source we have.** Join on `parcel_id` = UGRC `PARCEL_ID`.

**Layer 1 `Parcels`** (currently used, but we only read a fraction):
- **Owner / occupancy:** `own_name`, `care_of`, `own_addr` + `own_citystate` + `own_zip` + `own_apt_num` (mailing) vs `prop_location` (situs) → owner-occupied vs absentee/investor.
- **Tenure (the key advantage):** `date_created` = vesting date (real per-parcel, verified: values range 1983-2023), `last_vesting` (year), `source_doc`. → "years owned" → drives the hot/warm/cool equity tiers.
- **Value:** `total_full_mkt`, `full_mkt_total_land`, `full_mkt_total_bldg`, `total_assessed`, `taxable_value` (+ adjusted variants). Assessor market value, NOT sale price (Utah is a non-disclosure state).
- **Building:** `year_built`, `total_sq_ft`, **`abv_grnd_sf` (above-grade sqft, separate from total)**, `num_housing_units`, `multi_structure`.
- **Neighborhood sale comps:** `nbhrd_low_sale`, `nbhrd_high_sale`, `nbhrd_av_sale`, `nbrhd_av_home_sf` (neighborhood-level, not per-parcel).
- **Classification:** `property_type`, `lot_use`, `tax_class1/2/3`, `exempt_type`, `neighborhood_code`, `greenbelt_acres`.

**Layer 7 `Zones`** (NOT yet used): actual zoning polygons — `zone_descr`, `regional_code`, `municipality`, plus `ordinance_` (link to the ordinance) and `authority_` (city website). → real per-parcel zoning + a citable ordinance link for the "verify" credibility layer.

**Layer 2 `ParcelsTaxYear`:** tax-year history (not yet explored).

---

## 2. Utah County — `maps.utahcounty.gov/arcgis/rest/services`
CORS-open (server reflects the Origin), **but blocks bare bots — needs a normal browser User-Agent** (the app sends one automatically). Undocumented assessor service, could change. Join on `PARCELID`.

**`Parcels/Parcel_TaxParcels/MapServer/2` ("OwnerParcel with Label")** — the goldmine, ~150 fields:
- **Owner / occupancy:** `OWNER_NAME`, `CARE_NAME`, `OWN_FULL_ADDRESS` + `OWN_CITY/STATE/ZIP5` (mailing) vs `SITE_FULL_ADDRESS` (situs) → owner-occupied vs absentee/investor (rigorous, like SLCo). Currently we only have the crude `PRIMARY_RES` exemption flag.
- **Tenure: NONE.** No sale/deed/ownership date exists. `VESTING_DOC` is a document reference only; `PARCEL_CREATE_DATE` / the `DATES_DAT` history table are a **1994 bulk import** (verified: every parcel says created 1994-09), which the county itself warns is a system-entry date, not a recording date. Real sale dates live only in the Recorder's scanned documents — not queryable. **So Utah leads can't reach "hot" via tenure.**
- **Value:** `MKT_CUR_VALUE`, `MKT_PRV_VAL`, `MKT_LAND_VALUE`, `MKT_IMP_VALUE`, `TXBL_CUR_VALUE`, `TOT_CUR_TAXES`, plus year-over-year deltas (`MKT_VAL_YR_CHG`, `MKT_PCT_CHG`).
- **Building (richer than SLCo):** `YEARBLT_RES`, `GLA_RES`, **`TOTAL_ABOVE_GRADE_AREA`, `TOTAL_BASEMENT`, `TOTAL_BSMT_FINISH`** (basement split out), `BASEMENT_RES`, `GLA_BEDROOMS_RES` (beds), `BATHROOMS_RES` (baths), `ATT_GARAGE_SQFT_RES`, `QUALITY_DESCR_RES`, `CONDITION_DESCR_RES`, `EXTERIOR_RES`, `STYLE_DESCR_RES`.
- **Classification:** `PROP_TYPE_DESCR`, `USE_CODE_DESCR_1`, `TAX_CITY`, `NEIGHBORHOOD`, `EXEMPT_RES`, `GREENBELT`, `SUB_NAME`, `ACREAGE`.

**Other Utah County layers (checked, lower value):** `ParcelDeedPoints` (`DOC_OWNER`, `BOOKPAGE`, deed refs — no date), `Parcel_Name_Address`, address points, `Parcel_Historical_Date` (the 1994 bulk-import dates), `CommercialAppraiser` (commercial sales only).

---

## 3. UGRC statewide — `services1.arcgis.com/99lidPhWCzftIe9K` (geometry base, both counties)
CORS `*`. What we use for the map today: `Parcels_SaltLake_LIR` + `Parcels_Utah_LIR` (geometry + `PARCEL_ID`, city, county, acres, `BLDG_SQFT` [finished incl. basement], `PRIMARY_RES`, `TOTAL_MKT_VALUE`, `BUILT_YR`, `FLOORS_CNT`), `Buildings` (footprints), `UtahRoads`. Keep for geometry; enrich attributes from the county services above.

---

## What each county can and can't do

| Signal | Salt Lake Co | Utah Co |
|---|---|---|
| Owner name | ✅ | ✅ (new) |
| Owner-occupied vs investor (mailing≠situs) | ✅ | ✅ (new; today only crude exemption flag) |
| **Tenure / years owned** | ✅ vesting date | ❌ **none exists** |
| Market value | ✅ | ✅ (+ YoY change %) |
| Above-grade vs basement sqft | ✅ `abv_grnd_sf` | ✅ split out (better) |
| Beds / baths / condition | ❌ | ✅ |
| Per-parcel sale price | ❌ (non-disclosure state) | ❌ |
| Neighborhood sale comps | ✅ | ~ (value change %) |
| Actual zoning polygon + ordinance link | ✅ (Zones layer) | not found yet |

## Highest-value upgrades this unlocks
1. **Utah County → the county OwnerParcel service:** owner names, real occupancy (absentee flag), value → the all-orange Provo map finally differentiates. (No tenure, so no "hot" there, but a real filter.)
2. **Fix the ADU basement cap for real (both counties):** use `abv_grnd_sf` (SLCo) / `TOTAL_ABOVE_GRADE_AREA` (Utah) as the % denominator instead of the blunt 0.5 haircut.
3. **SLCo zoning layer:** real per-parcel zone + a citable ordinance link (feeds both the fit engine and the "verify" trust layer).
4. **Beds/baths/condition (Utah):** richer lead detail on the card.
