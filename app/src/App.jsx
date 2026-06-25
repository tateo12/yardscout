import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

const PARCELS_URL =
  "https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/Parcels_SaltLake_LIR/FeatureServer/0/query";

// unit + scoring (open-space from parcel attributes; access/crane is the footprint pass)
const SQFT_PER_ACRE = 43560;
const UNIT_FT2 = 14 * 66;            // single-wide footprint
const BACKYARD_FRAC = 0.5;           // assume ~half the open space is usable backyard
const MIN_ZOOM = 14;

const TIER = {
  green:  { color: "#21a567", label: "Room to place" },
  yellow: { color: "#f5a524", label: "Tight" },
  red:    { color: "#d64545", label: "No room" },
};
const OUTCOMES = [
  { key: "booked",         label: "Booked",         color: "#2563eb" },
  { key: "interested",     label: "Interested",     color: "#06b6d4" },
  { key: "not_home",       label: "Not home",       color: "#a07b1d" },
  { key: "not_interested", label: "Not interested", color: "#9aa1ab" },
  { key: "blocked",        label: "Can't place",    color: "#4b5563" },
];
const OUT = Object.fromEntries(OUTCOMES.map((o) => [o.key, o]));
const CUSTOMER_OUTCOMES = ["booked", "interested"];
const LS_KEY = "yardscout.knocks.v2";

function scoreOf(props) {
  const lot = (props.PARCEL_ACRES || 0) * SQFT_PER_ACRE;
  const open = Math.max(0, lot - (props.BLDG_SQFT || 0));
  const yard = open * BACKYARD_FRAC;
  if (yard < UNIT_FT2) return "red";
  if (yard < UNIT_FT2 * 1.6) return "yellow";
  return "green";
}

const styleFor = (feat, knocks) => {
  const k = knocks[feat.properties._key];
  if (k) return { color: "#fff", weight: k.outcome === "booked" ? 2.5 : 1,
                  fillColor: OUT[k.outcome].color, fillOpacity: 0.9 };
  const t = feat.properties._tier;
  return { color: TIER[t].color, weight: 1, fillColor: TIER[t].color, fillOpacity: 0.28 };
};

export default function App() {
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const idToLayer = useRef({});
  const knocksRef = useRef({});
  const reqToken = useRef(0);
  const meMarker = useRef(null);

  const [features, setFeatures] = useState([]);   // parcels currently loaded (viewport)
  const [knocks, setKnocks] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
  });
  const [tab, setTab] = useState("map");           // map | prospects | customers | stats
  const [selected, setSelected] = useState(null);  // parcel _key
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [zoomedOut, setZoomedOut] = useState(false);

  useEffect(() => { knocksRef.current = knocks; localStorage.setItem(LS_KEY, JSON.stringify(knocks)); }, [knocks]);

  const renderParcels = useCallback((rawFeatures) => {
    const map = mapRef.current;
    if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
    idToLayer.current = {};
    rawFeatures.forEach((f) => {
      const p = f.properties;
      p._key = String(p.PARCEL_ID || p.OBJECTID);
      p._tier = scoreOf(p);
    });
    const layer = L.geoJSON({ type: "FeatureCollection", features: rawFeatures }, {
      style: (f) => styleFor(f, knocksRef.current),
      onEachFeature: (f, lyr) => {
        idToLayer.current[f.properties._key] = lyr;
        lyr.on("click", () => setSelected(f.properties._key));
      },
    }).addTo(map);
    layerRef.current = layer;
    setFeatures(rawFeatures.map((f) => f.properties));
  }, []);

  const loadViewport = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getZoom() < MIN_ZOOM) {
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
      setFeatures([]); setZoomedOut(true); setLoading(false);
      return;
    }
    setZoomedOut(false);
    const b = map.getBounds();
    const params = new URLSearchParams({
      where: "PROP_CLASS='Residential'",
      geometry: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(","),
      geometryType: "esriGeometryEnvelope", inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "PARCEL_ID,PARCEL_ADD,PARCEL_CITY,PARCEL_ACRES,BLDG_SQFT,PRIMARY_RES",
      returnGeometry: "true", outSR: "4326", f: "geojson", resultRecordCount: "2000",
    });
    const token = ++reqToken.current;
    setLoading(true);
    fetch(`${PARCELS_URL}?${params}`)
      .then((r) => r.json())
      .then((fc) => {
        if (token !== reqToken.current) return;
        renderParcels(fc.features || []);
        setLoading(false);
      })
      .catch(() => { if (token === reqToken.current) setLoading(false); });
  }, [renderParcels]);

  // init map once
  useEffect(() => {
    const map = L.map("map", { preferCanvas: true, zoomControl: true }).setView([40.6655, -111.9925], 16);
    mapRef.current = map;
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 20, attribution: "Imagery &copy; Esri" }
    ).addTo(map);
    let t;
    const debounced = () => { clearTimeout(t); t = setTimeout(loadViewport, 450); };
    map.on("moveend", debounced);
    loadViewport();
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; layerRef.current = null; idToLayer.current = {}; };
  }, [loadViewport]);

  useEffect(() => { if (tab === "map") setTimeout(() => mapRef.current?.invalidateSize(), 0); }, [tab]);

  const flyTo = (center, zoom = 19) => mapRef.current?.flyTo(center, zoom, { duration: 0.6 });

  const selectParcel = (key, center) => {
    setSelected(key);
    setTab("map");
    const lyr = idToLayer.current[key];
    if (lyr) flyTo(lyr.getBounds().getCenter());
    else if (center) flyTo(center);
  };

  const record = (key, outcome, props, center) => {
    setKnocks((prev) => {
      const next = { ...prev };
      if (prev[key]?.outcome === outcome) {
        // keep customer details if any, just clear the outcome by deleting when no details
        const keep = prev[key];
        if (keep.name || keep.phone || keep.notes) next[key] = { ...keep, outcome: null };
        else delete next[key];
      } else {
        next[key] = { ...(prev[key] || {}), outcome, ts: Date.now(),
                      addr: props?.PARCEL_ADD, city: props?.PARCEL_CITY, center };
      }
      knocksRef.current = next;
      const lyr = idToLayer.current[key];
      if (lyr) lyr.setStyle(styleFor(lyr.feature, next));
      return next;
    });
  };

  const updateCustomer = (key, field, value) => {
    setKnocks((prev) => {
      const next = { ...prev, [key]: { ...(prev[key] || {}), [field]: value } };
      knocksRef.current = next;
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

  const prospects = useMemo(() => {
    const rank = { green: 0, yellow: 1, red: 2 };
    const q = filter.trim().toLowerCase();
    return features
      .filter((p) => p._tier !== "red")
      .filter((p) => !q || (p.PARCEL_ADD || "").toLowerCase().includes(q))
      .sort((a, b) => {
        const ak = knocks[a._key] ? 1 : 0, bk = knocks[b._key] ? 1 : 0;
        if (ak !== bk) return ak - bk;
        if (rank[a._tier] !== rank[b._tier]) return rank[a._tier] - rank[b._tier];
        return (a.PARCEL_ADD || "").localeCompare(b.PARCEL_ADD || "");
      });
  }, [features, knocks, filter]);

  const customers = useMemo(
    () => Object.entries(knocks)
      .filter(([, k]) => CUSTOMER_OUTCOMES.includes(k.outcome))
      .map(([key, k]) => ({ key, ...k }))
      .sort((a, b) => b.ts - a.ts),
    [knocks]
  );

  const stats = useMemo(() => {
    const tiers = { green: 0, yellow: 0, red: 0 };
    features.forEach((p) => (tiers[p._tier] += 1));
    const tally = Object.fromEntries(OUTCOMES.map((o) => [o.key, 0]));
    Object.values(knocks).forEach((k) => k.outcome && (tally[k.outcome] = (tally[k.outcome] || 0) + 1));
    return { tiers, tally, totalKnocks: Object.values(knocks).filter((k) => k.outcome).length };
  }, [features, knocks]);

  const sel = selected != null ? features.find((p) => p._key === selected) : null;
  const selKnock = selected != null ? knocks[selected] : null;

  const TABS = [
    { key: "map", label: "Map", icon: "▦" },
    { key: "prospects", label: "Prospects", icon: "≡" },
    { key: "customers", label: "Customers", icon: "★" },
    { key: "stats", label: "Stats", icon: "▮" },
  ];

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">▦</span>
          <div><b>Yardscout</b><small>Salt Lake Valley</small></div>
        </div>
        {loading && <span className="loadtag"><span className="spin sm" />loading yards…</span>}
        <div className="cov">{customers.length} customers · {stats.totalKnocks} knocks</div>
      </header>

      <div className="content">
        {/* map is always mounted so Leaflet keeps its size */}
        <main className="mapwrap" style={{ display: tab === "map" ? "block" : "none" }}>
          <div id="map" />
          {zoomedOut && <div className="zoommsg">Zoom in to load yards</div>}
          <button className="locate-fab" title="Locate me" onClick={locateMe}>◎</button>
          <div className="legend">
            <span><i style={{ background: TIER.green.color }} />Room to place</span>
            <span><i style={{ background: TIER.yellow.color }} />Tight</span>
            <span><i style={{ background: TIER.red.color }} />No room</span>
          </div>
          {sel && (
            <div className="detail">
              <button className="x" onClick={() => setSelected(null)}>×</button>
              <div className="verdict" style={{ color: TIER[sel._tier].color }}>{TIER[sel._tier].label}</div>
              <div className="daddr">{sel.PARCEL_ADD || "(no address)"}</div>
              <div className="dmeta">
                {sel.PARCEL_CITY} · {sel.PARCEL_ACRES} ac · house {sel.BLDG_SQFT?.toLocaleString() || "?"} sqft
              </div>
              <div className="dlabel">Log a knock</div>
              <div className="outcomes">
                {OUTCOMES.map((o) => (
                  <button key={o.key}
                    className={"obtn" + (selKnock?.outcome === o.key ? " sel" : "")}
                    style={selKnock?.outcome === o.key ? { background: o.color, borderColor: o.color, color: "#fff" } : {}}
                    onClick={() => record(sel._key, o.key, sel, idToLayer.current[sel._key]?.getBounds().getCenter())}>
                    {o.label}
                  </button>
                ))}
              </div>
              {CUSTOMER_OUTCOMES.includes(selKnock?.outcome) && (
                <div className="custfields">
                  <input placeholder="Name" value={selKnock.name || ""} onChange={(e) => updateCustomer(sel._key, "name", e.target.value)} />
                  <input placeholder="Phone" value={selKnock.phone || ""} onChange={(e) => updateCustomer(sel._key, "phone", e.target.value)} />
                  <textarea placeholder="Notes" rows={2} value={selKnock.notes || ""} onChange={(e) => updateCustomer(sel._key, "notes", e.target.value)} />
                </div>
              )}
            </div>
          )}
        </main>

        {tab === "prospects" && (
          <section className="panel">
            <div className="sidehd">
              <input placeholder="Filter by street..." value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <div className="hint">
              {zoomedOut ? "Zoom in on the map to load this area."
                : `${prospects.length.toLocaleString()} in view · unknocked first`}
            </div>
            <div className="list">
              {prospects.slice(0, 300).map((p) => {
                const k = knocks[p._key];
                return (
                  <div key={p._key} className="row" onClick={() => selectParcel(p._key)}>
                    <span className="dot" style={{ background: k ? OUT[k.outcome]?.color : TIER[p._tier].color }} />
                    <div className="rowmain">
                      <div className="addr">{p.PARCEL_ADD || "(no address)"}</div>
                      <div className="meta">{p.PARCEL_CITY} · {TIER[p._tier].label}</div>
                    </div>
                    {k?.outcome && <span className="badge" style={{ background: OUT[k.outcome].color }}>{OUT[k.outcome].label}</span>}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {tab === "customers" && (
          <section className="panel">
            <div className="hint">{customers.length} booked / interested</div>
            <div className="list">
              {customers.length === 0 && <div className="empty">Mark a yard “Interested” or “Booked” and it shows up here with their contact info.</div>}
              {customers.map((c) => (
                <div key={c.key} className="custcard">
                  <div className="custtop">
                    <span className="badge" style={{ background: OUT[c.outcome].color }}>{OUT[c.outcome].label}</span>
                    <button className="link" onClick={() => c.center && flyTo(c.center)}>{c.addr || "(no address)"}</button>
                  </div>
                  <div className="meta2">{c.city}</div>
                  <input placeholder="Name" value={c.name || ""} onChange={(e) => updateCustomer(c.key, "name", e.target.value)} />
                  <input placeholder="Phone" value={c.phone || ""} onChange={(e) => updateCustomer(c.key, "phone", e.target.value)} />
                  <textarea placeholder="Notes" rows={2} value={c.notes || ""} onChange={(e) => updateCustomer(c.key, "notes", e.target.value)} />
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "stats" && (
          <section className="panel padded">
            <h4>In current view</h4>
            <div className="cards">
              <div className="card"><b>{stats.tiers.green.toLocaleString()}</b><span>Room</span></div>
              <div className="card"><b>{stats.tiers.yellow.toLocaleString()}</b><span>Tight</span></div>
              <div className="card"><b>{stats.tiers.red.toLocaleString()}</b><span>No room</span></div>
            </div>
            <h4>Knock results (all)</h4>
            {OUTCOMES.map((o) => (
              <div className="statrow" key={o.key}>
                <span className="dot" style={{ background: o.color }} />{o.label}
                <b>{stats.tally[o.key] || 0}</b>
              </div>
            ))}
            <p className="note">
              Verdicts use lot size and open space from county records. The deeper
              back-it-in vs. crane-it-in access scoring comes from the building-footprint pass.
            </p>
          </section>
        )}
      </div>

      <nav className="bottomnav">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            <span className="navicon">{t.icon}</span>{t.label}
            {t.key === "customers" && customers.length > 0 && <span className="navbadge">{customers.length}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
