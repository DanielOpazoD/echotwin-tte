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
}

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
  };
}

/** Upper surface (y) of the liver dome at (x, z): a paraboloid peaking under the right heart. */
export function liverDomeY(t: ThoraxModel, x: number, z: number): number {
  const ex = (x + 2) / 7,
    ez = (z + 7) / 8;
  return -8.5 + 3.5 * Math.max(0, 1 - ex * ex - ez * ez) + t.diaphragmRiseCm;
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
 * Posterior mediastinal fat around the descending aorta, reaching forward to the pericardium behind the left atrium: the
 * lung wraps the aorta laterally and behind, and does not come between it and the atrium (the oesophagus and fat lie
 * there). An ellipse in the transverse plane around the aorta, shifted forward by `DESC_AORTA_SLEEVE_FORWARD`.
 */
export const DESC_AORTA_SLEEVE = 0.3;
export const DESC_AORTA_SLEEVE_FORWARD = 0.6;
export const ANTERIOR_CORRIDOR_CM = 2.5;

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
    pz = (z + 15.5) / 4.0;
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
    az = (z - DESC_AORTA_Z - DESC_AORTA_SLEEVE_FORWARD) / (rs + DESC_AORTA_SLEEVE_FORWARD);
  const aorta = ax * ax + az * az - 1;
  return Math.min(posterior, superior, aorta);
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
  // diaphragm as a bright fibrous layer on top; the subcostal window images the heart through it
  {
    const yDome = liverDomeY(t, x, z);
    if (y < yDome && z > -14) {
      const fibrous = y > yDome - 0.25;
      out.tissue = fibrous ? Tissue.Fibrous : Tissue.Liver;
      out.structure = fibrous ? Structure.Diaphragm : Structure.Liver;
      out.sdf = fibrous ? -0.1 : -1;
      out.ny = 1;
      out.nz = 0;
      return true;
    }
  }
  // Spine
  {
    const dx = x,
      dz = z + 17.3;
    const d = Math.sqrt(dx * dx + dz * dz) - 2.2;
    if (d < 0) {
      out.tissue = Tissue.Spine;
      out.structure = Structure.Spine;
      out.sdf = d;
      return true;
    }
  }
  // Descending aorta (behind the left atrium, left of the spine)
  {
    const dx = x - DESC_AORTA_X,
      dz = z - DESC_AORTA_Z;
    const d = Math.sqrt(dx * dx + dz * dz) - DESC_AORTA_R;
    if (d < 0) {
      out.tissue = Tissue.Blood;
      out.structure = Structure.DescendingAorta;
      out.sdf = d;
      out.nx = dx / DESC_AORTA_R;
      out.nz = dz / DESC_AORTA_R;
      return true;
    }
    if (d < DESC_AORTA_WALL) {
      out.tissue = Tissue.VesselWall;
      out.structure = Structure.DescendingAorta;
      out.sdf = -Math.min(d, DESC_AORTA_WALL - d);
      out.nx = dx / DESC_AORTA_R;
      out.nz = dz / DESC_AORTA_R;
      return true;
    }
  }
  // Lungs: lateral to the cardiac notch borders (the acoustic windows), and everywhere beyond the pericardial fat pad and
  // the corridor under the chest wall that is not mediastinum (decision 150)
  const lungL = x > leftLungBorderX(t, y);
  const lungR = x < rightLungBorderX(t);
  const aroundHeart =
    heartDistCm > PERICARDIAL_FAT_CM &&
    depth > T + ANTERIOR_CORRIDOR_CM &&
    mediastinumDistance(x, y, z) > 0;
  if (lungL || lungR || aroundHeart) {
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
