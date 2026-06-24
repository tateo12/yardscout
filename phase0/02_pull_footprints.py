"""Phase 0 step 2: pull building footprints for the Kearns bbox from OSM Overpass."""
import json, requests

bbox = json.load(open("data/bbox.json"))
s, w, n, e = bbox["s"], bbox["w"], bbox["n"], bbox["e"]
OUT = "data/buildings_kearns.geojson"

q = f"""
[out:json][timeout:180];
( way["building"]({s},{w},{n},{e});
  relation["building"]({s},{w},{n},{e}); );
out geom;
"""
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
HEADERS = {"User-Agent": "yardscout-phase0/0.1 (backyard viability research; contact tate)"}
import time
data = None
for url in ENDPOINTS:
    for attempt in range(3):
        try:
            print(f"querying {url} (attempt {attempt+1}) ...")
            r = requests.post(url, data={"data": q}, headers=HEADERS, timeout=200)
            r.raise_for_status()
            data = r.json()
            break
        except Exception as ex:
            print(f"  failed: {ex}")
            time.sleep(5)
    if data is not None:
        break
if data is None:
    raise SystemExit("all overpass endpoints failed")

feats = []
for el in data.get("elements", []):
    geom = el.get("geometry")
    if not geom:
        continue
    ring = [[p["lon"], p["lat"]] for p in geom]
    if len(ring) < 4:
        continue
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    feats.append({"type": "Feature", "properties": {"id": el.get("id")},
                  "geometry": {"type": "Polygon", "coordinates": [ring]}})

json.dump({"type": "FeatureCollection", "features": feats}, open(OUT, "w"))
print(f"wrote {len(feats)} building footprints -> {OUT}")
