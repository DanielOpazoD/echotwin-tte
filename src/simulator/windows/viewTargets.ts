import type { Vec3 } from '@/core/vec3';
import { add, dot, normalize, scale, sub, v3 } from '@/core/vec3';
import type { HeartModel } from '@/simulator/anatomy/heartModel';
import { lvProfileG } from '@/simulator/anatomy/lvShape';
import { AV_AXIS, heartDirToTorso, heartToTorso } from '@/simulator/anatomy/heartModel';
import { isAnteriorLung, ribSpacingAt, skinZ, snapToIntercostal, type ThoraxModel } from '@/simulator/anatomy/thoraxModel';
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
/** A2C plane: 60° from A4C (which lies at azimuth ~2°, through the tricuspid inflow) and 60° from A3C/PLAX (122°). */
const A2C_RIGHT = R(v3(Math.cos(1.082), Math.sin(1.082), 0)); // 62°
const AV_CENTER = v3(-0.7, 1.35, -0.25);

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
      // The great-vessel short axis belongs to the same plane family as psax-mv and psax-pm — perpendicular to
      // the LV long axis — and is reached by rotating 90° from the PLAX in the same intercostal space; the
      // aortic valve looks round because the root itself is tilted, not because the plane chases its axis.
      // Until 2026-09-12 this view was defined perpendicular to the AORTIC ROOT axis, 62° away from the plane
      // through the three valves. Measured against that definition, the plane missed the pulmonary valve by
      // 2.02 cm, the infundibular mid point by 1.22 cm and the trunk by 4.53 cm, and the rendered view held
      // zero pixels of RVOT, pulmonary valve and pulmonary artery: the aorta floated with nothing around it.
      // Perpendicular to the long axis those fall at -1.08, 0.27 and -3.67 cm.
      planeRight: R(v3(0.866, 0.5, 0)),
      planeDown: R(v3(0.5, -0.866, 0)),
      target: v3(AV_CENTER.x + AV_AXIS.x * 0.7, AV_CENTER.y + AV_AXIS.y * 0.7, AV_CENTER.z + AV_AXIS.z * 0.7), // coaptation level
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
      planeRight: A2C_RIGHT, // screen right = anterior wall (60° from A4C)
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
      id: 'subcostal-4c',
      name: 'Subcostal cuatro cámaras',
      window: 'subcostal',
      // the plane through the subxiphoid window, the crux and the midpoint between the atria: from this window
      // the atrial centres cannot both lie in one plane with the probe, so the view cuts each atrium off-centre
      // and the LV obliquely (foreshortened), as real subcostal four-chamber images do
      // plane through the subxiphoid window, the crux and the midpoint between the RV and LA centres: from this
      // window the four chamber centres cannot share a plane with the probe, so the view cuts the RV inflow and
      // the LA off-centre and the LV obliquely (foreshortened), as real subcostal four-chamber images do
      planeRight: R(v3(0.66, 0.36, 0.66)), // screen right ⊥ beam, apex to the upper right, atria to the lower left
      planeDown: R(v3(0.57, 0.34, -0.75)), // screen down = the beam from the subxiphoid window toward the crux
      target: v3(-2.2, -0.5, 1.5), // the crux: both AV valves and the interatrial septum
      skin: { u: 0.5, v: -9.5 },
      requiredLandmarks: [
        { landmarkId: 'rv-inferior', weight: 1.2, required: true },
        { landmarkId: 'ra', weight: 1.2, required: true },
        { landmarkId: 'ias', weight: 1.2, required: true },
        { landmarkId: 'lv-mid', weight: 1, required: true },
        { landmarkId: 'la', weight: 0.6, required: false },
        { landmarkId: 'tv', weight: 0.6, required: false },
        { landmarkId: 'mv', weight: 0.5, required: false },
      ],
      penaltyLandmarks: [
        { landmarkId: 'av', weight: 0.6, required: false },
        { landmarkId: 'ivc', weight: 0.5, required: false },
      ],
      recommendedDepthRangeCm: [18, 24],
      recommendedFocusCm: 12,
      hints: [
        'Sonda bajo el apéndice xifoides, casi plana sobre el abdomen y con el marcador hacia la izquierda del paciente; el haz atraviesa el hígado hacia el hombro izquierdo.',
        'El hígado ocupa el campo cercano; debajo aparecen el VD y la AD y, más profundos, el VI y la AI con el tabique interauricular perpendicular al haz.',
      ],
      commonErrors: ['Sonda demasiado inclinada: sólo hígado', 'Plano anterior: TSVI en vez de las aurículas (subcostal 5C)', 'Abdomen tenso (rodillas sin flexionar)'],
      tolerance: { planeAngleDeg: 20, inPlaneRotationDeg: 25, offsetCm: 2.0 },
    },
    {
      id: 'subcostal-ivc',
      name: 'Subcostal vena cava inferior',
      window: 'subcostal',
      // plane containing the cava axis, the RA and the subxiphoid window (an oblique sagittal cut)
      planeRight: R(v3(-0.09, 0.97, 0.21)), // screen right ⊥ beam, along the cava toward the RA (patient's head)
      planeDown: R(v3(0.43, 0.23, -0.87)), // screen down = the beam from the subxiphoid window to the cavo-atrial junction
      target: v3(-3.8, -1.7, 0.7), // cavo-atrial junction
      skin: { u: 0.0, v: -9.5 },
      requiredLandmarks: [
        { landmarkId: 'ivc', weight: 1.5, required: true },
        { landmarkId: 'ra', weight: 1.0, required: true },
        { landmarkId: 'hepatic-vein', weight: 0.6, required: false },
      ],
      penaltyLandmarks: [
        { landmarkId: 'lv-mid', weight: 1, required: false },
        { landmarkId: 'mv', weight: 0.8, required: false },
        { landmarkId: 'la', weight: 0.6, required: false },
      ],
      recommendedDepthRangeCm: [14, 20],
      recommendedFocusCm: 8,
      hints: ['Desde la subcostal de cuatro cámaras rota ~90° antihorario (marcador hacia la cabeza) y angula hacia la derecha del paciente hasta ver la vena cava inferior entrando en la aurícula derecha, con la vena hepática.', 'Mide el diámetro 1–2 cm antes de la desembocadura y observa el colapso con la inspiración brusca.'],
      commonErrors: ['Confundir la aorta abdominal (pulsátil, a la izquierda) con la cava', 'Corte oblicuo de la cava: diámetro falsamente pequeño'],
      tolerance: { planeAngleDeg: 20, inPlaneRotationDeg: 30, offsetCm: 2.0 },
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

/**
 * Share of the sector's rays (80°, 17 rays) that meet lung before the depth of the view target: what a sonographer
 * sees when choosing between two intercostal spaces. The renderer draws only reverberation behind the pleura.
 */
export function lungOcclusion(thorax: ThoraxModel, control: ProbeControl, target: Vec3): number {
  const beam = beamFrameFromPose(poseFromControl(thorax, control), 1);
  const reach = dot(sub(target, beam.origin), beam.forward);
  const RAYS = 17;
  let blocked = 0;
  for (let i = 0; i < RAYS; i++) {
    const a = (i / (RAYS - 1) - 0.5) * ((80 * Math.PI) / 180);
    const dir = add(scale(beam.forward, Math.cos(a)), scale(beam.lateral, Math.sin(a)));
    for (let r = 0.25; r < reach; r += 0.25) {
      const p = add(beam.origin, scale(dir, r));
      if (isAnteriorLung(thorax, p.x, p.y, p.z)) {
        blocked++;
        break;
      }
    }
  }
  return blocked / RAYS;
}

/**
 * Share of the left ventricular wall drawn by a probe control that lies behind lung: the mid-wall surface of the resting
 * ventricle, sampled within 0.5 cm of the image plane and inside the 80° sector, with lung anywhere between the probe
 * and the sample. The renderer shows only reverberation behind the pleura, so this is the wall the image loses.
 */
export function ventricleHiddenShare(heart: HeartModel, thorax: ThoraxModel, control: ProbeControl): number {
  const beam = beamFrameFromPose(poseFromControl(thorax, control), 1);
  const { lengthCm: L, rMax, shape } = heart.lv;
  const halfSector = (40 * Math.PI) / 180;
  let seen = 0,
    hidden = 0;
  for (let zi = 1; zi <= 12; zi++) {
    const zeta = zi / 13;
    const r = rMax * lvProfileG(shape, zeta) + 0.45;
    for (let k = 0; k < 48; k++) {
      const phi = (k / 48) * 2 * Math.PI;
      const pT = heartToTorso(heart.frame, v3(r * Math.cos(phi), r * shape.ratio * Math.sin(phi), zeta * L));
      const d = sub(pT, beam.origin);
      if (Math.abs(dot(d, beam.normal)) > 0.5) continue;
      const dep = dot(d, beam.forward);
      if (dep <= 0 || Math.abs(Math.atan2(dot(d, beam.lateral), dep)) > halfSector) continue;
      seen++;
      const len = Math.hypot(d.x, d.y, d.z);
      for (let t = 0.25; t < len; t += 0.25) {
        const q = add(beam.origin, scale(d, t / len));
        if (isAnteriorLung(thorax, q.x, q.y, q.z)) {
          hidden++;
          break;
        }
      }
    }
  }
  return seen ? hidden / seen : 0;
}

/** Canonical probe control for a view target, computed from the case anatomy (for scoring/ghost only). */
export function canonicalControl(view: ViewTarget, heart: HeartModel, thorax: ThoraxModel): ProbeControl {
  const plane = canonicalPlane(view, heart);
  let preferred = view.skin;
  let skin = preferred;
  if (view.window === 'apical') {
    const apex = heartToTorso(heart.frame, v3(0, 0, heart.lv.lengthCm));
    preferred = { u: apex.x, v: apex.y };
    // rotate at the apex and slide at most 2 cm: the exact 60° planes through the long axis would need a 3.4 cm
    // lateral slide for A2C (among the lateral ribs); a real A2C accepts a few degrees of obliquity instead
    const slid = skinPointOnPlane(thorax, plane, preferred, 2.0);
    // A sonographer takes the intercostal space from which the heart is seen. The slid point can fall almost halfway
    // between two spaces: the A3C one did (v −3.1, centres at −1.6 and −4.8), the nearest was the upper space, and
    // there the lingula lies between chest wall and heart — the A3C preset showed 66–83% lung and no LV in eight of
    // the twelve cases (decision 72). The adjacent space wins only when it clearly hides less of the sector: in the
    // eight broken presets it hid 0% of the rays against 65–88%, and elsewhere the difference never exceeded 6%
    // (always choosing the apex's own space instead foreshortened A4C from 9° to 31–41° in three cases).
    const near = snapToIntercostal(thorax, slid.u, slid.v);
    const spacing = ribSpacingAt(thorax, slid.u);
    const other = snapToIntercostal(thorax, slid.u, near.v + (slid.v > near.v ? spacing : -spacing));
    const hidden = (p: { u: number; v: number }): number => lungOcclusion(thorax, controlAimingAt(thorax, p.u, p.v, plane.target, plane.right, 0.6), plane.target);
    skin = hidden(other) < hidden(near) - 0.1 ? other : near;
    // Within that space the slide toward the plane stops before the lung covers the ventricle. Sliding the full 2 cm put
    // the A2C probe over the lung border: the lingula hid 35% of the LV wall in the normal case — the anterior wall — and
    // 23-50% in all twelve, while 1-1.5 cm back toward the apex the wall lay clear (decision 83). The probe keeps the
    // longest slide, the least obliquity, that leaves at most a tenth of the wall behind lung, or failing that no more
    // than 5 points above the clearest position this window allows.
    const back = Math.sign(preferred.u - skin.u);
    const stops = [skin];
    for (let d = 0.5; d < Math.abs(preferred.u - skin.u); d += 0.5) stops.push(snapToIntercostal(thorax, skin.u + back * d, skin.v));
    if (Math.abs(preferred.u - skin.u) > 0.25) stops.push(snapToIntercostal(thorax, preferred.u, skin.v));
    const hiddenAt = (p: { u: number; v: number }): number => ventricleHiddenShare(heart, thorax, controlAimingAt(thorax, p.u, p.v, plane.target, plane.right, 0.6));
    // a clear first position needs no search: it is the longest slide and within any tolerance
    if (stops.length > 1 && hiddenAt(skin) > 0.1) {
      const hid = stops.map(hiddenAt);
      const tolerated = Math.max(0.1, Math.min(...hid) + 0.05);
      skin = stops[hid.findIndex((h) => h <= tolerated + 1e-9)]!;
    }
  } else if (view.id === 'plax') {
    skin = skinPointOnPlane(thorax, plane, preferred, 1.5);
  } else if (view.window === 'parasternal') {
    // short-axis planes: a sonographer stays close to the PLAX window (3rd–4th space) and tilts the probe,
    // accepting some obliquity, rather than climbing toward the 2nd space; never over the sternum
    const p = skinPointOnPlane(thorax, plane, preferred, 1.0);
    skin = { u: Math.max(2.2, p.u), v: p.v };
  } else if (view.window === 'subcostal') {
    // slide along the costal margin (never above it) until the plane passes through the window
    const p = skinPointOnPlane(thorax, plane, preferred, 2.0);
    skin = { u: p.u, v: Math.min(-8.5, p.v) };
  }
  // a sonographer always sits in an intercostal space, never on a rib (the subcostal window has none)
  if (view.window !== 'subcostal') skin = snapToIntercostal(thorax, skin.u, skin.v);
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
