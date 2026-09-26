import { Structure, Tissue } from '../tissue';
import { ROOT_EXCURSION } from '../heartFrame';
import { AORTIC_ROOT_WALL_CM } from '../aorticValve';
import { setSample, type ClassifyCtx } from './context';

/** Aortic root / LVOT (tube along avAxis) and the aorto-mitral curtain. True when the point is one of them. */
export function classifyAorticRoot(c: ClassifyCtx): boolean {
  const { hp, x, y, z, out, rootT, rootRr, rootR, rootQx, rootQy, rootQz, inAnnularRegion } = c;
  const zAnn = hp.zAnn;
  if (rootT > -1.6) {
    const t = rootT,
      rr = rootRr,
      R = rootR;
    const wall = AORTIC_ROOT_WALL_CM;
    if (rr < R) {
      setSample(
        out,
        Tissue.Blood,
        rr - R,
        rootQx / rr,
        rootQy / rr,
        rootQz / rr,
        x,
        y,
        z - zAnn * ROOT_EXCURSION,
        0,
        t < 0 ? Structure.Lvot : Structure.AorticRoot,
      );
      return true;
    }
    if (rr < R + wall) {
      const dIn = -Math.min(rr - R, R + wall - rr);
      setSample(
        out,
        Tissue.VesselWall,
        dIn,
        rootQx / rr,
        rootQy / rr,
        rootQz / rr,
        x,
        y,
        z,
        0,
        Structure.AorticRoot,
      );
      return true;
    }
  }

  if (inAnnularRegion && z > zAnn - 1.2) {
    // aorto-mitral curtain / fibrous skeleton
    setSample(out, Tissue.Fibrous, -0.15, 0, 0, 1, x, y, z, 0, Structure.LvWallSeptal);
    return true;
  }
  return false;
}
