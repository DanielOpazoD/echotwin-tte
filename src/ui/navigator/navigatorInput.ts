import * as THREE from 'three';
import {
  navigatorLayers,
  segmentLayerOn,
  useHudStore,
  useSegmentHover,
  useSimStore,
} from '@/app/store';
import { frameBus } from '@/app/frameBus';
import type { HeartFrame } from '@/simulator/anatomy/heartFrame';
import { skinZ, type ThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { poseFromControl } from '@/simulator/probe/pose';
import { segmentCss, segmentIdOf, segmentNames } from '../segmentMap';
import { coverageText } from '../SegmentPanel';
import type { NavigatorCameraRig } from './navigatorCamera';
import type { HeartMeshes } from './navigatorHeart';

/** What the navigator's pointer handling reads from the scene. */
export interface NavigatorInputContext {
  /** The panel, which holds the segment tooltip. */
  el: HTMLDivElement;
  /** The canvas the pointer acts on. */
  dom: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  rig: NavigatorCameraRig;
  /** What a drag on the torso does, read at each pointer event. */
  dragAction: { readonly current: 'probe' | 'camera' };
  /** The orientation marker on the probe: a drag that starts on it rotates the probe. */
  marker: THREE.Object3D;
  heart: HeartMeshes;
  cutPlane: THREE.Plane;
  /** The body as built so far (all null until the navigator model arrives). */
  body: () => {
    thorax: ThoraxModel | null;
    heartFrame: HeartFrame | null;
    skin: THREE.Mesh | null;
    skeleton: THREE.Group | null;
    ghost: THREE.Group | null;
  };
}

/**
 * The pointer on the 3D navigator: a drag slides the probe over the skin, rocks it (Shift), tilts it (Alt), rotates it
 * (from the orientation marker) or orbits the camera (right button, camera mode, or frozen); the wheel rotates the probe
 * or zooms; a click in review mode marks the model (decision 135); and the hover names the LV segment under the pointer
 * (decision 153). Returns the cleanup that removes the listeners and the tooltip.
 */
export function attachNavigatorInput({
  el,
  dom,
  camera,
  rig,
  dragAction,
  marker,
  heart,
  cutPlane,
  body,
}: NavigatorInputContext): () => void {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let drag: {
    mode: 'slide' | 'rock' | 'tilt' | 'orbit' | 'rotate' | null;
    x: number;
    y: number;
    cx: number;
    cy: number;
  } = { mode: null, x: 0, y: 0, cx: 0, cy: 0 };
  const toNdc = (e: MouseEvent) => {
    const r = dom.getBoundingClientRect();
    mouse.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1,
    );
    return r;
  };
  const pickSkin = (e: MouseEvent): { u: number; v: number } | null => {
    const { skin, thorax } = body();
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
    const { thorax } = body();
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
    const { heartFrame, skin, skeleton, ghost } = body();
    if (!heartFrame) return;
    toNdc(e);
    raycaster.setFromCamera(mouse, camera);
    const st = useSimStore.getState();
    const targets: THREE.Object3D[] = [];
    for (const mesh of heart.meshByGroup.values()) if (mesh.visible) targets.push(mesh);
    if (skin?.visible) targets.push(skin);
    if (skeleton?.visible) targets.push(skeleton);
    if (ghost?.visible) targets.push(ghost);
    const hit = raycaster.intersectObjects(targets, true).find((h) => {
      // with the cut on, the half of the heart the plane removed is not a surface one can point at
      const heartHit = [...heart.meshByGroup.values()].includes(h.object as THREE.Mesh);
      if (!heartHit || !navigatorLayers(st).cut) return true;
      return cutPlane.distanceToPoint(h.point) >= 0;
    });
    if (!hit) return;
    let group: string | null = null;
    for (const [id, mesh] of heart.meshByGroup) if (mesh === hit.object) group = id;
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
  };
  let activePointer: number | null = null;
  const onDown = (e: PointerEvent) => {
    if (!e.isPrimary || activePointer !== null) return;
    activePointer = e.pointerId;
    dom.setPointerCapture(e.pointerId);
    e.preventDefault();
    down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button };
    const r = toNdc(e);
    if (e.button === 2 || dragAction.current === 'camera' || useHudStore.getState().hud?.frozen) {
      drag = { mode: 'orbit', x: e.clientX, y: e.clientY, cx: 0, cy: 0 };
      return;
    }
    if (useHudStore.getState().hud?.frozen) return;
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
  const onMove = (e: PointerEvent) => {
    if (!drag.mode || e.pointerId !== activePointer) return;
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
      rig.orbit.az += dx * 0.006;
      rig.orbit.el = Math.max(-0.7, Math.min(0.9, rig.orbit.el - dy * 0.006));
      rig.update();
      drag = { ...drag, x: e.clientX, y: e.clientY };
    }
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
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
    if (
      e.ctrlKey ||
      e.metaKey ||
      dragAction.current === 'camera' ||
      useHudStore.getState().hud?.frozen
    ) {
      rig.zoom.zoomBy(e.deltaY > 0 ? 1.1 : 0.9);
      return;
    }
    if (useHudStore.getState().hud?.frozen) return;
    useSimStore.getState().nudgeProbe({ rotationDeg: Math.sign(e.deltaY) * (e.shiftKey ? 10 : 3) });
  };
  // Pointer events support mouse, pen and touch; capture keeps a drag over adjacent controls.
  const onCancel = (e: PointerEvent) => {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    down = { x: 0, y: 0, t: 0, button: -1 };
    drag = { mode: null, x: 0, y: 0, cx: 0, cy: 0 };
  };
  dom.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
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
    const lvMesh = heart.meshByGroup.get('lv-myocardium');
    if (!e || drag.mode || !segmentLayerOn(st) || !lvMesh || !lvMesh.visible) return hideTip();
    const r = toNdc(e);
    raycaster.setFromCamera(mouse, camera);
    const opaque = [...heart.meshByGroup.values()].filter(
      (m) => m.visible && (m.material as THREE.MeshStandardMaterial).opacity >= 1,
    );
    const hit = raycaster
      .intersectObjects(opaque, false)
      .find((h) => !navigatorLayers(st).cut || cutPlane.distanceToPoint(h.point) >= 0);
    const codes = hit ? heart.lvSegmentsByGeom.get(lvMesh.geometry) : undefined;
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
  return () => {
    if (hoverRaf) cancelAnimationFrame(hoverRaf);
    dom.removeEventListener('mousemove', onHoverMove);
    dom.removeEventListener('mouseleave', onHoverLeave);
    el.removeChild(tipEl);
    dom.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    dom.removeEventListener('wheel', onWheel);
    dom.removeEventListener('contextmenu', noCtx);
  };
}
