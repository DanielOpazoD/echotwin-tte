import type { AcousticWindowConfig, BodyHabitusConfig } from '@/cases/schema';
import { Structure, Tissue, type TissueSample } from './tissue';
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

export function createThoraxModel(habitus: BodyHabitusConfig, window: AcousticWindowConfig, patient: PatientState, ivcCollapsePct = 0): ThoraxModel {
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

/** Snap a skin point to the centre of the intercostal space it falls in (or the nearest one). */
export function snapToIntercostal(t: ThoraxModel, u: number, v: number): { u: number; v: number } {
  const kf = (t.rib2Y + t.ribSlope * Math.abs(u) - v) / ribSpacingAt(t, u) + 2; // fractional rib index
  const kAbove = Math.floor(kf);
  const yAbove = ribCenterY(t, kAbove, u);
  const yBelow = ribCenterY(t, kAbove + 1, u);
  return { u, v: (yAbove + yBelow) / 2 };
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

/** Classify a torso-frame point that is NOT inside the heart. Returns false for air outside the body. */
export function classifyThorax(t: ThoraxModel, x: number, y: number, z: number, out: TissueSample): boolean {
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
  if (depth < 0.2) {
    out.tissue = Tissue.Skin;
    out.structure = Structure.ChestWall;
    out.sdf = -Math.min(depth, 0.2 - depth);
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
    const kf = (t.rib2Y + t.ribSlope * Math.abs(x) - y) / t.ribSpacing + 2;
    const k = Math.round(kf);
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
    out.tissue = depth < T * 0.5 ? Tissue.Fat : Tissue.Muscle;
    out.structure = Structure.ChestWall;
    out.sdf = -Math.min(depth - 0.2, T - depth);
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
  // Descending aorta (posterior to LA)
  {
    const dx = x + 1.0,
      dz = z + 14.2;
    const d = Math.sqrt(dx * dx + dz * dz) - 1.1;
    if (d < 0) {
      out.tissue = Tissue.Blood;
      out.structure = Structure.DescendingAorta;
      out.sdf = d;
      out.nx = dx / 1.1;
      out.nz = dz / 1.1;
      return true;
    }
    if (d < 0.2) {
      out.tissue = Tissue.VesselWall;
      out.structure = Structure.DescendingAorta;
      out.sdf = -Math.min(d, 0.2 - d);
      out.nx = dx / 1.1;
      out.nz = dz / 1.1;
      return true;
    }
  }
  // Lungs: lateral to the cardiac notch / medial borders, and posterior wrap
  const lungL = x > leftLungBorderX(t, y);
  const lungR = x < rightLungBorderX(t);
  // posterior lung wrap behind the heart: only a narrow paravertebral/mediastinal column stays soft tissue
  const posteriorWrap = z < -10.5 && Math.abs(x + 0.5) > 1.5;
  if (lungL || lungR || posteriorWrap) {
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
