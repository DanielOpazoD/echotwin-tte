import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { segmentLayerOn, useHudStore, useSegmentHover, useSimStore } from '@/app/store';
import {
  ribCenterY,
  ribDepth,
  ribRadiusAt,
  skinNormal,
  skinZ,
  type ThoraxModel,
} from '@/simulator/anatomy/thoraxModel';
import { heartToTorso, torsoToHeart, type HeartFrame } from '@/simulator/anatomy/heartFrame';
import { frameBus } from '@/app/frameBus';
import { groupLabel, markerLabel, type ReviewMarker } from '@/app/review';
import type {
  MeshError,
  MeshReply,
  MeshRequest,
  NavigatorModel,
  WindowMark,
} from '@/workers/heartMesh.worker';
import { beamFrameFromPose, poseFromControl, type BeamFrame } from '@/simulator/probe/pose';
import { CutMapView } from './CutMapView';
import {
  SEGMENT_RGB,
  segmentCss,
  segmentIdOf,
  segmentNames,
  type SegmentModelChoice,
} from './segmentMap';
import { coverageText } from './SegmentPanel';
import { RotationDial } from './RotationDial';
import { CheckItem, MenuCap, usePopover } from './menu';
import { IconCrosshair, IconLayers, IconMinus, IconPlus } from './icons';

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
  const split = useSimStore((s) => s.ui.navSplit);
  const patient = useSimStore((s) => s.patient);
  const zoomRef = useRef<{ zoomBy: (f: number) => void; center: () => void } | null>(null);
  // a browser without WebGL keeps the image and the cut map; only the 3D view gives way to a notice (decision 154).
  // Probed once on mounting; if the renderer still failed, the ErrorBoundary around the navigator would contain it
  const [webglError] = useState(probeWebgl);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // the models arrive from the mesh worker as data (NavigatorModel, audit B7): until then the scene has the
    // probe, the fan and the lights, and the pose-dependent parts wait
    let thorax: ThoraxModel | null = null;
    let heartFrame: HeartFrame | null = null;
    if (webglError) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, stencil: true });
    renderer.localClippingEnabled = true; // the heart is cut by the imaging plane (decision 57)
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x0f1319);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 1, 300);
    // render-on-change bookkeeping for the navigator (see tick)
    let dirty = true;
    let lastRenderAt = 0;
    let lastCostMs = 0;
    let shownPhaseIdx = -1;
    // Filmic tone mapping and a rim light: the anatomy is read by its volume, and flat linear output made
    // the myocardial shells look like cut-outs. The geometry itself stays the one the beam cuts — importing
    // a sculpted heart mesh would look better and stop matching the image, which is the whole point.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    scene.add(new THREE.HemisphereLight(0xe8eef5, 0x1a1f28, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(-12, 25, 40);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xcfe4ff, 0.85); // behind and above: separates the shells from the background
    rim.position.set(-6, 9, -12);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0x9fc0ff, 0.5);
    fill.position.set(20, -10, 30);
    scene.add(fill);

    // ---- body (built when the navigator model arrives) ----
    let skin: THREE.Mesh | null = null;
    let skeleton: THREE.Group | null = null;
    let ghost: THREE.Group | null = null;
    let windowMarks: THREE.Group | null = null;
    // the imaging plane doubles as a clipping plane: the 3D heart is split exactly where the beam cuts
    const cutPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const onModel = (model: NavigatorModel) => {
      thorax = model.thorax;
      heartFrame = model.frame;
      skin = buildSkin(model.thorax);
      scene.add(skin);
      skeleton = buildSkeleton(model.thorax);
      scene.add(skeleton);
      ghost = buildHeartGhost(model);
      scene.add(ghost);
      windowMarks = buildWindowMarks(model.thorax, model.windows);
      scene.add(windowMarks);
    };
    // surfaces extracted from the same implicit model the beam samples, so navigator and image cannot disagree
    const heartMeshes = new THREE.Group();
    scene.add(heartMeshes);
    const meshMaterials: THREE.MeshStandardMaterial[] = [];
    const meshByGroup = new Map<string, THREE.Mesh>();
    // stencil caps: each clipped mesh gets a mask (interior pixels) and a plane that fills it, so the
    // heart reads as solid tissue where the beam cuts it instead of a set of hollow shells
    const capByGroup = new Map<string, { stencil: THREE.Group; cap: THREE.Mesh }>();
    let capOrder = 0;
    // one geometry per cardiac phase per group: the navigator beats in step with the image instead of
    // standing still next to it (decision 68). Phases arrive one by one from the worker.
    const geomByGroup = new Map<string, THREE.BufferGeometry[]>();
    // LV segments on the 3D heart (decision 152): per-vertex segment codes of each phase's LV myocardium, painted as
    // vertex colours with the model and selection of the segment panel, the same as the cut map and the polar map
    const lvSegmentsByGeom = new Map<THREE.BufferGeometry, Uint8Array>();
    let segmentKeyShown = '';
    const LV_BASE = new THREE.Color(0xc4534f);
    const FADED = new THREE.Color().setRGB(58 / 255, 63 / 255, 74 / 255, THREE.SRGBColorSpace);
    const HOVER_LIFT = new THREE.Color(1, 1, 1);
    const paintSegments = (
      geom: THREE.BufferGeometry,
      codes: Uint8Array,
      model: SegmentModelChoice,
      selected: number | null,
      hovered: number | null,
    ): void => {
      // colour of each of the 21 codes once, in the renderer's linear space
      const table = Array.from({ length: 21 }, (_, c) => {
        const id = segmentIdOf(c, model);
        if (id === 0) return LV_BASE;
        const rgb = SEGMENT_RGB[id]!;
        const col = new THREE.Color().setRGB(
          rgb[0] / 255,
          rgb[1] / 255,
          rgb[2] / 255,
          THREE.SRGBColorSpace,
        );
        // the segment under the pointer (in any view) lightens; with one selected, the others fade
        if (id === hovered) return col.lerp(HOVER_LIFT, 0.35);
        return selected !== null && id !== selected ? col.lerp(FADED, 0.55) : col;
      });
      let attr = geom.getAttribute('color') as THREE.BufferAttribute | undefined;
      if (!attr || attr.count !== codes.length) {
        attr = new THREE.BufferAttribute(new Float32Array(codes.length * 3), 3);
        geom.setAttribute('color', attr);
      }
      const a = attr.array as Float32Array;
      for (let v = 0; v < codes.length; v++) {
        const col = table[codes[v]!] ?? LV_BASE;
        a[v * 3] = col.r;
        a[v * 3 + 1] = col.g;
        a[v * 3 + 2] = col.b;
      }
      attr.needsUpdate = true;
    };
    let phasesReady = 0;
    let shownPhasesReady = -1;
    // extraction samples the implicit model hundreds of thousands of times: off the UI thread, with the
    // ghost showing until the surfaces arrive
    const meshWorker = new Worker(new URL('../workers/heartMesh.worker.ts', import.meta.url), {
      type: 'module',
    });
    meshWorker.onerror = (e) => {
      // the ghost stays; the image is unaffected (it does not use these meshes)
      console.warn('heart mesh worker failed to load; keeping the schematic heart', e.message);
    };
    meshWorker.onmessage = (ev: MessageEvent<MeshReply | MeshError | NavigatorModel>) => {
      if ('kind' in ev.data) {
        onModel(ev.data);
        return;
      }
      if ('error' in ev.data) {
        console.warn('heart mesh extraction failed; keeping the schematic heart', ev.data.error);
        return;
      }
      const f = heartFrame;
      if (!f) return; // the model always precedes the meshes
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(f.ex.x, f.ex.y, f.ex.z),
        new THREE.Vector3(f.ey.x, f.ey.y, f.ey.z),
        new THREE.Vector3(f.ez.x, f.ez.y, f.ez.z),
      );
      const placement = new THREE.Matrix4()
        .makeTranslation(f.origin.x, f.origin.y, f.origin.z)
        .multiply(basis);
      for (const g of ev.data.groups) {
        if (!g.indices.length) continue;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
        geom.setIndex(new THREE.BufferAttribute(g.indices, 1));
        geom.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
        if (g.segments && g.segments.length * 3 === g.positions.length) {
          lvSegmentsByGeom.set(geom, g.segments);
          segmentKeyShown = ''; // paint the new phase on the next frame
        }
        let perPhase = geomByGroup.get(g.id);
        if (!perPhase) {
          perPhase = [];
          geomByGroup.set(g.id, perPhase);
        }
        perPhase[ev.data.index] = geom;
        if (!meshByGroup.has(g.id)) {
          const mat = new THREE.MeshStandardMaterial({
            color: g.color,
            roughness: 0.55,
            metalness: 0.05,
            transparent: g.opacity < 1,
            opacity: g.opacity,
            depthWrite: g.opacity >= 1,
            side: THREE.DoubleSide,
          });
          meshMaterials.push(mat);
          const mesh = new THREE.Mesh(geom, mat);
          mesh.applyMatrix4(placement);
          meshByGroup.set(g.id, mesh);
          heartMeshes.add(mesh);
          const stencil = createPlaneStencilGroup(geom, cutPlane, 10 + capOrder * 2);
          stencil.applyMatrix4(placement);
          const capMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(g.color).multiplyScalar(0.45),
            roughness: 0.8,
            metalness: 0,
            side: THREE.DoubleSide,
            stencilWrite: true,
            stencilRef: 0,
            stencilFunc: THREE.NotEqualStencilFunc,
            stencilFail: THREE.ReplaceStencilOp,
            stencilZFail: THREE.ReplaceStencilOp,
            stencilZPass: THREE.ReplaceStencilOp,
          });
          const cap = new THREE.Mesh(new THREE.PlaneGeometry(45, 45), capMat);
          cap.renderOrder = 11 + capOrder * 2;
          scene.add(stencil, cap);
          capByGroup.set(g.id, { stencil, cap });
          capOrder++;
        }
      }
      phasesReady = Math.max(phasesReady, ev.data.index + 1);
      if (ghost) ghost.visible = false;
      dirty = true;
    };
    // 0.26 cm and ten phases: extraction costs 553 ms per phase at this step against 2171 ms at 0.20, so the
    // whole beat is ready in ~5.5 s of worker time with the first phase on screen in half a second. The
    // finer grid left fewer black facets (3.2% of folded vertices on the RV wall against 4.5% here), but a
    // heart that stands still beside a beating image gives the model away far more than half a point of
    // facets (decisions 67 and 68).
    const MESH_PHASES = Array.from({ length: 10 }, (_, i) => i / 10);
    meshWorker.postMessage({
      caseId,
      patient,
      stepCm: 0.26,
      phases: MESH_PHASES,
    } satisfies MeshRequest);
    // examination axes: beam axis, elevation normal and the in-plane lateral direction
    const axisGroup = new THREE.Group();
    const axisLine = (color: number): THREE.Line =>
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }),
      );
    const beamAxis = axisLine(0xffc857);
    const elevAxis = axisLine(0x7ce8a0);
    const latAxis = axisLine(0x5cc8ff);
    axisGroup.add(beamAxis, elevAxis, latAxis);
    scene.add(axisGroup);
    // review markers placed on the model (decision 135): a sphere and a label per marker, rebuilt when they change
    const reviewGroup = new THREE.Group();
    scene.add(reviewGroup);
    let reviewShown: ReviewMarker[] | null = null;
    let reviewSelectedShown: string | null = null;
    const rebuildReviewMarkers = (markers: ReviewMarker[], selected: string | null) => {
      for (const o of reviewGroup.children) {
        const mesh = o as THREE.Mesh | THREE.Sprite;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material & { map?: THREE.Texture | null };
        mat.map?.dispose();
        mat.dispose();
      }
      reviewGroup.clear();
      // every marker with a torso position shows on the model: those put on it as spheres, those put on the
      // image (once the worker has placed them) as small diamonds, and each secondary joined to its primary
      const pos = (mk: ReviewMarker) =>
        mk.space === 'model' ? mk.torso : (mk.point?.torso ?? null);
      for (const mk of markers) {
        const at = pos(mk);
        if (!at) continue;
        const on = mk.id === selected;
        const color = on ? 0xffffff : 0xff6ad5;
        const size = mk.parentId ? 0.7 : 1;
        const ball = new THREE.Mesh(
          mk.space === 'model'
            ? new THREE.SphereGeometry((on ? 0.5 : 0.35) * size, 16, 12)
            : new THREE.OctahedronGeometry((on ? 0.42 : 0.3) * size),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.95,
            depthTest: false,
          }),
        );
        ball.position.set(at.x, at.y, at.z);
        ball.renderOrder = 30;
        reviewGroup.add(ball);
        const label = markerLabel(mk, markers);
        const tag = textSprite(
          mk.space === 'model' ? `${label} · ${groupLabel(mk.group)}` : label,
          color,
        );
        tag.position.set(at.x, at.y + 1.1, at.z + 0.6);
        tag.renderOrder = 31;
        reviewGroup.add(tag);
        if (mk.parentId) {
          const parent = markers.find((x) => x.id === mk.parentId);
          const from = parent ? pos(parent) : null;
          if (from) {
            const line = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(from.x, from.y, from.z),
                new THREE.Vector3(at.x, at.y, at.z),
              ]),
              new THREE.LineBasicMaterial({
                color: 0xff6ad5,
                transparent: true,
                opacity: 0.8,
                depthTest: false,
              }),
            );
            line.renderOrder = 29;
            reviewGroup.add(line);
          }
        }
      }
    };

    // ---- probe ----
    const { probe, marker } = buildProbe();
    scene.add(probe);
    const fanMat = new THREE.MeshBasicMaterial({
      color: 0x5cc8ff,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const fan = new THREE.Mesh(new THREE.BufferGeometry(), fanMat);
    scene.add(fan);
    const fanEdges = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.6 }),
    );
    scene.add(fanEdges);

    // ---- camera / interaction ----
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const orbit = { az: 0.12, el: 0.08, r: 54, tx: 2, ty: -1.5, tz: -6 };
    const updateCamera = () => {
      dirty = true;
      camera.position.set(
        orbit.tx + orbit.r * Math.sin(orbit.az) * Math.cos(orbit.el),
        orbit.ty + orbit.r * Math.sin(orbit.el),
        orbit.tz + orbit.r * Math.cos(orbit.az) * Math.cos(orbit.el),
      );
      camera.lookAt(orbit.tx, orbit.ty, orbit.tz);
    };
    updateCamera();
    zoomRef.current = {
      zoomBy: (f) => {
        orbit.r = Math.max(22, Math.min(90, orbit.r * f));
        updateCamera();
      },
      center: () => {
        if (!thorax) return;
        const p = poseFromControl(thorax, useSimStore.getState().probe).position;
        orbit.tx = p.x;
        orbit.ty = p.y;
        orbit.tz = p.z - 5;
        orbit.r = 30;
        updateCamera();
      },
    };
    let drag: {
      mode: 'slide' | 'rock' | 'tilt' | 'orbit' | 'rotate' | null;
      x: number;
      y: number;
      cx: number;
      cy: number;
    } = { mode: null, x: 0, y: 0, cx: 0, cy: 0 };
    const toNdc = (e: MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1,
      );
      return r;
    };
    const pickSkin = (e: MouseEvent): { u: number; v: number } | null => {
      toNdc(e);
      raycaster.setFromCamera(mouse, camera);
      if (!skin || !thorax) return null;
      const hit = raycaster.intersectObject(skin, false)[0];
      if (!hit) return null;
      // only the anterior surface is a valid probe location (the model's skin function covers it)
      if (hit.point.z < skinZ(thorax, hit.point.x, hit.point.y) - 3.5) return null;
      return { u: hit.point.x, v: hit.point.y };
    };
    const probeScreenCenter = (r: DOMRect) => {
      if (!thorax) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const p = poseFromControl(thorax, useSimStore.getState().probe).position;
      const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
    // a press that does not move is a click: in review mode it marks the model (decision 135)
    let down = { x: 0, y: 0, t: 0, button: -1 };
    const isUnder = (root: THREE.Object3D, o: THREE.Object3D): boolean => {
      for (let c: THREE.Object3D | null = o; c; c = c.parent) if (c === root) return true;
      return false;
    };
    const placeModelMarker = (e: MouseEvent) => {
      if (!heartFrame) return;
      toNdc(e);
      raycaster.setFromCamera(mouse, camera);
      const st = useSimStore.getState();
      const targets: THREE.Object3D[] = [];
      for (const mesh of meshByGroup.values()) if (mesh.visible) targets.push(mesh);
      if (skin?.visible) targets.push(skin);
      if (skeleton?.visible) targets.push(skeleton);
      if (ghost?.visible) targets.push(ghost);
      const hit = raycaster.intersectObjects(targets, true).find((h) => {
        // with the cut on, the half of the heart the plane removed is not a surface one can point at
        const heartHit = [...meshByGroup.values()].includes(h.object as THREE.Mesh);
        if (!heartHit || !st.ui.navCut) return true;
        return cutPlane.distanceToPoint(h.point) >= 0;
      });
      if (!hit) return;
      let group: string | null = null;
      for (const [id, mesh] of meshByGroup) if (mesh === hit.object) group = id;
      const point = hit.point;
      if (!group && skin && hit.object === skin) group = 'skin';
      if (!group && skeleton && isUnder(skeleton, hit.object)) group = 'skeleton';
      if (!group && ghost && isUnder(ghost, hit.object)) group = 'ghost';
      const torso = { x: point.x, y: point.y, z: point.z };
      const hud = useHudStore.getState().hud;
      const id = `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
      // Alt+click with a marker selected, or the armed «+ secundario», links the point to that primary
      const sel = st.reviewMarkers.find((x) => x.id === st.reviewSelectedId);
      const parentId = st.reviewLinkParentId ?? (e.altKey && sel ? (sel.parentId ?? sel.id) : null);
      const parent = parentId ? st.reviewMarkers.find((x) => x.id === parentId) : undefined;
      st.addReviewMarker({
        id,
        n: 0,
        parentId: parent ? parent.id : null,
        space: 'model',
        x: 0,
        y: 0,
        captureSector: null,
        rCm: null,
        thetaRad: null,
        strip: null,
        torso,
        group,
        frameId: hud?.frameId ?? 0,
        phase: hud?.phase ?? 0,
        modality: st.modality,
        structure: 0,
        point: null,
        note: '',
        category: parent ? parent.category : 'anatomia',
      });
      void frameBus
        .request({ kind: 'probePoint', torso })
        .then((res) => {
          if (res && res.kind === 'probePoint')
            useSimStore.getState().updateReviewMarker(id, { point: res.point });
        })
        .catch((err: unknown) => {
          console.warn('probe point request failed', err instanceof Error ? err.message : err);
        });
      void torsoToHeart; // heart-frame coordinates come back from the worker with the classification
    };
    const onDown = (e: MouseEvent) => {
      e.preventDefault();
      down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button };
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
        // in review mode a click must not jump the probe: the slide starts with the first move
        if (p && !useSimStore.getState().ui.reviewMode)
          useSimStore.getState().setProbe({ u: p.u, v: p.v });
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
    const onUp = (e: MouseEvent) => {
      if (
        down.button === 0 &&
        useSimStore.getState().ui.reviewMode &&
        !e.shiftKey &&
        performance.now() - down.t < 500 &&
        Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4
      )
        placeModelMarker(e);
      // Alt is the modifier for a secondary point, so a plain Alt-press without drag must not tilt the probe
      down = { x: 0, y: 0, t: 0, button: -1 };
      drag = { mode: null, x: 0, y: 0, cx: 0, cy: 0 };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomRef.current?.zoomBy(e.deltaY > 0 ? 1.1 : 0.9);
        return;
      }
      useSimStore
        .getState()
        .nudgeProbe({ rotationDeg: Math.sign(e.deltaY) * (e.shiftKey ? 10 : 3) });
    };
    const dom = renderer.domElement;
    dom.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    dom.addEventListener('wheel', onWheel, { passive: false });
    const noCtx = (e: Event) => e.preventDefault();
    dom.addEventListener('contextmenu', noCtx);
    // the name of the LV segment under the pointer on the 3D heart (decision 153), with the segment layer on: a ray
    // against the opaque heart meshes (the translucent chambers do not hide what is seen through them), the first hit
    // on the visible side of the cut, and the codes of the face's vertices at the phase on screen
    const tipEl = document.createElement('div');
    tipEl.className = 'seg-tip heart';
    tipEl.setAttribute('role', 'status');
    tipEl.append(
      document.createElement('i'),
      document.createElement('b'),
      document.createElement('span'),
    );
    (tipEl.children[0] as HTMLElement).className = 'seg-tip-swatch';
    el.appendChild(tipEl);
    let hoverEvent: MouseEvent | null = null;
    let hoverRaf = 0;
    const hideTip = () => {
      tipEl.style.display = 'none';
      useSegmentHover.getState().setHover(null, 'heart');
    };
    const hoverHeart = () => {
      hoverRaf = 0;
      const e = hoverEvent;
      const st = useSimStore.getState();
      const lvMesh = meshByGroup.get('lv-myocardium');
      if (!e || drag.mode || !segmentLayerOn(st) || !lvMesh || !lvMesh.visible) return hideTip();
      const r = toNdc(e);
      raycaster.setFromCamera(mouse, camera);
      const opaque = [...meshByGroup.values()].filter(
        (m) => m.visible && (m.material as THREE.MeshStandardMaterial).opacity >= 1,
      );
      const hit = raycaster
        .intersectObjects(opaque, false)
        .find((h) => !st.ui.navCut || cutPlane.distanceToPoint(h.point) >= 0);
      const codes = hit ? lvSegmentsByGeom.get(lvMesh.geometry) : undefined;
      if (!hit || hit.object !== lvMesh || !hit.face || !codes) return hideTip();
      // the nearest vertex of the face that carries a segment (papillary vertices carry none)
      const f = hit.face;
      let code = 0,
        best = Infinity;
      const pos = lvMesh.geometry.getAttribute('position');
      const local = lvMesh.worldToLocal(hit.point.clone());
      for (const v of [f.a, f.b, f.c]) {
        const c = codes[v] ?? 0;
        if (c <= 0) continue;
        const d = local.distanceToSquared(new THREE.Vector3().fromBufferAttribute(pos, v));
        if (d < best) {
          best = d;
          code = c;
        }
      }
      const id = segmentIdOf(code, st.ui.segmentModel);
      if (id <= 0) return hideTip();
      const names = segmentNames(id, st.ui.segmentModel);
      const view = useHudStore.getState().hud?.view?.segments;
      const cov = (st.ui.segmentModel === 'LV_AHA17' ? view?.aha17 : view?.lv16)?.find(
        (c) => c.segmentId === id,
      );
      (tipEl.children[0] as HTMLElement).style.background = segmentCss(id);
      tipEl.children[1]!.textContent = `${id} · ${names.es}`;
      tipEl.children[2]!.textContent = `${names.en} · ${coverageText(cov)}`;
      const x = e.clientX - r.left,
        y = e.clientY - r.top;
      tipEl.style.display = 'grid';
      const left = x + 14 + tipEl.offsetWidth > r.width ? x - 14 - tipEl.offsetWidth : x + 14;
      tipEl.style.left = `${Math.max(4, left)}px`;
      tipEl.style.top = `${Math.max(4, Math.min(r.height - tipEl.offsetHeight - 4, y + 12))}px`;
      useSegmentHover.getState().setHover(id, 'heart');
    };
    const onHoverMove = (e: MouseEvent) => {
      hoverEvent = e;
      if (!hoverRaf) hoverRaf = requestAnimationFrame(hoverHeart);
    };
    const onHoverLeave = () => {
      hoverEvent = null;
      hideTip();
    };
    dom.addEventListener('mousemove', onHoverMove);
    dom.addEventListener('mouseleave', onHoverLeave);

    const resize = () => {
      const w = el.clientWidth || 300,
        h = el.clientHeight || 300;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    // The navigator renders when something it shows has changed, and no faster than its own cost allows: the
    // stencil caps are cheap on a GPU but not on a software renderer (the E2E browser), where a navigator
    // drawn at 60 Hz starved the main thread of the simulator's frames.
    const unsubHover = useSegmentHover.subscribe(() => {
      dirty = true;
    });
    const unsubDirty = useSimStore.subscribe(() => {
      dirty = true;
    });
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const st = useSimStore.getState();
      if (!thorax) {
        renderer.render(scene, camera);
        return;
      }
      const hudPhaseNow = useHudStore.getState().hud?.phase ?? 0;
      const phaseIdxNow = Math.round(hudPhaseNow * MESH_PHASES.length) % MESH_PHASES.length;
      if (phaseIdxNow !== shownPhaseIdx || phasesReady !== shownPhasesReady) dirty = true;
      const now = performance.now();
      const minInterval = lastCostMs > 25 ? Math.min(500, lastCostMs * 4) : 0;
      if ((!dirty && now - lastRenderAt < 1000) || now - lastRenderAt < minInterval) return;
      dirty = false;
      lastRenderAt = now;
      shownPhaseIdx = phaseIdxNow;
      shownPhasesReady = phasesReady;
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
      // clip the heart with the imaging plane, and point the axes along the probe
      cutPlane.normal.set(beam.normal.x, beam.normal.y, beam.normal.z);
      cutPlane.constant = -(
        beam.normal.x * beam.origin.x +
        beam.normal.y * beam.origin.y +
        beam.normal.z * beam.origin.z
      );
      const clip = st.ui.navCut ? [cutPlane] : [];
      for (const m of meshMaterials) m.clippingPlanes = clip;
      const vis: Record<string, boolean> = {
        'lv-myocardium': st.ui.navHeart,
        'rv-myocardium': st.ui.navHeart,
        'lv-cavity': st.ui.navChambers,
        'rv-cavity': st.ui.navChambers,
        atria: st.ui.navChambers,
        valves: st.ui.navValves,
        'great-vessels': st.ui.navVessels,
      };
      for (const [id, mesh] of meshByGroup) mesh.visible = vis[id] ?? true;
      for (const [id, c] of capByGroup) {
        const v = (vis[id] ?? true) && st.ui.navCut;
        c.stencil.visible = v;
        c.cap.visible = v;
        {
          c.cap.position.set(beam.origin.x, beam.origin.y, beam.origin.z);
          c.cap.lookAt(
            beam.origin.x + beam.normal.x,
            beam.origin.y + beam.normal.y,
            beam.origin.z + beam.normal.z,
          );
        }
      }
      // beat in step with the image: the phase comes from the frame on screen, not from a clock of our own
      // only once the whole beat is in: animating a partial set would loop three phases as if they were the
      // entire cycle, which is a different lie from standing still
      if (phasesReady === MESH_PHASES.length) {
        const hudPhase = useHudStore.getState().hud?.phase ?? 0;
        const idx = Math.round(hudPhase * MESH_PHASES.length) % MESH_PHASES.length;
        for (const [id, mesh] of meshByGroup) {
          const geom = geomByGroup.get(id)?.[idx];
          if (geom && mesh.geometry !== geom) {
            mesh.geometry = geom;
            const c = capByGroup.get(id);
            if (c) for (const sm of c.stencil.children) (sm as THREE.Mesh).geometry = geom;
          }
        }
      }
      // segment colours on the LV myocardium: repainted only when the layer, the model or the selection change
      const segOn = segmentLayerOn(st);
      const hoveredSeg = useSegmentHover.getState().id;
      const segKey = `${segOn ? 1 : 0}|${st.ui.segmentModel}|${st.ui.selectedSegment ?? '-'}|${hoveredSeg ?? '-'}`;
      if (segKey !== segmentKeyShown) {
        const lvMesh = meshByGroup.get('lv-myocardium');
        if (lvMesh) {
          const mat = lvMesh.material as THREE.MeshStandardMaterial;
          if (segOn)
            for (const [geom, codes] of lvSegmentsByGeom)
              paintSegments(geom, codes, st.ui.segmentModel, st.ui.selectedSegment, hoveredSeg);
          mat.vertexColors = segOn;
          mat.color.set(segOn ? 0xffffff : 0xc4534f);
          mat.needsUpdate = true;
          segmentKeyShown = segKey;
        }
      }
      axisGroup.visible = st.ui.navAxes;
      if (st.reviewMarkers !== reviewShown || st.reviewSelectedId !== reviewSelectedShown) {
        rebuildReviewMarkers(st.reviewMarkers, st.reviewSelectedId);
        reviewShown = st.reviewMarkers;
        reviewSelectedShown = st.reviewSelectedId;
      }
      reviewGroup.visible = st.ui.reviewMode;
      if (st.ui.navAxes) {
        const o = new THREE.Vector3(beam.origin.x, beam.origin.y, beam.origin.z);
        const set = (
          line: THREE.Line,
          dir: { x: number; y: number; z: number },
          len: number,
        ): void => {
          const p = new THREE.Vector3(o.x + dir.x * len, o.y + dir.y * len, o.z + dir.z * len);
          line.geometry.setFromPoints([o, p]);
        };
        set(beamAxis, beam.forward, st.settings.depthCm);
        set(elevAxis, beam.normal, 4);
        set(latAxis, beam.lateral, 4);
      }
      if (skeleton) skeleton.visible = st.ui.showSkeleton;
      if (windowMarks) windowMarks.visible = st.ui.navWindows;
      // the skin is a layer of its own: hiding the bones used to make it opaque, which hid the heart
      if (skin) {
        skin.visible = st.ui.navSkin;
        (skin.material as THREE.MeshStandardMaterial).opacity =
          st.ui.navHeart || st.ui.navChambers || st.ui.navVessels ? 0.32 : 0.85;
      }
      renderer.render(scene, camera);
      lastCostMs = performance.now() - now;
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      unsubDirty();
      unsubHover();
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
      dom.removeEventListener('mousemove', onHoverMove);
      dom.removeEventListener('mouseleave', onHoverLeave);
      el.removeChild(tipEl);
      meshWorker.terminate();
      ro.disconnect();
      dom.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('contextmenu', noCtx);
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [caseId, patient, webglError]);

  return (
    <div className={`torso-wrap${split ? ' split' : ''}`}>
      <div className="torso-3d" ref={ref} aria-label="Torso 3D y sonda virtual">
        {/* inside the torso so it sits at the torso's own bottom edge, whatever height the cut map leaves it
            (decision 197) */}
        <div className="torso-help">
          Arrastrar: deslizar · Rueda: rotar · Shift: rock · Alt: tilt ·{' '}
          <kbd className="kbd">?</kbd> todos los gestos
        </div>
        {webglError && (
          <div className="panel-error" role="alert">
            <b>La vista 3D necesita WebGL 2, que este navegador no ofrece.</b>
            <span className="small">
              La imagen ecográfica, el mapa del corte y los controles de la sonda siguen
              funcionando.
            </span>
          </div>
        )}
      </div>
      {split && <div className="torso-caption top">Sonda y tórax</div>}
      {split && <CutMapView />}
      <div className="torso-tools">
        <RotationDial />
        <div className="torso-buttons">
          <button
            className="icon-btn"
            onClick={() => zoomRef.current?.zoomBy(0.85)}
            data-tip="Acercar"
            data-tip-key="Ctrl/⌘+rueda"
            aria-label="Acercar"
          >
            <IconPlus size={14} />
          </button>
          <button
            className="icon-btn"
            onClick={() => zoomRef.current?.zoomBy(1.18)}
            data-tip="Alejar"
            aria-label="Alejar"
          >
            <IconMinus size={14} />
          </button>
          <button
            className="icon-btn"
            onClick={() => zoomRef.current?.center()}
            data-tip="Centrar la cámara en la sonda"
            aria-label="Centrar la cámara en la sonda"
          >
            <IconCrosshair size={14} />
          </button>
          <LayerMenu />
        </div>
      </div>
    </div>
  );
}

/**
 * Why this browser cannot draw the 3D navigator, or null when it offers a WebGL2 context (released at once). three.js
 * creates only WebGL2 contexts: a browser with WebGL1 alone would pass a looser probe and fail inside the effect.
 */
function probeWebgl(): string | null {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return 'este navegador no ofrece un contexto WebGL2';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** 3D navigator layers as a checkable popover: keeps the torso overlay to camera controls only. */
function LayerMenu() {
  const ui = useSimStore((s) => s.ui);
  const setUi = useSimStore((s) => s.setUi);
  const { open, setOpen, wrap } = usePopover();
  const layer = (label: string, key: keyof typeof ui, hint: string) => (
    <CheckItem
      label={label}
      checked={Boolean(ui[key])}
      onToggle={() => setUi({ [key]: !ui[key] })}
      hint={hint}
    />
  );
  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        className={`icon-btn${open ? ' active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Capas del navegador 3D"
        data-tip="Capas del navegador 3D"
        onClick={() => setOpen(!open)}
      >
        <IconLayers size={14} />
      </button>
      {open && (
        <div className="menu down" role="menu" aria-label="Capas del navegador 3D">
          <MenuCap>Cuerpo</MenuCap>
          {layer('Piel', 'navSkin', 'Superficie del tórax')}
          {layer('Hueso', 'showSkeleton', 'Costillas y esternón')}
          <MenuCap>Corazón</MenuCap>
          {layer('Miocardio', 'navHeart', 'Paredes del modelo 3D')}
          {layer('Cavidades', 'navChambers', 'Ventrículos y aurículas')}
          {layer('Válvulas', 'navValves', 'Válvulas y cuerdas')}
          {layer(
            'Segmentos del VI',
            'navSegments',
            'Colorea el miocardio del VI por segmento (también el corte); pasar el ratón: nombre',
          )}
          {layer('Vasos', 'navVessels', 'Raíz aórtica, pulmonar y cavas')}
          <MenuCap>Vistas</MenuCap>
          {layer(
            'Corte de frente',
            'navSplit',
            'Segunda vista: el corazón cortado por el plano, mirando el corte',
          )}
          {layer(
            'Etiquetas del corte',
            'navLabels',
            'Nombres de cámaras y válvulas sobre el corte',
          )}
          <MenuCap>Examen</MenuCap>
          {layer('Ventanas', 'navWindows', 'Ventanas acústicas de las vistas canónicas')}
          {layer('Ejes', 'navAxes', 'Haz, elevación y lateral')}
          {layer('Corte', 'navCut', 'Cortar el corazón por el plano de imagen')}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// geometry builders
// ------------------------------------------------------------------------------------------------

/**
 * Stencil mask for one clipped mesh: back faces increment and front faces decrement, so pixels where
 * the solid interior projects end up non-zero. The cap plane then fills exactly that region (and the
 * replace ops reset the stencil so the next group's mask starts clean). Standard three.js capping.
 */
function createPlaneStencilGroup(
  geometry: THREE.BufferGeometry,
  plane: THREE.Plane,
  renderOrder: number,
): THREE.Group {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshBasicMaterial({
    depthWrite: false,
    depthTest: false,
    colorWrite: false,
    stencilWrite: true,
    stencilFunc: THREE.AlwaysStencilFunc,
    clippingPlanes: [plane],
  });
  const backMat = baseMat.clone();
  backMat.side = THREE.BackSide;
  backMat.stencilFail = backMat.stencilZFail = backMat.stencilZPass = THREE.IncrementWrapStencilOp;
  const backMesh = new THREE.Mesh(geometry, backMat);
  backMesh.renderOrder = renderOrder;
  const frontMat = baseMat.clone();
  frontMat.side = THREE.FrontSide;
  frontMat.stencilFail =
    frontMat.stencilZFail =
    frontMat.stencilZPass =
      THREE.DecrementWrapStencilOp;
  const frontMesh = new THREE.Mesh(geometry, frontMat);
  frontMesh.renderOrder = renderOrder;
  group.add(backMesh, frontMesh);
  return group;
}

/** Superellipse cross-section point at angle θ (0 = front centre), scaled inward by `inset` cm. */
function crossSection(
  t: ThoraxModel,
  theta: number,
  y: number,
  inset: number,
): { x: number; z: number } {
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
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd9b59a,
    roughness: 0.75,
    metalness: 0.02,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 2;
  // neck + shoulders (cosmetic landmarks: suprasternal notch sits between them)
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(5.2, 6.2, 9, 24),
    new THREE.MeshStandardMaterial({ color: 0xd9b59a, roughness: 0.8 }),
  );
  neck.position.set(0, 16.5, -t.bDepth * 0.55);
  mesh.add(neck);
  for (const side of [-1, 1]) {
    const sh = new THREE.Mesh(
      new THREE.SphereGeometry(5.5, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xd9b59a, roughness: 0.8 }),
    );
    sh.scale.set(1.35, 0.85, 1);
    sh.position.set(side * (t.aw + 1.5), 10.5, -t.bDepth * 0.6);
    mesh.add(sh);
  }
  return mesh;
}

/** Colour of each acoustic window's marks: the same family the console uses for the view presets. */
const WINDOW_COLORS: Record<WindowMark['window'], number> = {
  parasternal: 0xffc857,
  apical: 0x5cc8ff,
  subcostal: 0x7ce8a0,
  suprasternal: 0xf28cb1,
};
const WINDOW_LABELS: Record<WindowMark['window'], string> = {
  parasternal: 'Paraesternal',
  apical: 'Apical',
  subcostal: 'Subcostal',
  suprasternal: 'Supraesternal',
};

/**
 * Rings on the skin where the canonical views are acquired for this patient (decision 132): one ring per distinct
 * position (several short-axis presets share the parasternal window to the millimetre) and one label per window.
 * The positions come from the same window solver that scores the views, so the marks and the guidance agree.
 */
function buildWindowMarks(t: ThoraxModel, marks: WindowMark[]): THREE.Group {
  const g = new THREE.Group();
  const placed: { window: WindowMark['window']; u: number; v: number }[] = [];
  for (const m of marks) {
    if (placed.some((p) => p.window === m.window && Math.hypot(p.u - m.u, p.v - m.v) < 0.35))
      continue;
    placed.push({ window: m.window, u: m.u, v: m.v });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.62, 32),
      new THREE.MeshBasicMaterial({
        color: WINDOW_COLORS[m.window],
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const n = skinNormal(t, m.u, m.v);
    const z = skinZ(t, m.u, m.v);
    ring.position.set(m.u + n.x * 0.06, m.v + n.y * 0.06, z + n.z * 0.06);
    ring.lookAt(m.u + n.x, m.v + n.y, z + n.z);
    ring.renderOrder = 3;
    g.add(ring);
  }
  // one label per window, above the centroid of its rings
  const byWindow = new Map<WindowMark['window'], { u: number; v: number; n: number }>();
  for (const p of placed) {
    const acc = byWindow.get(p.window) ?? { u: 0, v: 0, n: 0 };
    acc.u += p.u;
    acc.v += p.v;
    acc.n++;
    byWindow.set(p.window, acc);
  }
  for (const [w, acc] of byWindow) {
    const u = acc.u / acc.n,
      v = acc.v / acc.n;
    const n = skinNormal(t, u, v);
    const sprite = textSprite(WINDOW_LABELS[w], WINDOW_COLORS[w]);
    sprite.position.set(u + n.x * 1.2, v + n.y * 1.2 + 1.1, skinZ(t, u, v) + n.z * 1.2);
    sprite.renderOrder = 3;
    g.add(sprite);
  }
  return g;
}

/** A small text label that always faces the camera (canvas texture on a sprite). */
function textSprite(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const scale = 2;
  const font = `${13 * scale}px system-ui, sans-serif`;
  const ctx = canvas.getContext('2d');
  const w = ctx ? Math.ceil(((ctx.font = font), ctx.measureText(text).width) + 12 * scale) : 96;
  canvas.width = w;
  canvas.height = 20 * scale;
  if (ctx) {
    ctx.font = font;
    ctx.fillStyle = 'rgba(12, 16, 22, 0.72)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 6 * scale, canvas.height / 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }),
  );
  sprite.scale.set((canvas.width / canvas.height) * 1.1, 1.1, 1);
  return sprite;
}

function buildSkeleton(t: ThoraxModel): THREE.Group {
  const g = new THREE.Group();
  const bone = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.55 });
  const cartilage = new THREE.MeshStandardMaterial({
    color: 0xcfd9e6,
    roughness: 0.5,
    transparent: true,
    opacity: 0.85,
  });
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
      g.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, r, 8, false),
          k <= 7 && cart.length >= 3 ? bone : bone,
        ),
      );
      if (cart.length >= 3)
        g.add(
          new THREE.Mesh(
            new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cart), 12, r * 1.05, 8, false),
            cartilage,
          ),
        );
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
    const pts = [
      new THREE.Vector3(side * 1.9, 10.6, sz(10.6) + 0.6),
      new THREE.Vector3(side * 7, 11.6, sz(10.6) - 0.6),
      new THREE.Vector3(side * 13.5, 12.4, sz(10.6) - 3.6),
    ];
    g.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.45, 8, false),
        bone,
      ),
    );
  }
  return g;
}

function buildHeartGhost(model: NavigatorModel): THREE.Group {
  const g = new THREE.Group();
  const f = model.frame;
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(f.ex.x, f.ex.y, f.ex.z),
    new THREE.Vector3(f.ey.x, f.ey.y, f.ey.z),
    new THREE.Vector3(f.ez.x, f.ez.y, f.ez.z),
  );
  for (const p of model.ghost) {
    const mat = new THREE.MeshStandardMaterial({
      color: p.color,
      transparent: true,
      opacity: p.opacity,
      roughness: 0.6,
      depthWrite: false,
    });
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
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(p.radii.x, p.radii.x * 0.9, len, 16),
        mat,
      );
      m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      g.add(m);
    }
  }
  // LV long axis hint
  const apex = heartToTorso(f, { x: 0, y: 0, z: model.lvLengthCm });
  const base = heartToTorso(f, { x: 0, y: 0, z: 0 });
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(base.x, base.y, base.z),
      new THREE.Vector3(apex.x, apex.y, apex.z),
    ]),
    new THREE.LineDashedMaterial({
      color: 0xffc857,
      dashSize: 0.5,
      gapSize: 0.3,
      transparent: true,
      opacity: 0.7,
    }),
  );
  line.computeLineDistances();
  g.add(line);
  g.renderOrder = 1;
  return g;
}

/**
 * Phased-array cardiac transducer. The footprint is taken from published probe specifications — 17×28 mm
 * on a GE M5S-D, 19×27 on a 3S-RS, 20×28 on an M4S-RS, 24×17 on an M3S — so the head is 2,85 cm along the
 * array (the imaging plane) by 1,90 cm in elevation, small enough to sit between two ribs. The length is
 * *not* a measured figure: no manufacturer sheet found gives it, so the 11,4 cm from the lens to the end of
 * the strain relief is plausible ergonomics (a barrel held like a thick pen), not a specification. Real probes also carry an index marker on
 * one side of the head and a tapered strain relief where the cable leaves the handle; here the marker is
 * also the pickable handle that rotates the probe, so it stays blue and grabbable on purpose.
 * Local frame: x lateral (marker side), y elevation, z ALONG THE BEAM, into the patient (the probe group's
 * third basis vector is beam.forward), so the lens sits at z = 0 and the whole body extends along −z.
 */
function buildProbe(): { probe: THREE.Group; marker: THREE.Group } {
  const probe = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({
    color: 0xd7dbe0,
    roughness: 0.5,
    metalness: 0.05,
  });
  const collar = new THREE.MeshStandardMaterial({
    color: 0x8b939c,
    roughness: 0.55,
    metalness: 0.1,
  });
  const lens = new THREE.MeshStandardMaterial({ color: 0x23282e, roughness: 0.25 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.8 });
  // head: 2,8 × 1,8 cm footprint, the array running along x
  const head = new THREE.Mesh(new RoundedBoxGeometry(2.85, 1.9, 1.5, 4, 0.3), shell);
  head.position.z = -0.76;
  // the acoustic lens is convex, not flat: a shallow spherical cap flattened in elevation
  const capR = 2.4;
  const lensMesh = new THREE.Mesh(
    new THREE.SphereGeometry(capR, 32, 12, 0, Math.PI * 2, 0, Math.asin(1.36 / capR)),
    lens,
  );
  lensMesh.rotation.x = Math.PI / 2; // the cap sits around +y: a positive turn points it at +z, into the patient
  lensMesh.scale.set(1, 1, 0.66); // scale is applied before the rotation, so local z becomes elevation: 1,8 cm
  lensMesh.position.z = -capR + 0.04; // cap apex ends up 0.4 mm proud of the contact face
  // shoulders: the head widens into the barrel instead of meeting it in a step
  const shoulder = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(1.4, 0),
        new THREE.Vector2(1.34, 0.3),
        new THREE.Vector2(1.2, 0.7),
        new THREE.Vector2(1.04, 1.15),
      ],
      28,
    ),
    shell,
  );
  shoulder.rotation.x = -Math.PI / 2; // lathe axis (+y) → −z, out of the patient
  shoulder.scale.set(1, 1, 0.72); // oval section, flattened in elevation
  shoulder.position.z = -1.5;
  // barrel with a waist where the fingers sit
  const rs = [1.04, 1.12, 1.1, 1.0, 0.93, 0.93, 1.0, 1.06, 1.02, 0.86];
  const profile = rs.map((r, i) => new THREE.Vector2(r, (i / (rs.length - 1)) * 7.4));
  // close the far end: a lathe has no caps, and seen end-on the barrel is a black hole where the cable leaves
  profile.push(new THREE.Vector2(0.6, 7.5), new THREE.Vector2(0, 7.56));
  const handle = new THREE.Mesh(new THREE.LatheGeometry(profile, 32), shell);
  handle.rotation.x = -Math.PI / 2;
  handle.scale.set(1, 1, 0.74);
  handle.position.z = -2.65;
  // strain relief: the tapered, ribbed collar that takes the pull of the cable
  const relief = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.62 - t * 0.28, 0.12 - t * 0.04, 8, 20),
      rubber,
    );
    ring.position.z = -(10.15 + t * 1.15);
    relief.add(ring);
  }
  const reliefCone = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.68, 1.35, 20), rubber);
  reliefCone.rotation.x = -Math.PI / 2;
  reliefCone.position.z = -10.75;
  relief.add(reliefCone);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.86, 0.32, 24), collar);
  band.rotation.x = Math.PI / 2;
  band.scale.set(1, 1, 0.78);
  band.position.z = -9.95;
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, -11.4),
        new THREE.Vector3(0.2, 0.5, -13.2),
        new THREE.Vector3(0.7, 2.2, -15.4),
      ]),
      14,
      0.3,
      10,
      false,
    ),
    rubber,
  );
  // index marker: the ridge and dot on the +x (screen-right) side, and the handle the mouse grabs to rotate
  const marker = new THREE.Group();
  const ridge = new THREE.Mesh(
    new RoundedBoxGeometry(0.26, 0.62, 1.0, 2, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x2f7fd0, roughness: 0.45 }),
  );
  ridge.position.set(1.42, 0, -0.8);
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x5cb0ee, emissive: 0x123c5e, roughness: 0.35 }),
  );
  dot.position.set(1.32, 0, -2.1);
  marker.add(ridge, dot);
  probe.add(head, lensMesh, shoulder, handle, relief, band, cable, marker);
  return { probe, marker };
}

function updateFan(
  fan: THREE.Mesh,
  edges: THREE.LineSegments,
  beam: BeamFrame,
  depth: number,
  sectorDeg: number,
): void {
  const half = (sectorDeg * Math.PI) / 360;
  const verts: number[] = [];
  const o = beam.origin;
  const n = 16;
  const at = (a: number, r: number) => {
    const c = Math.cos(a),
      s = Math.sin(a);
    return [
      o.x + (beam.forward.x * c + beam.lateral.x * s) * r,
      o.y + (beam.forward.y * c + beam.lateral.y * s) * r,
      o.z + (beam.forward.z * c + beam.lateral.z * s) * r,
    ] as const;
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
