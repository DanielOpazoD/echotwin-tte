import type { CycleState } from '@/simulator/cardiac-cycle/cycleModel';
import { Structure } from './tissue';
import type { TissueSample } from './tissue';
import { lvCavityRadius, lvProfileG } from './lvShape';
import { AV_AXIS, MITRAL_SHORT_AXIS_CM, heartToTorso, torsoToHeart } from './heartFrame';
import { DESC_AORTA_X, DESC_AORTA_Z } from './thoraxModel';
import { computeHeartPose } from './heartPose';
import { classifyHeart } from './classify';
import type { HeartModel } from './heartModel';
import type { Vec3 } from '@/core/vec3';
import { add, cross, dot, normalize, scale, sub, v3 } from '@/core/vec3';

// ---- Fixed anatomical anchor points (heart frame, ED), scaled by LV size where sensible ----
export interface Anchors {
  mvCenter: Vec3;
  mvR: number;
  avCenter: Vec3;
  avAxis: Vec3;
  avR: number;
  sinusR: number;
  ascR: number;
  laCenter: Vec3;
  laR: Vec3;
  raCenter: Vec3;
  raR: Vec3;
  rvCenter: Vec3;
  rvR: Vec3;
  /** RV crescent: maximal thickness (A4C basal diameter), azimuth span (rad, through π) and apex level (fraction of L). */
  rvT: number;
  rvAzA: number;
  rvAzP: number;
  rvApexFrac: number;
  tvCenter: Vec3;
  tvR: number;
  rvotA: Vec3; // infundibulum entry (RV anterior base)
  rvotM: Vec3; // outflow mid point (bowed anteriorly over the aortic root)
  rvotB: Vec3; // pulmonary valve plane
  rvotRa: number; // proximal (infundibular) radius
  rvotRm: number;
  rvotR: number; // distal radius at the valve
  paDir: Vec3;
  paEnd: Vec3; // bifurcation of the trunk
  paR: number;
  paStj: Vec3; // sinotubular junction: the trunk widens from the root radius at the valve to its own radius here
  paRootR: number;
  rpaEnd: Vec3; // right pulmonary artery (runs to the patient's right, behind the ascending aorta)
  rpaR: number;
  lpaEnd: Vec3;
  lpaR: number;
  pvR: number; // pulmonary annulus radius
  /** RV anterior papillary muscle (moderator-band insertion): azimuth and level fractions of root and tip. */
  rvPapAz: number;
  rvPapZetaBase: number;
  rvPapZetaTip: number;
  /** Minimal radial fraction of the atria (end-diastole): a dilated, remodelled atrium empties less. */
  laReservoir: number;
  /** Interatrial septal plane (x) and fossa ovalis centre (y, z). */
  iasX: number;
  fossaY: number;
  fossaZ: number;
  /** Venae cavae and a hepatic vein as capsules (heart frame; directions follow the patient's torso). */
  svcA: Vec3;
  svcB: Vec3;
  svcR: number;
  ivcA: Vec3;
  ivcB: Vec3;
  ivcR: number;
  hvA: Vec3;
  hvB: Vec3;
  /** Papillary muscles: azimuth of each, level fractions of the wall root and of the tip, tip radius fraction, radius. */
  papAzAL: number;
  papAzPM: number;
  papZetaBase: number;
  papZetaTip: number;
  papTipFrac: number;
  papR: number;
}

/**
 * Interventricular grooves, where the right ventricle inserts on the left (heart-frame azimuth, rad; 0 = lateral,
 * π/2 = anterior). They bound the septum and the AHA segments (decision 152): anterior | anteroseptal at the anterior
 * insertion (92°) and inferoseptal | inferior at the inferior one (212°). Model constants shared by all cases, not
 * individual insertions measured on an image.
 */
export const RV_GROOVE_ANTERIOR_RAD = 1.6;
export const RV_GROOVE_INFERIOR_RAD = 3.7;

/** Case LA volume (mL) whose clipped, stretched ellipsoid measures what the case declares (decision 161). */
export const LA_VOLUME_REF = 55;

export function anchors(m: HeartModel): Anchors {
  const a = m.anatomy;
  const L = m.lv.lengthCm;
  // Atria: ellipsoids scaled from the case volume (maximal volume, end-systole) with the proportions of a
  // normal LA (AP < transverse < long) and RA; the long axis follows the annulus (reservoir stretch).
  // LA_VOLUME_REF: the case volume whose ellipsoid measures as the case declares once clipped by the septum and
  // stretched by the annulus (decision 161; 48 until then, when the LA's maximum measured 13–19 % above its
  // declaration in ten of the twelve cases).
  const laK = Math.cbrt(a.la.volumeMl / LA_VOLUME_REF);
  const laRx = 2.5 * laK,
    laRy = 2.08 * laK,
    laRz = 2.65 * laK;
  const raK = Math.cbrt(a.ra.volumeMl / 44);
  const raRx = 2.15 * raK,
    raRy = 1.93 * raK,
    raRz = 1.86 * raK;
  const rvR = a.rv.basalDiameterCm / 2;
  // both atria overlap the interatrial plane by 0.35 cm and are clipped flat against it (classifyHeart)
  const iasX = -2.35;
  const laCenter = v3(iasX - 0.35 + laRx, -1.3, -laRz * 0.85);
  const raCenter = v3(iasX + 0.35 - raRx, -0.5 - raRx * 0.1, -raRz * 0.72 + 0.05);
  // LV hypertrophy must not crush the right heart: the RV/RVOT anchors move with the septal thickness
  const dWall = (a.lv.ivsdCm - 0.9) * 1.5;
  // The subpulmonary infundibulum winds across the FRONT of the aortic root and the pulmonary annulus sits
  // about 1.5 cm above the aortic one, pointing posteriorly, superiorly and to the left. Both semilunar
  // valves therefore fall close to one oblique plane, which is what makes the parasternal short axis of the
  // great vessels possible at all. Until 2026-09-12 the pulmonary valve sat 4.65 cm anterior and 2.35 cm
  // superior to the aortic one (centres 5.3 cm apart, against 2.5-3 cm in the adult): the PSAX-AV plane then
  // missed it by 3.73 cm, the trunk by 6.25 cm and the infundibular mid point by 2.31 cm, so that view showed
  // the aorta floating with no outflow tract, no pulmonary valve and no trunk. The root reaches y ~ 2.85,
  // so the infundibulum still passes in front of it.
  // Septal hypertrophy pushes the right heart forward, but not uniformly: the infundibular inlet sits on the
  // septum and takes the whole displacement, while the pulmonary annulus is tethered to the fibrous skeleton
  // and the trunk and barely moves. Applying dWall whole along the outflow tract separated the semilunar
  // valves by 4.51 cm in the HOCM case and 3.54 in severe aortic stenosis (2.88 in the normal heart, adult
  // reference 2.5-3.0) — caught by the new av-pv-distance measure, not by eye.
  // Placed from TORSO coordinates, not from the heart frame: the pulmonary valve sits ~1.5 cm cranial,
  // ~1.5 cm anterior and ~1.0 cm to the patient's left of the aortic one (it points at the left shoulder).
  // The first attempt at this put those 1.5 cm along the heart's base-apex axis, which is tilted with
  // respect to the body, and left the valve 2.78 cm cranial, 0.53 cm to the RIGHT and barely anterior —
  // the plane through the three valve centres then sat 64° from the aortic root axis instead of under 30°,
  // which is why no probe angle could show a round aorta ringed by the other valves.
  const rvotB = v3(-0.48, 3.57 + dWall * 0.2, 0.47);
  // torso directions in the heart frame: the pulmonary branches run horizontally in the patient
  const f = m.frame;
  const dirH = (d: Vec3): Vec3 => v3(dot(d, f.ex), dot(d, f.ey), dot(d, f.ez));
  // The trunk leaves the pulmonary valve backward, upward and to the left, around the left side of the ascending aorta
  // to its bifurcation behind it, so the great arteries cross. Given along the heart's axes it ran straight up and back in
  // the torso (−0.01, 0.83, −0.56), with no leftward course, 46° from the root axis (decision 86): the great-vessel short
  // axis cut it obliquely and never the pulmonary valve. The only measured crossing angle found is fetal (78 ± 10°,
  // 59–97°, smaller with gestational age); no adult value was found, so the 79° this direction gives is an assumption.
  const paDir = normalize(dirH(v3(0.4, 0.5, -0.77)));
  const paEnd = add(rvotB, scale(paDir, 3.6));
  const tRight = dirH(v3(-1, 0, 0)),
    tLeft = dirH(v3(1, 0, 0)),
    tPost = dirH(v3(0, 0, -1)),
    tAnt = dirH(v3(0, 0, 1)),
    tSup = dirH(v3(0, 1, 0)),
    tInf = dirH(v3(0, -1, 0));
  // venae cavae: SVC from the posterior RA roof upward, IVC from the posterior RA floor downward and back
  const tvZ0 = 0.7;
  const svcA = v3(raCenter.x + 0.1, raCenter.y - 0.35 * raRy, raCenter.z - raRz + 0.6);
  const ivcA = v3(raCenter.x + 0.3, raCenter.y - 0.45 * raRy, tvZ0 + 0.25 - 0.4);
  const ivcDir = normalize(add(tInf, scale(tPost, 0.25)));
  const hvA = add(ivcA, scale(ivcDir, 2.4));
  return {
    mvCenter: v3(0.2, -0.9, 0),
    mvR: a.mitral.annulusDiameterCm / 2,
    avCenter: v3(-0.7, 1.35, -0.25),
    avAxis: AV_AXIS,
    avR: a.aorta.annulusCm / 2,
    sinusR: a.aorta.sinusCm / 2,
    ascR: a.aorta.ascendingCm / 2,
    // both atria hang from the interatrial plane (x ≈ −2.3) so that enlarging one never swallows the septum
    laCenter,
    laR: v3(laRx, laRy, laRz * 0.88),
    raCenter,
    raR: v3(raRx, raRy, raRz),
    // RV modelled as a large ellipsoid carved by the LV epicardium → crescent wrapping the septum;
    // it reaches medially (RV/LV basal ratio ≈ 0.6 in A4C) and its apex sits ~0.85 of the LV length
    // RV as a crescent wrapped around the septum between the interventricular grooves (see rvCrescent);
    // rvCenter/rvR only bound it (ghost overlay, coarse tools)
    rvCenter: v3(-(m.lv.rMax + a.lv.ivsdCm + 1.1 * rvR), -0.1, L * 0.4),
    rvR: v3(1.1 * rvR + 0.4, 1.1 * rvR + 1.6, L * 0.46),
    rvT: a.rv.basalDiameterCm,
    rvAzA: RV_GROOVE_ANTERIOR_RAD,
    rvAzP: RV_GROOVE_INFERIOR_RAD,
    rvApexFrac: Math.min(0.9, Math.max(0.7, (a.rv.lengthCm + 0.8) / L)),
    // tricuspid annulus: its medial edge sits on the RV side of the septum, whatever the LV size or wall thickness
    // the tricuspid annulus is ~0.7 cm more apical than the mitral (normal apical offset 0.5–1 cm)
    tvCenter: v3(
      -(
        m.lv.rMax * lvProfileG(m.lv.shape, 0.12) +
        a.lv.ivsdCm +
        0.25 +
        a.tricuspid.annulusDiameterCm / 2
      ),
      -0.2,
      0.7,
    ),
    tvR: a.tricuspid.annulusDiameterCm / 2,
    // the inlet sits deep in the anterior RV: pulling the whole tract up to the repositioned pulmonary valve
    // shortened it from 4.3 to 2.6 cm and cost the right ventricle 13% of its volume (162 -> 141 mL in the
    // pulmonary hypertension case), because the outflow tract is part of the chamber
    rvotA: v3(-3.25, 3.05 + dWall, 1.25),
    rvotM: v3(-1.7, 3.95 + dWall * 0.55, 0.4),
    rvotB,
    rvotRa: 1.3,
    rvotRm: 1.2,
    rvotR: 1.1,
    paDir,
    paEnd,
    // the trunk of the case, and branches that dilate with it (decision 109): it was 2.3 cm in every case. It leaves the
    // valve with the radius of the root (the cusps hinge 1 mm inside it) and reaches its own at the sinotubular junction,
    // at the height of the commissures: 19.4 ± 2.0 mm by CT in 50 adults (Jelenc et al., ICVTS 2024;39:ivae206), sinus
    // heights of 15-19 mm in 182 autopsied hearts (Lis et al., Clin Anat 2023;36:234-41). Starting at the valve with its
    // full radius, the trunk of 3.2 cm left the cusps 5.5 mm from its wall and its rounded end widened the outflow tract
    // 8 mm below the valve from a radius of 0.83 to 1.39 cm.
    paR: a.pulmonaryArtery.trunkDiameterCm / 2,
    paStj: add(rvotB, scale(paDir, 1.9)),
    paRootR: 1.15,
    rpaEnd: add(paEnd, scale(normalize(add(tRight, scale(tPost, 0.45))), 4.4)),
    rpaR: 0.8 * (a.pulmonaryArtery.trunkDiameterCm / 2.3),
    lpaEnd: add(paEnd, scale(normalize(add(add(tLeft, scale(tPost, 0.6)), scale(tSup, 0.2))), 3.0)),
    lpaR: 0.75 * (a.pulmonaryArtery.trunkDiameterCm / 2.3),
    pvR: 1.05,
    rvPapAz: 2.35,
    rvPapZetaBase: 0.68,
    rvPapZetaTip: 0.46,
    laReservoir: 0.84 + 0.1 * Math.min(1, Math.max(0, (a.la.volumeMl - 60) / 60)),
    iasX,
    fossaY: -1.6,
    fossaZ: -2.3,
    svcA,
    svcB: add(svcA, scale(tSup, 4.2)),
    svcR: 0.9,
    ivcA,
    ivcB: add(ivcA, scale(ivcDir, 5.0)),
    ivcR: a.ivc.diameterCm / 2,
    hvA,
    // the middle hepatic vein reaches the cava from the liver parenchyma in front of and below the junction, a little to
    // the left: the course the subcostal long axis of the cava contains. Until 2026-09-16 it ran posterior and to the
    // right, out of that plane, so the view that is defined by the vein joining the cava never showed it (decision 131)
    hvB: add(
      hvA,
      scale(normalize(add(add(scale(tAnt, 0.65), scale(tLeft, 0.3)), scale(tInf, 0.65))), 2.5),
    ),
    // papillary azimuths (model frame = AHA − 28°): anterolateral at the lateral wall (AHA ≈ 0°, 3 o'clock in
    // PSAX), posteromedial at the inferior / inferoseptal junction (AHA ≈ 250°, 7–8 o'clock)
    papAzAL: -0.5,
    papAzPM: -2.4,
    papZetaBase: 0.68,
    papZetaTip: 0.4,
    papTipFrac: 0.5,
    papR: 0.55,
  };
}

/** Landmark used by the view-recognition engine (heart frame at ED). */
export interface Landmark {
  id: string;
  label: string;
  p: Vec3; // heart frame
  radius: number; // tolerance radius for "in plane" tests (cm)
}

export function heartLandmarks(m: HeartModel): Landmark[] {
  const A = anchors(m);
  const L = m.lv.lengthCm;
  const a = m.lv.rMax * lvProfileG(m.lv.shape, 0.45) + 0.45, // mid-wall radius at the mid level
    b = a * m.lv.shape.ratio;
  // the same at the level of the mitral short axis
  const zB = MITRAL_SHORT_AXIS_CM;
  const aB = m.lv.rMax * lvProfileG(m.lv.shape, zB / L) + 0.45,
    bB = aB * m.lv.shape.ratio;
  const rvc = A.rvCenter;
  const papAt = (az: number): Vec3 => {
    const z = L * 0.57;
    const r = lvCavityRadius(m.lv.shape, m.lv.edProfile, az, z) * 0.78;
    return v3(r * Math.cos(az), r * Math.sin(az), z);
  };
  return [
    { id: 'lv-apex', label: 'Ápex VI', p: v3(0, 0, L - 0.3), radius: 0.8 },
    { id: 'lv-apical-cavity', label: 'Cavidad apical VI', p: v3(0, 0, L * 0.8), radius: 0.9 },
    { id: 'lv-mid', label: 'Cavidad VI (mitad)', p: v3(0, 0, L * 0.5), radius: 1.2 },
    { id: 'mv', label: 'Válvula mitral', p: v3(0.2, -0.9, 0.7), radius: 1.2 },
    { id: 'av', label: 'Válvula aórtica', p: A.avCenter, radius: 1.0 },
    { id: 'lvot', label: 'TSVI', p: add(A.avCenter, scale(A.avAxis, -0.55)), radius: 0.9 },
    {
      id: 'aortic-root',
      label: 'Raíz aórtica',
      p: add(A.avCenter, scale(A.avAxis, 2.2)),
      radius: 1.1,
    },
    { id: 'la', label: 'Aurícula izquierda', p: A.laCenter, radius: 1.5 },
    { id: 'ra', label: 'Aurícula derecha', p: A.raCenter, radius: 1.4 },
    { id: 'rv', label: 'Ventrículo derecho (entrada)', p: v3(rvc.x, -0.35, L * 0.35), radius: 1.3 },
    { id: 'pa', label: 'Tronco pulmonar', p: add(A.rvotB, scale(A.paDir, 1.5)), radius: 1.0 },
    { id: 'pa-bifurcation', label: 'Bifurcación pulmonar', p: A.paEnd, radius: 1.0 },
    {
      id: 'rv-anterior',
      label: 'Ventrículo derecho (anterior)',
      p: v3((a + 0.6) * Math.cos(2.1), (b + 0.6) * Math.sin(2.1) + 0.5, L * 0.35),
      radius: 0.9,
    },
    // derived from the infundibular anchor instead of fixed coordinates: pinned at (-1.7, 4.7, -1.2) it was
    // left behind in the pericardium the moment the outflow tract moved (decision 62)
    { id: 'rvot', label: 'TSVD', p: A.rvotM, radius: 1.0 },
    // RV inflow near the inferior (diaphragmatic) wall: what the subcostal window cuts first
    {
      id: 'rv-inferior',
      label: 'Ventrículo derecho (inferior)',
      p: v3(-(a + 1.8) * 0.94, -(a + 1.8) * 0.35 - 0.2, L * 0.3),
      radius: 1.2,
    },
    {
      id: 'tv',
      label: 'Válvula tricúspide',
      p: v3(A.tvCenter.x, A.tvCenter.y, A.tvCenter.z + 0.7),
      radius: 1.2,
    },
    {
      id: 'ivs-anteroseptal',
      label: 'Septum anteroseptal',
      p: v3(-a * 0.5, b * 0.87, L * 0.45),
      radius: 0.9,
    },
    {
      id: 'ivs-inferoseptal',
      label: 'Septum inferoseptal',
      p: v3(-a * 1.0, -b * 0.1, L * 0.45),
      radius: 0.9,
    },
    {
      id: 'wall-inferolateral',
      label: 'Pared inferolateral',
      p: v3(a * 0.5, -b * 0.87, L * 0.45),
      radius: 0.9,
    },
    // the basal walls and the RV inflow the mitral short axis cuts; the mid-level ones lie 1.6-2.5 cm toward the apex
    {
      id: 'ivs-inferoseptal-basal',
      label: 'Septum inferoseptal basal',
      p: v3(-aB * 1.0, -bB * 0.1, zB),
      radius: 0.9,
    },
    {
      id: 'wall-inferolateral-basal',
      label: 'Pared inferolateral basal',
      p: v3(aB * 0.5, -bB * 0.87, zB),
      radius: 0.9,
    },
    { id: 'rv-basal', label: 'Ventrículo derecho (basal)', p: v3(rvc.x, -0.35, zB), radius: 1.3 },
    {
      id: 'wall-anterolateral',
      label: 'Pared anterolateral',
      p: v3(a * 1.0, b * 0.1, L * 0.45),
      radius: 0.9,
    },
    // A2C walls lie 60° from the A4C plane (AHA: anterior at 90°, anterolateral at 30°; here A4C is at 2°)
    {
      id: 'wall-anterior',
      label: 'Pared anterior',
      p: v3(a * 0.469, b * 0.883, L * 0.45),
      radius: 0.9,
    },
    {
      id: 'wall-inferior',
      label: 'Pared inferior',
      p: v3(-a * 0.469, -b * 0.883, L * 0.45),
      radius: 0.9,
    },
    { id: 'pap-al', label: 'Papilar anterolateral', p: papAt(A.papAzAL), radius: 0.7 },
    // a thorax structure: the point of its axis at the height of the posterior mitral annulus, behind the atrioventricular
    // groove where the long axis shows it (decision 213); it used to be a fixed heart-frame point 1.5 cm from the tube
    {
      id: 'desc-aorta',
      label: 'Aorta descendente',
      p: torsoToHeart(
        m.frame,
        v3(
          DESC_AORTA_X,
          heartToTorso(m.frame, v3(A.mvCenter.x, A.mvCenter.y - A.mvR, A.mvCenter.z)).y,
          DESC_AORTA_Z,
        ),
      ),
      radius: 1.0,
    },
    { id: 'pap-pm', label: 'Papilar posteromedial', p: papAt(A.papAzPM), radius: 0.7 },
    { id: 'ias', label: 'Septum interauricular', p: v3(A.iasX, -1.6, -2.2), radius: 1.0 },
    {
      id: 'svc',
      label: 'Vena cava superior',
      p: add(A.svcA, scale(sub(A.svcB, A.svcA), 0.4)),
      radius: 0.9,
    },
    {
      id: 'ivc',
      label: 'Vena cava inferior',
      p: add(A.ivcA, scale(sub(A.ivcB, A.ivcA), 0.4)),
      radius: 0.9,
    },
    {
      id: 'hepatic-vein',
      label: 'Vena hepática',
      p: add(A.hvA, scale(sub(A.hvB, A.hvA), 0.5)),
      radius: 0.7,
    },
  ];
}

export interface AnchorsCached extends Anchors {
  avE1: Vec3;
  avE2: Vec3;
  /** unit direction (⊥ root axis) of the ascending aorta's curvature */
  avBend: Vec3;
  /** basis ⊥ the pulmonary trunk axis (pulmonary cusps) */
  pvE1: Vec3;
  pvE2: Vec3;
}

export function anchorsCached(m: HeartModel): AnchorsCached {
  let a = (m as HeartModel & { _anchors?: AnchorsCached })._anchors;
  if (!a) {
    const base = anchors(m);
    const ax = base.avAxis;
    const helper = Math.abs(ax.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
    const e1 = normalize(cross(helper, ax));
    const e2 = cross(ax, e1);
    const bendRaw = v3(-0.866, -0.5, 0.35);
    const avBend = normalize(sub(bendRaw, scale(ax, dot(bendRaw, ax))));
    const helperP = Math.abs(base.paDir.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
    const pvE1 = normalize(cross(helperP, base.paDir));
    const pvE2 = cross(base.paDir, pvE1);
    a = { ...base, avE1: e1, avE2: e2, avBend, pvE1, pvE2 };
    (m as HeartModel & { _anchors?: AnchorsCached })._anchors = a;
    placePulmonaryRoot(m, a);
  }
  return a;
}

/** A frame of the beat without tables: end-diastole or end-systole of the case (for placing anchors against the walls). */
function extremeState(m: HeartModel, systole: boolean): CycleState {
  const { edvMl, esvMl } = m.physiology;
  const k = systole ? 1 : 0;
  return {
    phase: 0,
    timeInBeatS: 0,
    rrS: 1,
    lvVolumeMl: systole ? esvMl : edvMl,
    contraction: k,
    mvOpen: 0,
    avOpen: 0,
    tvOpen: 0,
    pvOpen: 0,
    longitudinal: k,
    rvLongitudinal: k,
    atrialContraction: 0,
    atrialHold: 0,
    mitralFlowMlps: 0,
    aorticFlowMlps: 0,
    edvMl,
    esvMl,
  };
}

/**
 * The pulmonary root stands beside the aortic root (decision 112). The valve is placed from torso coordinates (decision
 * 62: ~1.0 cm left, 1.5 cm cranial and 1.5 cm anterior of the aortic valve), which put its centre 2.3 cm from the aortic
 * one in every case, closer than the two roots allow: the aortic sinus and, over a dilated or thickened ventricle, the
 * anterior LV wall filled a quarter to two fifths of the pulmonary root and up to half of the ring where the cusps hinge.
 * Keeping its bearing around the aortic root, the root (valve, root, trunk and branches) moves out from the aortic axis
 * by the least distance that leaves its lumen, from the valve plane to the sinotubular junction, clear of every other
 * structure at end-diastole and at end-systole (the aortic root descends with the base more than the pulmonary root).
 */
function placePulmonaryRoot(m: HeartModel, A: AnchorsCached): void {
  const poses = [
    computeHeartPose(m, extremeState(m, false)),
    computeHeartPose(m, extremeState(m, true)),
  ];
  const rel = sub(A.rvotB, A.avCenter);
  const u = normalize(sub(rel, scale(A.avAxis, dot(rel, A.avAxis))));
  const base = {
    rvotB: A.rvotB,
    paStj: A.paStj,
    paEnd: A.paEnd,
    rpaEnd: A.rpaEnd,
    lpaEnd: A.lpaEnd,
  };
  const smp: TissueSample = {
    tissue: 0,
    sdf: 0,
    nx: 0,
    ny: 0,
    nz: 1,
    mx: 0,
    my: 0,
    mz: 0,
    extraReflect: 0,
    structure: 0,
    transmural: -1,
    segment: 0,
  };
  const e1 = A.pvE1,
    e2 = A.pvE2,
    d = A.paDir;
  const moveTo = (off: number): void => {
    const o = scale(u, off);
    A.rvotB = add(base.rvotB, o);
    A.paStj = add(base.paStj, o);
    A.paEnd = add(base.paEnd, o);
    A.rpaEnd = add(base.rpaEnd, o);
    A.lpaEnd = add(base.lpaEnd, o);
  };
  const inLumen = (s: Structure): boolean =>
    s === Structure.PulmonaryArtery ||
    s === Structure.PulmonaryValve ||
    s === Structure.Rvot ||
    s === Structure.RvCavity;
  const conflicts = (off: number): number => {
    moveTo(off);
    let bad = 0;
    for (const hp of poses) {
      const cx = A.rvotB.x,
        cy = A.rvotB.y,
        cz = A.rvotB.z + hp.pvZ;
      for (let i = 0; i <= 10; i++) {
        const t = (1.9 * i) / 10;
        const r = A.paRootR + ((A.paR - A.paRootR) * t) / 1.9 - 0.05;
        for (let k = 0; k < 24; k++) {
          const ang = (k / 24) * 2 * Math.PI;
          const c = Math.cos(ang) * r,
            sn = Math.sin(ang) * r;
          const x = cx + d.x * t + e1.x * c + e2.x * sn,
            y = cy + d.y * t + e1.y * c + e2.y * sn,
            z = cz + d.z * t + e1.z * c + e2.z * sn;
          if (!classifyHeart(m, hp, x + hp.swingX, y, z, smp) || !inLumen(smp.structure)) bad++;
        }
      }
    }
    return bad;
  };
  if (conflicts(0) === 0) {
    moveTo(0);
    return;
  }
  // coarse steps outward, then halve the last interval
  let lo = 0,
    hi = -1;
  for (let off = 0.25; off <= 2.5 + 1e-9; off += 0.25) {
    if (conflicts(off) === 0) {
      hi = off;
      break;
    }
    lo = off;
  }
  if (hi < 0) {
    moveTo(2.5);
    return;
  }
  for (let it = 0; it < 5; it++) {
    const mid = (lo + hi) / 2;
    if (conflicts(mid) === 0) hi = mid;
    else lo = mid;
  }
  moveTo(hi + 0.05);
}

/** Anchor points of the model (heart frame at ED) for measurement and debugging tools. */
export function heartAnchors(m: HeartModel): Readonly<AnchorsCached> {
  return anchorsCached(m);
}
export type HeartAnchors = Readonly<AnchorsCached>;

/** Aortic root axis (heart frame, unit) — the reference axis for the AV short-axis view. */
export function heartRootAxis(m: HeartModel): Vec3 {
  return anchorsCached(m).avAxis;
}
