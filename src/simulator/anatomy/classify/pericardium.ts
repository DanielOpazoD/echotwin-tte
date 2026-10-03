import { Structure, Tissue } from '../tissue';
import { sdCapsule, sdEllipsoid, sdRoundCone, smax, smin } from '../sdf';
import { setSample, type ClassifyCtx } from './context';
import { AORTIC_ROOT_WALL_CM } from '../aorticValve';
import { DESC_AORTA_MAX_OUTER_R, SPINE_R } from '../thoraxModel';

/** Left atrial wall (cm) and the appendage's. */
export const LA_WALL_CM = 0.25;
export const LAA_WALL_CM = 0.18;
/** Thickness (cm) of the pericardium the sac draws outside the epicardium. */
export const PERICARDIUM_CM = 0.12;

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
/** Distance (cm) over which the effusion thins from the ventricles to the left atrium (decision 255). */
export const OBLIQUE_SINUS_TAPER_CM = 1;

/**
 * Effusion (cm) at a point whose nearest epicardial surfaces are the left atrium at `dLa` and the rest of the heart at
 * `dRest` (decision 255). Behind the left atrium the parietal pericardium reflects onto the atrial wall around the
 * four pulmonary veins and the oblique sinus between them holds little fluid, so an effusion stays anterior to the
 * descending aorta and does not run behind the atrium; around the ventricles and the right atrium it has its full
 * thickness. The effusion of the tamponade case was a uniform 2.2 cm shell, the same behind the atrium.
 */
export function effusionAt(eff: number, dLa: number, dRest: number): number {
  const w = Math.min(1, Math.max(0, (dRest - dLa) / OBLIQUE_SINUS_TAPER_CM));
  const thin = Math.min(eff, OBLIQUE_SINUS_EFFUSION_CM);
  return eff - (eff - thin) * w * w * (3 - 2 * w);
}

/** Pericardium & effusion: the outer envelope of all epicardial surfaces. True when the point is in the sac. */
export function classifyPericardium(c: ClassifyCtx): boolean {
  const { m, hp, A, x, y, z, out, dEllR, wallT, nx0, ny0, nz0, rvSdf, raSleeve } = c;
  // the epicardium is the outer face of the wall shell; the sac keeps the septum's full thickness where its crest narrows
  // (decision 223), so no hole opens between the root, the crest and the atrium
  const dLvEpi = dEllR - wallT - c.crestLoss;
  const fw = m.anatomy.rv.freeWallThicknessCm;
  const dRvEpi = rvSdf[0]! - fw; // crescent and tricuspid inflow, computed just before (this point is outside the RV)
  // the atrium's own outer face (decision 273): a fixed ellipsoid 0.25 cm over its largest size, it left up to 1.7 cm of
  // fat behind the posterior wall, where the cavity is flattened and, at end-diastole, smaller
  const dLaEpi = c.laEpi;
  const ra = A.raCenter,
    rar = A.raR;
  const dRaEpi = Math.min(
    sdEllipsoid(x, y, z, ra.x, ra.y, ra.z, rar.x + 0.22, rar.y + 0.22, rar.z + 0.22),
    raSleeve + 0.22, // the lengthened atrium over the vacated base (decision 133)
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
  const dPaEpi = Math.min(
    sdRoundCone(
      x,
      y,
      z,
      A.rvotB.x,
      A.rvotB.y,
      A.rvotB.z,
      A.paStj.x,
      A.paStj.y,
      A.paStj.z,
      A.paRootR + 0.2,
      A.paR + 0.2,
    ),
    sdCapsule(
      x,
      y,
      z,
      A.paStj.x,
      A.paStj.y,
      A.paStj.z,
      A.paEnd.x,
      A.paEnd.y,
      A.paEnd.z,
      A.paR + 0.2,
    ),
  );
  // the cardiac silhouette is the smooth union of the epicardial surfaces: the grooves between chambers and
  // the space between outflow and root are filled with epicardial fat, and one pericardium wraps the whole heart
  // the sac lies against the descending aorta and the vertebral body and does not run into them (decision 273)
  const dEpi = smax(
    smin(
      smin(smin(dLvEpi, dRvEpi, 0.8), smin(dLaEpi, dRaEpi, 0.8), 0.8),
      smin(dRvotEpi, dPaEpi, 0.8),
      0.8,
    ),
    PERICARDIUM_CM - c.colDist,
    0.2,
  );
  // the effusion thins over the left atrium (decision 255), within the reach of its largest size: the oblique sinus
  const la = A.laCenter,
    lr = A.laR;
  // and it lies in front of the descending aorta and the vertebral body, not across them (decision 273)
  const eff =
    hp.effusion > 0
      ? Math.min(
          effusionAt(
            hp.effusion,
            sdEllipsoid(x, y, z, la.x, la.y, la.z, lr.x + 0.25, lr.y + 0.25, lr.z + 0.25),
            Math.min(dLvEpi, dRvEpi, dRaEpi, dRvotEpi, dPaEpi),
          ),
          Math.max(0, dEpi + c.colDist - 2 * PERICARDIUM_CM),
        )
      : 0;
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
  if (eff > 0 && dEpi < 0.12 + eff) {
    setSample(
      out,
      Tissue.Fluid,
      dEpi - 0.12 - eff,
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
  if (eff > 0 && dEpi < 0.12 + eff + 0.12) {
    setSample(out, Tissue.Pericardium, 0, nx0, ny0, nz0, x, y, z, 0, Structure.Pericardium);
    return true;
  }
  // outside the sac: how far beyond the parietal pericardium, or beyond the wall of the ascending aorta, which leaves
  // the sac — what the thorax classifier needs to wrap the lungs around the heart (decision 144)
  const dSac = dEpi - 0.12 - (eff > 0 ? eff + 0.12 : 0);
  const dRoot = c.rootT > -90 ? c.rootRr - c.rootR - AORTIC_ROOT_WALL_CM : dSac;
  out.sdf = Math.min(dSac, dRoot);
  return false;
}
