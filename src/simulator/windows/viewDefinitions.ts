import type { Vec3 } from '@/core/vec3';
import { normalize, scale, v3 } from '@/core/vec3';
import { AV_AXIS, MITRAL_SHORT_AXIS_CM } from '@/simulator/anatomy/heartFrame';

/**
 * The canonical views as data: plane in the heart frame, skin window, landmarks, hints and tolerances.
 * Split from viewTargets.ts (which keeps the window solver and needs the whole anatomy engine) so the
 * UI can list views and read their names without pulling the engine into the entry chunk (audit B7).
 */
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
  /**
   * The target's long-axis coordinate scales with the LV's length, `target.z` being the level in the reference
   * ventricle (`REFERENCE_LV_LENGTH_CM`, decision 170): the short axes below the mitral level aim at a level of the
   * ventricle, as their landmarks do.
   */
  scalesWithLvLength?: boolean;
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

/**
 * LV length (cm) of the normal case, the ventricle whose levels the short axes' targets are written for; a view whose
 * target scales with the LV's length aims at the same fraction of any other (decision 170).
 */
export const REFERENCE_LV_LENGTH_CM = 8.6;

const R = (v: Vec3): Vec3 => normalize(v);

/** Heart-frame direction that PLAX sweeps across: anteroseptal (+) ↔ inferolateral (−). */
const PLAX_AP = R(v3(-0.5, 0.866, 0)); // from lateral(x)/anterior(y): anteroseptal direction
/**
 * A2C plane: ~60° from A4C (which lies at azimuth ~2°, through the tricuspid inflow) and ~60° from A3C/PLAX (122°).
 * 64° rather than the 62° halfway: at 62° the plane, aimed exactly from the apical probe (decision 139), clipped the
 * inferior vena cava at the deep inferior edge of the sector (0.23% of it), which no two-chamber view holds; at 64° it
 * misses the cava in the normal case (1% at 58°, 0 from 64° on).
 */
const A2C_RIGHT = R(v3(Math.cos(1.117), Math.sin(1.117), 0)); // 64°
const AV_CENTER = v3(-0.7, 1.35, -0.25);
/** Turn of the A5C plane about the long axis from the septal–lateral direction toward the inferior wall (decision 139). */
const A5C_TURN = (-6 * Math.PI) / 180;

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
      commonErrors: [
        'Plano oblicuo (VI acortado o redondeado)',
        'Demasiado alto: solo aorta y AI',
        'Demasiado bajo: aparecen papilares',
        'Sonda sobre costilla',
      ],
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
      target: v3(
        AV_CENTER.x + AV_AXIS.x * 0.7,
        AV_CENTER.y + AV_AXIS.y * 0.7,
        AV_CENTER.z + AV_AXIS.z * 0.7,
      ), // coaptation level
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
      hints: [
        'Desde PLAX rota 90° en sentido horario y angula hacia la base hasta ver la válvula aórtica en el centro con sus tres velos; si la raíz sale ovalada, sube un espacio intercostal: el corte debe ser perpendicular a la raíz.',
      ],
      commonErrors: [
        'Rotación incompleta (plano oblicuo)',
        'Nivel demasiado bajo: mitral en vez de aórtica',
      ],
      tolerance: { planeAngleDeg: 18, inPlaneRotationDeg: 25, offsetCm: 1.5 },
    },
    {
      id: 'psax-mv',
      name: 'PSAX nivel mitral',
      window: 'parasternal',
      planeRight: R(v3(0.866, 0.5, 0)),
      planeDown: R(v3(0.5, -0.866, 0)),
      target: v3(0, -0.2, MITRAL_SHORT_AXIS_CM),
      skin: { u: 2.6, v: 1.6 },
      // the basal walls and RV this level cuts (decision 164); the mid-level ones lie 1.6-2.5 cm toward the apex, beyond
      // the reach of any mitral short axis
      requiredLandmarks: [
        { landmarkId: 'mv', weight: 1.5, required: true },
        { landmarkId: 'rv-basal', weight: 0.8, required: true },
        { landmarkId: 'ivs-inferoseptal-basal', weight: 0.8, required: false },
        { landmarkId: 'wall-inferolateral-basal', weight: 0.8, required: false },
      ],
      penaltyLandmarks: [
        { landmarkId: 'av', weight: 1, required: false },
        { landmarkId: 'pap-al', weight: 0.8, required: false },
        { landmarkId: 'la', weight: 0.5, required: false },
      ],
      recommendedDepthRangeCm: [12, 16],
      recommendedFocusCm: 8,
      hints: [
        'Desde el nivel aórtico angula (abanica) hacia el ápex hasta ver la mitral en "boca de pez".',
      ],
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
      // where the papillary muscles are in the reference ventricle; a fixed height left the dilated HFrEF ventricle
      // (9.8 cm) cut 1 cm above its papillary landmarks
      scalesWithLvLength: true,
      // 2 cm lateral to the sternal-edge point of the other short axes, in the same space (decision 182): the probe lands
      // at u 4.2 once it slides back toward the plane. From the sternal edge the cut showed the RV at 11.1-11.2 o'clock,
      // its insertions at 1.1-1.3 and 9.1-9.2 and the papillary muscles at 5.3-5.5 and 8.6-8.8, 1.07-1.14 h clockwise of
      // an average patient's; from here 0.69-0.80 h, the section 10-20° off the short axis instead of 1-13°.
      skin: { u: 5.0, v: 1.6 },
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
      hints: [
        'Angula un poco más hacia el ápex: los dos músculos papilares deben verse simétricos y el VI circular.',
      ],
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
      // a fixed height left the dilated HFrEF ventricle cut 1.2 cm above its apical cavity landmark
      scalesWithLvLength: true,
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
      hints: [
        'Desde el nivel papilar sigue angulando hacia el ápex (o baja un espacio): el VI se ve pequeño y circular, sin papilares.',
      ],
      commonErrors: [
        'Nivel papilar por angulación insuficiente',
        'Sector fuera del corazón por exceso de angulación',
      ],
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
      hints: [
        'Sonda en el ápex (5.º espacio, línea medioclavicular) con el marcador hacia la izquierda del paciente; el haz apunta hacia el hombro derecho.',
        'El VI debe verse largo, con el ápex en la punta del sector y las cuatro cámaras con ambos septos.',
      ],
      commonErrors: [
        'Acortamiento (ápex no verdadero)',
        'Plano anterior: aparece la aorta (A5C)',
        'Plano posterior: seno coronario',
      ],
      tolerance: { planeAngleDeg: 15, inPlaneRotationDeg: 20, offsetCm: 1.5 },
    },
    {
      id: 'a5c',
      name: 'Apical cinco cámaras (A5C)',
      window: 'apical',
      // The four-chamber plane moved forward onto the outflow tract, keeping its septal–lateral orientation, and aimed at
      // the aortic valve 0.55 cm behind its centre so the cusps and both atria stay in the sector (decision 85). It was
      // rotated 19° toward the anterior wall and aimed 1 cm into the ventricle: the plane grazed the back of the root
      // 0.9 cm from its centre, and the valve showed 1.3-2.1 cm from the septum, under the middle of the ventricle where
      // the mitral valve belongs, instead of against the septum between both atria. Seen from the apical probe on the
      // long axis and aimed from the beam's compressed origin (decision 139), that plane cut the valve and the left
      // atrium at their edges (0.26% of left atrium in the normal case against the 1% the view needs; 43 atrial samples
      // in systole in the tamponade case against 50). Turned 6° toward the inferolateral wall and aimed 0.3 cm further
      // toward the inferior wall, it keeps valve, root and both atria in all twelve cases (left atrium 1.2-6.6% of the
      // sector); 8° failed the difficult window (root no longer on the septal side) and 4° the tamponade.
      planeRight: R(v3(Math.cos(A5C_TURN), Math.sin(A5C_TURN), 0)),
      planeDown: R(v3(0, 0, -1)),
      target: v3(AV_CENTER.x, AV_CENTER.y - 0.85, AV_CENTER.z),
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
      hints: [
        'Desde A4C angula ligeramente anterior (hacia arriba) hasta abrir el TSVI y la válvula aórtica en el centro.',
      ],
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
      hints: [
        'Desde A4C rota ~60° en sentido antihorario sin desplazar la sonda: el VD desaparece y quedan VI, mitral y AI.',
      ],
      commonErrors: [
        'Rotación insuficiente: VD todavía visible',
        'Rotación excesiva: aparece la aorta (A3C)',
      ],
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
      hints: [
        'Desde A2C rota ~60° más en sentido antihorario hasta ver el TSVI y la aorta: es el PLAX visto desde el ápex.',
      ],
      commonErrors: ['Plano intermedio A2C/A3C sin aorta clara'],
      tolerance: { planeAngleDeg: 15, inPlaneRotationDeg: 20, offsetCm: 1.5 },
    },
    {
      id: 'subcostal-4c',
      name: 'Subcostal cuatro cámaras',
      window: 'subcostal',
      // the drawn plane is solved from the window and the landmarks below (`subcostalFourChamber`, decision 167); this
      // declared plane through the subxiphoid window, the crux and a point between the RV and LA centres stands in
      // where no thorax is at hand, and gives the screen's orientation
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
      commonErrors: [
        'Sonda demasiado inclinada: sólo hígado',
        'Plano anterior: TSVI en vez de las aurículas (subcostal 5C)',
        'Abdomen tenso (rodillas sin flexionar)',
      ],
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
      hints: [
        'Desde la subcostal de cuatro cámaras rota ~90° antihorario (marcador hacia la cabeza) y angula hacia la derecha del paciente hasta ver la vena cava inferior entrando en la aurícula derecha, con la vena hepática.',
        'Mide el diámetro 1–2 cm antes de la desembocadura y observa el colapso con la inspiración brusca.',
      ],
      commonErrors: [
        'Confundir la aorta abdominal (pulsátil, a la izquierda) con la cava',
        'Corte oblicuo de la cava: diámetro falsamente pequeño',
      ],
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
      hints: [
        'Desde A4C desplaza la sonda ligeramente medial y rota un poco antihorario para maximizar el VD manteniendo el ápex.',
      ],
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
