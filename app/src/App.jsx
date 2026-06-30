import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import Parcel3D from "./Parcel3D";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

const PARCELS_URL =
  "https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/Parcels_SaltLake_LIR/FeatureServer/0/query";

// unit + scoring (open-space from parcel attributes; access/crane is the footprint pass)
const SQFT_PER_ACRE = 43560;
const BACKYARD_FRAC = 0.5;
const MIN_ZOOM = 15;       // below this a viewport holds more parcels than the page budget can fully cover
const PAGE = 2000;         // ArcGIS per-request cap; we paginate to cover the whole viewport
const MAX_PAGES = 4;       // up to 8000 parcels per view before we ask the user to zoom in
const RENTAL_COLOR = "#64748b";
const SET_KEY = "yardscout.settings.v1";
const DEFAULT_SETTINGS = { unitW: 14, unitL: 66, unitH: 13.5, greenMargin: 1.6, highlightRentals: true, mapStyle: "satellite", home: null };
const PRESETS = [
  { key: "single", label: "Single-wide", w: 14, l: 66, h: 13.5 },
  { key: "park", label: "Park model", w: 12, l: 35, h: 13.5 },
  { key: "camper", label: "Camper", w: 8, l: 30, h: 10 },
];
const STRICTNESS = [
  { key: 1.2, label: "Tight" },
  { key: 1.6, label: "Standard" },
  { key: 2.2, label: "Roomy" },
];
const TILES = {
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  streets: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
};
// Best free signal: a parcel NOT claiming Utah's primary-residence exemption (second home / short-term
// rental / vacant). True owner-address rental detection needs the assessor's owner data (backend phase).
const isRental = (p) => p.PRIMARY_RES === "N";

const UA = typeof navigator !== "undefined" ? navigator.userAgent : "";
const IS_IOS = /iPhone|iPad|iPod/.test(UA) || (typeof navigator !== "undefined" && navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/.test(UA);

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

function scoreOf(props, s) {
  const lot = (props.PARCEL_ACRES || 0) * SQFT_PER_ACRE;
  const open = Math.max(0, lot - (props.BLDG_SQFT || 0));
  const yard = open * BACKYARD_FRAC;          // sq ft of usable back yard
  const uw = s.unitW || 14, ul = s.unitL || 66;
  const unit = uw * ul;                       // home footprint sq ft
  const margin = s.greenMargin || 1.6;
  // Dimensional check: the parcel data only gives areas, not yard shape, so we
  // estimate the buildable yard as a square and require the home's LONG side to
  // physically span it. This is why a long single-wide is harder to place than
  // its raw area implies (a yard can have enough sq ft yet be too short).
  const yardSpan = Math.sqrt(yard);           // est. yard dimension (ft)
  const homeLong = Math.max(uw, ul);
  if (yard < unit || yardSpan < homeLong) return "red";
  if (yard < unit * margin || yardSpan < homeLong * Math.sqrt(margin)) return "yellow";
  return "green";
}

// parcel color = scoring verdict (or rental). Knocks/customers never recolor the parcel — only the flag.
const styleFor = (feat, s) => {
  const p = feat.properties;
  if (s.highlightRentals && isRental(p))
    return { color: RENTAL_COLOR, weight: 1.3, fillColor: RENTAL_COLOR, fillOpacity: 0.5 };
  const c = TIER[p._tier].color;
  return { color: c, weight: 1, fillColor: c, fillOpacity: 0.3 };
};

// flag marker (Option D): pole-left flag for CUSTOMERS, recolored via currentColor. Size is baked into the
// icon so the clickable area always matches what you see; icons regenerate on zoom instead of CSS-scaling.
const FLAG_PATHS =
  '<path d="M5.5 33V2.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M6.5 3.2h13.5l-3.4 4.6 3.4 4.6H6.5Z" fill="currentColor" stroke="#fff" stroke-width="1"/>';
const sizeForZoom = (z) => Math.round(Math.min(70, Math.max(22, 32 * Math.pow(1.32, z - 18))));
const flagIcon = (color, h) => {
  const w = (h * 25) / 33;
  return L.divIcon({
    className: "flag-wrap",
    html: `<div class="flag" style="color:${color}"><svg width="${w}" height="${h}" viewBox="0 0 25 33">${FLAG_PATHS}</svg></div>`,
    iconSize: [w, h], iconAnchor: [(w * 5.5) / 25, h],
  });
};

const Icon = ({ name }) => {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  if (name === "map")
    return <svg viewBox="0 0 24 24" width="22" height="22" {...p}><path d="M9 4 3.5 6.2v13.3L9 17.3l6 2.2 5.5-2.2V3.8L15 6 9 4Z" /><path d="M9 4v13.3M15 6v13.5" /></svg>;
  if (name === "customers")
    return <svg viewBox="0 0 24 24" width="22" height="22" {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3.4 19c0-3.1 2.5-5.3 5.6-5.3s5.6 2.2 5.6 5.3" /><path d="M16.2 5.6a3 3 0 0 1 0 5.7M17 13.9c2.2.5 3.8 2.3 3.8 4.8" /></svg>;
  if (name === "settings")
    return <svg viewBox="0 0 24 24" width="22" height="22" {...p}><path d="M4 7h7M16 7h4M4 17h4M11 17h9" /><circle cx="14" cy="7" r="2.4" /><circle cx="8" cy="17" r="2.4" /></svg>;
  if (name === "trailer")
    return <svg viewBox="0 0 24 24" width="22" height="22" {...p}><path d="M12 2.5 3.5 7v10L12 21.5 20.5 17V7Z" /><path d="M3.7 7 12 11.6 20.3 7M12 11.6V21.4" /></svg>;
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 20V11M12 20V5M19 20v-6" /></svg>;
};

const Logo = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
    <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" stroke="#5b6470" strokeWidth="1.6" />
    <rect x="12" y="12.5" width="6.5" height="4.5" rx="1" fill="#1fa36b" />
  </svg>
);

export default function App({ profile, signOut } = {}) {
  const mapRef = useRef(null);
  const baseLayerRef = useRef(null);
  const layerRef = useRef(null);
  const markersRef = useRef(null);
  const markerByKey = useRef({});
  const idToLayer = useRef({});
  const knocksRef = useRef({});
  const reqToken = useRef(0);
  const meMarker = useRef(null);
  const mvRef = useRef(null);

  const [features, setFeatures] = useState([]);
  const [knocks, setKnocks] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
  });
  const [tab, setTab] = useState("map");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [zoomedOut, setZoomedOut] = useState(false);
  const [capped, setCapped] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [arReady, setArReady] = useState(false);
  const [show3D, setShow3D] = useState(null);
  const [settings, setSettings] = useState(() => {
    try { return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SET_KEY)) || {}) }; } catch { return DEFAULT_SETTINGS; }
  });
  const settingsRef = useRef(settings);

  useEffect(() => { knocksRef.current = knocks; localStorage.setItem(LS_KEY, JSON.stringify(knocks)); }, [knocks]);

  // re-score + restyle loaded parcels when settings change (no refetch needed)
  useEffect(() => {
    settingsRef.current = settings;
    localStorage.setItem(SET_KEY, JSON.stringify(settings));
    const layer = layerRef.current;
    if (layer) {
      layer.eachLayer((lyr) => {
        lyr.feature.properties._tier = scoreOf(lyr.feature.properties, settings);
        lyr.setStyle(styleFor(lyr.feature, settings));
      });
      setFeatures((fs) => fs.slice());
    }
  }, [settings]);

  const setSetting = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  const resetSettings = () => setSettings(DEFAULT_SETTINGS);
  const setHome = () => {
    const m = mapRef.current; if (!m) return;
    const c = m.getCenter();
    setSetting("home", { lat: c.lat, lng: c.lng, zoom: m.getZoom() });
  };
  const clearData = () => {
    if (!window.confirm("Clear all customers and knocks? This can't be undone.")) return;
    setKnocks({}); knocksRef.current = {};
    const layer = layerRef.current;
    if (layer) layer.eachLayer((lyr) => lyr.setStyle(styleFor(lyr.feature, settingsRef.current)));
  };
  // data ownership: export the customer list as CSV
  const exportCsv = () => {
    const cols = ["status", "name", "phone", "email", "addr", "city", "method", "date", "price", "notes"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [cols.join(",")];
    customers.forEach((c) => {
      const rec = { ...c, status: STAT[c.outcome]?.label || c.outcome || "" };
      lines.push(cols.map((k) => esc(rec[k])).join(","));
    });
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "yardscout-customers.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const renderParcels = useCallback((rawFeatures) => {
    const map = mapRef.current;
    if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
    idToLayer.current = {};
    rawFeatures.forEach((f) => {
      const p = f.properties;
      p._key = String(p.PARCEL_ID || p.OBJECTID);
      p._tier = scoreOf(p, settingsRef.current);
    });
    const layer = L.geoJSON({ type: "FeatureCollection", features: rawFeatures }, {
      style: (f) => styleFor(f, settingsRef.current),
      onEachFeature: (f, lyr) => {
        idToLayer.current[f.properties._key] = lyr;
        lyr.on("click", () => setSelected(f.properties._key));
      },
    }).addTo(map);
    layerRef.current = layer;

    // flags mark CUSTOMERS only — a pin drops when a house is marked interested/booked
    if (!markersRef.current) markersRef.current = L.layerGroup().addTo(map);
    markersRef.current.clearLayers();
    markerByKey.current = {};
    const h = sizeForZoom(map.getZoom());
    rawFeatures.forEach((f) => {
      const p = f.properties;
      const k = knocksRef.current[p._key];
      if (!(k && CUSTOMER_OUTCOMES.includes(k.outcome))) return;
      const poly = idToLayer.current[p._key];
      if (!poly) return;
      const m = L.marker(poly.getBounds().getCenter(), { icon: flagIcon(STAT[k.outcome].color, h) });
      m.on("click", () => setSelected(p._key));
      markerByKey.current[p._key] = m;
      markersRef.current.addLayer(m);
    });
    setFeatures(rawFeatures.map((f) => f.properties));
  }, []);

  // add/update/remove a customer's flag pin live
  const updateFlag = (key, knocks) => {
    const map = mapRef.current, group = markersRef.current;
    if (!map || !group) return;
    const k = knocks[key];
    const isCust = !!(k && CUSTOMER_OUTCOMES.includes(k.outcome));
    const existing = markerByKey.current[key];
    if (isCust) {
      const poly = idToLayer.current[key];
      if (!poly) return;
      const icon = flagIcon(STAT[k.outcome].color, sizeForZoom(map.getZoom()));
      if (existing) existing.setIcon(icon);
      else {
        const m = L.marker(poly.getBounds().getCenter(), { icon });
        m.on("click", () => setSelected(key));
        markerByKey.current[key] = m;
        group.addLayer(m);
      }
    } else if (existing) {
      group.removeLayer(existing);
      delete markerByKey.current[key];
    }
  };

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
    const home = settingsRef.current.home || { lat: 40.6655, lng: -111.9925, zoom: 16 };
    const map = L.map("map", { preferCanvas: true, zoomControl: true, attributionControl: false }).setView([home.lat, home.lng], home.zoom);
    mapRef.current = map;
    baseLayerRef.current = L.tileLayer(TILES[settingsRef.current.mapStyle] || TILES.satellite, { maxZoom: 20 }).addTo(map);
    const resizeFlags = () => {
      const h = sizeForZoom(map.getZoom());
      Object.entries(markerByKey.current).forEach(([key, mk]) => {
        const k = knocksRef.current[key];
        if (k && STAT[k.outcome]) mk.setIcon(flagIcon(STAT[k.outcome].color, h));
      });
    };
    map.on("zoomend", resizeFlags);
    let t;
    const debounced = () => { clearTimeout(t); t = setTimeout(loadViewport, 400); };
    map.on("moveend", debounced);
    loadViewport();
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; layerRef.current = null; markersRef.current = null; idToLayer.current = {}; };
  }, [loadViewport]);

  useEffect(() => { if (tab === "map") setTimeout(() => mapRef.current?.invalidateSize(), 0); }, [tab]);

  // lazy-load model-viewer the first time the Trailer tab opens
  useEffect(() => { if (tab === "trailer" && !arReady) import("@google/model-viewer").then(() => setArReady(true)); }, [tab, arReady]);

  // swap satellite/streets basemap (tilePane sits below the parcel canvas, so parcels stay on top)
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (baseLayerRef.current) map.removeLayer(baseLayerRef.current);
    baseLayerRef.current = L.tileLayer(TILES[settings.mapStyle] || TILES.satellite, { maxZoom: 20 }).addTo(map);
  }, [settings.mapStyle]);

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
      updateFlag(key, next);
      return next;
    });
  };

  const updateCustomer = (key, field, value) =>
    setKnocks((prev) => { const next = { ...prev, [key]: { ...(prev[key] || {}), [field]: value } }; knocksRef.current = next; return next; });

  const setStatus = (key, value) =>
    setKnocks((prev) => {
      const next = { ...prev, [key]: { ...(prev[key] || {}), outcome: value } };
      knocksRef.current = next;
      updateFlag(key, next);
      return next;
    });

  const addCustomer = () => {
    const key = "cust_" + crypto.randomUUID();
    setKnocks((prev) => { const next = { ...prev, [key]: { outcome: "lead", ts: Date.now() } }; knocksRef.current = next; return next; });
    setTab("customers");
  };

  const removeCustomer = (key) =>
    setKnocks((prev) => { const next = { ...prev }; delete next[key]; knocksRef.current = next;
      updateFlag(key, next); return next; });

  const toggleExpand = (key) =>
    setExpanded((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const saveCustomer = (key) => {
    updateCustomer(key, "saved", true);
    setExpanded((s) => { const n = new Set(s); n.delete(key); return n; });
  };

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

  // pick the box model closest to the configured trailer size
  const modelName = useMemo(() => {
    const a = settings.unitW * settings.unitL;
    return PRESETS.reduce((b, pr) => (Math.abs(pr.w * pr.l - a) < Math.abs(b.w * b.l - a) ? pr : b)).key;
  }, [settings.unitW, settings.unitL]);

  const TABS = [
    { key: "map", label: "Map" },
    { key: "trailer", label: "Trailer" },
    { key: "customers", label: "Customers" },
    { key: "stats", label: "Stats" },
    { key: "settings", label: "Settings" },
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
            {settings.highlightRentals && <span><i style={{ background: RENTAL_COLOR }} />Rental</span>}
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
              <div className="disclaim">Estimate from county data — verify on site before committing.</div>
              <button className="lot3d" onClick={() => {
                const lyr = idToLayer.current[sel._key]; if (!lyr) return;
                const b = lyr.getBounds(), c = b.getCenter();
                const latM = (b.getNorth() - b.getSouth()) * 111320;
                const lngM = (b.getEast() - b.getWest()) * 111320 * Math.cos(c.lat * Math.PI / 180);
                const groundMeters = Math.max(latM, lngM, 12) * 1.8;
                setShow3D({ center: { lat: c.lat, lng: c.lng }, groundMeters, modelUrl: `${import.meta.env.BASE_URL}models/${modelName}.glb`, label: sel.PARCEL_ADD || "Parcel" });
              }}>View on the lot in 3D</button>
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
              {customers.map((c) => {
                const status = STAT[c.outcome || "lead"];
                const canSave = (c.name || "").trim() && (c.phone || "").trim();
                if (c.saved && !expanded.has(c.key)) {
                  return (
                    <button key={c.key} className="custrow" onClick={() => toggleExpand(c.key)}>
                      <span className="cname">{c.name || "(no name)"}</span>
                      {c.date && <span className="cdate">{c.date}</span>}
                      <span className="cbadge" style={{ background: status.color }}>{status.label}</span>
                    </button>
                  );
                }
                return (
                  <div key={c.key} className="custcard">
                    <div className="custtop">
                      <select className="statsel" value={c.outcome || "lead"} onChange={(e) => setStatus(c.key, e.target.value)} style={{ color: status.color }}>
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
                    <div className="cardactions">
                      {c.center && <button className="link" onClick={() => { setTab("map"); flyTo(c.center); }}>Show on map →</button>}
                      {canSave && <button className="savebtn" onClick={() => saveCustomer(c.key)}>Save</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {tab === "stats" && (
          <section className="panel padded">
            <div className="swrap">
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
            </div>
          </section>
        )}

        {tab === "trailer" && (
          <section className="panel padded">
            <div className="swrap">
              <div className="phd">Your trailer</div>
              {(() => {
                const glb = `${import.meta.env.BASE_URL}models/${modelName}.glb`;
                const usdz = `${import.meta.env.BASE_URL}models/${modelName}.usdz`;
                const scene = `https://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(new URL(glb, window.location.href).href)}&mode=ar_preferred`;
                return (
                  <>
                    {arReady ? (
                      <model-viewer src={glb}
                        {...{ "camera-controls": "", "auto-rotate": "", "touch-action": "pan-y", "shadow-intensity": "1", exposure: "0.95", "interaction-prompt": "none", "camera-orbit": "-55deg 75deg auto", "min-camera-orbit": "auto 0deg auto", "max-camera-orbit": "auto 90deg auto" }}
                        style={{ width: "100%", height: "330px", background: "#eef1f0", borderRadius: "14px" }}>
                      </model-viewer>
                    ) : (
                      <div className="mvload" style={{ height: "330px" }}><div className="spin" /></div>
                    )}
                    <div className="readout" style={{ marginTop: "12px" }}>
                      <div><b>{settings.unitW}</b><span>width ft</span></div>
                      <div><b>{settings.unitL}</b><span>length ft</span></div>
                      <div><b>{settings.unitH}</b><span>height ft</span></div>
                    </div>
                    <div className="presets" style={{ marginTop: "12px" }}>
                      {PRESETS.map((pr) => {
                        const on = settings.unitW === pr.w && settings.unitL === pr.l;
                        return (
                          <button key={pr.key} className={"preset" + (on ? " on" : "")}
                            onClick={() => setSettings((s) => ({ ...s, unitW: pr.w, unitL: pr.l, unitH: pr.h }))}>
                            <b>{pr.label}</b><span>{pr.w} × {pr.l} ft</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="setrow" style={{ marginTop: "10px" }}>
                      <label>Width (ft)<input type="number" min="1" value={settings.unitW} onChange={(e) => setSetting("unitW", Number(e.target.value) || 0)} /></label>
                      <label>Length (ft)<input type="number" min="1" value={settings.unitL} onChange={(e) => setSetting("unitL", Number(e.target.value) || 0)} /></label>
                      <label>Height (ft)<input type="number" min="1" value={settings.unitH} onChange={(e) => setSetting("unitH", Number(e.target.value) || 0)} /></label>
                    </div>
                    {IS_IOS ? (
                      <a className="ar-anchor" style={{ marginTop: "14px" }} rel="ar" href={usdz}><img src={`${import.meta.env.BASE_URL}ar-poster.png`} alt="View in your yard" /></a>
                    ) : IS_ANDROID ? (
                      <a className="ar-cta" style={{ marginTop: "14px" }} href={scene}>View in your yard</a>
                    ) : (
                      <div className="arnote">Spin the 3D model above on a computer. To place it in a real yard with the camera, open Yardscout on your phone — the camera view is phone-only.</div>
                    )}
                    <p className="snote">Matches your {settings.unitW}×{settings.unitL} ft unit. Pick a preset or set the size above.</p>
                  </>
                );
              })()}
            </div>
          </section>
        )}

        {tab === "settings" && (
          <section className="panel padded">
            <div className="swrap">
              {profile && (
                <>
                  <div className="phd">Account</div>
                  <div className="acct">
                    <div className="who">
                      <b>{profile.name || "You"} · {profile.role === "owner" ? "Owner" : "Rep"}</b>
                      <span>{profile.org?.name}</span>
                    </div>
                    <button className="signout" onClick={signOut}>Sign out</button>
                  </div>
                </>
              )}
              <div className="phd">Trailer</div>
              <div className="presets">
                {PRESETS.map((pr) => {
                  const on = settings.unitW === pr.w && settings.unitL === pr.l;
                  return (
                    <button key={pr.key} className={"preset" + (on ? " on" : "")}
                      onClick={() => setSettings((s) => ({ ...s, unitW: pr.w, unitL: pr.l, unitH: pr.h }))}>
                      <b>{pr.label}</b><span>{pr.w} × {pr.l} ft</span>
                    </button>
                  );
                })}
              </div>
              <div className="setrow">
                <label>Width (ft)<input type="number" min="1" value={settings.unitW} onChange={(e) => setSetting("unitW", Number(e.target.value) || 0)} /></label>
                <label>Length (ft)<input type="number" min="1" value={settings.unitL} onChange={(e) => setSetting("unitL", Number(e.target.value) || 0)} /></label>
                <label>Height (ft)<input type="number" min="1" value={settings.unitH} onChange={(e) => setSetting("unitH", Number(e.target.value) || 0)} /></label>
              </div>
              <div className="preview">{(() => {
                const lotW = 62, lotL = 108, sc = 2.3;
                const W = lotW * sc, H = lotL * sc;
                const tw = Math.min(settings.unitW, lotW) * sc, tl = Math.min(settings.unitL, lotL) * sc;
                const fits = settings.unitW <= lotW && settings.unitL <= lotL;
                return (
                  <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="previewsvg">
                    <rect x="1" y="1" width={W - 2} height={H - 2} rx="7" fill="#eef1f0" stroke="#cdd5d1" strokeDasharray="5 4" />
                    <text x={W / 2} y="15" textAnchor="middle" className="pvlabel">≈ 0.15-acre lot</text>
                    <rect x={(W - tw) / 2} y={H - tl - 12} width={tw} height={tl} rx="3" fill={fits ? "#1fa36b" : "#dd5145"} opacity="0.9" />
                    <text x={W / 2} y={H - tl / 2 - 9} textAnchor="middle" className="pvunit">{settings.unitW}×{settings.unitL}</text>
                  </svg>
                );
              })()}</div>
              <p className="snote">Footprint {(settings.unitW * settings.unitL).toLocaleString()} sqft. A bigger unit raises the bar, so fewer yards score green.</p>

              <div className="phd">Scoring</div>
              <div className="seg3">
                {STRICTNESS.map((o) => (
                  <button key={o.key} className={settings.greenMargin === o.key ? "on" : ""} onClick={() => setSetting("greenMargin", o.key)}>{o.label}</button>
                ))}
              </div>
              <p className="snote">How much room beyond the trailer a yard needs before it counts as green.</p>

              <div className="phd">Map</div>
              <div className="seg3">
                <button className={settings.mapStyle === "satellite" ? "on" : ""} onClick={() => setSetting("mapStyle", "satellite")}>Satellite</button>
                <button className={settings.mapStyle === "streets" ? "on" : ""} onClick={() => setSetting("mapStyle", "streets")}>Streets</button>
              </div>
              <label className="toggle">
                <span className="tlabel"><b>Highlight rentals</b><small>Shade non-primary homes (second homes, short-term rentals, vacant) so the crew can skip them.</small></span>
                <input type="checkbox" checked={settings.highlightRentals} onChange={(e) => setSetting("highlightRentals", e.target.checked)} />
                <span className="sw" />
              </label>
              <button className="ghostbtn full" onClick={setHome}>Set current map view as “home”</button>
              <p className="snote">Heads up: a long-term rental with a tenant looks the same as owner-occupied in the free county data, so the rental shading only catches non-primary properties for now. Full absentee-owner detection comes with the backend.</p>

              <div className="phd">Data</div>
              <div className="setbtns">
                <button className="ghostbtn" onClick={exportCsv}>Export customers (CSV)</button>
                <button className="ghostbtn" onClick={resetSettings}>Reset settings to defaults</button>
                <button className="dangerbtn" onClick={clearData}>Clear all customers &amp; knocks</button>
              </div>
            </div>
          </section>
        )}
      </div>

      {show3D && (
        <Parcel3D center={show3D.center} groundMeters={show3D.groundMeters} modelUrl={show3D.modelUrl} label={show3D.label} onClose={() => setShow3D(null)} />
      )}

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
