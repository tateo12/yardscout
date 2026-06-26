import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

const PARCELS_URL =
  "https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/Parcels_SaltLake_LIR/FeatureServer/0/query";

// unit + scoring (open-space from parcel attributes; access/crane is the footprint pass)
const SQFT_PER_ACRE = 43560;
const UNIT_FT2 = 14 * 66;
const BACKYARD_FRAC = 0.5;
const MIN_ZOOM = 15;       // below this a viewport holds more parcels than the page budget can fully cover
const PAGE = 2000;         // ArcGIS per-request cap; we paginate to cover the whole viewport
const MAX_PAGES = 4;       // up to 8000 parcels per view before we ask the user to zoom in

const TIER = {
  green:  { color: "#1fa36b", label: "Room to place" },
  yellow: { color: "#f5a524", label: "Tight" },
  red:    { color: "#dd5145", label: "No room" },
};
const OUTCOMES = [
  { key: "booked",         label: "Booked",         color: "#2563eb" },
  { key: "interested",     label: "Interested",     color: "#0ca5b8" },
  { key: "not_home",       label: "Not home",       color: "#a07b1d" },
  { key: "not_interested", label: "Not interested", color: "#9aa1ab" },
  { key: "blocked",        label: "Can't place",    color: "#4b5563" },
];
const OUT = Object.fromEntries(OUTCOMES.map((o) => [o.key, o]));
const CUSTOMER_OUTCOMES = ["booked", "interested"];
const CUST_STATUS = [
  { key: "lead",       label: "Lead",       color: "#7c3aed" },
  { key: "interested", label: "Interested", color: "#0ca5b8" },
  { key: "booked",     label: "Booked",     color: "#2563eb" },
];
const CUSTOMER_KEYS = CUST_STATUS.map((s) => s.key);
const STAT = { ...OUT, lead: { label: "Lead", color: "#7c3aed" } };
const METHODS = [
  { key: "", label: "Placement: TBD" },
  { key: "backin", label: "Back it in" },
  { key: "crane", label: "Crane it in" },
];
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
  if (k && k.outcome && STAT[k.outcome])
    return { color: "#fff", weight: k.outcome === "booked" ? 2.5 : 1.2, fillColor: STAT[k.outcome].color, fillOpacity: 0.92 };
  const t = feat.properties._tier;
  return { color: TIER[t].color, weight: 1, fillColor: TIER[t].color, fillOpacity: 0.3 };
};

const Icon = ({ name }) => {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  if (name === "map")
    return <svg viewBox="0 0 24 24" width="22" height="22" {...p}><path d="M9 4 3.5 6.2v13.3L9 17.3l6 2.2 5.5-2.2V3.8L15 6 9 4Z" /><path d="M9 4v13.3M15 6v13.5" /></svg>;
  if (name === "customers")
    return <svg viewBox="0 0 24 24" width="22" height="22" {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3.4 19c0-3.1 2.5-5.3 5.6-5.3s5.6 2.2 5.6 5.3" /><path d="M16.2 5.6a3 3 0 0 1 0 5.7M17 13.9c2.2.5 3.8 2.3 3.8 4.8" /></svg>;
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 20V11M12 20V5M19 20v-6" /></svg>;
};

const Logo = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
    <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" stroke="#5b6470" strokeWidth="1.6" />
    <rect x="12" y="12.5" width="6.5" height="4.5" rx="1" fill="#1fa36b" />
  </svg>
);

export default function App() {
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const idToLayer = useRef({});
  const knocksRef = useRef({});
  const reqToken = useRef(0);
  const meMarker = useRef(null);

  const [features, setFeatures] = useState([]);
  const [knocks, setKnocks] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
  });
  const [tab, setTab] = useState("map");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [zoomedOut, setZoomedOut] = useState(false);
  const [capped, setCapped] = useState(false);

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
    const base = {
      where: "PROP_CLASS='Residential'",
      geometry: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(","),
      geometryType: "esriGeometryEnvelope", inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "PARCEL_ID,PARCEL_ADD,PARCEL_CITY,PARCEL_ACRES,BLDG_SQFT,PRIMARY_RES",
      returnGeometry: "true", outSR: "4326", f: "geojson", resultRecordCount: String(PAGE),
    };
    const token = ++reqToken.current;
    setLoading(true);
    (async () => {
      let offset = 0, all = [], more = true, pages = 0;
      while (more && pages < MAX_PAGES) {
        const params = new URLSearchParams({ ...base, resultOffset: String(offset) });
        let fc;
        try { fc = await fetch(`${PARCELS_URL}?${params}`).then((r) => r.json()); }
        catch { if (token === reqToken.current) setLoading(false); return; }
        if (token !== reqToken.current) return; // a newer move superseded this load
        const batch = fc.features || [];
        all = all.concat(batch);
        more = batch.length >= PAGE;   // a full page back means there are probably more (geojson omits exceededTransferLimit)
        offset += PAGE; pages++;
      }
      renderParcels(all);
      setCapped(more);   // still more beyond our page budget -> suggest zooming in
      setLoading(false);
    })();
  }, [renderParcels]);

  useEffect(() => {
    const map = L.map("map", { preferCanvas: true, zoomControl: true, attributionControl: false }).setView([40.6655, -111.9925], 16);
    mapRef.current = map;
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20 }).addTo(map);
    let t;
    const debounced = () => { clearTimeout(t); t = setTimeout(loadViewport, 400); };
    map.on("moveend", debounced);
    loadViewport();
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; layerRef.current = null; idToLayer.current = {}; };
  }, [loadViewport]);

  useEffect(() => { if (tab === "map") setTimeout(() => mapRef.current?.invalidateSize(), 0); }, [tab]);

  const flyTo = (center, zoom = 18) => mapRef.current?.flyTo(center, zoom, { duration: 0.6 });

  const record = (key, outcome, props, center) => {
    setKnocks((prev) => {
      const next = { ...prev };
      if (prev[key]?.outcome === outcome) {
        const keep = prev[key];
        if (keep.name || keep.phone || keep.notes) next[key] = { ...keep, outcome: null };
        else delete next[key];
      } else {
        next[key] = { ...(prev[key] || {}), outcome, ts: Date.now(), addr: props?.PARCEL_ADD, city: props?.PARCEL_CITY, center };
      }
      knocksRef.current = next;
      const lyr = idToLayer.current[key];
      if (lyr) lyr.setStyle(styleFor(lyr.feature, next));
      return next;
    });
  };

  const updateCustomer = (key, field, value) =>
    setKnocks((prev) => { const next = { ...prev, [key]: { ...(prev[key] || {}), [field]: value } }; knocksRef.current = next; return next; });

  const setStatus = (key, value) =>
    setKnocks((prev) => {
      const next = { ...prev, [key]: { ...(prev[key] || {}), outcome: value } };
      knocksRef.current = next;
      const lyr = idToLayer.current[key]; if (lyr) lyr.setStyle(styleFor(lyr.feature, next));
      return next;
    });

  const addCustomer = () => {
    const key = "cust_" + crypto.randomUUID();
    setKnocks((prev) => { const next = { ...prev, [key]: { outcome: "lead", ts: Date.now() } }; knocksRef.current = next; return next; });
    setTab("customers");
  };

  const removeCustomer = (key) =>
    setKnocks((prev) => { const next = { ...prev }; delete next[key]; knocksRef.current = next;
      const lyr = idToLayer.current[key]; if (lyr) lyr.setStyle(styleFor(lyr.feature, next)); return next; });

  const locateMe = () => {
    const map = mapRef.current; if (!map) return;
    map.locate({ setView: true, maxZoom: 18 });
    map.once("locationfound", (e) => {
      if (meMarker.current) meMarker.current.remove();
      meMarker.current = L.circleMarker(e.latlng, { radius: 8, color: "#fff", weight: 2, fillColor: "#1fa36b", fillOpacity: 1 }).addTo(map);
    });
  };

  const customers = useMemo(
    () => Object.entries(knocks).filter(([, k]) => CUSTOMER_KEYS.includes(k.outcome)).map(([key, k]) => ({ key, ...k })).sort((a, b) => b.ts - a.ts),
    [knocks]
  );

  const stats = useMemo(() => {
    const tiers = { green: 0, yellow: 0, red: 0 };
    features.forEach((p) => (tiers[p._tier] += 1));
    const tally = Object.fromEntries(OUTCOMES.map((o) => [o.key, 0]));
    Object.values(knocks).forEach((k) => k.outcome && OUT[k.outcome] && (tally[k.outcome] += 1));
    return { tiers, tally, totalKnocks: Object.values(knocks).filter((k) => k.outcome && OUT[k.outcome]).length };
  }, [features, knocks]);

  const sel = selected != null ? features.find((p) => p._key === selected) : null;
  const selKnock = selected != null ? knocks[selected] : null;

  const TABS = [
    { key: "map", label: "Map" },
    { key: "customers", label: "Customers" },
    { key: "stats", label: "Stats" },
  ];

  return (
    <div className="app">
      <header className="top">
        <Logo />
        <div className="title"><b>Yardscout</b><small>Salt Lake Valley</small></div>
        {loading && <span className="loadtag"><span className="spin sm" />loading</span>}
        <div className="cov">
          <span className="num">{customers.length}</span><span className="lab">cust</span>
          <span className="num">{stats.totalKnocks}</span><span className="lab">knock</span>
        </div>
      </header>

      <div className="content">
        <main className="mapwrap" style={{ display: tab === "map" ? "block" : "none" }}>
          <div id="map" />
          {zoomedOut && <div className="zoommsg">Zoom in to load yards</div>}
          {!zoomedOut && capped && <div className="zoommsg">Zoom in to load every yard here</div>}
          <button className="locate-fab" title="Locate me" onClick={locateMe} aria-label="Locate me">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3.4" /><path d="M12 2v3.2M12 18.8V22M2 12h3.2M18.8 12H22" /></svg>
          </button>
          <div className="legend">
            <span><i style={{ background: TIER.green.color }} />Room</span>
            <span><i style={{ background: TIER.yellow.color }} />Tight</span>
            <span><i style={{ background: TIER.red.color }} />No room</span>
          </div>
          {sel && (
            <div className="detail">
              <button className="x" onClick={() => setSelected(null)} aria-label="Close">×</button>
              <div className="vchip" style={{ background: TIER[sel._tier].color }}>{TIER[sel._tier].label}</div>
              <div className="daddr">{sel.PARCEL_ADD || "(no address)"}</div>
              <div className="dcity">{sel.PARCEL_CITY}</div>
              <div className="readout">
                <div><b>{sel.PARCEL_ACRES}</b><span>acres</span></div>
                <div><b>{(sel.BLDG_SQFT || 0).toLocaleString()}</b><span>house sqft</span></div>
                <div><b>{Math.round((sel.PARCEL_ACRES || 0) * SQFT_PER_ACRE - (sel.BLDG_SQFT || 0)).toLocaleString()}</b><span>open sqft</span></div>
              </div>
              <div className="dlabel">Log a knock</div>
              <div className="outcomes">
                {OUTCOMES.map((o) => (
                  <button key={o.key} className={"obtn" + (selKnock?.outcome === o.key ? " sel" : "")}
                    style={selKnock?.outcome === o.key ? { background: o.color, borderColor: o.color, color: "#fff" } : {}}
                    onClick={() => record(sel._key, o.key, sel, idToLayer.current[sel._key]?.getBounds().getCenter())}>{o.label}</button>
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

        {tab === "customers" && (
          <section className="panel">
            <div className="custhd">
              <span className="phd">Customers</span>
              <button className="addbtn" onClick={addCustomer}>+ Add</button>
            </div>
            <div className="list">
              {customers.length === 0 && <div className="empty">No customers yet. Tap <b>+ Add</b>, or mark a yard Interested or Booked on the map.</div>}
              {customers.map((c) => (
                <div key={c.key} className="custcard">
                  <div className="custtop">
                    <select className="statsel" value={c.outcome || "lead"} onChange={(e) => setStatus(c.key, e.target.value)} style={{ color: STAT[c.outcome || "lead"].color }}>
                      {CUST_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                    <button className="del" onClick={() => removeCustomer(c.key)}>Remove</button>
                  </div>
                  <div className="frow">
                    <input placeholder="Name" value={c.name || ""} onChange={(e) => updateCustomer(c.key, "name", e.target.value)} />
                    <input placeholder="Phone" inputMode="tel" value={c.phone || ""} onChange={(e) => updateCustomer(c.key, "phone", e.target.value)} />
                  </div>
                  <input placeholder="Email" inputMode="email" value={c.email || ""} onChange={(e) => updateCustomer(c.key, "email", e.target.value)} />
                  <input placeholder="Address" value={c.addr || ""} onChange={(e) => updateCustomer(c.key, "addr", e.target.value)} />
                  <div className="frow">
                    <input placeholder="City" value={c.city || ""} onChange={(e) => updateCustomer(c.key, "city", e.target.value)} />
                    <select value={c.method || ""} onChange={(e) => updateCustomer(c.key, "method", e.target.value)}>
                      {METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                  </div>
                  <div className="frow">
                    <input type="date" value={c.date || ""} onChange={(e) => updateCustomer(c.key, "date", e.target.value)} />
                    <input type="number" placeholder="Price $" value={c.price || ""} onChange={(e) => updateCustomer(c.key, "price", e.target.value)} />
                  </div>
                  <textarea placeholder="Notes" rows={2} value={c.notes || ""} onChange={(e) => updateCustomer(c.key, "notes", e.target.value)} />
                  {c.center && <button className="link" onClick={() => { setTab("map"); flyTo(c.center); }}>Show on map →</button>}
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "stats" && (
          <section className="panel padded">
            <div className="phd">In current view</div>
            <div className="readouts">
              <div className="ro"><b style={{ color: TIER.green.color }}>{stats.tiers.green}</b><span>Room</span></div>
              <div className="ro"><b style={{ color: TIER.yellow.color }}>{stats.tiers.yellow}</b><span>Tight</span></div>
              <div className="ro"><b style={{ color: TIER.red.color }}>{stats.tiers.red}</b><span>No room</span></div>
            </div>
            <div className="phd">Knocks logged</div>
            <div className="bars">
              {OUTCOMES.map((o) => {
                const v = stats.tally[o.key] || 0;
                const max = Math.max(1, ...OUTCOMES.map((x) => stats.tally[x.key] || 0));
                return (
                  <div className="bar" key={o.key}>
                    <span className="blab">{o.label}</span>
                    <span className="track"><span className="fill" style={{ width: `${(v / max) * 100}%`, background: o.color }} /></span>
                    <span className="bnum">{v}</span>
                  </div>
                );
              })}
            </div>
            <p className="note">Verdicts use lot size and open space from county records. The deeper back-it-in vs. crane access scoring comes from the building-footprint pass.</p>
          </section>
        )}
      </div>

      <nav className="bottomnav">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            <Icon name={t.key} />{t.label}
            {t.key === "customers" && customers.length > 0 && <span className="navbadge">{customers.length}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
