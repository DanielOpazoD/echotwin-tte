import * as THREE from 'three';
import type { HeartFrame } from '@/simulator/anatomy/heartFrame';
import type { BeamFrame } from '@/simulator/probe/pose';
import type { MeshReply } from '@/workers/heartMesh.worker';
import { SEGMENT_RGB, segmentIdOf, type SegmentModelChoice } from '../segmentMap';

/**
 * The heart surfaces of the 3D navigator: the meshes the worker extracts from the same implicit model the beam samples,
 * one geometry per cardiac phase, cut by the imaging plane with a stencil cap where the cut is, and the LV segments
 * painted on the myocardium.
 */

/** The navigator layers and segment state one frame of the heart depends on. */
export interface HeartFrameState {
  beam: BeamFrame;
  layers: {
    cut: boolean;
    heart: boolean;
    chambers: boolean;
    valves: boolean;
    vessels: boolean;
  };
  /** Whether the anatomy may be seen at all (never in the exam, decision 256). */
  anatomy: boolean;
  /** Cardiac phase on screen, 0–1. */
  phase: number;
  segments: {
    on: boolean;
    model: SegmentModelChoice;
    selected: number | null;
    hovered: number | null;
  };
}

export interface HeartMeshes {
  /** Surface of each group (`lv-myocardium`, `atria`, …), once its first phase has arrived. */
  readonly meshByGroup: ReadonlyMap<string, THREE.Mesh>;
  /** Per-vertex LV segment codes of each phase's myocardium geometry. */
  readonly lvSegmentsByGeom: ReadonlyMap<THREE.BufferGeometry, Uint8Array>;
  /** Phases received so far (they arrive in order). */
  phasesReady: () => number;
  /** Adds the surfaces of one phase, placed in the torso with the heart frame. */
  addPhase: (reply: MeshReply, frame: HeartFrame) => void;
  /** Visibility, clipping, caps, the phase shown and the segment colours, for the frame about to be drawn. */
  update: (s: HeartFrameState) => void;
}

const LV_BASE = new THREE.Color(0xc4534f);
const FADED = new THREE.Color().setRGB(58 / 255, 63 / 255, 74 / 255, THREE.SRGBColorSpace);
const HOVER_LIFT = new THREE.Color(1, 1, 1);

/** LV segments on the 3D heart (decision 152), as vertex colours with the model and selection of the segment panel. */
function paintSegments(
  geom: THREE.BufferGeometry,
  codes: Uint8Array,
  model: SegmentModelChoice,
  selected: number | null,
  hovered: number | null,
): void {
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
}

/**
 * The heart surfaces in `scene`, clipped by `cutPlane`. `phaseCount` is the number of phases the worker was asked for:
 * the heart beats only once all have arrived.
 */
export function createHeartMeshes(
  scene: THREE.Scene,
  cutPlane: THREE.Plane,
  phaseCount: number,
): HeartMeshes {
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
  const lvSegmentsByGeom = new Map<THREE.BufferGeometry, Uint8Array>();
  let segmentKeyShown = '';
  let phasesReady = 0;

  const addPhase = (reply: MeshReply, f: HeartFrame) => {
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(f.ex.x, f.ex.y, f.ex.z),
      new THREE.Vector3(f.ey.x, f.ey.y, f.ey.z),
      new THREE.Vector3(f.ez.x, f.ez.y, f.ez.z),
    );
    const placement = new THREE.Matrix4()
      .makeTranslation(f.origin.x, f.origin.y, f.origin.z)
      .multiply(basis);
    for (const g of reply.groups) {
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
      perPhase[reply.index] = geom;
      if (!meshByGroup.has(g.id)) {
        // a light clear coat: the shells look wet, as tissue does, without changing their colour (decision 202)
        const mat = new THREE.MeshPhysicalMaterial({
          color: g.color,
          roughness: 0.5,
          metalness: 0.02,
          clearcoat: 0.18,
          clearcoatRoughness: 0.55,
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
    phasesReady = Math.max(phasesReady, reply.index + 1);
  };

  const update = ({ beam, layers, anatomy, phase, segments }: HeartFrameState) => {
    const clip = layers.cut ? [cutPlane] : [];
    for (const m of meshMaterials) m.clippingPlanes = clip;
    const vis: Record<string, boolean> = {
      'lv-myocardium': layers.heart,
      'rv-myocardium': layers.heart,
      'lv-cavity': layers.chambers,
      'rv-cavity': layers.chambers,
      atria: layers.chambers,
      valves: layers.valves,
      'great-vessels': layers.vessels,
      'thoracic-aorta': layers.vessels,
    };
    // a group without a layer of its own shows with the anatomy, never in the exam
    for (const [id, mesh] of meshByGroup) mesh.visible = vis[id] ?? anatomy;
    for (const [id, c] of capByGroup) {
      const v = (vis[id] ?? anatomy) && layers.cut;
      c.stencil.visible = v;
      c.cap.visible = v;
      c.cap.position.set(beam.origin.x, beam.origin.y, beam.origin.z);
      c.cap.lookAt(
        beam.origin.x + beam.normal.x,
        beam.origin.y + beam.normal.y,
        beam.origin.z + beam.normal.z,
      );
    }
    // beat in step with the image: the phase comes from the frame on screen, not from a clock of our own
    // only once the whole beat is in: animating a partial set would loop three phases as if they were the
    // entire cycle, which is a different lie from standing still
    if (phasesReady === phaseCount) {
      const idx = Math.round(phase * phaseCount) % phaseCount;
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
    const segKey = `${segments.on ? 1 : 0}|${segments.model}|${segments.selected ?? '-'}|${segments.hovered ?? '-'}`;
    if (segKey !== segmentKeyShown) {
      const lvMesh = meshByGroup.get('lv-myocardium');
      if (lvMesh) {
        const mat = lvMesh.material as THREE.MeshStandardMaterial;
        if (segments.on)
          for (const [geom, codes] of lvSegmentsByGeom)
            paintSegments(geom, codes, segments.model, segments.selected, segments.hovered);
        mat.vertexColors = segments.on;
        mat.color.set(segments.on ? 0xffffff : 0xc4534f);
        mat.needsUpdate = true;
        segmentKeyShown = segKey;
      }
    }
  };

  return { meshByGroup, lvSegmentsByGeom, phasesReady: () => phasesReady, addPhase, update };
}

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
