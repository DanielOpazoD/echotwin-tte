import { iasThickness, LA_POSTERIOR_RATIO, leftAtrialFreeSdf } from '../laGeometry';
export { iasThickness } from '../laGeometry';
import { Structure, Tissue } from '../tissue';
import { sdCapsule, sdEllipsoid, sdRoundCone, smax, smin } from '../sdf';
import { ROOT_EXCURSION } from '../heartFrame';
import { latticeNoise3 } from '@/core/noise';
import { rvFloorZ, rvRadii } from '../rv';
import { skirtOffsetAt, skirtWarpScale } from '../valveSkirt';
import { setSample, type ClassifyCtx } from './context';
import { LA_WALL_CM, LAA_WALL_CM } from './pericardium';
import type { AnchorsCached } from '../anchors';
import { PV_RADIUS, pulmonaryVeinSegment } from '../pulmonaryVeins';

/** Scratch for the pulmonary vein segment of the sample being classified (no allocation per sample). */
const PV_SEG = new Float64Array(6);

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
/**
 * Height (cm) above the annulus of the septal corner the atrium fills (decision 318): it reaches the septum there wherever
 * its own section does at its centre.
 */
export const LA_CORNER_HEIGHT_CM = 1.2;
/** How far past the interatrial plane (cm) the released atrium may reach: its own shape bounds it. */
export const RA_SEPTAL_RELEASE_CM = 4;
export const RA_MEMBRANOUS_TO: readonly [number, number, number] = [-1.45, -0.85, 0.05];
export const RA_MEMBRANOUS_R_CM = 0.5;
/** Reach (cm) from the ventricular epicardium over which the atrium follows the septal crest (decision 223). */
export const RA_CREST_REACH_CM = 1.5;

/** Distance to the superior vena cava, which enters the roof of the atrium from above (decision 219). */
export function svcDistance(A: AnchorsCached, x: number, y: number, z: number): number {
  return sdCapsule(x, y, z, A.svcA.x, A.svcA.y, A.svcA.z, A.svcB.x, A.svcB.y, A.svcB.z, A.svcR);
}

/** Distance to the inferior vena cava, narrowed by its respiratory collapse (decision 113). */
export function ivcDistance(
  A: AnchorsCached,
  ivcCollapse: number,
  x: number,
  y: number,
  z: number,
): number {
  const rI = A.ivcR * (1 - ivcCollapse);
  return sdCapsule(x, y, z, A.ivcA.x, A.ivcA.y, A.ivcA.z, A.ivcB.x, A.ivcB.y, A.ivcB.z, rI);
}

/**
 * Distance to the lumen of the veins and the appendage that open into the left atrium (decision 320), negative inside one
 * of them. The atrial wall and the interatrial septum are classified before them, so 2.5-6 mm of wall closed every
 * pulmonary vein and the appendage at its mouth (the septum the right veins at end-systole): in 3D the left atrium met
 * the veins' blood over 0.4 cm² at end-diastole and none at end-systole, and the appendage's over 0.2 cm², against four
 * ostia of 0.9-1.3 cm (CT, Kim et al., Radiology 2005;235:43). The wall is not drawn across these lumens, as decision 219 did for the venae cavae.
 */
export function leftAtrialMouthLumen(
  m: ClassifyCtx['m'],
  colDist: number,
  x: number,
  y: number,
  z: number,
  la: { x: number; y: number; z: number },
  lr: { x: number; y: number; z: number },
  bo: number,
  czL: number,
  rzL: number,
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
      0.12 * (latticeNoise3(x * 2.3 + 1.7, y * 2.3 + 4.2, z * 2.3 + 8.8, m.wallNoise) - 0.5),
  );
  for (let i = 0; i < 4; i++) {
    pulmonaryVeinSegment(i, la, lr, bo, czL, rzL, PV_SEG);
    const dPv = smax(
      sdCapsule(
        x,
        y,
        z,
        PV_SEG[0]!,
        PV_SEG[1]!,
        PV_SEG[2]!,
        PV_SEG[3]!,
        PV_SEG[4]!,
        PV_SEG[5]!,
        PV_RADIUS,
      ),
      0.12 - colDist,
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

/** Distance to the lumen of the right pulmonary veins (decision 320). */
export function rightVeinDistance(
  la: { x: number; y: number; z: number },
  lr: { x: number; y: number; z: number },
  bo: number,
  czL: number,
  rzL: number,
  x: number,
  y: number,
  z: number,
): number {
  let d = Infinity;
  for (let i = 0; i < 4; i += 2) {
    pulmonaryVeinSegment(i, la, lr, bo, czL, rzL, PV_SEG);
    d = Math.min(
      d,
      sdCapsule(
        x,
        y,
        z,
        PV_SEG[0]!,
        PV_SEG[1]!,
        PV_SEG[2]!,
        PV_SEG[3]!,
        PV_SEG[4]!,
        PV_SEG[5]!,
        PV_RADIUS,
      ),
    );
  }
  return d;
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
export const CS_WALL_CM = 0.1;
/** From the atrium's posterior surface to the sinus's axis: the atrial wall, the sinus's wall and its radius (cm). */
export const CS_GROOVE_OFFSET_CM = LA_WALL_CM + CS_WALL_CM + CS_RADIUS_CM;
/** From the posterior mitral annulus to the sinus's axis (cm): the ring, the sinus's wall and its radius. */
export const CS_ANNULUS_OFFSET_CM = 0.15 + CS_WALL_CM + CS_RADIUS_CM;

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

/** Distance to the coronary sinus lumen (decision 321). */
export function coronarySinusDistance(c: ClassifyCtx, x: number, y: number, z: number): number {
  const { hp, A } = c;
  const zAnn = hp.zAnn;
  const la = A.laCenter,
    lr = A.laR;
  const zTop = la.z - lr.z,
    zBottom = zAnn + 0.25;
  const czL = (zTop + zBottom) / 2,
    rzL = (zBottom - zTop) / 2;
  const bo = atrialScale(hp.laBooster, A.laReservoir, hp.state.contraction);
  const rx = lr.x * bo,
    ry = lr.y * bo;
  const zs = zAnn - CS_ABOVE_ANNULUS_CM;
  const x0 = A.iasX + CS_CRUX_FROM_IAS_CM,
    x1 = Math.min(CS_LATERAL_X_CM, la.x + 0.85 * rx);
  // medial to its centre the atrium reaches as far back as at its centre (the septal corner, decision 318)
  const xc = Math.min(x1, Math.max(x0, x));
  // and behind the posterior mitral annulus, where the tapering atrium is narrower than the ring
  const mv = hp.valves.mitral;
  const yc = Math.min(
    laPosteriorY(Math.max(xc, la.x), zs, la, rx, ry, czL, rzL) - CS_GROOVE_OFFSET_CM,
    mv.cy - Math.sqrt(Math.max(0, mv.R * mv.R - (xc - mv.cx) ** 2)) - CS_ANNULUS_OFFSET_CM,
  );
  const body = Math.hypot(x - xc, y - yc, z - zs) - CS_RADIUS_CM;
  const ostium = sdRoundCone(
    x,
    y,
    z,
    x0,
    laPosteriorY(Math.max(x0, la.x), zs, la, rx, ry, czL, rzL) - CS_GROOVE_OFFSET_CM,
    zs,
    A.iasX - CS_OSTIUM_FROM_IAS_CM,
    CS_OSTIUM_Y_CM,
    zAnn - CS_OSTIUM_ABOVE_ANNULUS_CM,
    CS_RADIUS_CM,
    CS_OSTIUM_RADIUS_CM,
  );
  // clear of the left atrial cavity by both walls, so the sinus is never unroofed into it
  return Math.max(Math.min(body, ostium), LA_WALL_CM + CS_WALL_CM - c.laCav);
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
  const xIas = A.iasX;
  // interatrial septum: muscular septum ~0.55 cm with a thicker limbus around the thin fossa ovalis membrane
  const fo = Math.hypot((y - A.fossaY) / 0.6, (z - A.fossaZ) / 0.7);
  const tIas = iasThickness(fo);
  // LA: ellipsoid flattened against the septum (medial clip), against the oesophagus / descending aorta
  // (posterior clip) and under the pulmonary bifurcation (roof clip)
  const dFreeLa = leftAtrialFreeSdf(x, y, z, la.x, la.y, czL, lr.x * bo, lr.y * bo, rzL, zTop);
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
  const dCrossLa = leftAtrialFreeSdf(la.x, y, z, la.x, la.y, czL, lr.x * bo, lr.y * bo, rzL, zTop);
  const dCorner = Math.max(
    xIas + tIas / 2 - x,
    x - la.x,
    zAnn - LA_CORNER_HEIGHT_CM - z,
    z - zAnn,
    dCrossLa,
  );
  // and over the fossa ovalis, wherever its section reaches, the atrium meets the septum (decision 319): the fossa's floor
  // is the one true septum, a membrane between the two atrial cavities; around it the rims are folds of the atrial walls
  const dFossaLa = Math.max(xIas + tIas / 2 - x, x - la.x, dCrossLa, (fo - FOSSA_REACH) * 0.6);
  const d = Math.min(smax(dFreeLa, xIas + tIas / 2 - x, 0.3), dCorner, dFossaLa);
  c.laCav = d;
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
  if (
    dFreeLa < LA_WALL_CM &&
    x > xIas + tIas / 2 &&
    leftAtrialMouthLumen(m, c.colDist, x, y, z, la, lr, bo, czL, rzL) >= 0
  ) {
    setSample(
      out,
      Tissue.Myocardium,
      -Math.min(dFreeLa, LA_WALL_CM - dFreeLa),
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
  const dEllRa = sdEllipsoid(x, y, z, ra.x, ra.y, czR, rr.x * bo * raC, rr.y * bo * raC, rzR);
  let dFreeRa = smax(dEllRa, ra.y - 0.8 * rr.y * bo - y, 0.6);
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
      RA_ANTEROMEDIAL_R_CM * bo,
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
      RA_MEMBRANOUS_R_CM * bo,
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
  // behind, the right pulmonary veins with their wall (decision 320)
  dFreeRa = smax(
    dFreeRa,
    RA_RIGHT_VEIN_CLEARANCE_CM - rightVeinDistance(la, lr, bo, czL, rzL, x, y, z),
    0.2,
  );
  // in front of the left atrium the interatrial plane no longer clips the right atrium (decision 222)
  const q = Math.min(
    1,
    Math.max(0, (dFreeLa - RA_SEPTAL_RELEASE_LA_CM) / RA_SEPTAL_RELEASE_RAMP_CM),
  );
  const relL = q * q * (3 - 2 * q);
  const septumPlane = x - (xIas - tIas / 2) - RA_SEPTAL_RELEASE_CM * relL;
  const dR = smax(dFreeRa, septumPlane, 0.3);
  if (dR < 0) {
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
  const dSvc = svcDistance(A, x, y, z);
  const dIvc = ivcDistance(A, hp.ivcCollapse, x, y, z);
  if (dFreeRa < 0.22 && septumPlane < 0 && dSvc >= 0 && dIvc >= 0 && dCs >= 0) {
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
    if (z > czR && smin(dFreeRa, dOrifice, 1e-3 + RA_VESTIBULE_UNION_CM * septalSide) < 0) {
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
  // interatrial septum: slab between the clipped atria wherever either atrium reaches the septal plane (behind the aortic
  // root in PSAX-AV as well as in A4C and subcostal views), not in front of the left atrium (decision 222)
  if (Math.abs(x - xIas) <= tIas / 2 && z < zAnn + 0.4) {
    const nearLa = sdEllipsoid(xIas, y, z, la.x, la.y, czL, lr.x * bo, lr.y * bo, rzL) < 0.45;
    const nearRa =
      sdEllipsoid(xIas, y, z, ra.x, ra.y, czR, rr.x * bo * raC, rr.y * bo * raC, rzR) < 0.45;
    if (
      (nearLa || nearRa) &&
      relL < 0.5 &&
      leftAtrialMouthLumen(m, c.colDist, x, y, z, la, lr, bo, czL, rzL) >= 0
    ) {
      setSample(
        out,
        Tissue.Myocardium,
        -(tIas / 2 - Math.abs(x - xIas)),
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
  for (let i = 0; i < 4; i++) {
    pulmonaryVeinSegment(i, la, lr, bo, czL, rzL, PV_SEG);
    // the veins pass beside the descending aorta and the vertebral body, not through them (decision 273)
    const dPv = smax(
      sdCapsule(
        x,
        y,
        z,
        PV_SEG[0]!,
        PV_SEG[1]!,
        PV_SEG[2]!,
        PV_SEG[3]!,
        PV_SEG[4]!,
        PV_SEG[5]!,
        PV_RADIUS,
      ),
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
