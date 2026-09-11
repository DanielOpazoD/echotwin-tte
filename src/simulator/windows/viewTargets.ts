import type { Vec3 } from '@/core/vec3';
import { dot, normalize, scale, sub, v3 } from '@/core/vec3';
import type { HeartModel } from '@/simulator/anatomy/heartModel';
import { heartDirToTorso, heartToTorso } from '@/simulator/anatomy/heartModel';
import { skinZ, snapToIntercostal, type ThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { beamFrameFromPose, controlAimingAt, poseFromControl, type BeamFrame, type ProbeControl } from '@/simulator/probe/pose';

export type WindowId = 'parasternal' | 'apical' | 'subcostal' | 'suprasternal';

/**
 * ViewTarget (spec 50): what a standard view must show. The canonical pose is *derived from the
 * case anatomy* (heart position, size) so it adapts to each synthetic patient. It is used for
 * scoring and hints, never to teleport the probe.
 */
export interface LandmarkRequirement {
  landmarkId: string;
  weight: number; // relative importance
  required: boolean;
}

export interface ViewTarget {
  id: string;
  name: string;
  window: WindowId;
  /** Heart-frame plane definition: two in-plane directions (screen-right, screen-down) and a target point the beam should pass through. */
  planeRight: Vec3;
  planeDown: Vec3;
  target: Vec3;
  /** Skin location of the canonical window (torso cm). */
  skin: { u: number; v: number };
  requiredLandmarks: LandmarkRequirement[];
  penaltyLandmarks: LandmarkRequirement[];
  recommendedDepthRangeCm: [number, number];
  recommendedFocusCm: number;
  hints: string[];
  commonErrors: string[];
  /** Pose tolerances used for the geometric similarity component. */
  tolerance: { planeAngleDeg: number; inPlaneRotationDeg: number; offsetCm: number };
}

const R = (v: Vec3): Vec3 => normalize(v);

/** Heart-frame direction that PLAX sweeps across: anteroseptal (+) ↔ inferolateral (−). */
const PLAX_AP = R(v3(-0.5, 0.866, 0)); // from lateral(x)/anterior(y): anteroseptal direction

export function buildViewTargets(): ViewTarget[] {
  return [
    {
      id: 'plax',
      name: 'Paraesternal eje largo (PLAX)',
      window: 'parasternal',
      planeRight: R(v3(0, 0, -1)), // screen right = toward the base (aorta/LA)
      planeDown: PLAX_AP.x < 0 ? R(scale(PLAX_AP, -1)) : PLAX_AP, // screen down = posterior (inferolateral)
      target: v3(-0.2, 0.3, 1.2), // centre on the base (MV/LVOT) so the root and LA are in the sector; the LV extends left

      skin: { u: 2.6, v: 1.6 },
      requiredLandmarks: [
        { landmarkId: 'mv', weight: 1.2, required: true },
        { landmarkId: 'av', weight: 1.2, required: true },
        { landmarkId: 'la', weight: 1, required: true },
        { landmarkId: 'lvot', weight: 1, required: true },
        { landmarkId: 'ivs-anteroseptal', weight: 1, required: true },
        { landmarkId: 'wall-inferolateral', weight: 1, required: true },
        { landmarkId: 'rv-anterior', weight: 0.7, required: false },
        { landmarkId: 'aortic-root', weight: 0.6, required: false },
        { landmarkId: 'desc-aorta', weight: 0.3, required: false },
      ],
      penaltyLandmarks: [
        { landmarkId: 'lv-apex', weight: 0.8, required: false },
        { landmarkId: 'ra', weight: 0.6, required: false },
        { landmarkId: 'tv', weight: 0.6, required: false },
        { landmarkId: 'pap-al', weight: 0.4, required: false },
      ],
      recommendedDepthRangeCm: [13, 18],
      recommendedFocusCm: 8,
      hints: [
        'Coloca la sonda en el 3.º–4.º espacio intercostal paraesternal izquierdo con el marcador hacia el hombro derecho.',
        'El VI debe verse alargado, con la válvula mitral y aórtica alineadas y la AI bajo la raíz aórtica.',
      ],
      commonErrors: ['Plano oblicuo (VI acortado o redondeado)', 'Demasiado alto: solo aorta y AI', 'Demasiado bajo: aparecen papilares', 'Sonda sobre costilla'],
      tolerance: { planeAngleDeg: 18, inPlaneRotationDeg: 20, offsetCm: 1.5 },
    },
    {
      id: 'psax-av',
      name: 'PSAX nivel válvula aórtica',
      window: 'parasternal',
      // the AV short axis is perpendicular to the AORTIC ROOT axis (tilted ~39° from the LV long axis),
      // which is why the probe is angled toward the base to make the valve appear round
      planeRight: R(v3(0.847, 0.488, 0.212)),
      planeDown: R(v3(0.51, -0.63, -0.585)),
      target: v3(-0.78, 1.65, -0.64), // mid-cusp level (0.5 cm above the annular nadir along the root axis)
      skin: { u: 2.6, v: 1.6 },
      requiredLandmarks: [
        { landmarkId: 'av', weight: 1.5, required: true },
        { landmarkId: 'la', weight: 1, required: true },
        { landmarkId: 'ra', weight: 0.8, required: true },
        { landmarkId: 'rvot', weight: 0.9, required: true },
        { landmarkId: 'tv', weight: 0.6, required: false },
        { landmarkId: 'ias', weight: 0.5, required: false },
      ],
      penaltyLandmarks: [
        { landmarkId: 'lv-mid', weight: 1, required: false },
        { landmarkId: 'pap-al', weight: 0.8, required: false },
      ],
      recommendedDepthRangeCm: [12, 16],
      recommendedFocusCm: 7,
      hints: ['Desde PLAX rota 90° en sentido horario y angula ligeramente hacia la base hasta ver la válvula aórtica en el centro con sus tres velos.'],
      commonErrors: ['Rotación incompleta (plano oblicuo)', 'Nivel demasiado bajo: mitral en vez de aórtica'],
      tolerance: { planeAngleDeg: 18, inPlaneRotationDeg: 25, offsetCm: 1.5 },
    },
    {
      id: 'psax-mv',
      name: 'PSAX nivel mitral',
      window: 'parasternal',
      planeRight: R(v3(0.866, 0.5, 0)),
      planeDown: R(v3(0.5, -0.866, 0)),
      target: v3(0, -0.2, 1.4),
      skin: { u: 2.6, v: 1.6 },
      requiredLandmarks: [
        { landmarkId: 'mv', weight: 1.5, required: true },
        { landmarkId: 'rv', weight: 0.8, required: true },
        { landmarkId: 'ivs-inferoseptal', weight: 0.8, required: false },
        { landmarkId: 'wall-inferolateral', weight: 0.8, required: false },
      ],
      penaltyLandmarks: [
        { landmarkId: 'av', weight: 1, required: false },
        { landmarkId: 'pap-al', weight: 0.8, required: false },
        { landmarkId: 'la', weight: 0.5, required: false },
      ],
      recommendedDepthRangeCm: [12, 16],
      recommendedFocusCm: 8,
      hints: ['Desde el nivel aórtico angula (abanica) hacia el ápex hasta ver la mitral en "boca de pez".'],
      commonErrors: ['VI ovalado por plano oblicuo', 'Nivel papilar por exceso de angulación'],
      tolerance: { planeAngleDeg: 18, inPlaneRotationDeg: 25, offsetCm: 1.5 },
    },
    {
      id: 'psax-pm',
      name: 'PSAX nivel papilar',
      window: 'parasternal',
      planeRight: R(v3(0.866, 0.5, 0)),
      planeDown: R(v3(0.5, -0.866, 0)),
      target: v3(0, 0, 4.6),
      skin: { u: 2.6, v: 1.6 },
      requiredLandmarks: [
        { landmarkId: 'pap-al', weight: 1.2, required: true },
        { landmarkId: 'pap-pm', weight: 1.2, required: true },
        { landmarkId: 'lv-mid', weight: 1, required: true },
        { landmarkId: 'rv', weight: 0.7, required: false },
      ],
      penaltyLandmarks: [
        { landmarkId: 'mv', weight: 0.8, required: false },
        { landmarkId: 'av', weight: 1, required: false },
        { landmarkId: 'la', weight: 0.6, required: false },
      ],
      recommendedDepthRangeCm: [12, 16],
      recommendedFocusCm: 9,
      hints: ['Angula un poco más hacia el ápex: los dos músculos papilares deben verse simétricos y el VI circular.'],
      commonErrors: ['VI ovalado (oblicuo)', 'Un solo papilar visible por rotación incorrecta'],
      tolerance: { planeAngleDeg: 18, inPlaneRotationDeg: 25, offsetCm: 1.5 },
    },
    {
      id: 'psax-apex',
      name: 'PSAX nivel apical',
      window: 'parasternal',
      planeRight: R(v3(0.866, 0.5, 0)),
      planeDown: R(v3(0.5, -0.866, 0)),
      target: v3(0, 0, 6.6),
      skin: { u: 3.4, v: -1.0 },
      requiredLandmarks: [
        { landmarkId: 'lv-apical-cavity', weight: 1.5, required: true },
        { landmarkId: 'lv-apex', weight: 0.6, required: false },
      ],
      penaltyLandmarks: [
        { landmarkId: 'pap-al', weight: 1, required: false },
        { landmarkId: 'pap-pm', weight: 1, required: false },
        { landmarkId: 'mv', weight: 1, required: false },
        { landmarkId: 'av', weight: 1, required: false },
      ],
      recommendedDepthRangeCm: [10, 14],
      recommendedFocusCm: 8,
      hints: ['Desde el nivel papilar sigue angulando hacia el ápex (o baja un espacio): el VI se ve pequeño y circular, sin papilares.'],
      commonErrors: ['Nivel papilar por angulación insuficiente', 'Sector fuera del corazón por exceso de angulación'],
      tolerance: { planeAngleDeg: 18, inPlaneRotationDeg: 25, offsetCm: 1.5 },
    },
    {
      id: 'a4c',
      name: 'Apical cuatro cámaras (A4C)',
      window: 'apical',
      planeRight: R(v3(1, 0, 0)), // screen right = lateral wall (patient's left)
      planeDown: R(v3(0, 0, -1)), // screen down = toward the base (atria at the bottom)
      target: v3(-1.6, -0.5, 1.5),
      skin: { u: 6.8, v: -2.8 },
      requiredLandmarks: [
        { landmarkId: 'lv-apex', weight: 1.4, required: true },
        { landmarkId: 'mv', weight: 1.2, required: true },
        { landmarkId: 'tv', weight: 1.1, required: true },
        { landmarkId: 'la', weight: 1, required: true },
        { landmarkId: 'ra', weight: 1, required: true },
        { landmarkId: 'rv', weight: 1, required: true },
        { landmarkId: 'ivs-inferoseptal', weight: 0.9, required: true },
        { landmarkId: 'wall-anterolateral', weight: 0.9, required: true },
        { landmarkId: 'ias', weight: 0.5, required: false },
      ],
      penaltyLandmarks: [
        { landmarkId: 'av', weight: 1, required: false },
        { landmarkId: 'aortic-root', weight: 0.8, required: false },
      ],
      recommendedDepthRangeCm: [14, 18],
      recommendedFocusCm: 10,
      hints: ['Sonda en el ápex (5.º espacio, línea medioclavicular) con el marcador hacia la izquierda del paciente; el haz apunta hacia el hombro derecho.', 'El VI debe verse largo, con el ápex en la punta del sector y las cuatro cámaras con ambos septos.'],
      commonErrors: ['Acortamiento (ápex no verdadero)', 'Plano anterior: aparece la aorta (A5C)', 'Plano posterior: seno coronario'],
      tolerance: { planeAngleDeg: 15, inPlaneRotationDeg: 20, offsetCm: 1.5 },
    },
    {
      id: 'a5c',
      name: 'Apical cinco cámaras (A5C)',
      window: 'apical',
      planeRight: R(v3(1, 0.35, 0)),
      planeDown: R(v3(0, 0, -1)),
      target: v3(-0.7, 0.9, 1.0),
      skin: { u: 6.8, v: -2.8 },
      requiredLandmarks: [
        { landmarkId: 'lvot', weight: 1.3, required: true },
        { landmarkId: 'av', weight: 1.2, required: true },
        { landmarkId: 'lv-apex', weight: 1, required: true },
        { landmarkId: 'mv', weight: 0.8, required: false },
        { landmarkId: 'rv', weight: 0.7, required: false },
      ],
      penaltyLandmarks: [],
      recommendedDepthRangeCm: [14, 18],
      recommendedFocusCm: 10,
      hints: ['Desde A4C angula ligeramente anterior (hacia arriba) hasta abrir el TSVI y la válvula aórtica en el centro.'],
      commonErrors: ['Demasiado anterior: se pierde la tricúspide', 'TSVI no alineado con el haz'],
      tolerance: { planeAngleDeg: 15, inPlaneRotationDeg: 20, offsetCm: 1.5 },
    },
    {
      id: 'a2c',
      name: 'Apical dos cámaras (A2C)',
      window: 'apical',
      planeRight: R(v3(0, 1, 0)), // screen right = anterior wall
      planeDown: R(v3(0, 0, -1)),
      target: v3(0, 0, 1.5),
      skin: { u: 6.8, v: -2.8 },
      requiredLandmarks: [
        { landmarkId: 'lv-apex', weight: 1.4, required: true },
        { landmarkId: 'mv', weight: 1.2, required: true },
        { landmarkId: 'la', weight: 1, required: true },
        { landmarkId: 'wall-anterior', weight: 1, required: true },
        { landmarkId: 'wall-inferior', weight: 1, required: true },
      ],
      penaltyLandmarks: [
        { landmarkId: 'rv', weight: 1.2, required: false },
        { landmarkId: 'tv', weight: 1, required: false },
        { landmarkId: 'ra', weight: 1, required: false },
        { landmarkId: 'av', weight: 0.8, required: false },
      ],
      recommendedDepthRangeCm: [14, 18],
      recommendedFocusCm: 10,
      hints: ['Desde A4C rota ~60° en sentido antihorario sin desplazar la sonda: el VD desaparece y quedan VI, mitral y AI.'],
      commonErrors: ['Rotación insuficiente: VD todavía visible', 'Rotación excesiva: aparece la aorta (A3C)'],
      tolerance: { planeAngleDeg: 15, inPlaneRotationDeg: 20, offsetCm: 1.5 },
    },
    {
      id: 'a3c',
      name: 'Apical tres cámaras / eje largo apical (A3C)',
      window: 'apical',
      planeRight: R(v3(-0.5, 0.866, 0)), // screen right = anteroseptal/LVOT side
      planeDown: R(v3(0, 0, -1)),
      target: v3(-0.4, 0.6, 1.5),
      skin: { u: 6.8, v: -2.8 },
      requiredLandmarks: [
        { landmarkId: 'lv-apex', weight: 1.3, required: true },
        { landmarkId: 'mv', weight: 1.1, required: true },
        { landmarkId: 'lvot', weight: 1.2, required: true },
        { landmarkId: 'av', weight: 1.2, required: true },
        { landmarkId: 'la', weight: 0.9, required: true },
        { landmarkId: 'aortic-root', weight: 0.6, required: false },
      ],
      penaltyLandmarks: [
        { landmarkId: 'rv', weight: 1, required: false },
        { landmarkId: 'ra', weight: 1, required: false },
      ],
      recommendedDepthRangeCm: [14, 18],
      recommendedFocusCm: 10,
      hints: ['Desde A2C rota ~60° más en sentido antihorario hasta ver el TSVI y la aorta: es el PLAX visto desde el ápex.'],
      commonErrors: ['Plano intermedio A2C/A3C sin aorta clara'],
      tolerance: { planeAngleDeg: 15, inPlaneRotationDeg: 20, offsetCm: 1.5 },
    },
    {
      id: 'rv-focused',
      name: 'Apical enfocada en VD',
      window: 'apical',
      planeRight: R(v3(1, -0.3, 0)),
      planeDown: R(v3(0, 0, -1)),
      target: v3(-3.0, -0.3, 1.5),
      skin: { u: 6.0, v: -2.6 },
      requiredLandmarks: [
        { landmarkId: 'rv', weight: 1.5, required: true },
        { landmarkId: 'tv', weight: 1.2, required: true },
        { landmarkId: 'ra', weight: 1, required: true },
        { landmarkId: 'lv-apex', weight: 0.6, required: false },
        { landmarkId: 'ivs-inferoseptal', weight: 0.8, required: true },
      ],
      penaltyLandmarks: [{ landmarkId: 'av', weight: 1, required: false }],
      recommendedDepthRangeCm: [14, 18],
      recommendedFocusCm: 9,
      hints: ['Desde A4C desplaza la sonda ligeramente medial y rota un poco antihorario para maximizar el VD manteniendo el ápex.'],
      commonErrors: ['Simple zoom sin cambio de plano', 'Pérdida del ápex del VD'],
      tolerance: { planeAngleDeg: 15, inPlaneRotationDeg: 20, offsetCm: 1.5 },
    },
  ];
}

export const VIEW_TARGETS = buildViewTargets();

export function getViewTarget(id: string): ViewTarget {
  const v = VIEW_TARGETS.find((t) => t.id === id);
  if (!v) throw new Error(`Unknown view target ${id}`);
  return v;
}

/**
 * Skin point lying on the canonical plane, closest to a preferred skin location (max 2.5 cm away).
 * Apical views prefer the skin projection of the LV apex; parasternal views prefer the intercostal
 * space of the window definition. This is how a sonographer "finds" the plane: slide a little.
 */
export function skinPointOnPlane(thorax: ThoraxModel, plane: { target: Vec3; normal: Vec3 }, preferred: { u: number; v: number }, maxShiftCm = 2.5): { u: number; v: number } {
  const n = plane.normal;
  const inSkin = Math.hypot(n.x, n.y);
  if (inSkin < 1e-3) return preferred;
  const dx = n.x / inSkin,
    dy = n.y / inSkin;
  let u = preferred.u,
    v = preferred.v;
  for (let iter = 0; iter < 4; iter++) {
    const p = v3(u, v, skinZ(thorax, u, v));
    const err = dot(n, sub(p, plane.target));
    const t = -err / (n.x * dx + n.y * dy);
    u += dx * t;
    v += dy * t;
  }
  const shift = Math.hypot(u - preferred.u, v - preferred.v);
  if (shift > maxShiftCm) {
    const k = maxShiftCm / shift;
    u = preferred.u + (u - preferred.u) * k;
    v = preferred.v + (v - preferred.v) * k;
  }
  return { u, v };
}

/** Canonical probe control for a view target, computed from the case anatomy (for scoring/ghost only). */
export function canonicalControl(view: ViewTarget, heart: HeartModel, thorax: ThoraxModel): ProbeControl {
  const plane = canonicalPlane(view, heart);
  let preferred = view.skin;
  let skin = preferred;
  if (view.window === 'apical') {
    const apex = heartToTorso(heart.frame, v3(0, 0, heart.lv.lengthCm));
    preferred = { u: apex.x, v: apex.y };
    skin = skinPointOnPlane(thorax, plane, preferred, 3.5);
  } else if (view.id === 'plax') {
    skin = skinPointOnPlane(thorax, plane, preferred, 1.5);
  } else if (view.window === 'parasternal') {
    // short-axis planes are reached by sliding down/laterally along the sternal border; never over the sternum
    const p = skinPointOnPlane(thorax, plane, preferred, 3.5);
    skin = { u: Math.max(2.2, p.u), v: p.v };
  }
  // a sonographer always sits in an intercostal space, never on a rib
  skin = snapToIntercostal(thorax, skin.u, skin.v);
  return controlAimingAt(thorax, skin.u, skin.v, plane.target, plane.right, 0.6);
}

/** Canonical beam frame per (heart, view), cached: the pose a sonographer would reach for this anatomy. */
const canonicalBeamCache = new WeakMap<HeartModel, Map<string, BeamFrame>>();
export function canonicalBeam(view: ViewTarget, heart: HeartModel, thorax: ThoraxModel): BeamFrame {
  let m = canonicalBeamCache.get(heart);
  if (!m) {
    m = new Map();
    canonicalBeamCache.set(heart, m);
  }
  const key = `${view.id}|${thorax.lungShiftCm}|${thorax.heartOffset.x},${thorax.heartOffset.y},${thorax.heartOffset.z}`;
  let b = m.get(key);
  if (!b) {
    b = beamFrameFromPose(poseFromControl(thorax, canonicalControl(view, heart, thorax)));
    m.set(key, b);
  }
  return b;
}

/** Torso-frame plane basis for a view target (used by tests and the ghost overlay). */
export function canonicalPlane(view: ViewTarget, heart: HeartModel): { target: Vec3; right: Vec3; down: Vec3; normal: Vec3 } {
  const target = heartToTorso(heart.frame, view.target);
  const right = heartDirToTorso(heart.frame, view.planeRight);
  const down = heartDirToTorso(heart.frame, view.planeDown);
  const n = normalize(v3(right.y * down.z - right.z * down.y, right.z * down.x - right.x * down.z, right.x * down.y - right.y * down.x));
  return { target, right, down, normal: n };
}
