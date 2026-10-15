import { Structure, Tissue } from '../tissue';
import { LV_WALL_BASAL_OVERHANG_CM, ROOT_EXCURSION } from '../heartFrame';
import { LA_CORNER_ANTERIOR_MARGIN_CM } from '../laGeometry';
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

  // aorto-mitral curtain / fibrous skeleton: in the annular region, and basal of the hinge at this azimuth only in front
  // of the atrium's septal corner, where it is the curtain itself (decision 327): the annulus is a saddle, and under the
  // septal hinge of the four-chamber view, apical of the mean plane and 3 mm in front of the straight edge, this filler
  // hung 2-4.5 mm into the left atrium as a bright tooth beside the septum; withdrawn from everywhere basal of the hinge
  // it left the atrium's orifice column against the outflow tract at the curtain
  const mv = c.hp.valves.mitral;
  if (
    inAnnularRegion &&
    z > zAnn - 1.2 &&
    (z >= c.zHinge - LV_WALL_BASAL_OVERHANG_CM ||
      (x - mv.cx) * mv.ux + (y - mv.cy) * mv.uy > mv.D + LA_CORNER_ANTERIOR_MARGIN_CM)
  ) {
    setSample(out, Tissue.Fibrous, -0.15, 0, 0, 1, x, y, z, 0, Structure.LvWallSeptal);
    return true;
  }
  return false;
}
