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
export default function Parcel3D({ center, groundMeters, modelUrl, label, onClose }) {
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

      // drag the trailer across the lot (grab the model = move it; drag empty space = orbit)
      const ray = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const gp = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hitPt = new THREE.Vector3();
      const half = groundMeters / 2;
      let dragging = false;
      const setNdc = (e) => {
        const r = renderer.domElement.getBoundingClientRect();
        ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      };
      const onDown = (e) => {
        if (!model) return;
        setNdc(e); ray.setFromCamera(ndc, camera);
        if (ray.intersectObject(model, true).length) { dragging = true; controls.enabled = false; }
      };
      const onMove = (e) => {
        if (!dragging || !model) return;
        setNdc(e); ray.setFromCamera(ndc, camera);
        if (ray.ray.intersectPlane(gp, hitPt)) {
          model.position.x = Math.max(-half, Math.min(half, hitPt.x));
          model.position.z = Math.max(-half, Math.min(half, hitPt.z));
        }
      };
      const onUp = () => { dragging = false; controls.enabled = true; };
      const el = renderer.domElement;
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);

      const onResize = () => {
        const w = mount.clientWidth, h = mount.clientHeight;
        camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
      };
      window.addEventListener("resize", onResize);

      let raf;
      const loop = () => { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
      loop();

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        window.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        controls.dispose();
        renderer.dispose();
        modelRef.current = null;
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      };
    })();
    return () => { cancelled = true; cleanup(); };
  }, [center, groundMeters, modelUrl]);

  return (
    <div className="p3d">
      <div className="p3d-canvas" ref={mountRef} />
      <button className="p3d-close" onClick={onClose} aria-label="Close">×</button>
      <div className="p3d-rotate">
        <button onClick={() => rotate(-1)} aria-label="Rotate left">⟲</button>
        <button onClick={() => rotate(1)} aria-label="Rotate right">⟳</button>
      </div>
      <div className="p3d-label">{label}<small>Drag the trailer to place it · ⟲ ⟳ to rotate · drag empty space to orbit · pinch to zoom</small></div>
    </div>
  );
}
