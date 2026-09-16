import { fastAtan2 } from '@/core/noise';
import { rootRadiusAt } from '../aorticValve';
import { ROOT_EXCURSION } from '../heartFrame';
import type { ClassifyCtx } from './context';

/** Aortic root coordinates (tube along avAxis; also carves the LV base). Writes the root fields of the context. */
export function rootCoordinates(c: ClassifyCtx): void {
  const { hp, A, x, y, z } = c;
  const zAnn = hp.zAnn;
  let rootT = -99,
    rootRr = 0,
    rootR = 0,
    rootQx = 0,
    rootQy = 0,
    rootQz = 0,
    rootPhi = 0;
  {
    const cc = A.avCenter;
    const ax = A.avAxis;
    const czz = cc.z + zAnn * ROOT_EXCURSION;
    const dx = x - cc.x,
      dy = y - cc.y,
      dz = z - czz;
    const t = dx * ax.x + dy * ax.y + dz * ax.z; // along axis, 0 at annulus, negative toward LV
    if (t > -1.6 && t < 6.5) {
      // the ascending aorta curves toward the patient's right/anterior beyond the sinotubular junction
      // (it leaves the long-axis plane after ~3 cm instead of running straight for 7 cm)
      const bend = t > 3 ? 0.16 * (t - 3) * (t - 3) : 0;
      rootQx = dx - ax.x * t - A.avBend.x * bend;
      rootQy = dy - ax.y * t - A.avBend.y * bend;
      rootQz = dz - ax.z * t - A.avBend.z * bend;
      rootRr = Math.sqrt(rootQx * rootQx + rootQy * rootQy + rootQz * rootQz);
      rootT = t;
      // sinuses of Valsalva bulge at the cusp centres (trefoil in short axis, ±6 %), narrowing at the commissures;
      // the bulge fades to nothing at the annulus and at the sinotubular junction
      rootPhi = fastAtan2(
        rootQx * A.avE2.x + rootQy * A.avE2.y + rootQz * A.avE2.z,
        rootQx * A.avE1.x + rootQy * A.avE1.y + rootQz * A.avE1.z,
      );
      rootR = rootRadiusAt(hp.valves.root, t, rootPhi);
    }
  }
  c.rootT = rootT;
  c.rootRr = rootRr;
  c.rootR = rootR;
  c.rootQx = rootQx;
  c.rootQy = rootQy;
  c.rootQz = rootQz;
  c.rootPhi = rootPhi;
  // the aortic lumen from the annulus upward is never LV wall or fibrous skeleton
  c.inRootLumen = rootT >= -0.05 && rootRr < rootR;
  // nor is the outflow tract below it: the basal septal shell reached 0.35 cm into the tract at end diastole and, once
  // the root descended with the base (ROOT_EXCURSION), 0.75 cm at end systole
  c.inOutflowLumen = rootT > -1.6 && rootRr < rootR;
}
