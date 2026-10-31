import { Structure, Tissue } from '../tissue';
import { sdCapsule, sdEllipsoid, smax, smin } from '../sdf';
import { setSample, type ClassifyCtx } from './context';
import { AORTIC_ROOT_WALL_CM } from '../aorticValve';
import { DESC_AORTA_MAX_OUTER_R, SPINE_R } from '../thoraxModel';
import { pulmonaryTrunkEpiDistance, trunkFrontDistance } from '../greatVessels';

/** Left atrial wall (cm) and the appendage's. */
/**
 * The mediastinal fat in front of the pulmonary trunk that the lung does not cross (cm; decision 336), straight in front
 * of the trunk and less as the point turns to its sides.
 */
export const PA_ANTERIOR_FAT_CM = 1.0;
export const LA_WALL_CM = 0.25;
export const LAA_WALL_CM = 0.18;
/** Thickness (cm) of the pericardium the sac draws outside the epicardium. */
export const PERICARDIUM_CM = 0.12;
/**
 * How far (cm) above the mitral hinge the left ventricle's epicardium reaches for the sac (decision 380), and from how far
 * (cm) beyond the aortic root's wall it ends there: around the root its cap stays, the fill between the root, the atria
 * and the ventricular base.
 */
export const LV_SAC_ABOVE_HINGE_CM = 0.3;
export const LV_SAC_ROOT_KEEP_CM = 1.2;

/**
 * Distance (cm) from a heart-frame point to the surface of the posterior column (decision 273): the descending aorta at
 * its largest systolic size and the vertebral body, two vertical cylinders whose axes run along `u` through `a` and `s`.
 * The heart lay across them: the left atrium of the dilated cases ran into the vertebral body, and the sac into the wall
 * of the aorta.
 */
export function posteriorColumnDistance(
  x: number,
  y: number,
  z: number,
  ux: number,
  uy: number,
  uz: number,
  ax: number,
  ay: number,
  az: number,
  sx: number,
  sy: number,
  sz: number,
): number {
  const dax = x - ax,
    day = y - ay,
    daz = z - az;
  const ta = dax * ux + day * uy + daz * uz;
  const dA =
    Math.sqrt(Math.max(0, dax * dax + day * day + daz * daz - ta * ta)) - DESC_AORTA_MAX_OUTER_R;
  const dsx = x - sx,
    dsy = y - sy,
    dsz = z - sz;
  const ts = dsx * ux + dsy * uy + dsz * uz;
  const dS = Math.sqrt(Math.max(0, dsx * dsx + dsy * dsy + dsz * dsz - ts * ts)) - SPINE_R;
  return Math.min(dA, dS);
}

/** Effusion (cm) the sac holds over the left atrium (decision 255). */
export const OBLIQUE_SINUS_EFFUSION_CM = 0.3;
/** The oblique sinus behind the left atrium, in its own semi-axes (decision 383): the fluid thins from its centre plane
 * to OBLIQUE_SINUS_BEHIND behind it, within the atrium's footprint (its normalised lateral and vertical radius squared
 * from OBLIQUE_SINUS_FOOTPRINT_FROM to OBLIQUE_SINUS_FOOTPRINT_TO). */
export const OBLIQUE_SINUS_BEHIND = 0.6;
export const OBLIQUE_SINUS_FOOTPRINT_FROM = 0.6;
export const OBLIQUE_SINUS_FOOTPRINT_TO = 1.4;
/** Blend (cm) of the parietal layer against the descending aorta and the vertebral body (decision 383). */
export const PARIETAL_COLUMN_BLEND_CM = 1;

/**
 * Signed distance (cm) to the inner face of the parietal pericardium over an effusion `eff` (decision 383), from the
 * smooth envelope of the heart (`dHeart`), the point's place behind the left atrium (`behind`, in the atrium's posterior
 * semi-axis from its centre; `footprint`, its normalised lateral and vertical radius squared) and the distance to the
 * descending aorta and the vertebral body (`colDist`). Around the heart the fluid has its full thickness; behind the
 * left atrium the parietal pericardium reflects onto the atrial wall around the pulmonary veins and the oblique sinus
 * between them holds little fluid (decision 255); and it lies in front of the column (decision 273). The parietal layer
 * was the visceral surface pushed out by the effusion: 2.3 cm from the walls that surface showed the planes the atria
 * are built from, in straight faces meeting at corners, and its thinning over the left atrium, 2.2 to 0.3 cm within 1 cm
 * of the difference between two distances, drew steps. A smooth envelope pushed out by a thickness that changes
 * smoothly in space has neither.
 */
export function parietalSdf(
  eff: number,
  dHeart: number,
  behind: number,
  footprint: number,
  colDist: number,
): number {
  const thin = Math.min(eff, OBLIQUE_SINUS_EFFUSION_CM);
  const tb = Math.min(1, Math.max(0, behind / OBLIQUE_SINUS_BEHIND));
  const tf = Math.min(
    1,
    Math.max(
      0,
      (footprint - OBLIQUE_SINUS_FOOTPRINT_FROM) /
        (OBLIQUE_SINUS_FOOTPRINT_TO - OBLIQUE_SINUS_FOOTPRINT_FROM),
    ),
  );
  const w = tb * tb * (3 - 2 * tb) * (1 - tf * tf * (3 - 2 * tf));
  return smax(
    dHeart - PERICARDIUM_CM - (eff - (eff - thin) * w),
    2 * PERICARDIUM_CM - colDist,
    PARIETAL_COLUMN_BLEND_CM,
  );
}

/** Pericardium & effusion: the outer envelope of all epicardial surfaces. True when the point is in the sac. */
export function classifyPericardium(c: ClassifyCtx): boolean {
  const { m, hp, A, x, y, z, out, dEllR, wallT, nx0, ny0, nz0, rvSdf, raSleeve, raBody } = c;
  // the epicardium is the outer face of the wall shell; the sac keeps the septum's full thickness where its crest narrows
  // (decision 223), so no hole opens between the root, the crest and the atrium
  const dLvEpi = dEllR - wallT - c.crestLoss;
  // the ventricle's epicardium ends at its base (decision 380): the profile it is the outer face of closes 2-2.5 cm above
  // the mitral hinge, and where no atrium covered that cap the sac held it as fat, 1-1.4 cm thick in the left
  // atrioventricular groove beside the atrium, 3-8 cm³ in the hypertrophic case; around the root the cap stays
  const rootGap = c.rootT > -90 ? c.rootRr - c.rootR : 1e3;
  const dLvSac = smax(
    dLvEpi,
    Math.min(c.zHinge - LV_SAC_ABOVE_HINGE_CM - z, rootGap - LV_SAC_ROOT_KEEP_CM),
    0.2,
  );
  const fw = m.anatomy.rv.freeWallThicknessCm;
  const dRvEpi = rvSdf[0]! - fw; // crescent and tricuspid inflow, computed just before (this point is outside the RV)
  // the atrium's own outer face (decision 273): a fixed ellipsoid 0.25 cm over its largest size, it left up to 1.7 cm of
  // fat behind the posterior wall, where the cavity is flattened and, at end-diastole, smaller
  const dLaEpi = c.laEpi;
  // the right atrium's outer face is its own wall's (decision 378), as the left's is: the anchor ellipsoid 0.22 cm over its
  // largest size laid 8-10 cm³ of fat over its free walls, a layer 4 mm thick at the median and up to 1.6 cm, that the
  // subcostal view showed as a band around the atrium
  const dRaEpi = Math.min(
    raSleeve + 0.22, // the lengthened atrium over the vacated base (decision 133)
    raBody - 0.22, // the outer face of its body's wall, with the lateral wall over the tricuspid hinge (decision 367)
    c.raaEpi, // and its appendage (decision 323)
    c.raColumn - 0.22, // and the vestibule's column over the ring (decision 379)
  );
  // The sac around the outflow tract and the trunk stays where the pericardium is anchored (sternopericardial ligaments in
  // front, the arterial reflection on the trunk) while they descend in systole (decision 111). One envelope stands for the
  // epicardial fat, the pericardium and the effusion here; moved with the tract, the effusion of the tamponade case, which
  // reaches the transducer face in the parasternal views (chestWall.test.ts), changed its near field with every beat.
  const dRvotEpi = sdCapsule(
    x,
    y,
    z,
    A.rvotA.x,
    A.rvotA.y,
    A.rvotA.z,
    A.rvotB.x,
    A.rvotB.y,
    A.rvotB.z,
    A.rvotRa + fw,
  );
  const dPaEpi = pulmonaryTrunkEpiDistance(A, x, y, z);
  // the cardiac silhouette is the smooth union of the epicardial surfaces: the grooves between chambers and
  // the space between outflow and root are filled with epicardial fat, and one pericardium wraps the whole heart
  // the sac lies against the descending aorta and the vertebral body and does not run into them (decision 273)
  const dEpi = smax(
    smin(
      smin(smin(dLvSac, dRvEpi, 0.8), smin(dLaEpi, dRaEpi, 0.8), 0.8),
      smin(dRvotEpi, dPaEpi, 0.8),
      0.8,
    ),
    PERICARDIUM_CM - c.colDist,
    0.2,
  );
  // the parietal layer over an effusion is a smooth envelope (decision 383): the ventricles, the atria at their largest
  // sizes, the outflow tract and the trunk, smoothly united, and thin behind the left atrium
  const la = A.laCenter,
    lr = A.laR;
  const ra = A.raCenter,
    rar = A.raR;
  const par =
    hp.effusion > 0
      ? parietalSdf(
          hp.effusion,
          smin(
            smin(
              smin(dLvEpi, dRvEpi, 0.8),
              smin(
                sdEllipsoid(x, y, z, la.x, la.y, la.z, lr.x + 0.25, lr.y + 0.25, lr.z + 0.25),
                sdEllipsoid(x, y, z, ra.x, ra.y, ra.z, rar.x + 0.22, rar.y + 0.22, rar.z + 0.22),
                0.8,
              ),
              0.8,
            ),
            smin(dRvotEpi, dPaEpi, 0.8),
            0.8,
          ),
          (la.y - y) / lr.y,
          ((x - la.x) / lr.x) ** 2 + ((z - la.z) / lr.z) ** 2,
          c.colDist,
        )
      : 1e3;
  if (dEpi < 0) {
    setSample(out, Tissue.Fat, dEpi, nx0, ny0, nz0, x, y, z, 0, Structure.EpicardialFat);
    return true;
  }
  if (dEpi < PERICARDIUM_CM) {
    setSample(
      out,
      Tissue.Pericardium,
      -Math.min(Math.max(dEpi, 0), 0.12 - Math.max(dEpi, 0)),
      nx0,
      ny0,
      nz0,
      x,
      y,
      z,
      0,
      Structure.Pericardium,
    );
    return true;
  }
  if (par < 0) {
    setSample(
      out,
      Tissue.Fluid,
      Math.max(par, PERICARDIUM_CM - dEpi),
      nx0,
      ny0,
      nz0,
      x,
      y,
      z,
      0,
      Structure.PericardialEffusion,
    );
    return true;
  }
  if (par < PERICARDIUM_CM) {
    setSample(out, Tissue.Pericardium, 0, nx0, ny0, nz0, x, y, z, 0, Structure.Pericardium);
    return true;
  }
  // outside the sac: how far beyond the parietal pericardium, or beyond the wall of the ascending aorta, which leaves
  // the sac — what the thorax classifier needs to wrap the lungs around the heart (decision 144)
  const dSac = Math.min(dEpi, par) - PERICARDIUM_CM;
  const dRoot = c.rootT > -90 ? c.rootRr - c.rootR - AORTIC_ROOT_WALL_CM : dSac;
  // in front of the pulmonary trunk the mediastinum's fat stands between the trunk and the lung, as far as the point lies
  // in front of the trunk's middle, the torso's anterior direction read in the heart frame (decision 336)
  const dTrunkFront = trunkFrontDistance(m, A, x, y, z, dPaEpi);
  out.sdf = Math.min(dSac, dRoot, dTrunkFront);
  return false;
}
