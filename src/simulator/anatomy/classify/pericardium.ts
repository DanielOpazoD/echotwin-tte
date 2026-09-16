import { Structure, Tissue } from '../tissue';
import { sdCapsule, sdEllipsoid, sdRoundCone, smin } from '../sdf';
import { setSample, type ClassifyCtx } from './context';

/** Pericardium & effusion: the outer envelope of all epicardial surfaces. True when the point is in the sac. */
export function classifyPericardium(c: ClassifyCtx): boolean {
  const { m, hp, A, x, y, z, out, dEllR, wallT, nx0, ny0, nz0, rvSdf, raSleeve } = c;
  const dLvEpi = dEllR - wallT; // the epicardium is the outer face of the wall shell
  const fw = m.anatomy.rv.freeWallThicknessCm;
  const dRvEpi = rvSdf[0]! - fw; // crescent and tricuspid inflow, computed just before (this point is outside the RV)
  const la = A.laCenter,
    lr = A.laR;
  const dLaEpi = sdEllipsoid(x, y, z, la.x, la.y, la.z, lr.x + 0.25, lr.y + 0.25, lr.z + 0.25);
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
  const dEpi = smin(
    smin(smin(dLvEpi, dRvEpi, 0.8), smin(dLaEpi, dRaEpi, 0.8), 0.8),
    smin(dRvotEpi, dPaEpi, 0.8),
    0.8,
  );
  const eff = hp.effusion;
  if (dEpi < 0) {
    setSample(out, Tissue.Fat, dEpi, nx0, ny0, nz0, x, y, z, 0, Structure.EpicardialFat);
    return true;
  }
  if (dEpi < 0.12) {
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
  return false;
}
