"""Phase 0 step 3: score each Kearns parcel into drive / crane / red tiers.

Per ADR-0003, units are BACKED IN when there's drive access, or CRANED IN when not.
So Access does not gate viability -- room does. Tiers:
  red          -> no backyard spot big enough to set the unit down
  green-drive  -> room AND a side corridor wide enough to back it in (cheapest)
  green-crane  -> room but no drive access (still viable, costs more, needs overhead check)

All from free geometry. A v1 proxy to CALIBRATE, not a guarantee (fences, slope, gates,
overhead power lines are not in the data; the field confirms them).
"""
import json
from pyproj import Transformer
from shapely.geometry import shape, LineString
from shapely.ops import transform as shp_transform, unary_union
from shapely import STRtree, make_valid

# ---- UNIT CONFIG (one-line tunable; calibrate when Gavin sends real sizes) ----
FT = 0.3048
UNIT_W_FT      = 14.0     # unit width
UNIT_L_FT      = 66.0     # unit length  -> footprint to set down
ACCESS_W_FT    = 15.0     # clear corridor width needed to back it in
ROOM_MARGIN    = 1.3      # placeable area must be >= this * footprint
# -------------------------------------------------------------------------------
UNIT_W, UNIT_L, ACCESS_W = UNIT_W_FT*FT, UNIT_L_FT*FT, ACCESS_W_FT*FT
UNIT_AREA = UNIT_W * UNIT_L
M2_TO_SQFT = 10.7639
to_m = Transformer.from_crs("EPSG:4326", "EPSG:26912", always_xy=True).transform

def clean(g):
    g = make_valid(g)
    return g if g.is_valid else g.buffer(0)

def opened(region, width):
    """Morphological opening: keep only parts of `region` at least `width` wide."""
    return region.buffer(-width/2, join_style="mitre").buffer(width/2, join_style="mitre")

def pieces(geom):
    return [p for p in getattr(geom, "geoms", [geom]) if not p.is_empty]

def rect_dims(poly):
    """Long and short side of a polygon's minimum rotated rectangle."""
    c = list(poly.minimum_rotated_rectangle.exterior.coords)
    a, b = LineString([c[0], c[1]]).length, LineString([c[1], c[2]]).length
    return max(a, b), min(a, b)

def short_edges(poly):
    """The two short (front/back) edges of the parcel's bounding rectangle."""
    c = list(poly.minimum_rotated_rectangle.exterior.coords)
    edges = [LineString([c[k], c[k+1]]) for k in range(4)]
    order = sorted(range(4), key=lambda k: edges[k].length)
    return edges[order[0]], edges[order[1]]

print("loading...")
parcels = json.load(open("data/parcels_kearns.geojson"))["features"]
bgeoms = []
for f in json.load(open("data/buildings_kearns.geojson"))["features"]:
    try: bgeoms.append(clean(shp_transform(to_m, shape(f["geometry"]))))
    except Exception: pass
btree = STRtree(bgeoms)
print(f"{len(parcels)} parcels, {len(bgeoms)} footprints")

counts = {"green-drive":0, "green-crane":0, "red":0}
out = []
for i, f in enumerate(parcels):
    if not f.get("geometry"): continue
    try: pm = clean(shp_transform(to_m, shape(f["geometry"])))
    except Exception: continue

    here = [bgeoms[j] for j in btree.query(pm) if bgeoms[j].intersects(pm)]
    bld = unary_union([b.intersection(pm) for b in here]) if here else None
    open_region = pm.difference(bld) if bld else pm
    open_sqft = open_region.area * M2_TO_SQFT

    # room: does an actual UNIT_W x UNIT_L rectangle fit in an open spot?
    place_pieces = pieces(opened(open_region, UNIT_W))
    placeable = max((p.area for p in place_pieces), default=0.0)
    def fits(p):
        lng, sht = rect_dims(p)
        return lng >= UNIT_L and sht >= UNIT_W and p.area >= UNIT_AREA * ROOM_MARGIN
    room_ok = any(fits(p) for p in place_pieces)

    # drive: a corridor as wide as ACCESS_W that spans street edge -> back edge (gets past the house)
    fe, be = short_edges(pm)
    drive_ok = any(p.distance(fe) < 0.8 and p.distance(be) < 0.8
                   for p in pieces(opened(open_region, ACCESS_W)))

    if not room_ok:        tier, method = "red", None
    elif drive_ok:         tier, method = "green-drive", "backed-in"
    else:                  tier, method = "green-crane", "craned-in"
    counts[tier] += 1

    a = f["properties"]
    out.append({"type":"Feature","geometry":f["geometry"],"properties":{
        "addr": a.get("PARCEL_ADD"), "primary_res": a.get("PRIMARY_RES"),
        "acres": a.get("PARCEL_ACRES"), "bldg_sqft": a.get("BLDG_SQFT"),
        "open_sqft": round(open_sqft), "place_sqft": round(placeable*M2_TO_SQFT),
        "tier": tier, "method": method,
    }})
    if (i+1) % 2500 == 0: print(f"  {i+1} ... {counts}")

json.dump({"type":"FeatureCollection","features":out}, open("data/scored_kearns.geojson","w"))
print(f"done. {counts}")
print(f"unit {UNIT_W_FT}x{UNIT_L_FT}ft, access {ACCESS_W_FT}ft, room margin {ROOM_MARGIN}x")
