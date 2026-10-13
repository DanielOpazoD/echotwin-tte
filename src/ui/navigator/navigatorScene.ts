import { loadCaseById } from '@/cases';
import * as THREE from 'three';
import {
  navigatorLayers,
  segmentLayerOn,
  useHudStore,
  useSegmentHover,
  useSimStore,
} from '@/app/store';
import { modePolicy } from '@/app/modePolicy';
import type { PatientState, ThoraxModel } from '@/simulator/anatomy/thoraxModel';
import type { HeartFrame } from '@/simulator/anatomy/heartFrame';
import type { MeshError, MeshReply, MeshRequest, NavigatorModel } from '@/workers/heartMesh.worker';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { buildHeartGhost, buildSkeleton, buildSkin, buildWindowMarks } from './navigatorBody';
import {
  createCameraRig,
  narrowPanelFovDeg,
  navigatorState,
  type NavigatorZoom,
} from './navigatorCamera';
import { createHeartMeshes } from './navigatorHeart';
import { attachNavigatorInput } from './navigatorInput';
import { buildProbe, updateFan } from './navigatorProbe';
import { createReviewMarkers } from './navigatorReview';

export { narrowPanelFovDeg, type NavigatorZoom };

export interface NavigatorSceneOptions {
  caseId: string;
  patient: PatientState;
  /** What a drag on the torso does, read at each pointer event. */
  dragAction: { readonly current: 'probe' | 'camera' };
  /** Filled with the camera controls once the scene is up, for the component's buttons. */
  zoom: { current: NavigatorZoom | null };
}

/**
 * Builds the 3D navigator (torso, probe, fan, heart) in `el` and runs it until the returned cleanup: renderer, scene,
 * mesh worker, pointer handling and the render-on-change loop. Framework-free, so the React component only mounts it.
 * The pieces live in their own modules: the body (`navigatorBody`), the probe and its fan (`navigatorProbe`), the heart
 * surfaces (`navigatorHeart`), the review markers (`navigatorReview`), the camera (`navigatorCamera`) and the pointer
 * (`navigatorInput`); this module wires them to the stores and draws when something they show has changed.
 */
export function mountNavigatorScene(
  el: HTMLDivElement,
  { caseId, patient, dragAction: dragActionRef, zoom: zoomRef }: NavigatorSceneOptions,
): () => void {
  // the models arrive from the mesh worker as data (NavigatorModel, audit B7): until then the scene has the
  // probe, the fan and the lights, and the pose-dependent parts wait
  let thorax: ThoraxModel | null = null;
  let heartFrame: HeartFrame | null = null;
  // transparent over the panel's own radial backdrop (decision 202): the scene reads as lit in a room, not on a card
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true });
  renderer.localClippingEnabled = true; // the heart is cut by the imaging plane (decision 57)
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x0f1319, 0);
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 300);
  // render-on-change bookkeeping for the navigator (see tick)
  let dirty = true;
  let lastRenderAt = 0;
  let lastCostMs = 0;
  let shownPhaseIdx = -1;
  let shownPhasesReady = -1;
  // Filmic tone mapping and a rim light: the anatomy is read by its volume, and flat linear output made
  // the myocardial shells look like cut-outs. The geometry itself stays the one the beam cuts — importing
  // a sculpted heart mesh would look better and stop matching the image, which is the whole point.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  // a warm key, a cool fill and a stronger rim from behind (decision 202): skin and shells get a soft edge light
  // instead of a flat front wash
  scene.add(new THREE.HemisphereLight(0xe8eef5, 0x12161d, 0.85));
  const key = new THREE.DirectionalLight(0xfff1e2, 1.25);
  key.position.set(-14, 24, 40);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdcecff, 1.2); // behind and above: separates the shells from the background
  rim.position.set(-8, 12, -14);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0x8fb2e6, 0.42);
  fill.position.set(22, -8, 28);
  scene.add(fill);

  // ---- body (built when the navigator model arrives) ----
  let skin: THREE.Mesh | null = null;
  let skeleton: THREE.Group | null = null;
  let ghost: THREE.Group | null = null;
  let windowMarks: THREE.Group | null = null;
  // the imaging plane doubles as a clipping plane: the 3D heart is split exactly where the beam cuts
  const cutPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const onModel = (model: NavigatorModel) => {
    useSimStore.getState().setNavigatorReady(true);
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
  // 0.26 cm and ten phases: extraction costs 553 ms per phase at this step against 2171 ms at 0.20, so the
  // whole beat is ready in ~5.5 s of worker time with the first phase on screen in half a second. The
  // finer grid left fewer black facets (3.2% of folded vertices on the RV wall against 4.5% here), but a
  // heart that stands still beside a beating image gives the model away far more than half a point of
  // facets (decisions 67 and 68).
  const MESH_PHASES = Array.from({ length: 10 }, (_, i) => i / 10);
  // surfaces extracted from the same implicit model the beam samples, so navigator and image cannot disagree
  const heart = createHeartMeshes(scene, cutPlane, MESH_PHASES.length);
  // extraction samples the implicit model hundreds of thousands of times: off the UI thread, with the
  // ghost showing until the surfaces arrive
  const meshWorker = new Worker(new URL('../../workers/heartMesh.worker.ts', import.meta.url), {
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
    if (!heartFrame) return; // the model always precedes the meshes
    heart.addPhase(ev.data, heartFrame);
    if (ghost) ghost.visible = false;
    dirty = true;
  };
  meshWorker.postMessage({
    caseDef: loadCaseById(caseId),
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
  // review markers placed on the model (decision 135)
  const review = createReviewMarkers(scene);

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
  const rig = createCameraRig(
    camera,
    () => thorax,
    () => {
      dirty = true;
    },
  );
  zoomRef.current = rig.zoom;
  const dom = renderer.domElement;
  const detachInput = attachNavigatorInput({
    el,
    dom,
    camera,
    rig,
    dragAction: dragActionRef,
    marker,
    heart,
    cutPlane,
    body: () => ({ thorax, heartFrame, skin, skeleton, ghost }),
  });

  const resize = () => {
    const w = el.clientWidth || 300,
      h = el.clientHeight || 300;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // a tall, narrow panel (the exam's rail, torso alone, decision 256) widens the vertical field so the chest keeps
    // the width it has in a panel half as tall instead of filling the view with two ribs
    camera.fov = narrowPanelFovDeg(camera.aspect);
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
    const st = navigatorState();
    if (!thorax) {
      renderer.render(scene, camera);
      return;
    }
    const hudPhaseNow = useHudStore.getState().hud?.phase ?? 0;
    const phaseIdxNow = Math.round(hudPhaseNow * MESH_PHASES.length) % MESH_PHASES.length;
    if (phaseIdxNow !== shownPhaseIdx || heart.phasesReady() !== shownPhasesReady) dirty = true;
    const now = performance.now();
    const minInterval = lastCostMs > 25 ? Math.min(500, lastCostMs * 4) : 0;
    if ((!dirty && now - lastRenderAt < 1000) || now - lastRenderAt < minInterval) return;
    dirty = false;
    lastRenderAt = now;
    shownPhaseIdx = phaseIdxNow;
    shownPhasesReady = heart.phasesReady();
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
    // the saved layers, or in exam mode the skin and the ribs alone (decision 256)
    const layers = navigatorLayers(st);
    const anatomy = modePolicy(st.mode).navigatorAnatomy;
    heart.update({
      beam,
      layers,
      anatomy,
      phase: hudPhaseNow,
      segments: {
        on: segmentLayerOn(st),
        model: st.ui.segmentModel,
        selected: st.ui.selectedSegment,
        hovered: useSegmentHover.getState().id,
      },
    });
    // the schematic heart stands in until the surfaces arrive, and only where the heart may be seen
    if (ghost) ghost.visible = anatomy && heart.phasesReady() === 0;
    axisGroup.visible = layers.axes;
    review.sync(st.reviewMarkers, st.reviewSelectedId);
    review.group.visible = st.ui.reviewMode;
    if (layers.axes) {
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
    if (skeleton) skeleton.visible = layers.skeleton;
    if (windowMarks) windowMarks.visible = layers.windows;
    // the skin is a layer of its own: hiding the bones used to make it opaque, which hid the heart; in the exam the
    // ribs are the landmark, so the skin stays as translucent as over the heart (decision 256)
    if (skin) {
      skin.visible = layers.skin;
      (skin.material as THREE.MeshStandardMaterial).opacity =
        !anatomy || layers.heart || layers.chambers || layers.vessels ? 0.32 : 0.85;
    }
    // what the frame draws, read from the objects themselves, for the E2E check of the exam (decision 256)
    const drawn = [
      skin?.visible && 'skin',
      skeleton?.visible && 'skeleton',
      [...heart.meshByGroup.values()].some((m) => m.visible) && 'heart',
      ghost?.visible && 'ghost',
      windowMarks?.visible && 'windows',
      axisGroup.visible && 'axes',
    ]
      .filter(Boolean)
      .join(' ');
    if (el.dataset['drawn'] !== drawn) el.dataset['drawn'] = drawn;
    renderer.render(scene, camera);
    lastCostMs = performance.now() - now;
  };
  tick();
  return () => {
    cancelAnimationFrame(raf);
    unsubDirty();
    unsubHover();
    detachInput();
    meshWorker.terminate();
    ro.disconnect();
    renderer.dispose();
    el.removeChild(renderer.domElement);
  };
}
