"""Phase 0 step 4: render scored parcels over satellite as a standalone HTML map."""
import json

fc = json.load(open("data/scored_kearns.geojson"))

# round coords to ~0.1m to shrink the inlined payload
def rnd(c):
    if isinstance(c[0], (int, float)):
        return [round(c[0], 6), round(c[1], 6)]
    return [rnd(x) for x in c]
for f in fc["features"]:
    f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"])

counts = {"green-drive": 0, "green-crane": 0, "red": 0}
for f in fc["features"]:
    counts[f["properties"]["tier"]] += 1

COLORS = {"green-drive": "#21a567", "green-crane": "#f5a524", "red": "#d64545"}
data_js = json.dumps(fc, separators=(",", ":"))

html = f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Yardscout - Kearns (Phase 0)</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html,body,#map{{height:100%;margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif}}
  .panel{{position:absolute;top:10px;right:10px;z-index:1000;background:#fff;padding:12px 14px;
    border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.3);font-size:13px;line-height:1.5;max-width:230px}}
  .panel h3{{margin:0 0 6px;font-size:14px}}
  .sw{{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}}
  .row{{cursor:pointer;user-select:none}} .muted{{color:#666;font-size:11px;margin-top:8px}}
  .leaflet-popup-content{{font-size:13px;line-height:1.5}}
</style></head><body>
<div id="map"></div>
<div class="panel">
  <h3>Kearns &mdash; can a trailer go back there?</h3>
  <div>Unit: single-wide ~14&times;66 ft</div>
  <label class="row"><input type="checkbox" id="t0" checked>
    <span class="sw" style="background:{COLORS['green-drive']}"></span>Back it in &middot; {counts['green-drive']:,}</label><br>
  <label class="row"><input type="checkbox" id="t1" checked>
    <span class="sw" style="background:{COLORS['green-crane']}"></span>Crane it in &middot; {counts['green-crane']:,}</label><br>
  <label class="row"><input type="checkbox" id="t2" checked>
    <span class="sw" style="background:{COLORS['red']}"></span>No fit &middot; {counts['red']:,}</label>
  <div class="muted">Score is a starting point, not a promise. Fences, slope, gates and overhead
   power lines aren't in the data &mdash; the field confirms.</div>
</div>
<script>
const DATA = {data_js};
const COLORS = {json.dumps(COLORS)};
const map = L.map('map', {{preferCanvas:true}}).setView([40.6565,-112.0140], 15);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{{z}}/{{y}}/{{x}}',
  {{maxZoom:20, attribution:'Imagery &copy; Esri'}}).addTo(map);

const layers = {{'green-drive':L.layerGroup(),'green-crane':L.layerGroup(),'red':L.layerGroup()}};
L.geoJSON(DATA, {{
  style: f => ({{color:'#ffffff', weight:0.5, fillColor:COLORS[f.properties.tier], fillOpacity:0.55}}),
  onEachFeature: (f,l) => {{
    const p=f.properties;
    l.bindPopup(`<b>${{p.addr||'(no address)'}}</b><br>`+
      `Verdict: <b>${{p.tier==='red'?'No fit':(p.method==='backed-in'?'Back it in':'Crane it in')}}</b><br>`+
      `Lot: ${{p.acres}} ac &middot; house ${{p.bldg_sqft||'?'}} sqft<br>`+
      `Open yard: ${{(p.open_sqft||0).toLocaleString()}} sqft &middot; biggest spot ${{(p.place_sqft||0).toLocaleString()}} sqft`);
    layers[p.properties?p.properties.tier:p.tier].addLayer(l);
  }}
}});
Object.values(layers).forEach(g=>g.addTo(map));
const bind=(id,key)=>document.getElementById(id).onchange=e=>
  e.target.checked?layers[key].addTo(map):map.removeLayer(layers[key]);
bind('t0','green-drive'); bind('t1','green-crane'); bind('t2','red');
</script></body></html>"""

open("map.html", "w").write(html)
print(f"wrote map.html ({len(html)//1024} KB)  counts={counts}")
