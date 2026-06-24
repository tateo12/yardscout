"""Phase 0 step 1: pull Kearns residential parcels (with geometry) from UGRC LIR."""
import json, time, requests

BASE = ("https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/"
        "Parcels_SaltLake_LIR/FeatureServer/0/query")
OUT = "data/parcels_kearns.geojson"
FIELDS = ("OBJECTID,PARCEL_ID,PARCEL_ADD,PARCEL_CITY,PROP_CLASS,PROP_TYPE,"
          "PRIMARY_RES,PARCEL_ACRES,BLDG_SQFT,HOUSE_CNT,BUILT_YR")
WHERE = "PARCEL_CITY='Kearns' AND PROP_CLASS='Residential'"
PAGE = 2000

def fetch(offset):
    params = {
        "where": WHERE, "outFields": FIELDS, "returnGeometry": "true",
        "outSR": "4326", "f": "geojson",
        "resultOffset": offset, "resultRecordCount": PAGE,
    }
    r = requests.get(BASE, params=params, timeout=90)
    r.raise_for_status()
    return r.json()

feats, offset = [], 0
while True:
    fc = fetch(offset)
    batch = fc.get("features", [])
    feats.extend(batch)
    print(f"  offset {offset}: +{len(batch)} (total {len(feats)})")
    if len(batch) < PAGE:
        break
    offset += PAGE
    time.sleep(0.3)

out = {"type": "FeatureCollection", "features": feats}
with open(OUT, "w") as f:
    json.dump(out, f)
print(f"wrote {len(feats)} parcels -> {OUT}")
