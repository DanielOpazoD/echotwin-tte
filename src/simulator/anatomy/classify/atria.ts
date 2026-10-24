import {
  IAS_LEFT_FACE_CM,
  iasThickness,
  LA_CORNER_ANTERIOR_MARGIN_CM,
  LA_CORNER_HEIGHT_CM,
  LA_BASE_BOUND_READ_CM,
  laBaseLateralShare,
  laBaseSdf,
  laLateralWallSdf,
  LA_LATERAL_WALL_HOLD,
  LA_LATERAL_WALL_TOP,
  LA_LATERAL_HINGE_CM,
  LA_LATERAL_WALL_AHEAD_CM,
  laLateralWallBlend,
  LA_CORNER_FLAT_CM,
  LA_FLOOR_Y_CM,
  laFootprintScale,
  laRootHold,
  LA_POSTERIOR_FLOOR_DROP_CM,
  LA_POSTERIOR_RATIO,
  LA_SEPTAL_FLAT_CM,
  LA_TOUCH_CM,
  laMedialFaceOffset,
  leftAtrialFreeSdf,
  RA_LA_MIN_CM,
} from '../laGeometry';
export { iasThickness } from '../laGeometry';
import { Structure, Tissue } from '../tissue';
import { sdCapsule, sdEllipsoid, sdRoundCone, smax, smin } from '../sdf';
import { ROOT_EXCURSION } from '../heartFrame';
import { mitralOutlineSdf } from '../mitralValve';
import { latticeNoise3 } from '@/core/noise';
import { rvFloorZ, rvRadii } from '../rv';
import { skirtOffsetAt, skirtWarpScale } from '../valveSkirt';
import { setSample, type ClassifyCtx } from './context';
import { AORTIC_ROOT_WALL_CM } from '../aorticValve';
import { LA_WALL_CM, LAA_WALL_CM } from './pericardium';
import { IVC_HEPATIC_SEGMENT_CM, type AnchorsCached } from '../anchors';
import { PV_RADIUS, pulmonaryVeinSegment } from '../pulmonaryVeins';

/** Scratch for the pulmonary vein segment of the sample being classified (no allocation per sample). */
const PV_SEG = new Float64Array(6);
/** The posterior wall plane of the anchors, in the shape the vein placement takes (decision 330). */
export function laWallOf(A: AnchorsCached): { nx: number; ny: number; nz: number; d: number } {
  return { nx: A.laPostN.x, ny: A.laPostN.y, nz: A.laPostN.z, d: A.laPostD };
}

/** Radial scale of the atria: reservoir/conduit/booster with the LV contraction, shrunk by the atrial kick and its hold. */
/**
 * Share of the tricuspid annular descent the right atrial roof follows (decision 149). With the roof fixed the atrium
 * lengthened by the whole TAPSE of the free wall, 2.15 cm in the normal case, and measured 4.5 cm at end-diastole and
 * 6.7 at end-systole against a normal 3.5–4 and 4.5–5.3: the annular centre descends less than its lateral hinge, the
 * septal part being tied to the fibrous skeleton, and the atrium's upper wall follows the base a little. Half the TAPSE
 * is the effective elongation that brings the maximal volume to the case's declared one (47 against 45 mL in the normal
 * case) with a total emptying fraction of 38–43 % in sinus rhythm.
 */
export const RA_ROOF_DESCENT_SHARE = 0.5;
/**
 * The right atrium's lateral wall (decision 367), the left atrium's of decision 366 on the tricuspid side: it stands
 * RA_LATERAL_HINGE_CM beyond the lateral tricuspid hinge, over the top of the ventricle's free wall, from the shelf up to
 * RA_LATERAL_WALL_HOLD (a fraction of the body's half length about its centre, below it) and eases back into the body
 * by RA_LATERAL_WALL_TOP, above which it adds nothing. Before, the body stood 9 mm medial of the hinge 6-8 mm above it,
 * and only the orifice column reached the ring. Held up to the equator, as on the left, the wall widened the atrium's
 * mid-level transverse axis by up to 0.9 cm (4.80 cm in the HFrEF case, 4.46 in hypertrophic cardiomyopathy); eased back
 * from there to the centre, the edge stepped 5-9 mm per 2 mm toward the septum 16-20 mm above the hinge.
 */
export const RA_LATERAL_HINGE_CM = 0.5;
export const RA_LATERAL_WALL_HOLD = -0.3;
export const RA_LATERAL_WALL_TOP = 0.9;
/**
 * The base the right ventricle vacates in systole becomes atrium only over the tricuspid orifice and a vestibule of
 * this width around it (decision 149). Decision 133 gave the atrium the whole end-diastolic crescent between the
 * floors, from groove to groove: 22 mL in the normal case, 3 of them taken from the infundibulum at end-systole, which
 * made the right ventricle's geometric ejection fraction read 3 points high. Outside the vestibule the vacated base is
 * right ventricular wall and the fat of the atrioventricular groove, as in a heart.
 */
export const RA_SLEEVE_MARGIN_CM = 0.5;
/**
 * The vestibule opens onto the septal side of the tricuspid orifice (decision 226): the orifice column and the cavity
 * are joined with a smooth minimum of RA_VESTIBULE_UNION_CM where the direction from the orifice centre points toward the
 * septum (its cosine above RA_VESTIBULE_SEPTAL_COS, full RA_VESTIBULE_SEPTAL_RAMP beyond), and with a sharp one on the
 * free-wall side, which keeps its vestibule wall down to the annulus.
 */
export const RA_VESTIBULE_UNION_CM = 0.6;
export const RA_VESTIBULE_SEPTAL_COS = 0.2;
export const RA_VESTIBULE_SEPTAL_RAMP = 0.3;

/**
 * The anteromedial right atrium (decision 218): the atrial wall that wraps the right side of the aortic root, where the
 * non-coronary sinus meets the atrial septum and the root indents the atrium, and the tricuspid septal leaflet hinges
 * across the membranous septum just below. The atrium was an ellipsoid 2 cm behind the root: walking from the root
 * toward the patient's right 0.3 cm above the annulus crossed 1.1-1.8 cm of wall before the first right-heart cavity,
 * the ventricle in eight of twelve cases. A capsule from inside the atrial body (offset from its centre) to the right
 * side of the root at the level of its sinuses (offset from the moving valve centre), smoothly joined to the
 * ellipsoid, brings the atrium to 0.26-0.82 cm of the root lumen in eleven cases without touching the apical views.
 */
export const RA_ANTEROMEDIAL_FROM: readonly [number, number, number] = [0.6, 0.6, 0.4];
export const RA_ANTEROMEDIAL_TO: readonly [number, number, number] = [-2.1, -0.2, -0.3];
export const RA_ANTEROMEDIAL_R_CM = 0.8;
export const RA_ANTEROMEDIAL_BLEND_CM = 0.6;

/**
 * The atrium beside the membranous septum (decision 222). Under the commissure between the non-coronary and right
 * coronary sinuses the left ventricular outflow tract faces the right atrium across the atrioventricular part of the
 * membranous septum. The atrium was clipped flat against the interatrial plane everywhere, also in front of the left
 * atrium where there is no interatrial septum, so between the outflow tract and the atrium lay 0.8 cm of fat at end-
 * diastole and in systole a 0.6 cm slab of interatrial septum drawn where only the right atrium reached the plane. Where
 * the left atrium is RA_SEPTAL_RELEASE_LA_CM away and more (over a ramp as long) the plane no longer clips the right atrium
 * nor draws a septum, and a capsule carries the atrium from its anteromedial reach (decision 218) down to the septum just
 * below the aortic annulus, above the tricuspid floor and outside the ventricular wall.
 */
export const RA_SEPTAL_RELEASE_LA_CM = 0.6;
export const RA_SEPTAL_RELEASE_RAMP_CM = 0.6;
/**
 * Out to which fossa radius (1 = its rim, 1.3 = the limbus's outer edge) the left atrium meets the septum (decision 319):
 * the ellipsoid met the septal plane only around its equator, so its wall ran over the fossa. The right atrium keeps its
 * shape and its thin wall there (its volume stays the case's).
 */
export const FOSSA_REACH = 1.0;
export { LA_CORNER_HEIGHT_CM } from '../laGeometry';
/** How far past the interatrial plane (cm) the released atrium may reach: its own shape bounds it. */
export const RA_SEPTAL_RELEASE_CM = 4;
export const RA_MEMBRANOUS_TO: readonly [number, number, number] = [-1.45, -0.85, 0.05];
export const RA_MEMBRANOUS_R_CM = 0.5;
/** Reach (cm) from the ventricular epicardium over which the atrium follows the septal crest (decision 223). */
export const RA_CREST_REACH_CM = 1.5;

/** Distance to the superior vena cava, which enters the roof of the atrium from above (decision 219). */
export function svcDistance(A: AnchorsCached, x: number, y: number, z: number): number {
  // its entry segment and the rest that rises (decision 324)
  return Math.min(
    sdCapsule(x, y, z, A.svcA.x, A.svcA.y, A.svcA.z, A.svcM.x, A.svcM.y, A.svcM.z, A.svcR),
    sdCapsule(x, y, z, A.svcM.x, A.svcM.y, A.svcM.z, A.svcB.x, A.svcB.y, A.svcB.z, A.svcR),
  );
}

/** Distance to the inferior vena cava and its intrahepatic segment, narrowed by its respiratory collapse (decision 113). */
export function ivcDistance(
  A: AnchorsCached,
  ivcCollapse: number,
  x: number,
  y: number,
  z: number,
): number {
  const rI = A.ivcR * (1 - ivcCollapse);
  return Math.min(
    sdCapsule(x, y, z, A.ivcA.x, A.ivcA.y, A.ivcA.z, A.ivcB.x, A.ivcB.y, A.ivcB.z, rI),
    sdCapsule(
      x,
      y,
      z,
      A.ivcB.x,
      A.ivcB.y,
      A.ivcB.z,
      A.ivcB.x + IVC_HEPATIC_SEGMENT_CM[0],
      A.ivcB.y + IVC_HEPATIC_SEGMENT_CM[1],
      A.ivcB.z + IVC_HEPATIC_SEGMENT_CM[2],
      rI,
    ),
  );
}

/**
 * Distance to the lumen of the veins and the appendage that open into the left atrium (decision 320), negative inside one
 * of them. The atrial wall and the interatrial septum are classified before them, so 2.5-6 mm of wall closed every
 * pulmonary vein and the appendage at its mouth (the septum the right veins at end-systole): in 3D the left atrium met
 * the veins' blood over 0.4 cm² at end-diastole and none at end-systole, and the appendage's over 0.2 cm², against four
 * ostia of 0.9-1.3 cm (CT, Kim et al., Radiology 2005;235:43). The wall is not drawn across these lumens, as decision 219 did for the venae cavae.
 */
export function leftAtrialMouthLumen(
  c: ClassifyCtx,
  x: number,
  y: number,
  z: number,
  la: { x: number; y: number; z: number },
  lr: { x: number; y: number; z: number },
  bo: number,
  czL: number,
): number {
  let d = sdCapsule(
    x,
    y,
    z,
    la.x + lr.x * 0.55,
    la.y + lr.y * 0.55,
    czL + 0.4,
    la.x + lr.x * 0.95,
    la.y + lr.y * 0.55 + 2.0,
    czL + 0.9,
    0.55 * bo +
      0.12 * (latticeNoise3(x * 2.3 + 1.7, y * 2.3 + 4.2, z * 2.3 + 8.8, c.m.wallNoise) - 0.5),
  );
  const g = c.veinSeg;
  for (let i = 0; i < 24; i += 6) {
    const dPv = smax(
      sdCapsule(x, y, z, g[i]!, g[i + 1]!, g[i + 2]!, g[i + 3]!, g[i + 4]!, g[i + 5]!, PV_RADIUS),
      0.12 - c.colDist,
      0.2,
    );
    d = Math.min(d, dPv);
  }
  return d;
}

/**
 * Clearance (cm) the right atrial cavity keeps from the lumen of the right pulmonary veins (decision 320): the vein's wall
 * (0.12) and its own (0.22). The veins run behind the atrium into the interatrial groove; the dilated atrium of pulmonary
 * hypertension took up to 46 % of the right inferior vein's first 2 cm, its cavity and wall drawn across the lumen.
 */
export const RA_RIGHT_VEIN_CLEARANCE_CM = 0.34;

/** Distance to the lumen of the right pulmonary veins (decision 320), from the per-pose vein segments. */
export function rightVeinDistance(c: ClassifyCtx, x: number, y: number, z: number): number {
  const g = c.veinSeg;
  return Math.min(
    sdCapsule(x, y, z, g[0]!, g[1]!, g[2]!, g[3]!, g[4]!, g[5]!, PV_RADIUS),
    sdCapsule(x, y, z, g[12]!, g[13]!, g[14]!, g[15]!, g[16]!, g[17]!, PV_RADIUS),
  );
}

/**
 * Fill the per-pose atrial cache (decisions 320-321): the vein segments and the coronary sinus course depend only on the
 * pose and the anchors, and computing them per sample cost a quarter of the CPU tracer's time.
 */
function atrialPoseCache(
  c: ClassifyCtx,
  la: { x: number; y: number; z: number },
  lr: { x: number; y: number; z: number },
  bo: number,
  czL: number,
  rzL: number,
): void {
  if (c.atrialHp === c.hp && c.atrialA === c.A) return;
  c.atrialHp = c.hp;
  c.atrialA = c.A;
  const wall = laWallOf(c.A);
  for (let i = 0; i < 4; i++) {
    pulmonaryVeinSegment(i, la, lr, bo, czL, rzL, PV_SEG, wall);
    c.veinSeg.set(PV_SEG, 6 * i);
  }
  const zAnn = c.hp.zAnn;
  const mv = c.hp.valves.mitral;
  // the sinus lies in the groove, under the body's full posterior surface, whatever the radial scale (decision 330)
  const rx = lr.x,
    ry = lr.y;
  const zs = zAnn - CS_ABOVE_ANNULUS_CM;
  const x0 = c.A.iasX + CS_CRUX_FROM_IAS_CM;
  const g = c.csGeo;
  g[0] = zs;
  g[1] = x0;
  g[2] = Math.min(CS_LATERAL_X_CM, la.x + 0.85 * rx);
  g[3] = rx;
  g[4] = ry;
  g[5] = czL;
  g[6] = rzL;
  g[7] = Math.max(
    laPosteriorY(Math.max(x0, la.x), zs, la, rx, ry, czL, rzL) -
      LA_POSTERIOR_FLOOR_DROP_CM -
      CS_GROOVE_OFFSET_CM,
    csWallFloor(c, x0, zs),
  );
  g[8] = c.A.iasX - CS_OSTIUM_FROM_IAS_CM;
  g[9] = CS_OSTIUM_Y_CM;
  g[10] = zAnn - CS_OSTIUM_ABOVE_ANNULUS_CM;
  g[11] = mv.cx;
  g[12] = mv.cy;
  g[13] = mv.R;
}

/**
 * The coronary sinus (decision 321) runs in the posterior atrioventricular groove on the atrial side of the mitral annulus,
 * CS_ABOVE_ANNULUS_CM above it (minimal distance 5.1 ± 2.9 mm on CT, Tops et al., Am J Cardiol 2007; variable, Choure et
 * al., JACC 2006;48:1938), against the posterior wall of the left atrium, and opens into the right atrium beside the
 * septum, in front of the inferior vena cava. It ran 1-3.5 mm below the annulus on the ventricular side, the inferior
 * wall of the ventricle took part of its lumen (2.6 cm² of contact without its wall), and its end met the wall of the
 * inferior vena cava instead of the atrium.
 * Course: a tube along the atrium's posterior contour at that height, outside its wall and its own, from the lateral
 * groove (CS_LATERAL_X_CM, or the atrium's lateral reach) to the crux behind the septum (CS_CRUX_FROM_IAS_CM), then a
 * funnel to the ostium CS_OSTIUM_FROM_IAS_CM to the right of the septum at y CS_OSTIUM_Y_CM, CS_OSTIUM_ABOVE_ANNULUS_CM
 * above the mitral annulus: a point inside the right atrium in every case and phase. Lumen 0.66 cm, ostium 1.0 cm (CT
 * 1.1-1.6 cm).
 */
export const CS_ABOVE_ANNULUS_CM = 0.5;
export const CS_LATERAL_X_CM = 2.2;
export const CS_CRUX_FROM_IAS_CM = 0.4;
export const CS_OSTIUM_FROM_IAS_CM = 1.2;
export const CS_OSTIUM_Y_CM = -1.2;
export const CS_OSTIUM_ABOVE_ANNULUS_CM = 0.4;
export const CS_RADIUS_CM = 0.33;
export const CS_OSTIUM_RADIUS_CM = 0.5;
/**
 * Above the annulus the left atrium comes up to the root's outer wall less its own wall and this gap (cm), within
 * LA_ROOT_NEAR_CM of the root (decision 335): the wall of the atrium and the wall of the root, with a film between.
 */
export const LA_ROOT_GAP_CM = 0.05;
export const LA_ROOT_NEAR_CM = 1.2;
/** Up to how far above the annulus, along the root's axis, the septum's anterior rim rests on the root: the sinuses (cm). */
export const LA_ROOT_TOP_CM = 1.5;
/** How fast the right atrium's release takes the root's ground back from the left atrium (cm per unit of release). */
export const LA_ROOT_RELEASE_CM = RA_SEPTAL_RELEASE_CM;
export const CS_WALL_CM = 0.1;
/** From the atrium's posterior surface to the sinus's axis: the atrial wall, the sinus's wall and its radius (cm). */
export const CS_GROOVE_OFFSET_CM = LA_WALL_CM + CS_WALL_CM + CS_RADIUS_CM;
/** From the posterior mitral annulus to the sinus's axis (cm): the ring, the sinus's wall and its radius. */
export const CS_ANNULUS_OFFSET_CM = 0.15 + CS_WALL_CM + CS_RADIUS_CM;

/** Lowest y the sinus's axis may take at (x, z) to stay its wall in front of the posterior wall plane (decision 330). */
function csWallFloor(c: ClassifyCtx, x: number, z: number): number {
  const n = c.A.laPostN;
  return (c.A.laPostD - CS_RADIUS_CM - CS_WALL_CM - x * n.x - z * n.z) / n.y;
}

/** Posterior surface (y) of the left atrial cavity at (x, z), the flattened ellipsoid of `leftAtrialFreeSdf`. */
function laPosteriorY(
  x: number,
  z: number,
  la: { x: number; y: number },
  rx: number,
  ry: number,
  cz: number,
  rz: number,
): number {
  const u = (x - la.x) / rx,
    w = (z - cz) / rz;
  const q = Math.max(0, 1 - u * u - w * w);
  return Math.max(la.y - ry * Math.sqrt(q), la.y - LA_POSTERIOR_RATIO * ry);
}

/**
 * Distance to the coronary sinus lumen (decision 321). Far from its course it may return a lower bound (the distance to
 * the box that holds it) where that already decides every use of it.
 */
export function coronarySinusDistance(c: ClassifyCtx, x: number, y: number, z: number): number {
  const g = c.csGeo;
  const zs = g[0]!,
    x0 = g[1]!,
    x1 = g[2]!;
  // the lumen lies within 0.5 cm of zs (the ostium's funnel reaches zs + 0.6) and between the ostium and the lateral end
  const far = Math.max(
    Math.abs(z - zs - 0.05) - 0.65,
    g[8]! - CS_OSTIUM_RADIUS_CM - x,
    x - x1 - CS_RADIUS_CM,
  );
  // a lower bound is enough where it already decides every use: the wall and lumen tests, and the sac's minimum
  if (far > 0.3 && far - CS_WALL_CM >= c.laEpi) return far;
  const la = c.A.laCenter;
  // medial to its centre the atrium reaches as far back as at its centre (the septal corner, decision 318), and behind
  // the posterior mitral annulus, where the tapering atrium is narrower than the ring
  const xc = Math.min(x1, Math.max(x0, x));
  // under the atrium's floor at the back (LA_POSTERIOR_FLOOR_DROP_CM lower, decision 330), and in front of the
  // posterior wall plane by its own wall
  const yc = Math.max(
    Math.min(
      laPosteriorY(Math.max(xc, la.x), zs, la, g[3]!, g[4]!, g[5]!, g[6]!) -
        LA_POSTERIOR_FLOOR_DROP_CM -
        CS_GROOVE_OFFSET_CM,
      g[12]! - Math.sqrt(Math.max(0, g[13]! * g[13]! - (xc - g[11]!) ** 2)) - CS_ANNULUS_OFFSET_CM,
    ),
    csWallFloor(c, xc, zs),
  );
  const body = Math.hypot(x - xc, y - yc, z - zs) - CS_RADIUS_CM;
  const ostium = sdRoundCone(
    x,
    y,
    z,
    x0,
    g[7]!,
    zs,
    g[8]!,
    g[9]!,
    g[10]!,
    CS_RADIUS_CM,
    CS_OSTIUM_RADIUS_CM,
  );
  // clear of the left atrial cavity by both walls, so the sinus is never unroofed into it
  return Math.max(Math.min(body, ostium), LA_WALL_CM + CS_WALL_CM - c.laCav);
}

/**
 * The right atrial appendage (decision 323): the broad pouch of the right atrium that runs forward over the atrioventricular
 * groove beside the right face of the aortic root. The model had none. Against twenty healthy hearts of a four-chamber CT
 * atlas (Rodero et al., PLoS Comput Biol 2021) the right atrial myocardium of 60 % or more of them filled 17 cm³ in front
 * of the model's atrium, up to 5 cm forward of its centre, centred at (−4.2, 3.4, −2.2) cm in the heart frame of the
 * normal case; on CT the appendage holds 13.3 ± 3.5 mL in men and 10.7 ± 2.8 in women at its largest and 5-6 mL at its
 * smallest, with a 37 × 26 mm base and 24 mm of depth (BMC Cardiovasc Disord 2025, 60 patients in sinus rhythm).
 * A rounded cone from inside the atrium's anterosuperior face (`raaBase` in the anchors, decision 324) to a tip
 * set from the aortic valve centre (RAA_TIP_FROM_AV), radii RAA_BASE_R_CM and RAA_TIP_R_CM scaled with the atrium, with the
 * wall of the left appendage.
 */
export const RAA_TIP_FROM_AV: readonly [number, number, number] = [-3.2, 3.0, -1.3];
export const RAA_BASE_R_CM = 1.1;
export const RAA_TIP_R_CM = 0.55;
/**
 * Height (cm) over the atrial floor below which the appendage does not reach (decision 324): its base lies over the
 * anterior atrioventricular groove, and without this its wall reached the anteroseptal edge of the tricuspid orifice.
 */
export const RAA_ABOVE_FLOOR_CM = 0.5;

/** Distance to the right atrial appendage's lumen (decision 323). */
export function rightAppendageDistance(
  c: ClassifyCtx,
  bo: number,
  x: number,
  y: number,
  z: number,
): number {
  const A = c.A,
    b = A.raaBase,
    av = A.avCenter;
  return sdRoundCone(
    x,
    y,
    z,
    b.x,
    b.y,
    b.z,
    av.x + RAA_TIP_FROM_AV[0],
    av.y + RAA_TIP_FROM_AV[1],
    av.z + RAA_TIP_FROM_AV[2],
    RAA_BASE_R_CM * bo,
    RAA_TIP_R_CM * bo,
  );
}

export function atrialScale(booster: number, reservoir: number, contraction: number): number {
  return booster * (reservoir + (1 - reservoir) * contraction);
}

/** Right atrial radial scale under tamponade: late-diastolic collapse of `raCollapse` (0..1). */
export function raCollapseScale(raCollapse: number): number {
  return 1 - 0.35 * raCollapse;
}

/**
 * Atria (lengthen in systole as the annulus descends), interatrial septum, left atrial appendage, pulmonary veins,
 * venae cavae with the hepatic vein, and the coronary sinus. True when the point is one of them.
 */
export function classifyAtria(c: ClassifyCtx): boolean {
  const { m, hp, A, x, y, z, out } = c;
  const zAnn = hp.zAnn;
  const V = hp.valves;
  const la = A.laCenter,
    lr = A.laR;
  const zTop = la.z - lr.z; // fixed superior boundary (roof, under the pulmonary bifurcation)
  const zBottom = zAnn + 0.25;
  const czL = (zTop + zBottom) / 2,
    rzL = (zBottom - zTop) / 2;
  // reservoir / conduit / booster: radial size follows LV contraction (maximal at end-systole); the atrial
  // kick and its hold until ejection shrink it further (laBooster)
  const bo = atrialScale(hp.laBooster, A.laReservoir, hp.state.contraction);
  // the right atrium's own (decision 330)
  const boR = atrialScale(hp.laBooster, A.raReservoir, hp.state.contraction);
  atrialPoseCache(c, la, lr, bo, czL, rzL);
  const xIas = A.iasX;
  // interatrial septum: muscular septum ~0.55 cm with a thicker limbus around the thin fossa ovalis membrane. Its left
  // face is flat (decision 327): the limbus stands and the fossa sinks on the right atrial side only.
  const fo = Math.hypot((y - A.fossaY) / 0.6, (z - A.fossaZ) / 0.7);
  const tIas = iasThickness(fo);
  const xFace = xIas + IAS_LEFT_FACE_CM;
  // LA: ellipsoid flattened against the septum (medial clip), against the oesophagus / descending aorta
  // (posterior clip) and under the pulmonary bifurcation (roof clip)
  // beside the aortic root the body keeps its end-systolic size (decision 341): the scale at this point
  const rootOuter = c.rootRr - c.rootR - AORTIC_ROOT_WALL_CM;
  const boL = bo + (1 - bo) * laRootHold(c.rootT, rootOuter, x - (A.iasX + IAS_LEFT_FACE_CM));
  const dFreeLa = leftAtrialFreeSdf(x, y, z, la.x, la.y, czL, lr.x * boL, lr.y * boL, rzL, zTop);
  // the body at the scale of the moment, without the hold: what the right atrium's release reads (decision 222), which
  // the hold would otherwise keep from the membranous septum beside the root
  const dFreeLaNow =
    boL === bo
      ? dFreeLa
      : leftAtrialFreeSdf(x, y, z, la.x, la.y, czL, lr.x * bo, lr.y * bo, rzL, zTop);
  // the atrium's epicardium, for the pericardial sac: the outer face of its wall and of the appendage's (decision 273)
  c.laEpi = Math.min(
    dFreeLa - LA_WALL_CM,
    sdCapsule(
      x,
      y,
      z,
      la.x + lr.x * 0.55,
      la.y + lr.y * 0.55,
      czL + 0.4,
      la.x + lr.x * 0.95,
      la.y + lr.y * 0.55 + 2.0,
      czL + 0.9,
      0.55 * bo,
    ) - LAA_WALL_CM,
  );
  // The corner between the septum and the annulus belongs to the atrium (decision 318): its medial wall is the septum
  // down to the septal hinge of the mitral valve. As an ellipsoid it curved away from both toward the annulus, and the
  // oblique four-chamber cut showed the gap as a wedge of wall, fat and ventricular overhang under the hinge.
  // only toward the septum, where the atrium's own section reaches at this height
  const dCrossLa = leftAtrialFreeSdf(
    la.x,
    y,
    z,
    la.x,
    la.y,
    czL,
    lr.x * boL,
    lr.y * boL,
    rzL,
    zTop,
  );
  // the gap between the plane and the ellipsoid's medial chord at this (y, z) (decision 327)
  const uL = (y - la.y) / (lr.y * boL),
    wL = (z - czL) / rzL;
  const gap = la.x - lr.x * boL * Math.sqrt(Math.max(0, 1 - uL * uL - wL * wL)) - xFace;
  // In the corner the atrium keeps, down to the annulus, the section it has LA_CORNER_HEIGHT_CM above it: the ellipsoid
  // tapers to a tip there and left fat and wall under the septal hinge of the four-chamber view, where the base of a real
  // atrium sits broad on the annulus. Up to LA_CORNER_FLAT_CM of that section's chord is closed to the plane, so bounded
  // by the chord the corner stops short of the aortic root; its floor is the hinge at this azimuth (the annulus is a
  // saddle, and the commissural hinges of the four-chamber view sit apical of the mean plane).
  const zRef = zAnn - LA_CORNER_HEIGHT_CM;
  const wRef = (zRef - czL) / rzL;
  const gapRef = la.x - lr.x * boL * Math.sqrt(Math.max(0, 1 - uL * uL - wRef * wRef)) - xFace;
  const cornerOff = laMedialFaceOffset(gapRef, LA_CORNER_FLAT_CM);
  // (the base, on the annulus, keeps the body's full sections whatever the radial scale of the moment, decision 330:
  // tethered to the skeleton, it does not shrink with the kick as the body does)
  const dCrossRef = leftAtrialFreeSdf(la.x, y, zRef, la.x, la.y, czL, lr.x, lr.y, rzL, zTop);
  const zHingeHere = c.zHinge;
  // and in front it ends at the aortomitral curtain, the straight anterior edge of the annulus: beyond it the right atrium
  // reaches the outflow tract across the membranous septum (decision 222)
  // (measured along the valve's anterior axis, the normal of the straight edge, which runs 22° obliquely to y; the
  // four-chamber plane cuts the corner 2.9-3.5 mm in front of the edge, within the margin)
  // read at the septal face, where the corner meets the plane, and carried across the atrium: read at the sample the
  // oblique edge crossed the slab and the corner's own edge, so the right atrium's wall stood 1.1 mm inside the septum
  // and the corner ended 1-1.5 mm short of the face behind its own wall (the valve's axis points to the septal side, so
  // to the right of the face the edge lies farther in front than the bound: the corner never passes it there)
  const mvA = V.mitral;
  const rootClearFaceLine =
    (xFace - mvA.cx) * mvA.ux + (y - mvA.cy) * mvA.uy - (mvA.D + LA_CORNER_ANTERIOR_MARGIN_CM);
  // the base reads the curtain's bound a little medial of the point, at the face near the face (decision 328)
  const xRead = Math.max(xFace, x - LA_BASE_BOUND_READ_CM);
  const rootClearBaseLine =
    (xRead - mvA.cx) * mvA.ux + (y - mvA.cy) * mvA.uy - (mvA.D + LA_CORNER_ANTERIOR_MARGIN_CM);
  // above the annulus the root is round and recedes from the curtain's straight bound: near it the atrium comes up to a
  // wall's thickness of the root's outer wall (decision 335). Behind the root in the parasternal short axis a wedge of fat
  // 7-10 mm across stood between the bound and the root, the left atrium held off its septal face, and the septum did
  // not reach the root.
  // the right atrium is released from the septal plane in front of the left atrium (decision 222): by how much
  const qRel = Math.min(
    1,
    Math.max(
      0,
      (Math.max(dFreeLaNow, rootClearFaceLine) - RA_SEPTAL_RELEASE_LA_CM) /
        RA_SEPTAL_RELEASE_RAMP_CM,
    ),
  );
  const relL = qRel * qRel * (3 - 2 * qRel);
  // (not where the right atrium is released past the plane toward the root: the atrium gives up the root's ground by as
  // much as the right atrium's face moves)
  const atSinuses = c.rootT >= 0 && c.rootT <= LA_ROOT_TOP_CM;
  const rootWall = atSinuses
    ? Math.max(LA_WALL_CM + LA_ROOT_GAP_CM - rootOuter, rootOuter - LA_ROOT_NEAR_CM) +
      LA_ROOT_RELEASE_CM * relL
    : 1e3;
  const rootClearFace = Math.min(rootClearFaceLine, rootWall);
  const rootClearBase = Math.min(rootClearBaseLine, rootWall);
  // and all around the annulus the base flares from the hinge up to that section (decision 328): the ellipsoid tapered
  // to a tip above the annulus, so 3 mm outside the ring the blood lay 2.5 cm above the hinge behind 6-19 mm of fat, and
  // under the anterior hinge of the two-chamber view 10 mm of fat and filler stood where the atrium is
  const dCrossEq = leftAtrialFreeSdf(la.x, y, czL, la.x, la.y, czL, lr.x, lr.y, rzL, zTop);
  const dCorner = laBaseSdf(
    x,
    la.x,
    xFace,
    cornerOff,
    z,
    zRef,
    zHingeHere,
    dCrossRef,
    dCrossEq,
    rootClearBase,
    mitralOutlineSdf(x, y, mvA),
    laBaseLateralShare(x - mvA.cx, y - mvA.cy),
  );
  // and over the fossa ovalis, wherever its section reaches, the atrium meets the septum (decision 319): the fossa's floor
  // is the one true septum, a membrane between the two atrial cavities; around it the rims are folds of the atrial walls
  // (the fossa is on the fixed septum: the fill reads the body's full section, whatever the radial scale of the moment,
  // decision 330; at the scale of the moment 1-2 mm of fat stood behind the membrane at end-diastole)
  const dCrossLaFull = leftAtrialFreeSdf(la.x, y, z, la.x, la.y, czL, lr.x, lr.y, rzL, zTop);
  const dFossaLa = Math.max(xFace - x, x - la.x, dCrossLaFull, (fo - FOSSA_REACH) * 0.6);
  // and wherever its body comes close to the septal plane, its medial wall is the septum (decision 327): the gap is closed
  // up to LA_SEPTAL_FLAT_CM and eases back to the body's own shape over LA_SEPTAL_TAPER_CM, so no wall, fat or thicker
  // septum stacks between the atria where they face each other
  const faceOff = laMedialFaceOffset(gap, LA_SEPTAL_FLAT_CM);
  const dFlat = Math.max(xFace + faceOff - x, x - la.x, dCrossLa);
  // the body with its fills, before the septal clip: what its wall wraps, what the sac wraps, and what the right atrium
  // keeps clear of (the release of decision 222 read the bare ellipsoid, so where a fill brought the left atrium to the
  // plane the right atrium was let through the slab and no septum was drawn: 2.3 cm² of blood against blood in the normal
  // case at mid-systole)
  // and behind, its wall is the plane on the descending aorta (decision 330): behind its centre the body is the prism
  // of its full section (the footprint of the posterior wall, which does not shrink with the beat) up to that plane,
  // with the body's roof, the groove (LA_FLOOR_Y_CM) as its floor and the hinge level as its end, so the wall is flat
  // across the atrium and down to the groove and does not move with the beat (the ellipsoid curved away
  // from the aorta toward the groove, leaving 4-16 mm of fat between them in the long axis, and moved back 4-5 mm with
  // each beat)
  const pn = A.laPostN;
  const tPost = x * pn.x + y * pn.y + z * pn.z - A.laPostD;
  const sPost = (x - la.x) * pn.x + (y - la.y) * pn.y + (z - czL) * pn.z;
  // (its footprint below the equator is the equator's: the wall runs straight down to the groove; the footprint's
  // edges follow half of the body's radial scale, the sides of the atrium moving 2 mm where its body moves 4)
  // (the prism's front is the plane through the centre that stands along the heart's axis: the plane across the
  // wall's normal, which leans back toward the annulus, left the posterior ring of a tall atrium in front of it)
  const sFront = (x - la.x) * pn.x + (y - la.y) * pn.y;
  // in front of that plane by more than the blend of the prism's union with the body (0.6, below) plus the body's own
  // distance, the prism cannot change the body's distance, and its silhouette is not evaluated: the same value the
  // union would read (the CPU tracer's cost guard, decision 247)
  let dPost: number;
  if (-sFront >= Math.max(dFreeLa, 0) + 0.6) dPost = dFreeLa + 0.6;
  else {
    const fp = laFootprintScale(bo);
    // (and below the centre the footprint keeps the centre's width, down to the groove: the body's own floor, lifted
    // with the AP span of a dilated atrium, left the posterior ring under fat and the coronary sinus)
    const dSil = sdEllipsoid(
      x - sPost * pn.x,
      Math.max(y - sPost * pn.y, la.y),
      Math.min(z - sPost * pn.z, czL),
      la.x,
      la.y,
      czL,
      lr.x * fp,
      lr.y * fp,
      rzL,
    );
    // and it ends at the hinge level, where the groove is
    // (its cavity ends half a wall above the hinge level: down to the hinge it put blood behind the posterior annulus,
    // where the groove is, and a whole wall left fat behind the wall on the long axis's groove lines)
    dPost = smax(
      smax(
        Math.max(tPost, -sFront, dSil, z - (c.zHinge - 0.5 * LA_WALL_CM)),
        LA_FLOOR_Y_CM - y,
        0.3,
      ),
      zTop + 0.15 * rzL - z,
      0.5,
    );
  }
  // in front of the curtain the body keeps RA_LA_MIN_CM from the septal plane (decision 330): drawn forward, a dilated
  // atrium reached the plane where the right atrium passes to the membranous septum (decision 222)
  // and only as far as it is released does the body keep its distance, in full once the released face reaches the left
  // one: next to the root, where the right atrium meets its face of the septum, the left meets the other (decision 335)
  const raReach = Math.min(1, (RA_SEPTAL_RELEASE_CM * relL) / tIas);
  // (in front of the curtain's bound, where the root lets the fills in, the atrium ends at its face like the rest of the
  // septum: the fills crossed it by up to 2.6 mm, thinning the septum to 1.2 mm)
  const holdShare = atSinuses && rootOuter < LA_ROOT_NEAR_CM ? raReach : 1;
  const frontClear = Math.min(rootClearFaceLine, xFace + RA_LA_MIN_CM * holdShare - x);
  const faceKeep = rootClearFaceLine > 0 ? xFace - x : -1e3;
  // the lateral wall stands on the lateral hinge (decision 366)
  const dLatWall = laLateralWallSdf(
    x,
    y,
    c.zHinge - z,
    (czL - z) / rzL,
    la.x,
    mvA.cx + mvA.R + LA_LATERAL_HINGE_CM,
    mvA.cy + LA_LATERAL_WALL_AHEAD_CM,
    LA_LATERAL_WALL_HOLD,
    LA_LATERAL_WALL_TOP,
  );
  // (united after the body's blend with the posterior prism: inside that blend, the wall's distance near its floor swelled
  // the dilated atria over the hinge)
  const dBodyPost = smin(smin(dFreeLa, dPost, 0.6), dLatWall, laLateralWallBlend(c.zHinge - z));
  const dLaBody = Math.max(
    Math.min(dBodyPost, dCorner, dFossaLa, dFlat),
    tPost,
    frontClear,
    faceKeep,
  );
  c.laEpi = Math.min(c.laEpi, dLaBody - LA_WALL_CM);
  // the same body seen from the septal plane: within 0.45 cm of it the septum is drawn and the right atrium meets its face
  // negative where a fill leaves the atrium within LA_TOUCH_CM of the plane: there the septum is drawn and the right
  // atrium meets its face; the bare ellipsoid keeps the 0.45 cm of decision 222
  const laTouch = Math.min(
    Math.max(dCrossLa, faceOff - LA_TOUCH_CM),
    Math.max(dCrossRef, zRef - z, z - zHingeHere, cornerOff - LA_TOUCH_CM, rootClearFace),
    // (over the fossa the body's full section, as the fill reads it, decision 330)
    Math.max(dCrossLaFull, (fo - FOSSA_REACH) * 0.6),
  );
  const nearLa =
    laTouch < 0 ||
    (rootClearFace < 0 &&
      sdEllipsoid(xIas, y, z, la.x, la.y, czL, lr.x * bo, lr.y * bo, rzL) < 0.45);
  const d = Math.max(
    Math.min(smax(dBodyPost, xFace - x, 0.3), dCorner, dFossaLa, dFlat),
    tPost,
    frontClear,
    faceKeep,
  );
  c.laCav = d;
  // and, near the root, wherever the body with its fills comes within the septum's thickness and LA_TOUCH_CM of a point
  // right of its face: there the fill reaches the face where the touch test above reads the curtain's bound (decision 335)
  const nearRoot = atSinuses && rootOuter < LA_ROOT_NEAR_CM;
  const nearLaBody = nearLa || (nearRoot && x <= xFace && d < tIas + LA_TOUCH_CM);
  if (d < 0) {
    setSample(
      out,
      Tissue.Blood,
      d,
      (x - la.x) / lr.x,
      (y - la.y) / lr.y,
      (z - czL) / rzL,
      x,
      y,
      z,
      0,
      Structure.LaCavity,
    );
    return true;
  }
  // the coronary sinus, which the pericardial sac wraps with the atrium (decision 321)
  const dCs = coronarySinusDistance(c, x, y, z);
  c.laEpi = Math.min(c.laEpi, dCs - CS_WALL_CM);
  // not across the mouths of the pulmonary veins and the appendage (decision 320)
  if (dLaBody < LA_WALL_CM && x > xFace && leftAtrialMouthLumen(c, x, y, z, la, lr, bo, czL) >= 0) {
    setSample(
      out,
      Tissue.Myocardium,
      -Math.min(dLaBody, LA_WALL_CM - dLaBody),
      (x - la.x) / lr.x,
      (y - la.y) / lr.y,
      (z - czL) / rzL,
      x,
      y,
      z,
      0,
      Structure.LaWall,
    );
    return true;
  }
  // RA: rounder, flattened against the septum and posteriorly
  const ra = A.raCenter,
    rr = A.raR;
  const zTopR = ra.z - rr.z + RA_ROOF_DESCENT_SHARE * hp.tvZ;
  // The atrium ends AT the annulus: it used to run 0.25 cm past it, with its own 0.22 cm wall sealing the
  // orifice and hiding the excess, so the cavity measured 5.60 cm (the top of the 3.5-5.6 range) while the
  // ellipsoid was really 5.82 cm long. Opening the orifice exposed that, so the ellipsoid is shortened by
  // the same amount instead of letting a wall trim it.
  // the floor is the annulus, wherever TAPSE has taken it (decision 133) and with its saddle and tilt (decision 138)
  const tvOff = skirtOffsetAt(V.tv, x, y);
  const zBotR = A.tvCenter.z + hp.tvZ + tvOff + 0.03;
  const czR = (zTopR + zBotR) / 2,
    rzR = (zBotR - zTopR) / 2;
  const raC = raCollapseScale(hp.raCollapse);
  const dEllRa = sdEllipsoid(x, y, z, ra.x, ra.y, czR, rr.x * boR * raC, rr.y * boR * raC, rzR);
  let dFreeRa = smax(dEllRa, ra.y - 0.8 * rr.y * boR - y, 0.6);
  // the lateral wall rises from the lateral tricuspid hinge as the left atrium's does from the mitral one (decision 367)
  {
    const tvLat = V.tv.cx - V.tv.R - RA_LATERAL_HINGE_CM;
    const hR = zBotR - z;
    const dLatR = Math.max(
      laLateralWallSdf(
        -x,
        y,
        hR,
        (czR - z) / rzR,
        -ra.x,
        -tvLat,
        V.tv.cy,
        RA_LATERAL_WALL_HOLD,
        RA_LATERAL_WALL_TOP,
      ),
      czR - RA_LATERAL_WALL_TOP * rzR - z,
    );
    dFreeRa = smin(dFreeRa, dLatR, laLateralWallBlend(hR));
    c.raBody = dFreeRa;
  }
  // the anteromedial atrium beside the right side of the aortic root (decision 218)
  {
    const av = A.avCenter;
    const f = RA_ANTEROMEDIAL_FROM,
      t = RA_ANTEROMEDIAL_TO;
    const dAm = sdCapsule(
      x,
      y,
      z,
      ra.x + f[0],
      ra.y + f[1],
      ra.z + f[2],
      av.x + t[0],
      av.y + t[1],
      av.z + zAnn * ROOT_EXCURSION + t[2],
      RA_ANTEROMEDIAL_R_CM * boR,
    );
    dFreeRa = smin(dFreeRa, dAm, RA_ANTEROMEDIAL_BLEND_CM);
    // on down to the membranous septum (decision 222): above the tricuspid floor, and outside the ventricular wall
    // (beyond its epicardium, or above its basal edge), so it never slips between the outflow tract and the septum
    const m2 = RA_MEMBRANOUS_TO;
    const zr = zAnn * ROOT_EXCURSION;
    let dMs = sdCapsule(
      x,
      y,
      z,
      av.x + t[0],
      av.y + t[1],
      av.z + zr + t[2],
      av.x + m2[0],
      av.y + m2[1],
      av.z + zr + m2[2],
      RA_MEMBRANOUS_R_CM * boR,
    );
    dMs = smax(dMs, z - zBotR, 0.1);
    dMs = smax(dMs, -Math.max(c.dEllR - c.wallT - 0.05, zAnn - 0.25 - z), 0.1);
    dFreeRa = smin(dFreeRa, dMs, 0.3);
  }
  // where the atrium borders the septal crest it takes the thickness the crest gave up (decision 223): its surface moves
  // with the septum's, within RA_CREST_REACH_CM of the ventricular epicardium, so no new lobe meets it at a crease
  if (c.crestLoss > 0) {
    const dEpi = c.dEllR - c.wallT;
    // only outside the epicardium: inside it the gaps between the outflow tract and the septum are not the atrium's
    const w =
      Math.min(1, Math.max(0, dEpi / 0.05)) *
      Math.min(1, Math.max(0, 1 - dEpi / RA_CREST_REACH_CM));
    dFreeRa -= c.crestLoss * w;
  }
  // The base the ventricle vacates as its annulus descends belongs to the atrium: the atrioventricular plane works as a
  // piston and the atria lengthen by what the ventricles shorten (Carlsson 2004: the total heart volume barely changes).
  // Here it is the end-diastolic crescent at this height, below the floor of the moment and above the end-diastolic one,
  // inside the free wall. Without it the basal RV between inflow and infundibulum was 2 cm of fat and wall at end
  // systole, and the short axis of the great vessels showed the ventricle contracting over that edge (decision 133).
  let dSleeve = 1e3;
  if (hp.tvZ > 0.05) {
    const rad = c.sleeveRad;
    rvRadii(m, A, hp.prof, hp.thickK, zAnn, hp.lengthNow, 0, 0, hp.septalShiftCm, 0, c.az, z, rad);
    const u = rad[1]!;
    if (u > 0 && u < 1) {
      const r = Math.hypot(x, y);
      // the end-diastolic floor has the annulus's own shape, without the septal lag of the moment (decision 220)
      const rhoT = Math.hypot(x - V.tv.cx, y - V.tv.cy);
      const tvOffEd =
        tvOff - V.tv.lift - (rhoT > 1e-6 ? (V.tv.tiltC * (x - V.tv.cx)) / rhoT : V.tv.tiltC);
      dSleeve = Math.max(
        rad[0]! + 0.1 - r,
        r - (rad[2]! - m.anatomy.rv.freeWallThicknessCm),
        rvFloorZ(A.tvCenter.z, 0, 0, u, tvOffEd) - z,
        z - rvFloorZ(A.tvCenter.z, hp.tvZ, hp.pvZ, u, tvOff),
        Math.hypot(x - V.tv.cx, y - V.tv.cy) * skirtWarpScale(V.tv, x - V.tv.cx, y - V.tv.cy) -
          (V.tv.R + RA_SLEEVE_MARGIN_CM),
      );
    }
  }
  c.raSleeve = dSleeve;
  dFreeRa = Math.min(dFreeRa, dSleeve);
  // behind, the right pulmonary veins with their wall (decision 320); over the fossa the membrane is what stands between
  // the right atrium and the veins' mouths, and the atrium meets it (decision 330: the right inferior vein, risen with the
  // forward-drawn body, passed 0.9-1.0 cm behind the fossa's centre, and the clearance left 0.2-1 mm of fat or 4.6-6.8 mm
  // of wall between the right atrial blood and the membrane in four cases)
  const rightVeinClear = Math.min(
    RA_RIGHT_VEIN_CLEARANCE_CM - rightVeinDistance(c, x, y, z),
    (fo - FOSSA_REACH) * 0.6,
  );
  dFreeRa = smax(dFreeRa, rightVeinClear, 0.2);
  // in front of the left atrium the interatrial plane no longer clips the right atrium (decision 222); in front of the
  // curtain the left atrium does not count, however close its body comes (decision 330: drawn forward, a dilated
  // atrium's body reached the plane behind the root, and a septum stood between the root and the right atrium)
  // (relL, computed with the left atrium's body, reads the curtain's straight bound)
  const xRaFace = xFace - tIas;
  const septumPlane = x - xRaFace - RA_SEPTAL_RELEASE_CM * relL;
  // and the right atrium meets its face of the septum wherever its body comes close (decision 327), as the left does,
  // where there is a septum to meet (the left atrium near the plane) and clear of the right pulmonary veins
  const uR = (y - ra.y) / (rr.y * boR * raC),
    wR = (z - czR) / rzR;
  const gapR = xRaFace - (ra.x + rr.x * boR * raC * Math.sqrt(Math.max(0, 1 - uR * uR - wR * wR)));
  const dCrossRa = smax(
    sdEllipsoid(ra.x, y, z, ra.x, ra.y, czR, rr.x * boR * raC, rr.y * boR * raC, rzR),
    ra.y - 0.8 * rr.y * boR - y,
    0.6,
  );
  const dFlatRa = Math.max(
    x - (xRaFace - laMedialFaceOffset(gapR, LA_SEPTAL_FLAT_CM)),
    ra.x - x,
    dCrossRa,
    laTouch,
    rightVeinClear,
  );
  // and never within the septum's thickness of the left atrial blood: the release of decision 222 reads the bare ellipsoid,
  // and where a fill brought the left atrium to the plane it let the right atrium through the slab (blood against blood
  // over 0.1-0.34 cm² in five cases, the septum thinned to 0.5-2 mm over 0.4-1.6 cm² in all)
  // (the membrane of the fossa is thinner than that minimum: there it is the membrane)
  const raLaMin = Math.min(tIas, RA_LA_MIN_CM);
  const dR = Math.max(Math.min(smax(dFreeRa, septumPlane, 0.3), dFlatRa), raLaMin - c.laCav);
  // and not where the septum stands: there the slab below is drawn
  const inSeptum = x <= xFace && x >= xFace - tIas && nearLaBody;
  if (dR < 0 && !inSeptum) {
    setSample(
      out,
      Tissue.Blood,
      dR,
      (x - ra.x) / rr.x,
      (y - ra.y) / rr.y,
      (z - czR) / rzR,
      x,
      y,
      z,
      0,
      Structure.RaCavity,
    );
    return true;
  }
  // The venae cavae open into the atrium (decision 219): its wall is not drawn across their mouths. The cavae were
  // classified after the wall, so 0.22-0.24 cm of atrial wall closed the inferior vena cava in every case and phase, and
  // 0.10-0.16 cm the superior one in diastole.
  // the right atrial appendage opens into the atrium and the sac wraps it (decision 323)
  // above the atrioventricular groove: it stays RAA_ABOVE_FLOOR_CM over the atrial floor, clear of the tricuspid orifice
  const dRaa = smax(rightAppendageDistance(c, boR, x, y, z), z - (zBotR - RAA_ABOVE_FLOOR_CM), 0.2);
  c.raaEpi = dRaa - LAA_WALL_CM;
  const dSvc = svcDistance(A, x, y, z);
  const dIvc = ivcDistance(A, hp.ivcCollapse, x, y, z);
  // not where the septum stands (decision 327): there the slab below is drawn, and the vestibule's blood keeps its
  // distance from the left atrial blood like the cavity does
  if (
    !inSeptum &&
    dFreeRa < 0.22 &&
    septumPlane < 0 &&
    dSvc >= 0 &&
    dIvc >= 0 &&
    dCs >= 0 &&
    dRaa >= 0
  ) {
    // No wall across the tricuspid orifice: there the atrium opens into the ventricle, and the annulus and
    // leaflets are emitted by the valve block above. Both atria end 0.25 cm past their annulus, but on the
    // left the LV cavity is classified first and claims the orifice, while on the right nothing did — so
    // the atrial wall filled the gap and drew a 2.6 mm echogenic line splitting RA from RV in every A4C.
    // Reported from the images by a cardiologist; measured as RaCavity -> RaWall 0.28 -> RvCavity along a
    // line straight through the annulus centre.
    // Only on the floor side of the atrium: the test was a cylinder over the ring, so the roof had no wall over a strip
    // the width of the annulus, which the four-chamber view cuts (decision 219). The floor half keeps it, since the
    // curved floor of the ellipsoid leaves a vestibule up to 1 cm above the orifice that only this rule opens.
    // On the septal side the vestibule opens onto the orifice: the orifice column and the cavity are one smooth volume,
    // so no fold of wall stands between the ring and the atrium that reaches the septum beyond it (decision 226). The
    // free-wall side keeps its vestibule wall down to the annulus.
    const oxT = x - V.tv.cx,
      oyT = y - V.tv.cy;
    const dOrifice = Math.hypot(oxT, oyT) - V.tv.R / skirtWarpScale(V.tv, oxT, oyT);
    const toward = oxT / Math.max(1e-6, Math.hypot(oxT, oyT));
    const septalSide = Math.min(
      1,
      Math.max(0, (toward - RA_VESTIBULE_SEPTAL_COS) / RA_VESTIBULE_SEPTAL_RAMP),
    );
    if (
      z > czR &&
      smin(dFreeRa, dOrifice, 1e-3 + RA_VESTIBULE_UNION_CM * septalSide) < 0 &&
      c.laCav > raLaMin
    ) {
      // past the annulus the blood belongs to the ventricle, as it does on the left where the LV cavity
      // claims the mitral orifice: calling it atrium instead stretched ra-long past its reference range
      const past = z > A.tvCenter.z + hp.tvZ + tvOff;
      setSample(
        out,
        Tissue.Blood,
        dFreeRa - 0.22,
        (x - ra.x) / rr.x,
        (y - ra.y) / rr.y,
        (z - czR) / rzR,
        x,
        y,
        z,
        0,
        past ? Structure.RvCavity : Structure.RaCavity,
      );
      return true;
    }
    setSample(
      out,
      Tissue.Myocardium,
      -Math.min(dFreeRa, 0.22 - dFreeRa),
      (x - ra.x) / rr.x,
      (y - ra.y) / rr.y,
      (z - czR) / rzR,
      x,
      y,
      z,
      0,
      Structure.RaWall,
    );
    return true;
  }
  // near the root the appendage keeps out of the septum and off the left atrial blood as the cavity does (decision 335:
  // there the left atrium now meets its face, and the appendage reached into the slab)
  if (dRaa < 0 && !(nearRoot && (inSeptum || c.laCav <= raLaMin))) {
    setSample(out, Tissue.Blood, dRaa, 0, 1, 0, x, y, z, 0, Structure.RaAppendage);
    return true;
  }
  if (dRaa < LAA_WALL_CM) {
    setSample(
      out,
      Tissue.Myocardium,
      -Math.min(dRaa, LAA_WALL_CM - dRaa),
      0,
      1,
      0,
      x,
      y,
      z,
      0,
      Structure.RaWall,
    );
    return true;
  }
  // interatrial septum: slab between the clipped atria wherever either atrium reaches the septal plane (behind the aortic
  // root in PSAX-AV as well as in A4C and subcostal views), not in front of the left atrium (decision 222)
  if (x <= xFace && x >= xFace - tIas && z < zAnn + 0.4) {
    // wherever the left atrium, with its fills, is at the plane there is a septum; where only the right atrium is, not in
    // front of the left atrium (decision 222)
    const nearRa =
      sdEllipsoid(xIas, y, z, ra.x, ra.y, czR, rr.x * boR * raC, rr.y * boR * raC, rzR) < 0.45;
    // and not across the coronary sinus, which passes behind the crux (decision 321)
    if (
      (nearLaBody || (nearRa && relL < 0.5)) &&
      dCs >= 0 &&
      leftAtrialMouthLumen(c, x, y, z, la, lr, bo, czL) >= 0
    ) {
      setSample(
        out,
        Tissue.Myocardium,
        -Math.min(xFace - x, x - (xFace - tIas)),
        1,
        0,
        0,
        x,
        y,
        z,
        0,
        Structure.InteratrialSeptum,
      );
      return true;
    }
  }
  // left atrial appendage: lobulated pouch on the anterolateral LA, pointing anteriorly (A2C/PSAX-AV)
  {
    const ax0 = la.x + lr.x * 0.55,
      ay0 = la.y + lr.y * 0.55,
      az0 = czL + 0.4;
    const ax1 = la.x + lr.x * 0.95,
      ay1 = ay0 + 2.0,
      az1 = czL + 0.9;
    const lob =
      0.12 * (latticeNoise3(x * 2.3 + 1.7, y * 2.3 + 4.2, z * 2.3 + 8.8, m.wallNoise) - 0.5);
    const dApp = sdCapsule(x, y, z, ax0, ay0, az0, ax1, ay1, az1, 0.55 * bo + lob);
    if (dApp < 0) {
      setSample(out, Tissue.Blood, dApp, 0, 1, 0, x, y, z, 0, Structure.LaAppendage);
      return true;
    }
    if (dApp < LAA_WALL_CM) {
      setSample(
        out,
        Tissue.Myocardium,
        -Math.min(dApp, LAA_WALL_CM - dApp),
        0,
        1,
        0,
        x,
        y,
        z,
        0,
        Structure.LaWall,
      );
      return true;
    }
  }
  // pulmonary veins: towards the hila from the lateral wall (left) and the posteromedial corner (right); the
  // geometry lives in pulmonaryVeins.ts, shared with the venous flow sampler (decision 143)
  for (let i = 0; i < 24; i += 6) {
    const g = c.veinSeg;
    // the veins pass beside the descending aorta and the vertebral body, not through them (decision 273)
    const dPv = smax(
      sdCapsule(x, y, z, g[i]!, g[i + 1]!, g[i + 2]!, g[i + 3]!, g[i + 4]!, g[i + 5]!, PV_RADIUS),
      0.12 - c.colDist,
      0.2,
    );
    if (dPv < 0) {
      setSample(out, Tissue.Blood, dPv, 0, -1, 0, x, y, z, 0, Structure.PulmonaryVein);
      return true;
    }
    if (dPv < 0.12) {
      setSample(
        out,
        Tissue.VesselWall,
        -Math.min(dPv, 0.12 - dPv),
        0,
        -1,
        0,
        x,
        y,
        z,
        0,
        Structure.PulmonaryVein,
      );
      return true;
    }
  }
  // venae cavae: the superior enters the RA roof from above (torso superior), the inferior its floor from
  // below and behind through the liver, joined by a hepatic vein (subcostal views); the IVC narrows with the sniff
  {
    if (dSvc < 0) {
      setSample(out, Tissue.Blood, dSvc, 0, 0, -1, x, y, z, 0, Structure.Svc);
      return true;
    }
    if (dSvc < 0.12) {
      setSample(
        out,
        Tissue.VesselWall,
        -Math.min(dSvc, 0.12 - dSvc),
        0,
        0,
        -1,
        x,
        y,
        z,
        0,
        Structure.Svc,
      );
      return true;
    }
    const dHv = sdCapsule(x, y, z, A.hvA.x, A.hvA.y, A.hvA.z, A.hvB.x, A.hvB.y, A.hvB.z, 0.4);
    if (dIvc < 0) {
      setSample(out, Tissue.Blood, dIvc, 0, 0, 1, x, y, z, 0, Structure.Ivc);
      return true;
    }
    // nor the caval wall across the mouth of the hepatic vein (it drew 0.14 cm there)
    if (dIvc < 0.12 && dHv >= 0) {
      setSample(
        out,
        Tissue.VesselWall,
        -Math.min(dIvc, 0.12 - dIvc),
        0,
        0,
        1,
        x,
        y,
        z,
        0,
        Structure.Ivc,
      );
      return true;
    }
    if (dHv < 0) {
      setSample(out, Tissue.Blood, dHv, 0, 0, 1, x, y, z, 0, Structure.HepaticVein);
      return true;
    }
    if (dHv < 0.08) {
      setSample(
        out,
        Tissue.VesselWall,
        -Math.min(dHv, 0.08 - dHv),
        0,
        0,
        1,
        x,
        y,
        z,
        0,
        Structure.HepaticVein,
      );
      return true;
    }
  }
  // coronary sinus: in the posterior atrioventricular groove above the mitral annulus, into the RA (decision 321)
  {
    if (dCs < 0) {
      setSample(out, Tissue.Blood, dCs, 0, -1, 0, x, y, z, 0, Structure.CoronarySinus);
      return true;
    }
    if (dCs < CS_WALL_CM) {
      setSample(
        out,
        Tissue.VesselWall,
        -Math.min(dCs, CS_WALL_CM - dCs),
        0,
        -1,
        0,
        x,
        y,
        z,
        0,
        Structure.CoronarySinus,
      );
      return true;
    }
  }
  return false;
}
