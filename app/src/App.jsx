import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import Parcel3D from "./Parcel3D";
import { loadCustomers, saveCustomer, deleteCustomer, loadFlags, saveFlag, subscribeShared } from "./lib/data";
import { computeParcelFit, fitParcelWith, fetchBuildings, fetchRoads, fetchOwnership, fetchUtahOwnership } from "./lib/geo";
import { ADU_MODELS, KEARNS_PROFILE, BUSINESS_OVERLAY, NEEDS_CHECK_LABEL, CITY_PROFILES, RULE_OPTIONS, resolveJurisdiction, JURISDICTIONS_VERSION } from "./lib/adu";
import { aduSizeCap, PRIMARY_ABOVEGRADE_FACTOR } from "./lib/fit";
import { toOwnerRecord, toOwnerRecordLIR, toOwnerRecordUC } from "./lib/owner";
import { sharePdf } from "./lib/share";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

// Per-county LIR parcel layers (same CORS-open UGRC org, full attributes). Both valleys load by querying each;
// a viewport in one county returns ~0 from the other, so it's one cheap extra request. Add more counties here.
const PARCELS_ORG = "https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services";
const PARCEL_LAYERS = [
  `${PARCELS_ORG}/Parcels_SaltLake_LIR/FeatureServer/0/query`,
  `${PARCELS_ORG}/Parcels_Utah_LIR/FeatureServer/0/query`,
];

// unit + scoring (open-space from parcel attributes; access/crane is the footprint pass)
const SQFT_PER_ACRE = 43560;
const BACKYARD_FRAC = 0.5;
const MIN_ZOOM = 15;       // below this a viewport holds more parcels than the page budget can fully cover
const FIT_ZOOM = 16;       // at/above this (default browse zoom) the map runs + trusts the exact geometry fit, not the coarse open-space estimate
let AT_FIT_ZOOM = false;    // set from the live map zoom; when true, only an EXACT-confirmed fit gets a lead color (see styleFor)
const PAGE = 2000;         // ArcGIS per-request cap; we paginate to cover the whole viewport
const MAX_PAGES = 4;       // up to 8000 parcels per view before we ask the user to zoom in
const SET_KEY = "yardscout.settings.v1";
const ftIn = (f) => { const w = Math.floor(f); const i = Math.round((f - w) * 12); return i ? `${w}′${i}″` : `${w}′`; };
// collapse fitting models by footprint -> one entry per distinct size, keeping the roomiest fit + the models at that size
const groupFits = (fits) => Object.values((fits || []).reduce((acc, f) => {
  const k = `${f.model.widthFt}x${f.model.lengthFt}`;
  if (!acc[k]) acc[k] = { key: k, w: f.model.widthFt, l: f.model.lengthFt, clearanceFt: f.clearanceFt, method: f.method, models: [] };
  else if (f.clearanceFt > acc[k].clearanceFt) { acc[k].clearanceFt = f.clearanceFt; acc[k].method = f.method; }
  acc[k].models.push(f.model);
  return acc;
}, {}));
const titleCase = (s) => String(s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const sizeCapLabel = (p) => {
  const parts = [];
  if (p.maxPctOfPrimary) parts.push(`${p.maxPctOfPrimary}% of home`);
  if (p.maxAduSqft) parts.push(`${p.maxAduSqft.toLocaleString()} sq ft`);
  return parts.length ? parts.join(" or ") : "No cap";
};
const DEFAULT_SETTINGS = {
  mapStyle: "satellite", home: null,
  // ADU placement rules (single-owner, local for now; shared DB comes with the per-rep phase)
  aduCity: "slco-kearns", minLotSqft: 7000, sideFt: 5, rearFt: 10, frontBehindFacadeFt: 10, maxPctOfPrimary: 0, maxAduSqft: 0,
  houseSeparationFt: 20, backinMinSideGapFt: 16,
};
// persistent per-lot fit cache (survives panning + reloads); keyed by parcel id, scoped to a rules signature
const FITS_KEY = "yardscout.fits.v1";
const loadFits = () => {
  try { const d = JSON.parse(localStorage.getItem(FITS_KEY)); return { map: new Map(Object.entries(d?.entries || {})), sig: d?.sig || null }; }
  catch { return { map: new Map(), sig: null }; }
};
// owner/equity sidecar cache: parcelId -> OwnerRecord (from owner.toOwnerRecord). Kept separate from the fit cache
// so live county data never entangles with the geometry judgments. Short TTL so field reps don't see stale ownership.
const OWNER_KEY = "yardscout.owners.v2";   // bump to drop stale records (recompute tenure/etc. with current code)
const OWNER_TTL = 7 * 864e5;   // 7 days
const loadOwners = () => {
  try {
    const d = JSON.parse(localStorage.getItem(OWNER_KEY)); const now = Date.now(); const m = new Map();
    for (const [k, v] of Object.entries(d?.entries || {})) if (now - (v.fetchedAt || 0) <= OWNER_TTL) m.set(k, v);
    return m;
  } catch { return new Map(); }
};
// equity-likelihood tiers: shade the fitting lots by lead quality (hot = long-held/deep equity). Estimate, not a $ amount.
const EQ = {  // "Ember" tiers tuned for the warm-paper theme (match the marketing site)
  hot:  { color: "#C4552D", label: "Hot lead" },        // terracotta — long-held, deep equity
  warm: { color: "#C68A2E", label: "Warm lead" },       // ochre — mid tenure/unknown
  cool: { color: "#4F7A99", label: "Lower priority" },  // slate blue — recent buyer, recedes
};
// read an owner record only if still within TTL; purge it on read otherwise (enforces freshness everywhere, not just at load)
const freshOwner = (cache, key) => {
  const r = cache.get(key);
  if (!r) return null;
  if (Date.now() - (r.fetchedAt || 0) > OWNER_TTL) { cache.delete(key); return null; }
  return r;
};
const ownerDisplay = (s) => String(s || "").split(";")[0]
  .replace(/\s+\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, "")   // drop trailing trust/recording dates ("... FAMILY TRUST 10/02/2015")
  .replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim()
  .toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
const fmtAsOf = (ts) => { try { return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return "recently"; } };

const TILES = {
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  streets: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
};

const UA = typeof navigator !== "undefined" ? navigator.userAgent : "";
const IS_IOS = /iPhone|iPad|iPod/.test(UA) || (typeof navigator !== "undefined" && navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/.test(UA);

const TIER = {
  green:  { color: "#1B6E47", label: "Room to place" },
  yellow: { color: "#C68A2E", label: "Tight" },
  red:    { color: "#C4552D", label: "No room" },
};
const OUTCOMES = [
  { key: "booked",         label: "Booked",         color: "#2563eb" },  // blue — the win
  { key: "interested",     label: "Interested",     color: "#0ca5b8" },  // teal — warm lead
  { key: "not_home",       label: "Not home",       color: "#f59e0b" },  // amber — come back later
  { key: "not_interested", label: "Not interested", color: "#94a3b8" },  // gray — soft no
  { key: "blocked",        label: "Can't place",    color: "#dc2626" },  // red — hard/physical no
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

// Fast open-space tier for LOW zoom (block zoom runs the exact fit engine instead). No user knobs. Uses the
// SMALLEST/easiest unit in the catalog so "promising" (green) means "at least one unit could plausibly fit" —
// permissive on purpose, so we don't hide potential doors when zoomed out.
const MIN_UNIT = ADU_MODELS.reduce((a, m) => (m.widthFt * m.lengthFt < a.w * a.l ? { w: m.widthFt, l: m.lengthFt } : a), { w: 1e9, l: 1e9 });
const STANDARD_MARGIN = 1.6;
function scoreOf(props) {
  const lot = (props.PARCEL_ACRES || 0) * SQFT_PER_ACRE;
  const open = Math.max(0, lot - (props.BLDG_SQFT || 0));
  const yard = open * BACKYARD_FRAC;          // sq ft of usable back yard
  const unit = MIN_UNIT.w * MIN_UNIT.l;       // smallest home footprint sq ft
  // Dimensional check: the parcel data only gives areas, not yard shape, so we estimate the buildable yard as a
  // square and require the home's LONG side to physically span it (enough sq ft isn't enough if the yard is short).
  const yardSpan = Math.sqrt(yard);           // est. yard dimension (ft)
  const homeLong = Math.max(MIN_UNIT.w, MIN_UNIT.l);
  if (yard < unit || yardSpan < homeLong) return "red";
  if (yard < unit * STANDARD_MARGIN || yardSpan < homeLong * Math.sqrt(STANDARD_MARGIN)) return "yellow";
  return "green";
}

// parcel color = equity-lead tier. Knocks/customers never recolor the parcel — only the flag.
const styleFor = (feat, _s) => {   // _s (settings) kept for call-site symmetry; not needed now that color = tier only
  const p = feat.properties;
  // Only the lots that WORK are highlighted; everything else is plain satellite (still tappable).
  // At browse zoom (AT_FIT_ZOOM) a lot is only a "winner" once the EXACT fit confirms it fits -- never on the coarse
  // open-space estimate -- so the map can't promise a fit the tap then retracts. Coarse tier only drives the zoomed-out
  // overview. A lot awaiting its exact result at browse zoom stays hidden until computeFits fills it in.
  const winner = p._fitStatus ? p._fitStatus === "fits" : (!AT_FIT_ZOOM && p._tier === "green");
  if (!winner) return HIDDEN_STYLE;
  // The map only ever speaks Ember: shade by equity-lead tier once we have owner data; a fitting lot that isn't
  // rated yet (data still loading / missing) gets a neutral graphite gray — never the old green/amber fit scale.
  const c = p._ownerTier ? EQ[p._ownerTier].color : PENDING_COLOR;
  // lighter fill + solid border: reads as a clean highlight (you can still see the roof through it), and it keeps a
  // slight parcel-vs-imagery offset from looking like a solid slab covering the wrong house.
  return { color: c, weight: 2.5, opacity: 1, fillColor: c, fillOpacity: 0.42 };
};
const PENDING_COLOR = "#A7A092";  // fits, not yet rated (warm neutral, on-brand with the paper theme)
// invisible fill so non-winners stay clickable (tap any house at a door) without cluttering the map
const HIDDEN_STYLE = { stroke: false, fill: true, fillColor: "#16b866", fillOpacity: 0.001 };

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
  const flagsRef = useRef({});
  const dirtyRef = useRef(new Set());   // customer keys with an unsaved/in-flight edit — preserved across realtime reloads
  const verRef = useRef({});            // per-key write version; a reload only clears dirty if no newer edit landed
  const flagDirtyRef = useRef(new Set());
  const flagVerRef = useRef({});
  const saveTimers = useRef({});
  const orgId = profile?.org_id;
  const orgIdRef = useRef(orgId);
  const reqToken = useRef(0);
  const fitToken = useRef(0);
  const fitCacheRef = useRef(null);        // parcelId -> {status, color}; persisted, scoped to sigRef
  const sigRef = useRef(null);
  if (fitCacheRef.current === null) { const { map, sig } = loadFits(); fitCacheRef.current = map; sigRef.current = sig; }
  const ownerCacheRef = useRef(null);      // parcelId -> OwnerRecord; persisted, TTL-scoped (independent of fits)
  const ownerToken = useRef(0);
  if (ownerCacheRef.current === null) ownerCacheRef.current = loadOwners();
  const [ownerVer, setOwnerVer] = useState(0);   // bumps when owner data lands so the detail card re-reads the ref
  const aduProfileRef = useRef(KEARNS_PROFILE);
  const aduOverlayRef = useRef(BUSINESS_OVERLAY);
  const meMarker = useRef(null);
  const mvRef = useRef(null);

  const [features, setFeatures] = useState([]);
  const [knocks, setKnocks] = useState({});      // shared CRM, loaded from Supabase (keyed by parcel_id or cust_<id>)
  const [flags, setFlags] = useState({});        // parcel_id -> 'fits' | 'no_fit' (rep override of computed verdict)
  const [tab, setTab] = useState("map");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [zoomedOut, setZoomedOut] = useState(false);
  const [capped, setCapped] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [arReady, setArReady] = useState(false);
  const [show3D, setShow3D] = useState(null);
  const [aduFit, setAduFit] = useState(null);
  const [aduLoading, setAduLoading] = useState(false);
  const [floorPlan, setFloorPlan] = useState(null);   // catalog model whose floor plan is open
  const [openModel, setOpenModel] = useState(null);   // Trailer tab: which unit is expanded (3D loads only when open)
  const [showRules, setShowRules] = useState(false);   // detail card: expand the jurisdiction's ADU rules
  const [ownerPartial, setOwnerPartial] = useState(false);  // last owner fetch couldn't reach some lots (county server)
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullRef = useRef(0);
  const ptr = useRef({ startY: 0, active: false });
  const [settings, setSettings] = useState(() => {
    try { return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SET_KEY)) || {}) }; } catch { return DEFAULT_SETTINGS; }
  });
  const settingsRef = useRef(settings);

  useEffect(() => { knocksRef.current = knocks; }, [knocks]);
  useEffect(() => { flagsRef.current = flags; }, [flags]);
  useEffect(() => { orgIdRef.current = orgId; }, [orgId]);

  // ---- Supabase <-> in-memory mapping. Each knocks entry is one customers row; status carries the outcome. ----
  const rowToRec = (r) => ({
    _id: r.id,
    outcome: r.status,
    ts: r.created_at ? Date.parse(r.created_at) : Date.now(),
    addr: r.addr, city: r.city,
    center: r.lat != null && r.lng != null ? [r.lat, r.lng] : undefined,
    name: r.name, phone: r.phone, email: r.email,
    method: r.method, date: r.place_date, price: r.price, notes: r.notes,
    saved: true,
  });
  const recToRow = (key, rec) => ({
    id: rec._id,
    org_id: orgIdRef.current,
    parcel_id: key.startsWith("cust_") ? null : key,
    status: rec.outcome ?? null,
    name: rec.name, phone: rec.phone, email: rec.email,
    addr: rec.addr, city: rec.city,
    method: rec.method, place_date: rec.date, price: rec.price, notes: rec.notes,
    lat: rec.center?.[0], lng: rec.center?.[1],
  });

  // single source of truth for a parcel's color: a rep's flag wins, else the computed score.
  const resolveVerdict = (key, props) =>
    flagsRef.current[key] === "no_fit" ? "red"
      : flagsRef.current[key] === "fits" ? "green"
        : scoreOf(props);

  const touch = (key) => { dirtyRef.current.add(key); return (verRef.current[key] = (verRef.current[key] || 0) + 1); };

  // push one key's current local record to Supabase (id is client-generated, so no return-value remap needed).
  const persist = (key) => {
    const rec = knocksRef.current[key];
    if (!rec || !orgIdRef.current) return;
    const ver = verRef.current[key];
    saveCustomer(recToRow(key, rec))
      .then(() => { if (verRef.current[key] === ver) dirtyRef.current.delete(key); })  // keep dirty if a newer edit landed
      .catch((e) => console.error("save customer failed", e));
  };
  const schedulePersist = (key) => {
    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => persist(key), 700);
  };

  // redraw the customer flag pins and recolor polygons from current knocks/flags (after a realtime reload).
  const refreshShared = useCallback(() => {
    const map = mapRef.current, group = markersRef.current;
    if (map && group) {
      group.clearLayers();
      markerByKey.current = {};
      const h = sizeForZoom(map.getZoom());
      Object.entries(knocksRef.current).forEach(([key, k]) => {
        if (!OUT[k.outcome]) return;
        const poly = idToLayer.current[key];
        if (!poly) return;
        const m = L.marker(poly.getBounds().getCenter(), { icon: flagIcon(STAT[k.outcome].color, h) });
        m.on("click", () => setSelected(key));
        markerByKey.current[key] = m;
        group.addLayer(m);
      });
    }
    const layer = layerRef.current;
    if (layer) layer.eachLayer((lyr) => {
      lyr.feature.properties._tier = resolveVerdict(lyr.feature.properties._key, lyr.feature.properties);
      lyr.setStyle(styleFor(lyr.feature, settingsRef.current));
    });
  }, []);

  // load shared data on login and keep it live; Supabase is authoritative (no localStorage for shared data).
  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    const reload = async () => {
      try {
        const [rows, fl] = await Promise.all([loadCustomers(), loadFlags()]);
        if (!alive) return;
        setFlags((prevF) => {
          const fmap = {}; fl.forEach((f) => { fmap[f.parcel_id] = f.verdict; });
          flagDirtyRef.current.forEach((k) => { fmap[k] = prevF[k]; });  // keep in-flight flag edits
          flagsRef.current = fmap; return fmap;
        });
        setKnocks((prev) => {
          const next = {};
          rows.forEach((r) => { next[r.parcel_id || "cust_" + r.id] = rowToRec(r); });
          dirtyRef.current.forEach((k) => { if (prev[k]) next[k] = prev[k]; });  // keep in-flight customer edits
          knocksRef.current = next; return next;
        });
        refreshShared();
      } catch (e) { console.error("load shared data failed", e); }
    };
    reload();
    const unsub = subscribeShared(orgId, () => reload());
    return () => { alive = false; unsub(); };
  }, [orgId, refreshShared]);

  // re-score + restyle loaded parcels when settings change (no refetch needed)
  useEffect(() => {
    settingsRef.current = settings;
    localStorage.setItem(SET_KEY, JSON.stringify(settings));
    const layer = layerRef.current;
    if (layer) {
      layer.eachLayer((lyr) => {
        lyr.feature.properties._tier = resolveVerdict(lyr.feature.properties._key, lyr.feature.properties);
        lyr.setStyle(styleFor(lyr.feature, settings));
      });
      setFeatures((fs) => fs.slice());
    }
  }, [settings]);

  const setSetting = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  const setCity = (key) => setSettings((s) => {
    const p = CITY_PROFILES.find((c) => c.key === key);
    return p ? { ...s, aduCity: key, minLotSqft: p.minLotSqft, sideFt: p.sideFt, rearFt: p.rearFt, frontBehindFacadeFt: p.frontBehindFacadeFt, maxPctOfPrimary: p.maxPctOfPrimary ?? 0, maxAduSqft: p.maxAduSqft ?? 0 } : { ...s, aduCity: key };
  });
  const resetSettings = () => setSettings(DEFAULT_SETTINGS);
  const setHome = () => {
    const m = mapRef.current; if (!m) return;
    const c = m.getCenter();
    setSetting("home", { lat: c.lat, lng: c.lng, zoom: m.getZoom() });
  };
  const clearData = () => {
    if (!window.confirm("Remove every customer for your whole team? This can't be undone.")) return;
    Object.values(knocksRef.current).forEach((rec) => { if (rec._id) deleteCustomer(rec._id).catch((e) => console.error(e)); });
    setKnocks({}); knocksRef.current = {};
    if (markersRef.current) { markersRef.current.clearLayers(); markerByKey.current = {}; }
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

  const renderParcels = useCallback((rawFeaturesIn) => {
    const map = mapRef.current;
    if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
    idToLayer.current = {};
    // dedup by parcel id: pagination / the two county layers can return the same parcel twice -> drawing it twice
    // stacks outlines and reads as "overlapping" lines. Keep the first occurrence.
    const seen = new Set();
    const rawFeatures = rawFeaturesIn.filter((f) => {
      const id = String(f.properties?.PARCEL_ID || f.properties?.OBJECTID);
      if (seen.has(id)) return false; seen.add(id); return true;
    });
    rawFeatures.forEach((f) => {
      const p = f.properties;
      p._key = String(p.PARCEL_ID || p.OBJECTID);
      p._tier = resolveVerdict(p._key, p);
      const cached = !flagsRef.current[p._key] && fitCacheRef.current.get(p._key);   // paint judged lots instantly (no flicker)
      if (cached) { p._fitStatus = cached.status; p._fitColor = cached.color; }
      const own = freshOwner(ownerCacheRef.current, p._key);   // cached (non-stale) equity tier -> instant tier shading
      if (own) p._ownerTier = own.tier; else delete p._ownerTier;
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
      if (!(k && OUT[k.outcome])) return;
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
    const isKnock = !!(k && OUT[k.outcome]);   // flag drops for ANY logged outcome (knocking history), colored by outcome
    const existing = markerByKey.current[key];
    if (isKnock) {
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

  const persistFits = () => {
    try { localStorage.setItem(FITS_KEY, JSON.stringify({ sig: sigRef.current, entries: Object.fromEntries(fitCacheRef.current) })); } catch { /* quota */ }
  };

  // At block zoom, judge any not-yet-judged visible lots ONCE (one viewport fetch), cache the result
  // persistently, and highlight the winners. Already-judged lots keep their color (no re-judging = no flicker).
  const computeFits = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !layerRef.current || map.getZoom() < FIT_ZOOM) return;   // low zoom: keep whatever's cached
    const uncached = [];
    layerRef.current.eachLayer((l) => { const k = l.feature.properties._key; if (!flagsRef.current[k] && !fitCacheRef.current.has(k)) uncached.push(l); });
    if (!uncached.length) return;                                        // everything in view already judged
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const token = ++fitToken.current;
    let buildings, roads;
    try { [buildings, roads] = await Promise.all([fetchBuildings(bbox), fetchRoads(bbox)]); }
    catch { return; }
    if (token !== fitToken.current || !layerRef.current) return;         // a newer move superseded this
    uncached.forEach((l) => {
      const p = l.feature.properties, key = p._key;
      if (fitCacheRef.current.has(key)) return;
      // judge each lot by ITS OWN city's rules (auto-detected from the parcel); fall back to the county baseline
      const { profile } = resolveJurisdiction({ city: p.PARCEL_CITY, county: p.COUNTY_NAME, fallback: aduProfileRef.current });
      const r = fitParcelWith(l.feature, buildings, roads, { models: ADU_MODELS, profile, overlay: aduOverlayRef.current });
      const entry = { status: r.status, color: r.status === "fits" ? r.color : null };
      fitCacheRef.current.set(key, entry);
      p._fitStatus = entry.status; p._fitColor = entry.color;
      l.setStyle(styleFor(l.feature, settingsRef.current));
    });
    persistFits();
  }, []);

  const persistOwners = () => {
    // evict from the LIVE map (not just the snapshot) so the in-memory cache can't grow without bound
    if (ownerCacheRef.current.size > 4000) {
      const keep = [...ownerCacheRef.current.entries()].sort((a, b) => (b[1].fetchedAt || 0) - (a[1].fetchedAt || 0)).slice(0, 4000);
      ownerCacheRef.current = new Map(keep);
    }
    try { localStorage.setItem(OWNER_KEY, JSON.stringify({ entries: Object.fromEntries(ownerCacheRef.current) })); } catch { /* quota */ }
  };

  // At block zoom, enrich visible lots with county owner/equity data ONCE (batched by parcel-id), cache with a TTL,
  // and re-shade the fitting lots by lead tier. Best-effort: if the county server is down, lots keep the fit hue.
  const computeOwners = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !layerRef.current || map.getZoom() < FIT_ZOOM) return;
    const now = Date.now(); const needSL = []; const needUC = []; const ucFeats = new Map();
    layerRef.current.eachLayer((l) => {
      const p = l.feature.properties; const rec = ownerCacheRef.current.get(p._key);
      if (rec && now - (rec.fetchedAt || 0) <= OWNER_TTL) return;
      // Salt Lake County -> SLCo assessor service (owner + tenure). Utah County -> Utah County OwnerParcel service (owner + occupancy + value, no tenure).
      if (p.COUNTY_NAME === "Salt Lake County") needSL.push(p._key);
      else { needUC.push(p._key); ucFeats.set(p._key, l.feature); }
    });
    if (!needSL.length && !needUC.length) return;
    const nd = new Date();
    const token = ++ownerToken.current;
    // Utah County: fetch the assessor OwnerParcel service; fall back to the parcel's LIR fields for any parcel it doesn't return.
    if (needUC.length) {
      let ucRaw = new Map();
      try { ucRaw = await fetchUtahOwnership(needUC); } catch { ucRaw = new Map(); }
      if (token !== ownerToken.current || !layerRef.current) return;
      if (ucRaw.partial) setOwnerPartial(true);
      for (const key of needUC) {
        const attrs = ucRaw.get(key);
        if (attrs) ownerCacheRef.current.set(key, toOwnerRecordUC(attrs, nd));
        else { const f = ucFeats.get(key); if (f) ownerCacheRef.current.set(key, toOwnerRecordLIR(f.properties, nd)); }
      }
    }
    let raw = new Map();
    if (needSL.length) {
      try { raw = await fetchOwnership(needSL); } catch { raw = new Map(); }
      if (token !== ownerToken.current || !layerRef.current) return;   // a newer move superseded this
      setOwnerPartial(!!raw.partial);   // some chunks failed -> tell the user it's incomplete
      raw.forEach((attrs, id) => ownerCacheRef.current.set(id, toOwnerRecord(attrs, nd)));
    }
    layerRef.current.eachLayer((l) => {
      const p = l.feature.properties, rec = ownerCacheRef.current.get(p._key);
      if (rec) { p._ownerTier = rec.tier; if (!flagsRef.current[p._key]) l.setStyle(styleFor(l.feature, settingsRef.current)); }
    });
    persistOwners();
    setOwnerVer((v) => v + 1);
  }, []);

  // manual "refresh this area": drop the viewport's cached owner records and re-pull (for stale data or a prior partial load)
  const refreshOwners = useCallback(() => {
    const layer = layerRef.current; if (!layer) return;
    layer.eachLayer((l) => ownerCacheRef.current.delete(l.feature.properties._key));
    persistOwners();
    setOwnerPartial(false);
    computeOwners();
  }, [computeOwners]);

  const loadViewport = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    AT_FIT_ZOOM = map.getZoom() >= FIT_ZOOM;   // at browse zoom, styleFor trusts only the EXACT fit, not the coarse estimate
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
      outFields: "PARCEL_ID,PARCEL_ADD,PARCEL_CITY,COUNTY_NAME,PARCEL_ACRES,BLDG_SQFT,PRIMARY_RES,TOTAL_MKT_VALUE,BUILT_YR",
      returnGeometry: "true", outSR: "4326", f: "geojson", resultRecordCount: String(PAGE),
    };
    const token = ++reqToken.current;
    setLoading(true);
    (async () => {
      let all = [], capped = false;
      for (const url of PARCEL_LAYERS) {   // query each county layer; one returns ~0 for a single-county viewport
        let offset = 0, more = true, pages = 0;
        while (more && pages < MAX_PAGES) {
          const params = new URLSearchParams({ ...base, resultOffset: String(offset) });
          let fc;
          try { fc = await fetch(`${url}?${params}`).then((r) => r.json()); }
          catch { break; }   // this county's layer failed -> skip it, keep the others
          if (token !== reqToken.current) return; // a newer move superseded this load
          const batch = fc.features || [];
          all = all.concat(batch);
          more = batch.length >= PAGE;   // a full page back means there are probably more (geojson omits exceededTransferLimit)
          offset += PAGE; pages++;
        }
        if (more) capped = true;   // hit the page budget in some county -> suggest zooming in
      }
      renderParcels(all);
      setCapped(capped);
      setLoading(false);
      computeFits();     // block-zoom: color lots by the real geometry fit
      computeOwners();   // then enrich with county owner/equity data and re-shade winners by lead tier
    })();
  }, [renderParcels, computeFits, computeOwners]);

  useEffect(() => {
    let lastView = null;
    try { lastView = JSON.parse(localStorage.getItem("yardscout.view")); } catch { /* ignore */ }
    const home = lastView || settingsRef.current.home || { lat: 40.6655, lng: -111.9925, zoom: 16 };
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
    const debounced = () => {
      clearTimeout(t); t = setTimeout(loadViewport, 400);
      const c = map.getCenter();
      try { localStorage.setItem("yardscout.view", JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() })); } catch { /* ignore */ }
    };
    map.on("moveend", debounced);
    loadViewport();
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; layerRef.current = null; markersRef.current = null; idToLayer.current = {}; };
  }, [loadViewport]);

  // auto-update: GitHub Pages caches index.html for 10 min (not changeable there). version.json is fetched
  // no-store, so a new deploy is detected and the app reloads itself past the cache. Checks on load + refocus.
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const { version } = await r.json();
        if (version && typeof __APP_VERSION__ !== "undefined" && version !== __APP_VERSION__) {
          window.location.replace(`${import.meta.env.BASE_URL}?r=${Date.now()}`);
        }
      } catch { /* offline — ignore */ }
    };
    check();
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // pull-to-refresh: drag down (not on the map/3D) to reload. Reloads latest data + build; map view is restored.
  useEffect(() => {
    const THRESH = 70;
    const reset = () => { pullRef.current = 0; setPull(0); ptr.current.active = false; };
    const onStart = (e) => {
      if (e.touches.length !== 1 || refreshing) { ptr.current.active = false; return; }
      const t = e.target;
      if (t.closest?.(".leaflet-container, .p3d")) { ptr.current.active = false; return; }
      const sc = t.closest?.(".panel, .detail, main");
      if (sc && sc.scrollTop > 4) { ptr.current.active = false; return; }
      ptr.current = { startY: e.touches[0].clientY, active: true };
    };
    const onMove = (e) => {
      if (!ptr.current.active) return;
      const dy = e.touches[0].clientY - ptr.current.startY;
      if (dy <= 0) { pullRef.current = 0; setPull(0); return; }
      const p = Math.min(95, dy * 0.5);
      pullRef.current = p; setPull(p);
      if (p > 3 && e.cancelable) e.preventDefault();
    };
    const onEnd = () => {
      if (ptr.current.active && pullRef.current >= THRESH) { setRefreshing(true); setTimeout(() => window.location.replace(import.meta.env.BASE_URL + "?r=" + Date.now()), 200); }
      else reset();
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", reset);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", reset);
    };
  }, [refreshing]);

  useEffect(() => { if (tab === "map") setTimeout(() => mapRef.current?.invalidateSize(), 0); }, [tab]);

  // lazy-load model-viewer the first time the Trailer tab opens
  useEffect(() => { if (tab === "trailer" && !arReady) import("@google/model-viewer").then(() => setArReady(true)); }, [tab, arReady]);

  // swap satellite/streets basemap (tilePane sits below the parcel canvas, so parcels stay on top)
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (baseLayerRef.current) map.removeLayer(baseLayerRef.current);
    baseLayerRef.current = L.tileLayer(TILES[settings.mapStyle] || TILES.satellite, { maxZoom: 20 }).addTo(map);
  }, [settings.mapStyle]);

  // ADU rules come from Settings (fall back to the shipped Kearns config)
  const aduProfile = useMemo(() => ({
    name: settings.aduCity, minLotSqft: settings.minLotSqft ?? KEARNS_PROFILE.minLotSqft,
    sideFt: settings.sideFt ?? KEARNS_PROFILE.sideFt, rearFt: settings.rearFt ?? KEARNS_PROFILE.rearFt,
    frontYardFt: KEARNS_PROFILE.frontYardFt, frontBehindFacadeFt: settings.frontBehindFacadeFt ?? KEARNS_PROFILE.frontBehindFacadeFt,
    maxPctOfPrimary: settings.maxPctOfPrimary ?? 0, maxAduSqft: settings.maxAduSqft ?? 0,
  }), [settings.aduCity, settings.minLotSqft, settings.sideFt, settings.rearFt, settings.frontBehindFacadeFt, settings.maxPctOfPrimary, settings.maxAduSqft]);
  const aduOverlay = useMemo(() => ({
    houseSeparationFt: settings.houseSeparationFt ?? BUSINESS_OVERLAY.houseSeparationFt,
    backinMinSideGapFt: settings.backinMinSideGapFt ?? BUSINESS_OVERLAY.backinMinSideGapFt,
  }), [settings.houseSeparationFt, settings.backinMinSideGapFt]);

  // keep the fit-engine refs current and re-color the map when the rules change
  useEffect(() => {
    aduProfileRef.current = aduProfile; aduOverlayRef.current = aduOverlay;
    const sig = JSON.stringify([aduProfile, aduOverlay, ADU_MODELS.map((m) => m.id), JURISDICTIONS_VERSION]);
    if (sig !== sigRef.current) {   // rules changed -> drop stale judgments and re-judge against the new rules
      sigRef.current = sig; fitCacheRef.current = new Map(); persistFits();
      layerRef.current?.eachLayer((l) => { const p = l.feature.properties; delete p._fitStatus; delete p._fitColor; l.setStyle(styleFor(l.feature, settingsRef.current)); });
    }
    computeFits();
  }, [aduProfile, aduOverlay, computeFits]);

  // on tap, run the ADU fit pipeline for the selected parcel (fetch footprints/roads -> which models fit)
  useEffect(() => {
    if (selected == null) { setAduFit(null); setAduLoading(false); return; }
    const feat = idToLayer.current[selected]?.feature;
    if (!feat?.geometry) { setAduFit(null); return; }
    let alive = true; setAduFit(null); setAduLoading(true);
    const { profile } = resolveJurisdiction({ city: feat.properties.PARCEL_CITY, county: feat.properties.COUNTY_NAME, fallback: aduProfile });
    computeParcelFit(feat, { models: ADU_MODELS, profile, overlay: aduOverlay })
      .then((r) => { if (alive) setAduFit({ ...r, _key: selected }); })
      .catch((e) => { if (alive) setAduFit({ status: "error", reason: String(e?.message || e), _key: selected }); })
      .finally(() => { if (alive) setAduLoading(false); });
    return () => { alive = false; };
  }, [selected, aduProfile, aduOverlay]);

  // ensure owner/equity data for the tapped parcel (fills the card even if batch enrichment hasn't reached it)
  useEffect(() => {
    if (selected == null) return;
    const key = String(selected), rec = ownerCacheRef.current.get(key);
    if (rec && Date.now() - (rec.fetchedAt || 0) <= OWNER_TTL) return;
    const feat = idToLayer.current[key]?.feature;
    const applyRecord = (r) => {
      ownerCacheRef.current.set(key, r);
      persistOwners();
      setOwnerVer((v) => v + 1);
      const l = idToLayer.current[key];
      if (l && !flagsRef.current[key]) { l.feature.properties._ownerTier = r.tier; l.setStyle(styleFor(l.feature, settingsRef.current)); }
    };
    // Utah County: fetch the county OwnerParcel service (owner + occupancy + value); fall back to LIR fields if not returned
    if (feat && feat.properties.COUNTY_NAME !== "Salt Lake County") {
      let alive = true;
      fetchUtahOwnership([key]).then((raw) => {
        const attrs = raw.get(key);
        if (alive) applyRecord(attrs ? toOwnerRecordUC(attrs) : toOwnerRecordLIR(feat.properties));
      }).catch(() => { if (alive) applyRecord(toOwnerRecordLIR(feat.properties)); });
      return () => { alive = false; };
    }
    let alive = true;
    fetchOwnership([key]).then((raw) => {
      const attrs = raw.get(key);
      if (!alive || !attrs) return;
      applyRecord(toOwnerRecord(attrs));
    }).catch(() => {});
    return () => { alive = false; };
  }, [selected]);

  const flyTo = (center, zoom = 18) => mapRef.current?.flyTo(center, zoom, { duration: 0.6 });

  // open the full-screen 3D lot view for a parcel with a given model (used by the map card AND the Add-a-home tab)
  const openLotView = (key, model, place, label) => {
    const lyr = idToLayer.current[key]; if (!lyr) return;
    const b = lyr.getBounds(), c = b.getCenter();
    const latM = (b.getNorth() - b.getSouth()) * 111320;
    const lngM = (b.getEast() - b.getWest()) * 111320 * Math.cos(c.lat * Math.PI / 180);
    const groundMeters = Math.max(latM, lngM, 12) * 1.8;
    const g = lyr.feature?.geometry;
    const ring = g?.type === "MultiPolygon" ? g.coordinates[0][0] : g?.coordinates?.[0];
    setShow3D({ center: { lat: c.lat, lng: c.lng }, groundMeters, ring, modelUrl: `${import.meta.env.BASE_URL}models/${model.glb}.glb`, dims: { widthFt: model.widthFt, lengthFt: model.lengthFt, heightFt: model.heightFt }, place: place || null, label: label || "Parcel" });
  };

  const record = (key, outcome, props, center) => {
    let toDelete = null, toSave = false;
    setKnocks((prev) => {
      const next = { ...prev };
      if (prev[key]?.outcome === outcome) {
        const keep = prev[key];
        if (keep.name || keep.phone || keep.notes) { next[key] = { ...keep, outcome: null }; toSave = true; }
        else { delete next[key]; toDelete = keep._id; }
      } else {
        const id = prev[key]?._id || crypto.randomUUID();   // client-generated id: stable from creation, no return-value remap
        next[key] = { ...(prev[key] || {}), _id: id, outcome, ts: prev[key]?.ts || Date.now(), addr: props?.PARCEL_ADD, city: props?.PARCEL_CITY, center };
        toSave = true;
      }
      knocksRef.current = next;
      updateFlag(key, next);
      return next;
    });
    if (toSave) { touch(key); persist(key); }
    else if (toDelete) { dirtyRef.current.delete(key); delete verRef.current[key]; deleteCustomer(toDelete).catch((e) => console.error(e)); }
  };

  const updateCustomer = (key, field, value) => {
    setKnocks((prev) => { const next = { ...prev, [key]: { ...(prev[key] || {}), [field]: value } }; knocksRef.current = next; return next; });
    touch(key); schedulePersist(key);
  };

  const setStatus = (key, value) => {
    setKnocks((prev) => {
      const next = { ...prev, [key]: { ...(prev[key] || {}), outcome: value } };
      knocksRef.current = next;
      updateFlag(key, next);
      return next;
    });
    touch(key); persist(key);
  };

  const addCustomer = () => {
    const id = crypto.randomUUID(), key = "cust_" + id;   // key matches the row's future "cust_"+id so reload is stable
    setKnocks((prev) => { const next = { ...prev, [key]: { _id: id, outcome: "lead", ts: Date.now() } }; knocksRef.current = next; return next; });
    touch(key); persist(key);
    setTab("customers");
  };

  const removeCustomer = (key) => {
    const id = knocksRef.current[key]?._id;
    dirtyRef.current.delete(key); delete verRef.current[key];
    setKnocks((prev) => { const next = { ...prev }; delete next[key]; knocksRef.current = next; updateFlag(key, next); return next; });
    if (id) deleteCustomer(id).catch((e) => console.error(e));
  };

  // flag-wrong-lot: a rep overrides the computed verdict for everyone. Tapping the active one clears it.
  const setFlag = (key, verdict) => {
    flagDirtyRef.current.add(key);
    const ver = (flagVerRef.current[key] = (flagVerRef.current[key] || 0) + 1);
    setFlags((prev) => {
      const next = { ...prev };
      const cleared = prev[key] === verdict;
      if (cleared) delete next[key]; else next[key] = verdict;
      flagsRef.current = next;
      const lyr = idToLayer.current[key];
      if (lyr) { lyr.feature.properties._tier = resolveVerdict(key, lyr.feature.properties); lyr.setStyle(styleFor(lyr.feature, settingsRef.current)); setFeatures((fs) => fs.slice()); }
      saveFlag({ org_id: orgIdRef.current, parcel_id: key, verdict: cleared ? null : verdict })
        .then(() => { if (flagVerRef.current[key] === ver) flagDirtyRef.current.delete(key); })
        .catch((e) => console.error("save flag failed", e));
      return next;
    });
  };

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
  const fit = aduFit && aduFit._key === selected ? aduFit : null;   // only trust the fit result if it's for the CURRENT parcel
  const ruleCounty = sel?.COUNTY_NAME || (CITY_PROFILES.find((c) => c.key === settings.aduCity)?.name || "this county");
  const selJuris = sel ? resolveJurisdiction({ city: sel.PARCEL_CITY, county: sel.COUNTY_NAME, fallback: aduProfile }) : null;   // rules for THIS parcel's city
  // header subtitle: name the area from the county most represented in the loaded parcels (not hardcoded)
  const areaLabel = useMemo(() => {
    const counts = {};
    for (const f of features) { const c = f?.properties?.COUNTY_NAME; if (c) counts[c] = (counts[c] || 0) + 1; }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top === "Salt Lake County") return "Salt Lake Valley";
    if (top === "Utah County") return "Utah Valley";
    return top ? top.replace(/ County$/, "") : "Wasatch Front";
  }, [features]);
  const selHouseSqft = sel?.BLDG_SQFT || 0;   // assessor finished area, incl. finished basement
  const selOwner = useMemo(() => {
    void ownerVer;   // re-read the ref when owner data lands (batch enrich or on-demand fetch)
    return selected != null ? freshOwner(ownerCacheRef.current, String(selected)) : null;
  }, [selected, ownerVer]);
  // What the city's %-of-primary cap works out to for THIS home. Denominator: cities whose code counts the basement
  // (capBasement:"included") use total sqft; otherwise prefer the owner record's EXACT above-grade sqft (one floor),
  // falling back to a conservative haircut of total only when above-grade isn't loaded yet.
  const selAboveGrade = selOwner?.aboveGradeSqft || 0;
  const selCapDenom = !selJuris ? 0
    : selJuris.profile.capBasement === "included" ? selHouseSqft
    : selAboveGrade > 0 ? selAboveGrade
    : selHouseSqft * PRIMARY_ABOVEGRADE_FACTOR;
  const selEffCap = selJuris ? aduSizeCap(selJuris.profile, selCapDenom) : null;
  const selEffCapLabel = !selJuris ? ""
    : selEffCap != null ? `~${Math.round(selEffCap).toLocaleString()} sq ft`
    : (selJuris.profile.maxPctOfPrimary > 0 && selCapDenom <= 0) ? "needs home size"
    : "no cap";

  const TABS = [
    { key: "map", label: "Map" },
    { key: "sell", label: "Add a home" },
    { key: "trailer", label: "Trailer" },
    { key: "customers", label: "Customers" },
    { key: "stats", label: "Stats" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <div className="app">
      <div className="ptr" style={{ height: pull }}>
        <span>{refreshing ? "Refreshing…" : pull >= 70 ? "Release to refresh" : "Pull to refresh"}</span>
      </div>
      <header className="top">
        <Logo />
        <div className="title"><b>Yardscout</b><small>{areaLabel}</small></div>
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
            <span><i style={{ background: EQ.hot.color }} />Hot lead</span>
            <span><i style={{ background: EQ.warm.color }} />Warm</span>
            <span><i style={{ background: EQ.cool.color }} />Lower</span>
          </div>
          {!zoomedOut && (
            <div className="ownerctl">
              {ownerPartial && <span className="ownerctl-warn">Some owner data didn’t load</span>}
              <button onClick={refreshOwners} title="Reload owner data for this area">↻ Refresh owners</button>
            </div>
          )}
          {sel && (
            <div className="detail">
              <button className="x" onClick={() => setSelected(null)} aria-label="Close">×</button>
              <div className="daddr">{sel.PARCEL_ADD || "(no address)"}</div>
              <div className="dcity">{titleCase(sel.PARCEL_CITY) || "Unincorporated"}{sel.COUNTY_NAME ? ` · ${sel.COUNTY_NAME}` : ""}</div>
              <button className="ruleshd" onClick={() => setShowRules((v) => !v)} aria-expanded={showRules}>ADU rules · {selJuris?.verified ? titleCase(sel.PARCEL_CITY) : ruleCounty} <span>{showRules ? "▾" : "▸"}</span></button>
              {showRules && selJuris && (
                <div className="rules">
                  <div><span>Min lot</span><b>{selJuris.profile.minLotSqft.toLocaleString()} sq ft</b></div>
                  <div><span>Side setback</span><b>{selJuris.profile.sideFt} ft</b></div>
                  <div><span>Rear setback</span><b>{selJuris.profile.rearFt} ft</b></div>
                  <div><span>Behind house front</span><b>{selJuris.profile.frontBehindFacadeFt} ft</b></div>
                  <div><span>House size</span><b>{selHouseSqft > 0 ? `${selHouseSqft.toLocaleString()} sq ft` : "unknown"}</b></div>
                  <div><span>Max ADU size</span><b>{sizeCapLabel(selJuris.profile)}</b></div>
                  <div><span>Max ADU here</span><b>{selEffCapLabel}</b></div>
                  <div><span>Off the house</span><b>{aduOverlay.houseSeparationFt} ft</b></div>
                  <div><span>Owner-occupied</span><b>Required</b></div>
                  <div><span>Max height</span><b>≤ 20 ft</b></div>
                  <div><span>Parking</span><b>1 space</b></div>
                  <p className="snote">{selJuris.verified
                    ? `${titleCase(sel.PARCEL_CITY)} ADU standards — always verify locally before committing.`
                    : `${ruleCounty} standards${sel?.PARCEL_CITY ? ` — confirm ${titleCase(sel.PARCEL_CITY)}'s local requirements` : ""} before committing.`}</p>
                </div>
              )}
              <div className="readout">
                <div><b>{sel.PARCEL_ACRES}</b><span>acres</span></div>
                <div><b>{(sel.BLDG_SQFT || 0).toLocaleString()}</b><span>house sqft</span></div>
                <div><b>{Math.round((sel.PARCEL_ACRES || 0) * SQFT_PER_ACRE - (sel.BLDG_SQFT || 0)).toLocaleString()}</b><span>open sqft</span></div>
              </div>
              {selOwner && (
                <div className="owner">
                  <div className="ownhd">
                    <span className="eqchip" style={{ background: EQ[selOwner.tier].color }}>{EQ[selOwner.tier].label}</span>
                    <span className={"occ " + selOwner.occupancy}>{selOwner.occupancy === "investor" ? "Investor" : selOwner.occupancy === "owner-occupant" ? "Owner-occupied" : "Owner unknown"}</span>
                  </div>
                  {selOwner.ownerName && <div className="ownname">{ownerDisplay(selOwner.ownerName)}</div>}
                  <div className="ownmeta">
                    <span>{selOwner.tenureYrs == null ? "Move-in date unknown" : selOwner.tenureYrs === 0 ? "Owned under a year" : `Owned ${selOwner.tenureYrs} yr${selOwner.tenureYrs === 1 ? "" : "s"}`}</span>
                    {selOwner.marketValue ? <span>${Math.round(selOwner.marketValue).toLocaleString()}</span> : null}
                  </div>
                  <div className="ownpitch">{selOwner.pitch}</div>
                  <div className="owndisc">Equity estimate from tenure + value, not an actual amount · as of {fmtAsOf(selOwner.fetchedAt)}</div>
                </div>
              )}
              <div className="dlabel">Which units fit</div>
              {(aduLoading || (selected != null && !fit)) && <div className="fitrow muted">Checking the yard…</div>}
              {!aduLoading && fit?.status === "fits" && groupFits(fit.fits).map((g) => (
                <div className="fitrow ok" key={g.key}>
                  <span className="dot" />
                  <span className="fittxt"><b>{ftIn(g.w)} × {ftIn(g.l)}</b> · {Math.round(g.clearanceFt)} ft to spare · {g.method}<small>{g.models.map((m) => m.name.replace(/\s*\(.*\)/, "")).join(", ")}</small></span>
                </div>
              ))}
              {!aduLoading && fit?.status === "not-eligible" && (
                <div className="fitrow no">{fit.reason === "detached_not_allowed"
                  ? `${titleCase(sel.PARCEL_CITY) || ruleCounty} doesn't allow detached ADUs — a backyard unit can't be placed here.`
                  : `Not eligible — lot is ${Math.round(fit.lotSqft).toLocaleString()} sq ft, under the ${(selJuris?.profile.minLotSqft ?? 7000).toLocaleString()} sq ft minimum.`}</div>
              )}
              {!aduLoading && fit?.status === "no-fit" && <div className="fitrow no">{fit.noFitReason === "over_size_cap" ? "A unit fits the yard, but every model is over this city’s ADU size limit for this home." : "No unit fits this yard after setbacks."}</div>}
              {!aduLoading && fit?.status === "needs-check" && (
                <div className="fitrow warn">Needs a look — {NEEDS_CHECK_LABEL[fit.reason] || fit.reason}.</div>
              )}
              {!aduLoading && fit?.status === "error" && <div className="fitrow warn">Couldn’t check this lot right now.</div>}
              <div className="disclaim">Estimate from county data — verify on site before committing.</div>
              <button className="lot3d" onClick={() => openLotView(sel._key, fit?.best?.model || ADU_MODELS[0], fit?.best?.place, sel.PARCEL_ADD || "Parcel")}>View on the lot in 3D</button>
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

        {tab === "sell" && (
          <section className="panel padded">
            <div className="swrap sell">
              <div className="phd">Add a home to the backyard</div>
              {sel ? (
                <div className="sellcard">
                  <div className="sellhd">For {sel.PARCEL_ADD || "this home"}</div>
                  {fit?.status === "fits" ? (
                    <>
                      <p className="sellp">A backyard home fits here:</p>
                      {groupFits(fit.fits).map((g) => (
                        <div className="fitrow ok" key={g.key}>
                          <span className="dot" />
                          <span className="fittxt"><b>{ftIn(g.w)} × {ftIn(g.l)}</b> · {g.models[0].beds} bed / {g.models[0].baths} bath<small>{g.models.map((m) => m.name.replace(/\s*\(.*\)/, "")).join(", ")}</small></span>
                        </div>
                      ))}
                      <button className="lot3d" onClick={() => openLotView(sel._key, fit.best.model, fit.best.place, sel.PARCEL_ADD || "Parcel")}>See it in your yard</button>
                      {fit.best?.model?.floorPlan && <button className="ghostbtn full" onClick={() => setFloorPlan(fit.best.model)}>View floor plan</button>}
                    </>
                  ) : (
                    <p className="sellp muted">Check this home on the Map tab to see what fits the backyard.</p>
                  )}
                </div>
              ) : (
                <div className="sellcard"><p className="sellp muted">Pick a home on the Map to show what fits their yard.</p></div>
              )}

              <div className="phd">Why add one</div>
              <ul className="selllist">
                <li><b>Extra income.</b> Rent it out — most of the time the rent more than covers the loan payment, so it pays for itself.</li>
                <li><b>Room for family.</b> Aging parents, adult kids, or a guest suite.</li>
                <li><b>Adds value.</b> A second dwelling raises what the property is worth.</li>
                <li><b>Flexible space.</b> Home office, studio, or short-term rental.</li>
              </ul>

              <div className="phd">How to pay for it</div>
              <p className="sellp"><b>Most of the time the rent covers the payment</b> — the tenant effectively pays it off for you.</p>
              <ul className="selllist">
                <li><b>Home equity / HELOC.</b> Borrow against the equity already built up.</li>
                <li><b>Construction or conventional loan.</b></li>
                <li><b>Retirement or investment account.</b></li>
                <li><b>Cash or family financing.</b></li>
              </ul>

              <div className="phd">How it works</div>
              <ol className="sellsteps">
                <li>Pick a model</li>
                <li>Permit &amp; site prep</li>
                <li>Foundation set</li>
                <li>Home delivered &amp; placed</li>
                <li>Utilities hooked up</li>
                <li>Move in or rent it out</li>
              </ol>
              <p className="snote">A manufactured home goes in far faster than a site-built addition.</p>

              <div className="phd">The homes</div>
              <button className="ghostbtn full" onClick={() => setTab("trailer")}>Browse models &amp; floor plans</button>
            </div>
          </section>
        )}

        {tab === "trailer" && (
          <section className="panel padded">
            <div className="swrap">
              <div className="phd">Your units</div>
              {ADU_MODELS.map((m) => {
                const glb = `${import.meta.env.BASE_URL}models/${m.glb}.glb`;
                const usdz = `${import.meta.env.BASE_URL}models/${m.usdz}.usdz`;
                const scene = `https://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(new URL(glb, window.location.href).href)}&mode=ar_preferred`;
                const open = openModel === m.id;
                return (
                  <div className={"unitrow" + (open ? " open" : "")} key={m.id}>
                    <button className="unitrow-hd" onClick={() => setOpenModel(open ? null : m.id)} aria-expanded={open}>
                      <span className="unitrow-main">
                        <b>{m.name}</b>
                        <small>{ftIn(m.widthFt)} × {ftIn(m.lengthFt)} · {m.beds} bd / {m.baths} ba · {Math.round(m.widthFt * m.lengthFt).toLocaleString()} sq ft</small>
                      </span>
                      <span className="unitrow-chev">{open ? "▾" : "▸"}</span>
                    </button>
                    {open && (
                      <div className="unitrow-body">
                        {arReady ? (
                          <model-viewer src={glb}
                            {...{ "camera-controls": "", "auto-rotate": "", "touch-action": "pan-y", "shadow-intensity": "1", exposure: "0.95", "interaction-prompt": "none", "camera-orbit": "-55deg 75deg auto", "min-camera-orbit": "auto 0deg auto", "max-camera-orbit": "auto 90deg auto" }}
                            style={{ width: "100%", height: "280px", background: "#eef1f0", borderRadius: "14px" }}>
                          </model-viewer>
                        ) : (
                          <div className="mvload" style={{ height: "280px" }}><div className="spin" /></div>
                        )}
                        {IS_IOS ? (
                          <a className="ar-anchor" style={{ marginTop: "12px" }} rel="ar" href={usdz}><img src={`${import.meta.env.BASE_URL}ar-poster.png`} alt="View in your yard" /></a>
                        ) : IS_ANDROID ? (
                          <a className="ar-cta" style={{ marginTop: "12px" }} href={scene}>View in your yard</a>
                        ) : (
                          <div className="arnote">Spin the 3D model on a computer. To place it in a real yard with the camera, open Yardscout on your phone.</div>
                        )}
                        {m.floorPlan && <button className="ghostbtn full" style={{ marginTop: "10px" }} onClick={() => setFloorPlan(m)}>View floor plan</button>}
                      </div>
                    )}
                  </div>
                );
              })}
              <p className="snote">Tap a unit to see it in 3D and open its floor plan.</p>
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
              <div className="phd">ADU placement rules</div>
              <label className="selrow"><span>City / jurisdiction</span>
                <select value={settings.aduCity} onChange={(e) => setCity(e.target.value)}>
                  {CITY_PROFILES.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                </select>
              </label>
              <label className="selrow"><span>Min lot size</span>
                <select value={settings.minLotSqft} onChange={(e) => setSetting("minLotSqft", Number(e.target.value))}>
                  {RULE_OPTIONS.minLotSqft.map((v) => <option key={v} value={v}>{v.toLocaleString()} sq ft</option>)}
                </select>
              </label>
              <label className="selrow"><span>Side setback</span>
                <select value={settings.sideFt} onChange={(e) => setSetting("sideFt", Number(e.target.value))}>
                  {RULE_OPTIONS.sideFt.map((v) => <option key={v} value={v}>{v} ft</option>)}
                </select>
              </label>
              <label className="selrow"><span>Rear setback</span>
                <select value={settings.rearFt} onChange={(e) => setSetting("rearFt", Number(e.target.value))}>
                  {RULE_OPTIONS.rearFt.map((v) => <option key={v} value={v}>{v} ft</option>)}
                </select>
              </label>
              <label className="selrow"><span>Behind house front</span>
                <select value={settings.frontBehindFacadeFt} onChange={(e) => setSetting("frontBehindFacadeFt", Number(e.target.value))}>
                  {RULE_OPTIONS.frontBehindFacadeFt.map((v) => <option key={v} value={v}>{v} ft</option>)}
                </select>
              </label>
              <label className="selrow"><span>Max ADU vs. home</span>
                <select value={settings.maxPctOfPrimary} onChange={(e) => setSetting("maxPctOfPrimary", Number(e.target.value))}>
                  {RULE_OPTIONS.maxPctOfPrimary.map((v) => <option key={v} value={v}>{v ? `${v}% of home` : "No cap"}</option>)}
                </select>
              </label>
              <label className="selrow"><span>Max ADU size</span>
                <select value={settings.maxAduSqft} onChange={(e) => setSetting("maxAduSqft", Number(e.target.value))}>
                  {RULE_OPTIONS.maxAduSqft.map((v) => <option key={v} value={v}>{v ? `${v.toLocaleString()} sq ft` : "No cap"}</option>)}
                </select>
              </label>
              <p className="snote">Loaded from the selected city (from county code — verify locally; state ADU rules are changing). Kearns/unincorporated SLCo has no size cap; SLC caps at 50% of the home, others vary.</p>
              <label className="selrow"><span>Distance from house</span>
                <select value={settings.houseSeparationFt} onChange={(e) => setSetting("houseSeparationFt", Number(e.target.value))}>
                  {RULE_OPTIONS.houseSeparationFt.map((v) => <option key={v} value={v}>{v} ft</option>)}
                </select>
              </label>
              <label className="selrow"><span>Back-in vs. crane</span>
                <select value={settings.backinMinSideGapFt} onChange={(e) => setSetting("backinMinSideGapFt", Number(e.target.value))}>
                  {RULE_OPTIONS.backinMinSideGapFt.map((v) => <option key={v} value={v}>{v} ft side yard</option>)}
                </select>
              </label>
              <p className="snote">Your own placement practice, not code (the legal minimum off the house is 6 ft).</p>

              <div className="phd">Map</div>
              <div className="seg3">
                <button className={settings.mapStyle === "satellite" ? "on" : ""} onClick={() => setSetting("mapStyle", "satellite")}>Satellite</button>
                <button className={settings.mapStyle === "streets" ? "on" : ""} onClick={() => setSetting("mapStyle", "streets")}>Streets</button>
              </div>
              <button className="ghostbtn full" onClick={setHome}>Set current map view as “home”</button>

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
        <Parcel3D center={show3D.center} groundMeters={show3D.groundMeters} ring={show3D.ring} modelUrl={show3D.modelUrl} dims={show3D.dims} place={show3D.place} label={show3D.label} onClose={() => setShow3D(null)} />
      )}

      {floorPlan && (() => {
        const url = `${import.meta.env.BASE_URL}${floorPlan.floorPlan}`;
        return (
          <div className="fpv">
            <div className="fpv-bar">
              <b>{floorPlan.name} floor plan</b>
              <div className="fpv-actions">
                <button className="fpv-share" onClick={() => sharePdf(url, `yardscout-${floorPlan.id}-floorplan.pdf`, `${floorPlan.name} floor plan`)}>Share</button>
                <a className="fpv-open" href={url} target="_blank" rel="noreferrer">Open</a>
                <button className="fpv-close" onClick={() => setFloorPlan(null)} aria-label="Close">×</button>
              </div>
            </div>
            <object className="fpv-doc" data={url} type="application/pdf">
              <div className="fpv-fallback">Can’t preview here. <a href={url} target="_blank" rel="noreferrer">Open the floor plan</a>.</div>
            </object>
          </div>
        );
      })()}

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
