import { useEffect, useRef } from "react";

// Web-Mercator (EPSG:3857) bbox covering `realHalf` meters around a lat/lng.
function mercatorBbox(lat, lng, realHalf) {
  const R = 6378137;
  const x = (R * lng * Math.PI) / 180;
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const mh = realHalf / Math.cos((lat * Math.PI) / 180); // 3857 units stretch by 1/cos(lat)
  return [x - mh, y - mh, x + mh, y + mh];
}
function esriExport(bbox, size) {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bbox.join(",")}&bboxSR=3857&imageSR=3857&size=${size},${size}&format=jpg&f=image`;
}

// Full-screen per-parcel 3D scene: the trailer at real scale on that lot's satellite ground.
export default function Parcel3D({ center, groundMeters, ring, modelUrl, label, onClose }) {
  const mountRef = useRef(null);
  const modelRef = useRef(null);
  const rotate = (dir) => { const m = modelRef.current; if (m) m.rotation.y += dir * Math.PI / 12; }; // 15° per tap

  useEffect(() => {
    let cleanup = () => {};
    let cancelled = false;
    (async () => {
      const THREE = await import("three");
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
      const { Line2 } = await import("three/addons/lines/Line2.js");
      const { LineGeometry } = await import("three/addons/lines/LineGeometry.js");
      const { LineMaterial } = await import("three/addons/lines/LineMaterial.js");
      if (cancelled) return;
      const mount = mountRef.current;
      if (!mount) return;
      const W = mount.clientWidth, H = mount.clientHeight;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0e1116);
      const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 5000);
      camera.position.set(groundMeters * 0.45, groundMeters * 0.55, groundMeters * 0.7);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(W, H);
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      mount.appendChild(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6472, 1.0));
      const sun = new THREE.DirectionalLight(0xffffff, 2.4);
      sun.position.set(groundMeters * 0.4, groundMeters * 1.0, groundMeters * 0.25);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const d = groundMeters;
      sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
      sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
      sun.shadow.camera.near = 0.5; sun.shadow.camera.far = d * 5;
      scene.add(sun);

      // satellite ground
      const bbox = mercatorBbox(center.lat, center.lng, groundMeters / 2);
      const tex = await new Promise((res) => {
        new THREE.TextureLoader().setCrossOrigin("anonymous").load(esriExport(bbox, 1024), res, undefined, () => res(null));
      });
      if (tex) tex.colorSpace = THREE.SRGBColorSpace;
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(groundMeters, groundMeters),
        new THREE.MeshStandardMaterial({ map: tex || null, color: tex ? 0xffffff : 0x6f7d57, roughness: 1 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);

      // property lines: the parcel boundary drawn on the ground (lat/lng -> local meters; +X east, -Z north)
      let lineMat = null;
      if (ring && ring.length >= 3) {
        const mPerLat = 111320, mPerLng = 111320 * Math.cos((center.lat * Math.PI) / 180);
        const pos = [];
        for (const [lng, lat] of ring) pos.push((lng - center.lng) * mPerLng, 0.3, -((lat - center.lat) * mPerLat));
        const [lng0, lat0] = ring[0]; // ensure the loop closes
        pos.push((lng0 - center.lng) * mPerLng, 0.3, -((lat0 - center.lat) * mPerLat));
        const geo = new LineGeometry(); geo.setPositions(pos);
        // depthTest ON so the trailer (a solid, closer mesh) occludes the line instead of it cutting through
        lineMat = new LineMaterial({ color: 0xffe14d, linewidth: 3, worldUnits: false, depthTest: true });
        lineMat.resolution.set(W, H);
        scene.add(new Line2(geo, lineMat));
      }

      // trailer (real-scale GLB, bottom at y=0). Start off-center so it isn't dropped on the house.
      let model = null;
      try {
        const gltf = await new GLTFLoader().loadAsync(modelUrl);
        if (cancelled) return;
        gltf.scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        gltf.scene.position.z = groundMeters * 0.18;
        scene.add(gltf.scene);
        model = gltf.scene;
        modelRef.current = model;
      } catch { /* model fails -> still show ground */ }

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 1.5, 0);
      controls.enableDamping = true;
      controls.maxPolarAngle = Math.PI * 0.495; // can't go under the ground
      controls.minDistance = 3;
      controls.maxDistance = groundMeters * 3;

      // gestures: 1 finger on trailer = move it; 2 fingers twisting = rotate it; 1 finger on map = orbit camera.
      const ray = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const gp = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hitPt = new THREE.Vector3();
      const half = groundMeters / 2;
      const pointers = new Map(); // pointerId -> {x,y}
      let mode = null;            // 'drag' | 'twist' | null (null = let OrbitControls handle it)
      let lastAngle = 0;
      const setNdc = (e) => {
        const r = renderer.domElement.getBoundingClientRect();
        ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      };
      const twoFingerAngle = () => {
        const [a, b] = [...pointers.values()];
        return Math.atan2(b.y - a.y, b.x - a.x);
      };
      const hitsModel = (px, py) => {
        if (!model) return false;
        const r = renderer.domElement.getBoundingClientRect();
        ndc.x = ((px - r.left) / r.width) * 2 - 1;
        ndc.y = -((py - r.top) / r.height) * 2 + 1;
        ray.setFromCamera(ndc, camera);
        return ray.intersectObject(model, true).length > 0;
      };
      const onDown = (e) => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
          const pts = [...pointers.values()];
          if (hitsModel(pts[0].x, pts[0].y) || hitsModel(pts[1].x, pts[1].y)) {
            mode = "twist"; controls.enabled = false; lastAngle = twoFingerAngle(); // two fingers on trailer -> rotate
          } else { mode = null; controls.enabled = true; } // two fingers on map -> OrbitControls pinch-zoom
        } else if (pointers.size === 1) {
          if (hitsModel(e.clientX, e.clientY)) { mode = "drag"; controls.enabled = false; } // one finger on trailer -> move
          else { mode = null; controls.enabled = true; } // one finger on map -> orbit
        }
      };
      const onMove = (e) => {
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (mode === "twist" && pointers.size >= 2 && model) {
          const a = twoFingerAngle();
          model.rotation.y -= a - lastAngle;
          lastAngle = a;
        } else if (mode === "drag" && model) {
          setNdc(e); ray.setFromCamera(ndc, camera);
          if (ray.ray.intersectPlane(gp, hitPt)) {
            model.position.x = Math.max(-half, Math.min(half, hitPt.x));
            model.position.z = Math.max(-half, Math.min(half, hitPt.z));
          }
        }
      };
      const onUp = (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2 && mode === "twist") mode = null;
        if (pointers.size === 0) mode = null;
        if (mode === null) controls.enabled = true;
      };
      const el = renderer.domElement;
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);

      const onResize = () => {
        const w = mount.clientWidth, h = mount.clientHeight;
        camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
        if (lineMat) lineMat.resolution.set(w, h);
      };
      window.addEventListener("resize", onResize);

      let raf;
      const loop = () => { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
      loop();

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        controls.dispose();
        renderer.dispose();
        modelRef.current = null;
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      };
    })();
    return () => { cancelled = true; cleanup(); };
  }, [center, groundMeters, modelUrl, ring]);

  return (
    <div className="p3d">
      <div className="p3d-canvas" ref={mountRef} />
      <button className="p3d-close" onClick={onClose} aria-label="Close">×</button>
      <div className="p3d-rotate">
        <button onClick={() => rotate(-1)} aria-label="Rotate left">⟲</button>
        <button onClick={() => rotate(1)} aria-label="Rotate right">⟳</button>
      </div>
      <div className="p3d-label">{label}<small>Yellow = property line · drag the trailer to place it · ⟲ ⟳ to rotate · drag empty space to orbit · pinch to zoom</small></div>
    </div>
  );
}
