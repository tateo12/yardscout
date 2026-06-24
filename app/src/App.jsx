import { useEffect, useRef, useState, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

const TIER = {
  "green-drive": { color: "#21a567", label: "Back it in" },
  "green-crane": { color: "#f5a524", label: "Crane it in" },
  "red":         { color: "#d64545", label: "No fit" },
};
const OUTCOMES = [
  { key: "booked",         label: "Booked",         color: "#2563eb" },
  { key: "interested",     label: "Interested",     color: "#06b6d4" },
  { key: "not_home",       label: "Not home",       color: "#a07b1d" },
  { key: "not_interested", label: "Not interested", color: "#9aa1ab" },
  { key: "blocked",        label: "Can't place",    color: "#4b5563" },
];
const OUT = Object.fromEntries(OUTCOMES.map((o) => [o.key, o]));
const LS_KEY = "yardscout.knocks.v1";

const styleFor = (feat, knocks) => {
  const k = knocks[feat.properties._id];
  if (k) return { color: "#fff", weight: k.outcome === "booked" ? 2 : 0.6,
                  fillColor: OUT[k.outcome].color, fillOpacity: 0.85 };
  return { color: "#fff", weight: 0.5, fillColor: TIER[feat.properties.tier].color, fillOpacity: 0.55 };
};

export default function App() {
  const mapRef = useRef(null);
  const idToLayer = useRef({});
  const knocksRef = useRef({});
  const meMarker = useRef(null);

  const [features, setFeatures] = useState([]);
  const [knocks, setKnocks] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
  });
  const [mode, setMode] = useState("field");
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("");

  useEffect(() => { knocksRef.current = knocks; localStorage.setItem(LS_KEY, JSON.stringify(knocks)); }, [knocks]);

  // init map + load data once
  useEffect(() => {
    const map = L.map("map", { preferCanvas: true, zoomControl: true }).setView([40.6565, -112.014], 15);
    mapRef.current = map;
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 20, attribution: "Imagery &copy; Esri" }
    ).addTo(map);

    fetch(`${import.meta.env.BASE_URL}scored_kearns.geojson`).then((r) => r.json()).then((fc) => {
      fc.features.forEach((f, i) => (f.properties._id = i));
      L.geoJSON(fc, {
        style: (f) => styleFor(f, knocksRef.current),
        onEachFeature: (f, lyr) => {
          idToLayer.current[f.properties._id] = lyr;
          lyr.on("click", () => setSelected(f.properties._id));
        },
      }).addTo(map);
      setFeatures(fc.features.map((f) => f.properties));
    });

    return () => { map.remove(); mapRef.current = null; idToLayer.current = {}; };
  }, []);

  const selectParcel = (id) => {
    setSelected(id);
    const lyr = idToLayer.current[id];
    if (lyr && mapRef.current) mapRef.current.flyTo(lyr.getBounds().getCenter(), 19, { duration: 0.6 });
  };

  const record = (id, outcome) => {
    setKnocks((prev) => {
      const next = { ...prev };
      if (prev[id]?.outcome === outcome) delete next[id];
      else next[id] = { outcome, ts: Date.now() };
      knocksRef.current = next;
      const lyr = idToLayer.current[id];
      if (lyr) lyr.setStyle(styleFor(lyr.feature, next));
      return next;
    });
  };

  const locateMe = () => {
    const map = mapRef.current; if (!map) return;
    map.locate({ setView: true, maxZoom: 18 });
    map.once("locationfound", (e) => {
      if (meMarker.current) meMarker.current.remove();
      meMarker.current = L.circleMarker(e.latlng, { radius: 8, color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 }).addTo(map);
    });
  };

  // prospect list (field): non-red, unknocked first, drive before crane
  const prospects = useMemo(() => {
    const rank = { "green-drive": 0, "green-crane": 1 };
    const q = filter.trim().toLowerCase();
    return features
      .filter((p) => p.tier !== "red")
      .filter((p) => !q || (p.addr || "").toLowerCase().includes(q))
      .sort((a, b) => {
        const ak = knocks[a._id] ? 1 : 0, bk = knocks[b._id] ? 1 : 0;
        if (ak !== bk) return ak - bk;
        if (rank[a.tier] !== rank[b.tier]) return rank[a.tier] - rank[b.tier];
        return (a.addr || "").localeCompare(b.addr || "");
      });
  }, [features, knocks, filter]);

  const stats = useMemo(() => {
    const total = features.filter((p) => p.tier !== "red").length;
    const tally = Object.fromEntries(OUTCOMES.map((o) => [o.key, 0]));
    Object.values(knocks).forEach((k) => (tally[k.outcome] = (tally[k.outcome] || 0) + 1));
    const tiers = { "green-drive": 0, "green-crane": 0, "red": 0 };
    features.forEach((p) => (tiers[p.tier] += 1));
    return { total, knocked: Object.keys(knocks).length, tally, tiers };
  }, [features, knocks]);

  const sel = selected != null ? features.find((p) => p._id === selected) : null;
  const recent = useMemo(
    () => Object.entries(knocks).map(([id, k]) => ({ id: +id, ...k }))
      .sort((a, b) => b.ts - a.ts).slice(0, 40),
    [knocks]
  );

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">▦</span>
          <div><b>Yardscout</b><small>Kearns &middot; proof of concept</small></div>
        </div>
        <div className="seg">
          <button className={mode === "field" ? "on" : ""} onClick={() => setMode("field")}>Field</button>
          <button className={mode === "office" ? "on" : ""} onClick={() => setMode("office")}>Office</button>
        </div>
        <div className="cov">{stats.knocked}/{stats.total} knocked</div>
      </header>

      <div className="body">
        <aside className="side">
          {mode === "field" ? (
            <>
              <div className="sidehd">
                <input placeholder="Filter by street..." value={filter} onChange={(e) => setFilter(e.target.value)} />
                <button className="ghost" onClick={locateMe}>Locate me</button>
              </div>
              <div className="hint">{prospects.length.toLocaleString()} prospects &middot; unknocked first</div>
              <div className="list">
                {prospects.slice(0, 250).map((p) => {
                  const k = knocks[p._id];
                  return (
                    <div key={p._id} className={"row" + (selected === p._id ? " active" : "")} onClick={() => selectParcel(p._id)}>
                      <span className="dot" style={{ background: k ? OUT[k.outcome].color : TIER[p.tier].color }} />
                      <div className="rowmain">
                        <div className="addr">{p.addr || "(no address)"}</div>
                        <div className="meta">{TIER[p.tier].label} &middot; {p.place_sqft?.toLocaleString()} sqft spot</div>
                      </div>
                      {k && <span className="badge" style={{ background: OUT[k.outcome].color }}>{OUT[k.outcome].label}</span>}
                    </div>
                  );
                })}
                {prospects.length > 250 && <div className="hint">+{(prospects.length - 250).toLocaleString()} more, filter to narrow</div>}
              </div>
            </>
          ) : (
            <div className="office">
              <div className="cards">
                <div className="card"><b>{stats.tiers["green-drive"].toLocaleString()}</b><span>Back it in</span></div>
                <div className="card"><b>{stats.tiers["green-crane"].toLocaleString()}</b><span>Crane it in</span></div>
                <div className="card"><b>{stats.tiers["red"].toLocaleString()}</b><span>No fit</span></div>
              </div>
              <h4>Knock results</h4>
              {OUTCOMES.map((o) => (
                <div className="statrow" key={o.key}>
                  <span className="dot" style={{ background: o.color }} />{o.label}
                  <b>{stats.tally[o.key] || 0}</b>
                </div>
              ))}
              <h4>Recent knocks</h4>
              <div className="list">
                {recent.length === 0 && <div className="hint">No knocks logged yet.</div>}
                {recent.map((r) => {
                  const p = features.find((x) => x._id === r.id);
                  return (
                    <div key={r.id} className="row" onClick={() => { setMode("field"); selectParcel(r.id); }}>
                      <span className="dot" style={{ background: OUT[r.outcome].color }} />
                      <div className="rowmain"><div className="addr">{p?.addr}</div>
                        <div className="meta">{OUT[r.outcome].label}</div></div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        <main className="mapwrap">
          <div id="map" />
          <div className="legend">
            <span><i style={{ background: TIER["green-drive"].color }} />Back it in</span>
            <span><i style={{ background: TIER["green-crane"].color }} />Crane it in</span>
            <span><i style={{ background: TIER["red"].color }} />No fit</span>
          </div>
          {sel && (
            <div className="detail">
              <button className="x" onClick={() => setSelected(null)}>×</button>
              <div className="verdict" style={{ color: TIER[sel.tier].color }}>{TIER[sel.tier].label}</div>
              <div className="daddr">{sel.addr || "(no address)"}</div>
              <div className="dmeta">
                Lot {sel.acres} ac &middot; house {sel.bldg_sqft?.toLocaleString() || "?"} sqft<br />
                Open yard {sel.open_sqft?.toLocaleString()} sqft &middot; biggest spot {sel.place_sqft?.toLocaleString()} sqft
              </div>
              {sel.tier !== "red" ? (
                <>
                  <div className="dlabel">Log a knock</div>
                  <div className="outcomes">
                    {OUTCOMES.map((o) => (
                      <button key={o.key}
                        className={"obtn" + (knocks[sel._id]?.outcome === o.key ? " sel" : "")}
                        style={knocks[sel._id]?.outcome === o.key ? { background: o.color, borderColor: o.color, color: "#fff" } : {}}
                        onClick={() => record(sel._id, o.key)}>{o.label}</button>
                    ))}
                  </div>
                </>
              ) : <div className="dlabel">Too tight for the unit — skip.</div>}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
