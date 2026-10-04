import type { AcousticWindowConfig, BodyHabitusConfig } from '@/cases/schema';
import { makeSample, Structure, Tissue, type TissueSample } from './tissue';
import type { Vec3 } from '@/core/vec3';
import { normalize, v3 } from '@/core/vec3';

/**
 * Simplified thorax (spec 23, 58, 76). TORSO FRAME (cm): origin on the skin over the sternum at
 * the 4th intercostal level; +x patient's left, +y superior, +z anterior. The anterior chest is a
 * superellipse; ribs are tubes following the surface; lungs are air outside the cardiac notch.
 */
export interface PatientState {
  position: 'left-lateral' | 'supine' | 'subcostal-supine';
  /** 'free-breathing' keeps the expiratory anatomy and varies the inflows breath by breath (decision 108). */
  respiration: 'inspiration' | 'expiration' | 'breath-hold' | 'free-breathing';
  headElevationDeg: number;
}

export interface ThoraxModel {
  habitus: BodyHabitusConfig;
  window: AcousticWindowConfig;
  aw: number; // half width
  bDepth: number; // anterior half-depth used for surface curvature
  n: number; // superellipse exponent
  chestWall: number;
  ribRadius: number;
  ribSpacing: number;
  rib2Y: number;
  ribSlope: number;
  lungShiftCm: number; // extra medial shift of the left lung border (inspiration, hyperinflation)
  heartOffset: Vec3; // torso-frame displacement of the heart due to position/respiration
  /** How fast the abdominal wall recedes below the costal margin (cm per cm; relaxed abdomen recedes less). */
  abdomenSlope: number;
  /** Extra height of the liver dome / diaphragm (cm): the heart rests on it in the subcostal position. */
  diaphragmRiseCm: number;
  /** IVC diameter reduction 0..1 for the respiratory state (the sniff collapses a normal IVC). */
  ivcCollapse: number;
  /** The diaphragm under the right heart (decision 229), fitted to the heart by `buildCaseModels`; none until then. */
  diaphragmMap: DiaphragmMap;
  /**
   * Systolic expansion of the descending aorta's lumen area over its diastolic one (decision 272), set from the patient's
   * age by `buildCaseModels`; 0, a still aorta, until then.
   */
  descAortaAreaStrain: number;
  /** Cranial join to the arch in torso cm; assigned by the shared case builder. */
  descAortaTopY: number;
  /**
   * Torso-z shift (cm, negative backwards) of the posterior column — vertebral body, descending aorta and posterior
   * mediastinum — from where decisions 150 and 213 placed it for the normal case's chest wall (decision 273).
   */
  columnShiftCm: number;
}

/**
 * Heights (torso y, cm) of the diaphragm under the right heart (decision 229, `diaphragm.ts`): a grid of
 * `DIAPHRAGM_MAP_N` × `DIAPHRAGM_MAP_N` nodes 1 cm apart from (`x0`, `z0`), row-major in z, sampled bilinearly;
 * `DIAPHRAGM_MAP_NONE_CM` where the heart does not reach.
 */
export interface DiaphragmMap {
  x0: number;
  z0: number;
  h: Float32Array;
}
export const DIAPHRAGM_MAP_N = 20;
export const DIAPHRAGM_MAP_NONE_CM = -100;
export const NO_DIAPHRAGM_MAP: DiaphragmMap = {
  x0: 0,
  z0: 0,
  h: new Float32Array(DIAPHRAGM_MAP_N * DIAPHRAGM_MAP_N).fill(DIAPHRAGM_MAP_NONE_CM),
};
/**
 * Fat, not lung, this far above the diaphragm under the heart (cm): the pericardial and cardiophrenic fat where the
 * interpolated diaphragm dips below the heart between the grid's nodes, or the heart rises from it in systole.
 */
export const UNDERSIDE_FAT_CM = 0.6;

/**
 * How much further lateral the left lung's cardiac notch reaches in the left lateral decubitus position (cm). Turning onto
 * the left side moves the left ventricle toward the lateral chest wall — 1.1 cm laterally and 1.3 cm anteriorly by
 * cardiac MRI in 20 healthy adults (Gottlieb et al., Physiol Rep 2021;9:e15022) — and the apex that comes to rest against
 * the wall displaces the lingula: that is why echocardiography is done in this position. The apical window sits where the
 * left ventricular long axis leaves the chest, 9.7-10.6 cm from the midline in the eleven cases with a lung-free window,
 * lateral to the 9.0 cm the notch reaches supine; a lingula over it hid 30-35% of the ventricular wall in the two- and
 * five-chamber views (decision 139).
 */
export const LLD_NOTCH_WIDENING_CM = 1.6;

export function createThoraxModel(
  habitus: BodyHabitusConfig,
  window: AcousticWindowConfig,
  patient: PatientState,
  ivcCollapsePct = 0,
): ThoraxModel {
  const ribRadius = Math.max(0.35, (habitus.ribSpacingCm - habitus.intercostalWidthCm) / 2);
  let lungShift = window.lungOverlapCm;
  const heartOffset = v3(0, 0, 0);
  let abdomenSlope = 0.18;
  let diaphragmRise = 0;
  let ivcCollapse = 0;
  if (patient.respiration === 'inspiration') {
    lungShift += 1.4;
    heartOffset.y -= 0.8;
    heartOffset.z -= 0.4;
    diaphragmRise -= 0.6; // the diaphragm descends
    ivcCollapse = ivcCollapsePct / 100;
  } else if (patient.respiration === 'breath-hold') {
    lungShift += 0.4;
  }
  if (patient.position === 'supine') {
    heartOffset.z -= 0.9; // heart falls back, more lung interposition
    lungShift += 0.6;
  } else if (patient.position === 'left-lateral') {
    heartOffset.x += 0.6;
    heartOffset.z += 0.4;
    lungShift -= LLD_NOTCH_WIDENING_CM;
  } else if (patient.position === 'subcostal-supine') {
    // supine with the knees bent: the abdomen relaxes and the liver dome rises against the heart
    heartOffset.z -= 0.6;
    lungShift += 0.5;
    abdomenSlope = 0.08;
    diaphragmRise += 0.8;
  }
  heartOffset.y += window.cardiacRotationDeg * 0.02;
  // a thicker chest wall pushes the heart deeper (the anatomy is defined for a 2 cm wall)
  const chestWall = habitus.chestWallThicknessCm * (1 + 0.8 * window.obesityAttenuation);
  // The heart must sit BEHIND the chest wall. With a threshold of 2.0 cm it was only pushed back when the
  // wall was thicker than that, so in the normal case (2.08 cm of wall) it moved 0.08 cm and intruded 1.96 cm
  // into the wall in systole — in the 3D navigator the epicardial fat came out through the chest, and in the
  // PLAX only 0.36 cm of tissue preceded the heart in diastole and none in systole, so the RV free wall
  // started at the sector apex and could only be told apart when contraction pulled it away. Both were
  // reported from the app by a cardiologist ("the heart is too anterior", "the near field is missing").
  heartOffset.z -= Math.max(0, chestWall - 0.8);
  // the same thicker wall pushes the vertebral body and the descending aorta back with the heart (decision 273)
  const columnShiftCm = -(
    Math.max(0, chestWall - 0.8) - Math.max(0, COLUMN_REFERENCE_CHEST_WALL_CM - 0.8)
  );
  return {
    habitus,
    window,
    aw: habitus.chestWidthCm / 2,
    bDepth: habitus.chestDepthCm / 2,
    n: 2.5,
    chestWall,
    ribRadius,
    ribSpacing: habitus.ribSpacingCm,
    rib2Y: 5.2,
    ribSlope: 0.15,
    lungShiftCm: lungShift,
    heartOffset,
    abdomenSlope,
    diaphragmRiseCm: diaphragmRise,
    ivcCollapse,
    diaphragmMap: NO_DIAPHRAGM_MAP,
    descAortaAreaStrain: 0,
    descAortaTopY: 6,
    columnShiftCm,
  };
}

/** Upper surface (y) of the liver dome at (x, z): a paraboloid peaking under the right heart. */
export function liverDomeY(t: ThoraxModel, x: number, z: number): number {
  const ex = (x + 2) / 7,
    ez = (z + 7) / 8;
  return -8.5 + 3.5 * Math.max(0, 1 - ex * ex - ez * ez) + t.diaphragmRiseCm;
}

/** Height of the diaphragm under the right heart at (x, z), bilinear in its grid (decision 229). */
export function diaphragmMapY(m: DiaphragmMap, x: number, z: number): number {
  const N = DIAPHRAGM_MAP_N;
  const fx = x - m.x0,
    fz = z - m.z0;
  if (!(fx >= 0 && fz >= 0 && fx < N - 1 && fz < N - 1)) return DIAPHRAGM_MAP_NONE_CM;
  const i = Math.floor(fx),
    j = Math.floor(fz);
  const u = fx - i,
    v = fz - j;
  const a = m.h[j * N + i]!,
    b = m.h[j * N + i + 1]!,
    c = m.h[(j + 1) * N + i]!,
    d = m.h[(j + 1) * N + i + 1]!;
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Upper surface (y) of the diaphragm: the liver dome, raised to meet the right heart that rests on it (decision 229). */
export function diaphragmY(t: ThoraxModel, x: number, z: number): number {
  return Math.max(liverDomeY(t, x, z), diaphragmMapY(t.diaphragmMap, x, z));
}

/** True just above the diaphragm under the right heart, where the pleura does not reach (decision 229). */
export function isUnderHeart(t: ThoraxModel, x: number, y: number, z: number): boolean {
  return y < diaphragmMapY(t.diaphragmMap, x, z) + UNDERSIDE_FAT_CM;
}

/** Anterior skin surface height z_s(x, y). */
export function skinZ(t: ThoraxModel, x: number, y: number): number {
  const ax = Math.min(Math.abs(x) / t.aw, 0.999);
  const inner = 1 - Math.pow(ax, t.n);
  let z = -t.bDepth * (1 - Math.pow(inner, 1 / t.n));
  if (y > 8) z -= 0.12 * (y - 8) * (y - 8); // toward the neck / suprasternal notch
  if (y < -8) z -= t.abdomenSlope * (-8 - y); // below the costal margin the abdomen recedes
  return z;
}

export function skinNormal(t: ThoraxModel, x: number, y: number): Vec3 {
  const h = 0.05;
  const dzdx = (skinZ(t, x + h, y) - skinZ(t, x - h, y)) / (2 * h);
  const dzdy = (skinZ(t, x, y + h) - skinZ(t, x, y - h)) / (2 * h);
  return normalize(v3(-dzdx, -dzdy, 1)); // outward
}

/** Left lung medial border (cardiac notch) as a function of y; x beyond it is lung. */
export function leftLungBorderX(t: ThoraxModel, y: number): number {
  const base = 2.4 + Math.max(0, 3.5 - y) * 0.75;
  return Math.min(9.0, Math.max(2.0, base)) - t.lungShiftCm;
}
export function rightLungBorderX(t: ThoraxModel): number {
  return -1.8 + t.lungShiftCm * 0.3;
}

/** Intercostal spacing widens laterally (ribs diverge from the sternum toward the axilla). */
export function ribSpacingAt(t: ThoraxModel, x: number): number {
  return t.ribSpacing * (1 + 0.03 * Math.abs(x));
}

export function ribCenterY(t: ThoraxModel, k: number, x: number): number {
  return t.rib2Y - (k - 2) * ribSpacingAt(t, x) + t.ribSlope * Math.abs(x);
}

/** Rib tube radius: ribs thin out laterally, so intercostal spaces widen toward the apex region. */
export function ribRadiusAt(t: ThoraxModel, x: number): number {
  return t.ribRadius * (1 - 0.45 * Math.min(1, Math.abs(x) / 8));
}

/** Depth of the rib centre line below the skin. */
export function ribDepth(t: ThoraxModel): number {
  return t.chestWall * 0.7;
}

/** Fractional index of the rib at height y and lateral position x: ribs k and k+1 bound the space at floor(). */
export function ribIndexAt(t: ThoraxModel, x: number, y: number): number {
  return (t.rib2Y + t.ribSlope * Math.abs(x) - y) / ribSpacingAt(t, x) + 2;
}

/** Snap a skin point to the centre of the intercostal space it falls in (or the nearest one). */
export function snapToIntercostal(t: ThoraxModel, u: number, v: number): { u: number; v: number } {
  const kAbove = Math.floor(ribIndexAt(t, u, v));
  const yAbove = ribCenterY(t, kAbove, u);
  const yBelow = ribCenterY(t, kAbove + 1, u);
  return { u, v: (yAbove + yBelow) / 2 };
}

/**
 * Keep a skin point inside the rib-free band of the intercostal space it falls in, `marginCm` from each rib surface (the
 * half-height of the probe face across the ribs); the space centre when the band is narrower than the face. Lateral
 * spaces are wide (2.9 cm between the rib surfaces at 10 cm from the midline): a sonographer holds the probe where the
 * view needs it within the space, not on its centre line.
 */
export function clampToIntercostal(
  t: ThoraxModel,
  u: number,
  v: number,
  marginCm: number,
): { u: number; v: number } {
  const kAbove = Math.floor(ribIndexAt(t, u, v));
  const yAbove = ribCenterY(t, kAbove, u);
  const yBelow = ribCenterY(t, kAbove + 1, u);
  const r = ribRadiusAt(t, u);
  const hi = yAbove - r - marginCm,
    lo = yBelow + r + marginCm;
  if (lo >= hi) return { u, v: (yAbove + yBelow) / 2 };
  return { u, v: Math.min(hi, Math.max(lo, v)) };
}

/**
 * Anterior lung interposition: lateral to the cardiac notch the lingula/lung lies BETWEEN the chest
 * wall and the heart, thicker the further lateral. Checked before the heart so it occludes it
 * (spec 23, 57): sliding medially, expiration and a lower intercostal space reduce it.
 */
export function isAnteriorLung(t: ThoraxModel, x: number, y: number, z: number): boolean {
  const depth = skinZ(t, x, y) - z;
  if (depth <= t.chestWall) return false;
  const border = leftLungBorderX(t, y);
  if (x > border) {
    const thick = Math.min(5, (x - border) * 1.3 + 0.4);
    return depth < t.chestWall + thick;
  }
  const rb = rightLungBorderX(t);
  if (x < rb) {
    const thick = Math.min(5, (rb - x) * 1.3 + 0.4);
    return depth < t.chestWall + thick;
  }
  return false;
}

/**
 * The pleural cavities wrap the pericardium (decision 144). Until then lung existed only lateral to the cardiac notch
 * border and behind z = −10.5, and everything else around the heart was one homogeneous «mediastinal fat»: in the apical
 * images the far background measured a flat grey 76 (99th percentile 164) where CAMUS Good shows 107 with bright
 * pleural and pericardial interfaces up to 243, and the band outside the lateral wall 65 against 122. A point outside
 * the heart is lung when it lies beyond the pericardial fat pad, outside the mediastinum (`mediastinumDistance`: a rounded
 * posterior column and a superior one above the base since decision 150, a straight slab until then) and deeper than the
 * corridor between chest wall and heart, where the anterior lung border rules (`isAnteriorLung`, the acoustic windows).
 */
export const PERICARDIAL_FAT_CM = 0.15;

/**
 * Chest wall layers (decision 144): skin, subcutaneous fat (hypoechoic), the superficial (pectoral) fascia as a thin
 * fibrous sheet that reflects coherently, and muscle down to the thickness of the wall. In CAMUS Good images the wall
 * reads 119–138 grey with a bright line or two; a wall of fat over muscle with no interface was one flat band.
 */
export const SKIN_CM = 0.15;
export const FAT_FRACTION = 0.45;
export const FASCIA_HALF_CM = 0.04;

/**
 * Descending thoracic aorta (decision 213): a vertical tube left-anterolateral to the vertebral body, behind the left atrium
 * near the atrioventricular groove, where the parasternal long axis shows it in cross-section (Goldstein et al., JASE
 * 2015;28:119-182) and against the posterior atrial wall (MRI, 2.8 mm between the inner walls, Hopman et al., Radiol
 * Cardiothorac Imaging 2022;4:e210192). Lumen 2.0 cm (MRI at the pulmonary artery, men 20.6 and women 18.9 mm, Davis et
 * al., JCMR 2014;16:9) and a 2 mm wall. It used to lie 1 cm right of the midline with a 2.2 cm lumen, and the long axis cut
 * it behind the upper atrium on the side of the aortic root, 14 cm deep and 2.6 × 3.8 cm across.
 */
export const DESC_AORTA_X = 2.6;
export const DESC_AORTA_Z = -14.5;
export const DESC_AORTA_R = 1.0;
export const DESC_AORTA_WALL = 0.2;
/**
 * Outer radius (cm) of the descending aorta at the largest systolic distension the model gives it (decision 272, the
 * area strain of the twenties): what the heart keeps clear of (decision 273).
 */
export const DESC_AORTA_MAX_OUTER_R = DESC_AORTA_R * Math.sqrt(1.33) + DESC_AORTA_WALL;
/**
 * Chest wall (cm, with its obesity term) of the normal case, for which decisions 150 and 213 placed the posterior column
 * (decision 273). A thicker wall pushes the heart back (`createThoraxModel`), and it used to leave the vertebral body and
 * the aorta where they were: in the difficult window the left atrium, its veins and the inferior wall of the ventricle ran
 * through the aorta.
 */
export const COLUMN_REFERENCE_CHEST_WALL_CM = 2.08;
/** Vertebral body: a vertical cylinder in the midline. */
export const SPINE_Z = -17.3;
export const SPINE_R = 2.2;
/** Centre (torso z) of the posterior mediastinal column behind the left atrium (decision 150). */
export const POSTERIOR_MEDIASTINUM_Z = -15.5;
/**
 * Posterior mediastinal fat around the descending aorta, reaching forward to the pericardium behind the left atrium: the
 * lung wraps the aorta laterally and behind, and does not come between it and the atrium (the oesophagus and fat lie
 * there). In the transverse plane, the aorta's disk widened by `DESC_AORTA_SLEEVE` and drawn forward by
 * `DESC_AORTA_SLEEVE_REACH`, as wide as the aorta all the way (decision 273). It was an ellipse shifted forward that
 * narrowed in front of the aorta, and the lung came in at its sides: tongues of lung 2–5 mm thick lay between the
 * pericardium and the aorta in the long axis and, a gas interface, hid a quarter of the aorta's circle behind them.
 */
export const DESC_AORTA_SLEEVE = 0.3;
export const DESC_AORTA_SLEEVE_REACH = 2.5;
/**
 * Area strain of the proximal descending aorta, (Amax − Amin)/Amin, by decade of age (MRI in 100 healthy subjects,
 * Redheuil et al., Hypertension 2010;55:319-326, table 1): 33 ± 8 % in the twenties and 31 ± 12 % in the thirties, falling
 * to 13–14 % after sixty as the wall stiffens. [age at the middle of the decade, strain]
 */
const DESC_AORTA_AREA_STRAIN_BY_AGE: readonly (readonly [number, number])[] = [
  [25, 0.33],
  [35, 0.31],
  [45, 0.19],
  [55, 0.18],
  [65, 0.13],
  [75, 0.14],
];

/** Area strain of the descending aorta at an age, interpolated between the decades (decision 272). */
export function descendingAortaAreaStrain(ageYears: number): number {
  const tab = DESC_AORTA_AREA_STRAIN_BY_AGE;
  if (ageYears <= tab[0]![0]) return tab[0]![1];
  for (let i = 1; i < tab.length; i++) {
    const [a1, s1] = tab[i]!;
    if (ageYears <= a1) {
      const [a0, s0] = tab[i - 1]!;
      return s0 + ((s1 - s0) * (ageYears - a0)) / (a1 - a0);
    }
  }
  return tab[tab.length - 1]![1];
}

/**
 * Scale of the descending aorta's lumen radius at a fraction of the pulse pressure (decision 272): the area grows by the
 * strain at the systolic peak from its diastolic size, `DESC_AORTA_R`.
 */
export function descAortaScale(
  t: Pick<ThoraxModel, 'descAortaAreaStrain'>,
  aorticPressure: number,
): number {
  return Math.sqrt(1 + t.descAortaAreaStrain * aorticPressure);
}
export const ANTERIOR_CORRIDOR_CM = 2.5;
/**
 * Under the left hemidiaphragm (decision 271): the left lobe of the liver lies anteriorly, its lateral segment a few
 * centimetres thick under the abdominal wall, and the gastric fundus behind it, its air bubble against the dome. Left of
 * `FUNDUS_MEDIAL_X_CM` and deeper than `LIVER_LEFT_LOBE_DEPTH_CM` from the skin the model put liver there, so the long axis
 * showed liver behind the posterior wall of the ventricle and the papillary short axis below the inferior wall.
 */
export const FUNDUS_MEDIAL_X_CM = 2;
export const LIVER_LEFT_LOBE_DEPTH_CM = 7;

/**
 * Signed distance-like measure of the mediastinum around the heart (decision 150): negative inside. Beside the heart
 * the lungs meet the pericardial fat pad; the mediastinum proper is a posterior column behind the left atrium
 * (oesophagus, descending aorta, the front of the spine: an ellipse in the transverse plane, centred 1.5 cm right of the
 * midline and 15.5 cm deep, 1.8 cm across and 4.0 cm deep, running the whole height) and a superior one around the great
 * vessels that widens from nothing at the heart's base (torso y = 2 cm) to 2.5 cm on either side by y = 6. Until then the
 * mediastinum was a straight slab 5 cm wide from front to back at every height and the posterior lung began at a plane
 * 10.5 cm deep: their faces are pleural interfaces, and they crossed the parasternal and apical sectors as straight
 * bright lines. A third region is the fat around the descending aorta (decision 213).
 */
export function mediastinumDistance(x: number, y: number, z: number): number {
  const px = (x + 0.5) / 1.8,
    pz = (z - POSTERIOR_MEDIASTINUM_Z) / 4.0;
  const posterior = px * px + pz * pz - 1;
  const u = Math.min(1, Math.max(0, (y - 2) / 4));
  const halfWidth = 2.5 * u * u * (3 - 2 * u);
  let superior = 1;
  if (halfWidth > 0.05) {
    const sx = (x + 0.5) / halfWidth,
      sz = (z + 8) / 5;
    superior = sx * sx + sz * sz - 1;
  }
  const rs = DESC_AORTA_R + DESC_AORTA_WALL + DESC_AORTA_SLEEVE;
  const ax = (x - DESC_AORTA_X) / rs,
    az = (z - DESC_AORTA_Z - Math.min(Math.max(z - DESC_AORTA_Z, 0), DESC_AORTA_SLEEVE_REACH)) / rs;
  const aorta = ax * ax + az * az - 1;
  // Connect the superior visceral space to the existing periaortic cuff. The lung cannot
  // split the connective-tissue envelope of the arch and proximal descending aorta.
  // Idealized transverse capsule, using the existing cuff radius and superior taper;
  // no dependence on probe, view label or case identity (decision 294).
  let bridge = 1;
  const radius = Math.min(rs, halfWidth);
  if (radius > 0.05) {
    const bx = DESC_AORTA_X + 0.5,
      bz = DESC_AORTA_Z + DESC_AORTA_SLEEVE_REACH + 8;
    const t = Math.min(1, Math.max(0, ((x + 0.5) * bx + (z + 8) * bz) / (bx * bx + bz * bz)));
    const dx = (x + 0.5 - t * bx) / radius,
      dz = (z + 8 - t * bz) / radius;
    bridge = dx * dx + dz * dz - 1;
  }
  return Math.min(posterior, superior, aorta, bridge);
}

const ribProbe = makeSample();
/** True inside a rib, as `classifyThorax` draws it: for window searches that must keep the ventricle out of bone shadow. */
export function isInRib(t: ThoraxModel, x: number, y: number, z: number): boolean {
  return classifyThorax(t, x, y, z, ribProbe) && ribProbe.structure === Structure.Rib;
}

/**
 * Classify a torso-frame point that is NOT inside the heart. Returns false for air outside the body. `heartDistCm` is
 * the distance from the point to the outside of the pericardial sac (what `classifyHeart` leaves in `out.sdf` on a
 * miss); without it the lungs keep their borders and nothing wraps the heart.
 */
export function classifyThorax(
  t: ThoraxModel,
  x: number,
  y: number,
  z: number,
  out: TissueSample,
  heartDistCm = 0,
  daScale = 1,
): boolean {
  const zs = skinZ(t, x, y);
  const depth = zs - z; // depth below skin along z
  if (depth < 0) {
    out.tissue = Tissue.None;
    out.structure = Structure.None;
    out.sdf = -depth;
    return false;
  }
  out.mx = x;
  out.my = y;
  out.mz = z;
  out.extraReflect = 0;
  out.nx = 0;
  out.ny = 0;
  out.nz = 1;
  if (depth < SKIN_CM) {
    out.tissue = Tissue.Skin;
    out.structure = Structure.ChestWall;
    out.sdf = -Math.min(depth, SKIN_CM - depth);
    return true;
  }
  const T = t.chestWall;
  // Sternum
  if (Math.abs(x) < 1.6 && y > -5 && y < 9.5 && depth > T * 0.3 && depth < T * 0.3 + 1.0) {
    out.tissue = Tissue.Bone;
    out.structure = Structure.Sternum;
    out.sdf = -0.3;
    return true;
  }
  // Ribs: nearest rib index by y at this x
  if (Math.abs(x) >= 1.6 && Math.abs(x) < t.aw * 0.95) {
    // nearest rib with the spacing it has here: dividing by the sternal spacing (until decision 139) picked the wrong
    // rib lateral to ~5 cm, where the spaces widen, and ribs 5-7 were never drawn over the apical window
    const k = Math.round(ribIndexAt(t, x, y));
    if (k >= 2 && k <= 9) {
      const ry = ribCenterY(t, k, x);
      const rDepth = ribDepth(t);
      const rr = ribRadiusAt(t, x);
      const dy = y - ry,
        dd = depth - rDepth;
      const dist = Math.sqrt(dy * dy + dd * dd) - rr;
      if (dist < 0) {
        out.tissue = Math.abs(x) < 5 ? Tissue.Cartilage : Tissue.Bone;
        out.structure = Structure.Rib;
        out.sdf = dist;
        out.ny = dy / (rr + 1e-6);
        out.nz = -dd / (rr + 1e-6);
        return true;
      }
    }
  }
  if (depth < T) {
    const fasciaDepth = T * FAT_FRACTION;
    if (Math.abs(depth - fasciaDepth) < FASCIA_HALF_CM) {
      out.tissue = Tissue.Fibrous;
      out.structure = Structure.ChestWall;
      out.sdf = -(FASCIA_HALF_CM - Math.abs(depth - fasciaDepth));
      return true;
    }
    out.tissue = depth < fasciaDepth ? Tissue.Fat : Tissue.Muscle;
    out.structure = Structure.ChestWall;
    out.sdf =
      depth < fasciaDepth
        ? -Math.min(depth - SKIN_CM, fasciaDepth - FASCIA_HALF_CM - depth)
        : -Math.min(depth - fasciaDepth - FASCIA_HALF_CM, T - depth);
    return true;
  }
  // Below the diaphragm: the liver dome (highest to the right of the midline, under the right heart) with the
  // diaphragm as a bright fibrous layer on top, raised to meet the right heart that rests on it (decision 229); the
  // subcostal window images the heart through it
  {
    const yDome = diaphragmY(t, x, z);
    if (y < yDome && z > -14) {
      const fibrous = y > yDome - 0.25;
      // left of the midline and behind the left lobe of the liver lies the gastric fundus, its air bubble under the dome
      // (decision 271): a gas interface, as the lung is
      const fundus = !fibrous && x > FUNDUS_MEDIAL_X_CM && depth > LIVER_LEFT_LOBE_DEPTH_CM;
      out.tissue = fibrous ? Tissue.Fibrous : fundus ? Tissue.Lung : Tissue.Liver;
      out.structure = fibrous ? Structure.Diaphragm : fundus ? Structure.Stomach : Structure.Liver;
      out.sdf = fibrous ? -0.1 : -1;
      out.ny = 1;
      out.nz = 0;
      return true;
    }
  }
  // Spine
  {
    const dx = x,
      dz = z - SPINE_Z - t.columnShiftCm;
    const d = Math.sqrt(dx * dx + dz * dz) - SPINE_R;
    if (d < 0) {
      out.tissue = Tissue.Spine;
      out.structure = Structure.Spine;
      out.sdf = d;
      return true;
    }
  }
  // Descending aorta (behind the left atrium, left of the spine)
  if (y <= t.descAortaTopY) {
    // the lumen expands with the pulse (decision 272); the posterior mediastinal fat around it stays put
    const r = DESC_AORTA_R * daScale;
    const dx = x - DESC_AORTA_X,
      dz = z - DESC_AORTA_Z - t.columnShiftCm;
    const d = Math.sqrt(dx * dx + dz * dz) - r;
    if (d < 0) {
      out.tissue = Tissue.Blood;
      out.structure = Structure.DescendingAorta;
      out.sdf = d;
      out.nx = dx / r;
      out.nz = dz / r;
      return true;
    }
    if (d < DESC_AORTA_WALL) {
      out.tissue = Tissue.VesselWall;
      out.structure = Structure.DescendingAorta;
      out.sdf = -Math.min(d, DESC_AORTA_WALL - d);
      out.nx = dx / r;
      out.nz = dz / r;
      return true;
    }
  }
  // Lungs: lateral to the cardiac notch borders (the acoustic windows), and everywhere beyond the pericardial fat pad and
  // the corridor under the chest wall that is not mediastinum (decision 150), except under the heart, which rests on the
  // diaphragm (decision 229)
  const lungL = x > leftLungBorderX(t, y);
  const lungR = x < rightLungBorderX(t);
  const outsideMediastinum = mediastinumDistance(x, y, z - t.columnShiftCm) > 0;
  const aroundHeart = heartDistCm > PERICARDIAL_FAT_CM && depth > T + ANTERIOR_CORRIDOR_CM;
  if ((lungL || lungR || aroundHeart) && outsideMediastinum && !isUnderHeart(t, x, y, z)) {
    out.tissue = Tissue.Lung;
    out.structure = Structure.Lung;
    out.sdf = -1;
    // normal facing anteriorly at the pleural surface
    out.nz = 1;
    return true;
  }
  // Mediastinal soft tissue / fat
  out.tissue = Tissue.Fat;
  out.structure = Structure.None;
  out.sdf = -1;
  return true;
}
