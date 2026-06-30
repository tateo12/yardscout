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

      // trailer (real-scale GLB, bottom at y=0)
      try {
        const gltf = await new GLTFLoader().loadAsync(modelUrl);
        if (cancelled) return;
        gltf.scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        scene.add(gltf.scene);
      } catch { /* model fails -> still show ground */ }

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 1.5, 0);
      controls.enableDamping = true;
      controls.maxPolarAngle = Math.PI * 0.495; // can't go under the ground
      controls.minDistance = 3;
      controls.maxDistance = groundMeters * 3;

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
        controls.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      };
    })();
    return () => { cancelled = true; cleanup(); };
  }, [center, groundMeters, modelUrl]);

  return (
    <div className="p3d">
      <div className="p3d-canvas" ref={mountRef} />
      <button className="p3d-close" onClick={onClose} aria-label="Close">×</button>
      <div className="p3d-label">{label}<small>Drag to orbit · pinch/scroll to zoom · two-finger drag to tilt</small></div>
    </div>
  );
}
