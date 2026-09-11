import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { useSimStore } from '@/app/store';
import { getCaseModels } from '@/app/caseModels';
import { ribCenterY, ribDepth, ribRadiusAt, skinZ, type ThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { heartGhostPrimitives, heartToTorso, heartDirToTorso, type HeartModel } from '@/simulator/anatomy/heartModel';
import { beamFrameFromPose, poseFromControl, type BeamFrame } from '@/simulator/probe/pose';
import { RotationDial } from './RotationDial';

/**
 * 3D torso + probe trainer (spec 4.3, 58, 76). Clean clinical torso: wrap-around superellipse chest
 * with a translucent skin over a full rib cage (both sides), sternum, clavicles, a translucent heart
 * ghost and the imaging plane fan; a phased-array transducer with a pickable index marker.
 * Mouse: drag skin = slide · drag the blue marker or wheel = rotate · Shift+drag = rock ·
 * Alt+drag = tilt · right-drag = orbit · Ctrl/⌘+wheel = zoom. Never teleports to a view.
 */
export function TorsoView() {
  const ref = useRef<HTMLDivElement>(null);
  const caseId = useSimStore((s) => s.caseId);
  const patient = useSimStore((s) => s.patient);
  const showSkeleton = useSimStore((s) => s.ui.showSkeleton);
  const setUi = useSimStore((s) => s.setUi);
  const zoomRef = useRef<{ zoomBy: (f: number) => void; center: () => void } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { thorax, heart } = getCaseModels(caseId, patient);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x0f1319);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 1, 300);
    scene.add(new THREE.HemisphereLight(0xe8eef5, 0x1a1f28, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(-12, 25, 40);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fc0ff, 0.5);
    fill.position.set(20, -10, 30);
    scene.add(fill);

    // ---- body ----
    const skin = buildSkin(thorax);
    scene.add(skin);
    const skeleton = buildSkeleton(thorax);
    scene.add(skeleton);
    scene.add(buildHeartGhost(heart));

    // ---- probe ----
    const { probe, marker } = buildProbe();
    scene.add(probe);
    const fanMat = new THREE.MeshBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false });
    const fan = new THREE.Mesh(new THREE.BufferGeometry(), fanMat);
    scene.add(fan);
    const fanEdges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.6 }));
    scene.add(fanEdges);

    // ---- camera / interaction ----
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const orbit = { az: 0.12, el: 0.08, r: 54, tx: 2, ty: -1.5, tz: -6 };
    const updateCamera = () => {
      camera.position.set(orbit.tx + orbit.r * Math.sin(orbit.az) * Math.cos(orbit.el), orbit.ty + orbit.r * Math.sin(orbit.el), orbit.tz + orbit.r * Math.cos(orbit.az) * Math.cos(orbit.el));
      camera.lookAt(orbit.tx, orbit.ty, orbit.tz);
    };
    updateCamera();
    zoomRef.current = {
      zoomBy: (f) => {
        orbit.r = Math.max(22, Math.min(90, orbit.r * f));
        updateCamera();
      },
      center: () => {
        const p = poseFromControl(thorax, useSimStore.getState().probe).position;
        orbit.tx = p.x;
        orbit.ty = p.y;
        orbit.tz = p.z - 5;
        orbit.r = 30;
        updateCamera();
      },
    };
    let drag: { mode: 'slide' | 'rock' | 'tilt' | 'orbit' | 'rotate' | null; x: number; y: number; cx: number; cy: number } = { mode: null, x: 0, y: 0, cx: 0, cy: 0 };
    const toNdc = (e: MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      return r;
    };
    const pickSkin = (e: MouseEvent): { u: number; v: number } | null => {
      toNdc(e);
      raycaster.setFromCamera(mouse, camera);
      const hit = raycaster.intersectObject(skin, false)[0];
      if (!hit) return null;
      // only the anterior surface is a valid probe location (the model's skin function covers it)
      if (hit.point.z < skinZ(thorax, hit.point.x, hit.point.y) - 3.5) return null;
      return { u: hit.point.x, v: hit.point.y };
    };
    const probeScreenCenter = (r: DOMRect) => {
      const p = poseFromControl(thorax, useSimStore.getState().probe).position;
      const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
    const onDown = (e: MouseEvent) => {
      e.preventDefault();
      const r = toNdc(e);
      if (e.button === 2) {
        drag = { mode: 'orbit', x: e.clientX, y: e.clientY, cx: 0, cy: 0 };
        return;
      }
      raycaster.setFromCamera(mouse, camera);
      if (raycaster.intersectObject(marker, true).length > 0) {
        const c = probeScreenCenter(r);
        drag = { mode: 'rotate', x: e.clientX, y: e.clientY, cx: c.x, cy: c.y };
        return;
      }
      if (e.shiftKey) drag = { mode: 'rock', x: e.clientX, y: e.clientY, cx: 0, cy: 0 };
      else if (e.altKey) drag = { mode: 'tilt', x: e.clientX, y: e.clientY, cx: 0, cy: 0 };
      else {
        drag = { mode: 'slide', x: e.clientX, y: e.clientY, cx: 0, cy: 0 };
        const p = pickSkin(e);
        if (p) useSimStore.getState().setProbe({ u: p.u, v: p.v });
      }
    };
    const onMove = (e: MouseEvent) => {
      if (!drag.mode) return;
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (drag.mode === 'slide') {
        const p = pickSkin(e);
        if (p) useSimStore.getState().setProbe({ u: p.u, v: p.v });
      } else if (drag.mode === 'rotate') {
        // angle swept around the probe's screen position: clockwise on screen = positive rotation
        const ax = drag.x - drag.cx,
          ay = drag.y - drag.cy,
          bx = e.clientX - drag.cx,
          by = e.clientY - drag.cy;
        const cross = ax * by - ay * bx,
          dot = ax * bx + ay * by;
        const dth = (Math.atan2(cross, dot) * 180) / Math.PI;
        if (Number.isFinite(dth)) useSimStore.getState().nudgeProbe({ rotationDeg: dth });
        drag = { ...drag, x: e.clientX, y: e.clientY };
      } else if (drag.mode === 'rock') {
        useSimStore.getState().nudgeProbe({ rockDeg: dx * 0.3 });
        drag = { ...drag, x: e.clientX, y: e.clientY };
      } else if (drag.mode === 'tilt') {
        useSimStore.getState().nudgeProbe({ tiltDeg: -dy * 0.3 });
        drag = { ...drag, x: e.clientX, y: e.clientY };
      } else if (drag.mode === 'orbit') {
        orbit.az += dx * 0.006;
        orbit.el = Math.max(-0.7, Math.min(0.9, orbit.el - dy * 0.006));
        updateCamera();
        drag = { ...drag, x: e.clientX, y: e.clientY };
      }
    };
    const onUp = () => {
      drag = { mode: null, x: 0, y: 0, cx: 0, cy: 0 };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomRef.current?.zoomBy(e.deltaY > 0 ? 1.1 : 0.9);
        return;
      }
      useSimStore.getState().nudgeProbe({ rotationDeg: Math.sign(e.deltaY) * (e.shiftKey ? 10 : 3) });
    };
    const dom = renderer.domElement;
    dom.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    dom.addEventListener('wheel', onWheel, { passive: false });
    const noCtx = (e: Event) => e.preventDefault();
    dom.addEventListener('contextmenu', noCtx);

    const resize = () => {
      const w = el.clientWidth || 300,
        h = el.clientHeight || 300;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const st = useSimStore.getState();
      const pose = poseFromControl(thorax, st.probe);
      const beam = beamFrameFromPose(pose);
      probe.position.set(pose.position.x, pose.position.y, pose.position.z);
      const m = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(beam.lateral.x, beam.lateral.y, beam.lateral.z),
        new THREE.Vector3(beam.normal.x, beam.normal.y, beam.normal.z),
        new THREE.Vector3(beam.forward.x, beam.forward.y, beam.forward.z),
      );
      probe.quaternion.setFromRotationMatrix(m);
      updateFan(fan, fanEdges, beam, st.settings.depthCm, st.settings.sectorDeg);
      skeleton.visible = st.ui.showSkeleton;
      (skin.material as THREE.MeshStandardMaterial).opacity = st.ui.showSkeleton ? 0.55 : 0.92;
      renderer.render(scene, camera);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      dom.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('contextmenu', noCtx);
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [caseId, patient]);

  return (
    <div className="torso-wrap" ref={ref} aria-label="Torso 3D y sonda virtual">
      <div className="torso-tools">
        <RotationDial />
        <div className="torso-buttons">
          <button onClick={() => zoomRef.current?.zoomBy(0.85)} title="Acercar (Ctrl/⌘ + rueda)" aria-label="Acercar">
            +
          </button>
          <button onClick={() => zoomRef.current?.zoomBy(1.18)} title="Alejar" aria-label="Alejar">
            −
          </button>
          <button onClick={() => zoomRef.current?.center()} title="Centrar la cámara en la sonda">
            Sonda
          </button>
          <button className={showSkeleton ? 'active' : ''} onClick={() => setUi({ showSkeleton: !showSkeleton })} title="Mostrar/ocultar costillas y esternón bajo la piel">
            Hueso
          </button>
        </div>
      </div>
      <div className="torso-help">Arrastrar piel: deslizar · Arrastrar marcador azul o rueda: rotar · Shift+arrastrar: rock · Alt+arrastrar: tilt · Botón derecho: orbitar</div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// geometry builders
// ------------------------------------------------------------------------------------------------

/** Superellipse cross-section point at angle θ (0 = front centre), scaled inward by `inset` cm. */
function crossSection(t: ThoraxModel, theta: number, y: number, inset: number): { x: number; z: number } {
  const n = t.n;
  const aw = t.aw - inset;
  const b = t.bDepth - inset;
  const s = Math.sin(theta),
    c = Math.cos(theta);
  const x = aw * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
  let z = -t.bDepth + b * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
  if (y > 8) z -= 0.12 * (y - 8) * (y - 8);
  if (y < -8) z -= 0.18 * (-8 - y);
  return { x, z };
}

function buildSkin(t: ThoraxModel): THREE.Mesh {
  const nT = 64,
    nY = 44;
  const thMax = 1.45; // ~83° each side: anterior and lateral chest
  const ys = -16,
    ye = 13;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nY; j++) {
    const y = ys + ((ye - ys) * j) / nY;
    const taper = 1 - 0.06 * Math.max(0, (-y - 6) / 10) - 0.03 * Math.max(0, (y - 9) / 4); // waist / shoulder slope (cosmetic)
    for (let i = 0; i <= nT; i++) {
      const th = -thMax + (2 * thMax * i) / nT;
      const p = crossSection(t, th, y, 0);
      pos.push(p.x * taper, y, p.z);
    }
  }
  for (let j = 0; j < nY; j++)
    for (let i = 0; i < nT; i++) {
      const a = j * (nT + 1) + i;
      idx.push(a, a + 1, a + nT + 1, a + 1, a + nT + 2, a + nT + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xd9b59a, roughness: 0.75, metalness: 0.02, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 2;
  // neck + shoulders (cosmetic landmarks: suprasternal notch sits between them)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 6.2, 9, 24), new THREE.MeshStandardMaterial({ color: 0xd9b59a, roughness: 0.8 }));
  neck.position.set(0, 16.5, -t.bDepth * 0.55);
  mesh.add(neck);
  for (const side of [-1, 1]) {
    const sh = new THREE.Mesh(new THREE.SphereGeometry(5.5, 24, 16), new THREE.MeshStandardMaterial({ color: 0xd9b59a, roughness: 0.8 }));
    sh.scale.set(1.35, 0.85, 1);
    sh.position.set(side * (t.aw + 1.5), 10.5, -t.bDepth * 0.6);
    mesh.add(sh);
  }
  return mesh;
}

function buildSkeleton(t: ThoraxModel): THREE.Group {
  const g = new THREE.Group();
  const bone = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.55 });
  const cartilage = new THREE.MeshStandardMaterial({ color: 0xcfd9e6, roughness: 0.5, transparent: true, opacity: 0.85 });
  const depth = ribDepth(t);
  const thMax = 1.4;
  // ribs 1–10, both sides; ribs run posterior-superior to anterior-inferior; 8–10 stop short of the sternum
  for (let k = 1; k <= 10; k++) {
    for (const side of [-1, 1]) {
      const yFront = ribCenterY(t, k, 1.8);
      const xEnd = k <= 7 ? 1.8 : 3.2 + (k - 7) * 1.4; // anterior end (sternum or costal margin)
      const pts: THREE.Vector3[] = [];
      const cart: THREE.Vector3[] = [];
      for (let i = 0; i <= 40; i++) {
        const th = (thMax * i) / 40;
        const p = crossSection(t, side * th, yFront, depth);
        if (Math.abs(p.x) < xEnd) continue;
        const y = yFront + 3.8 * Math.pow(th / thMax, 1.3);
        const v = new THREE.Vector3(p.x, y, p.z);
        pts.push(v);
        if (Math.abs(p.x) < 5.5 && k <= 7) cart.push(v);
      }
      if (pts.length < 3) continue;
      const r = ribRadiusAt(t, 5) * 0.9;
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, r, 8, false), k <= 7 && cart.length >= 3 ? bone : bone));
      if (cart.length >= 3) g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cart), 12, r * 1.05, 8, false), cartilage));
    }
  }
  // sternum: manubrium, body, xiphoid
  const sz = (y: number) => skinZ(t, 0, y) - t.chestWall * 0.3 - 0.45;
  const manubrium = new THREE.Mesh(new RoundedBoxGeometry(5.0, 4.4, 0.9, 3, 0.4), bone);
  manubrium.position.set(0, 8.4, sz(8.4));
  const body = new THREE.Mesh(new RoundedBoxGeometry(3.0, 10.4, 0.8, 3, 0.4), bone);
  body.position.set(0, 1.2, sz(1.2));
  const xiphoid = new THREE.Mesh(new RoundedBoxGeometry(1.5, 2.6, 0.5, 3, 0.3), cartilage);
  xiphoid.position.set(0, -5.3, sz(-5.3));
  g.add(manubrium, body, xiphoid);
  // clavicles
  for (const side of [-1, 1]) {
    const pts = [new THREE.Vector3(side * 1.9, 10.6, sz(10.6) + 0.6), new THREE.Vector3(side * 7, 11.6, sz(10.6) - 0.6), new THREE.Vector3(side * 13.5, 12.4, sz(10.6) - 3.6)];
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.45, 8, false), bone));
  }
  return g;
}

function buildHeartGhost(heart: HeartModel): THREE.Group {
  const g = new THREE.Group();
  const f = heart.frame;
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(f.ex.x, f.ex.y, f.ex.z), new THREE.Vector3(f.ey.x, f.ey.y, f.ey.z), new THREE.Vector3(f.ez.x, f.ez.y, f.ez.z));
  for (const p of heartGhostPrimitives(heart)) {
    const mat = new THREE.MeshStandardMaterial({ color: p.color, transparent: true, opacity: p.opacity, roughness: 0.6, depthWrite: false });
    if (p.kind === 'ellipsoid') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
      const c = heartToTorso(f, p.center);
      m.position.set(c.x, c.y, c.z);
      m.quaternion.setFromRotationMatrix(basis);
      m.scale.set(p.radii.x, p.radii.y, p.radii.z);
      g.add(m);
    } else if (p.end) {
      const a = heartToTorso(f, p.center),
        b = heartToTorso(f, p.end);
      const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
      const len = dir.length();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(p.radii.x, p.radii.x * 0.9, len, 16), mat);
      m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      g.add(m);
    }
  }
  // LV long axis hint
  const apex = heartToTorso(f, { x: 0, y: 0, z: heart.lv.lengthCm });
  const base = heartToTorso(f, { x: 0, y: 0, z: 0 });
  void heartDirToTorso;
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(base.x, base.y, base.z), new THREE.Vector3(apex.x, apex.y, apex.z)]), new THREE.LineDashedMaterial({ color: 0xffc857, dashSize: 0.5, gapSize: 0.3, transparent: true, opacity: 0.7 }));
  line.computeLineDistances();
  g.add(line);
  g.renderOrder = 1;
  return g;
}

/** Phased-array cardiac transducer: small footprint head, ergonomic handle, index marker ridge, cable. Local frame: x lateral (marker side), y elevation, z beam (into the body). */
function buildProbe(): { probe: THREE.Group; marker: THREE.Group } {
  const probe = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x2f3a46, roughness: 0.45, metalness: 0.15 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x4a86c8, roughness: 0.55 });
  const lens = new THREE.MeshStandardMaterial({ color: 0x1d2229, roughness: 0.3 });
  // head (footprint ≈ 2.0 × 1.3 cm) with the acoustic lens at z = 0
  const head = new THREE.Mesh(new RoundedBoxGeometry(2.1, 1.35, 1.2, 3, 0.25), shell);
  head.position.z = 0.65;
  const lensMesh = new THREE.Mesh(new RoundedBoxGeometry(1.9, 1.15, 0.12, 2, 0.05), lens);
  lensMesh.position.z = 0.03;
  // neck and handle (oval section) along −z beyond the head
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, 0.7, 20), shell);
  neck.rotation.x = Math.PI / 2;
  neck.scale.set(1.25, 1, 0.75);
  neck.position.z = 1.55;
  const profile: THREE.Vector2[] = [];
  const rs = [0.85, 1.05, 1.22, 1.3, 1.3, 1.22, 1.05, 0.9];
  for (let i = 0; i < rs.length; i++) profile.push(new THREE.Vector2(rs[i]!, (i / (rs.length - 1)) * 5.2));
  const handle = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), grip);
  handle.rotation.x = Math.PI / 2; // lathe axis (y) → local z
  handle.scale.set(1, 0.68, 1);
  handle.position.z = 1.9;
  const handleGrip = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.4, 2.6, 2, 0.15), shell);
  handleGrip.position.set(0, 0.62, 4.2);
  // cable exiting the handle end
  const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 7.1), new THREE.Vector3(0.2, 0.6, 9.5), new THREE.Vector3(0.6, 2.4, 12)]), 12, 0.28, 8, false), new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.7 }));
  // index marker: ridge + emissive dot on the +x (screen-right) side
  const marker = new THREE.Group();
  const ridge = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.55, 1.5, 2, 0.1), new THREE.MeshStandardMaterial({ color: 0x5cc8ff, emissive: 0x1b6f9a, roughness: 0.4 }));
  ridge.position.set(1.15, 0, 0.95);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), new THREE.MeshStandardMaterial({ color: 0x8fe0ff, emissive: 0x3aa0d8, roughness: 0.3 }));
  dot.position.set(1.28, 0, 1.9);
  marker.add(ridge, dot);
  probe.add(head, lensMesh, neck, handle, handleGrip, cable, marker);
  return { probe, marker };
}

function updateFan(fan: THREE.Mesh, edges: THREE.LineSegments, beam: BeamFrame, depth: number, sectorDeg: number): void {
  const half = (sectorDeg * Math.PI) / 360;
  const verts: number[] = [];
  const o = beam.origin;
  const n = 16;
  const at = (a: number, r: number) => {
    const c = Math.cos(a),
      s = Math.sin(a);
    return [o.x + (beam.forward.x * c + beam.lateral.x * s) * r, o.y + (beam.forward.y * c + beam.lateral.y * s) * r, o.z + (beam.forward.z * c + beam.lateral.z * s) * r] as const;
  };
  for (let i = 0; i < n; i++) {
    const p0 = at(-half + (2 * half * i) / n, depth),
      p1 = at(-half + (2 * half * (i + 1)) / n, depth);
    verts.push(o.x, o.y, o.z, ...p0, ...p1);
  }
  fan.geometry.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  fan.geometry = g;
  const ev: number[] = [];
  const l = at(-half, depth),
    r = at(half, depth);
  ev.push(o.x, o.y, o.z, ...l, o.x, o.y, o.z, ...r);
  for (let i = 0; i < n; i++) {
    const p0 = at(-half + (2 * half * i) / n, depth),
      p1 = at(-half + (2 * half * (i + 1)) / n, depth);
    ev.push(...p0, ...p1);
  }
  edges.geometry.dispose();
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(ev, 3));
  edges.geometry = eg;
}
