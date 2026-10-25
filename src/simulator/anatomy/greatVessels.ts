import { anchorsCached, type Anchors } from './anchors';
import { classifyAorticExtension } from './aorticExtension';
import { setSample } from './classify/context';
import type { HeartModel, HeartPose } from './heartModel';
import { sdCapsule, sdRoundCone } from './sdf';
import { Structure, Tissue, type TissueSample } from './tissue';

/** Wall (cm) of the pulmonary trunk and its branches, outside their lumen. */
export const PA_WALL_CM = 0.18;

/**
 * Signed distance (cm) to the lumen of the pulmonary trunk and its branches: from the valve plane to the sinotubular
 * junction, on to the bifurcation, and the right and left branches. The valve and the junction move with the base
 * (`pvZ`, decision 111); the bifurcation stays.
 */
export function pulmonaryTrunkDistance(
  A: Anchors,
  pvZ: number,
  x: number,
  y: number,
  z: number,
): number {
  const zo = z - pvZ;
  const dPa = Math.min(
    sdRoundCone(
      x,
      y,
      zo,
      A.rvotB.x,
      A.rvotB.y,
      A.rvotB.z,
      A.paStj.x,
      A.paStj.y,
      A.paStj.z,
      A.paRootR,
      A.paR,
    ),
    sdCapsule(
      x,
      y,
      z,
      A.paStj.x,
      A.paStj.y,
      A.paStj.z + pvZ,
      A.paEnd.x,
      A.paEnd.y,
      A.paEnd.z,
      A.paR,
    ),
  );
  const dRpa = sdCapsule(
    x,
    y,
    z,
    A.paEnd.x,
    A.paEnd.y,
    A.paEnd.z,
    A.rpaEnd.x,
    A.rpaEnd.y,
    A.rpaEnd.z,
    A.rpaR,
  );
  const dLpa = sdCapsule(
    x,
    y,
    z,
    A.paEnd.x,
    A.paEnd.y,
    A.paEnd.z,
    A.lpaEnd.x,
    A.lpaEnd.y,
    A.lpaEnd.z,
    A.lpaR,
  );
  return Math.min(dPa, dRpa, dLpa);
}

/**
 * The analytic heart's great vessels alone, for a heart that ends where its own vessels were cut (decision 372): the
 * ascending aorta past the sinotubular junction, the arch and its three branches (`aorticExtension.ts`), and the
 * pulmonary trunk with its branches and wall. True on a hit. On a miss `out.sdf` is lowered to the distance from their
 * outer wall, which the thorax keeps mediastinum around, as `classifyHeart` does for the aorta.
 */
export function classifyGreatVessels(
  m: HeartModel,
  hp: HeartPose,
  x: number,
  y: number,
  z: number,
  out: TissueSample,
): boolean {
  if (classifyAorticExtension(hp.aorta, x, y, z, out)) return true;
  const A = anchorsCached(m);
  const d = pulmonaryTrunkDistance(A, hp.pvZ, x, y, z);
  if (d < PA_WALL_CM) {
    out.segment = 0;
    out.transmural = -1;
    setSample(
      out,
      d < 0 ? Tissue.Blood : Tissue.VesselWall,
      d < 0 ? d : -Math.min(d, PA_WALL_CM - d),
      x - A.rvotB.x,
      y - A.rvotB.y,
      z - hp.pvZ - A.rvotB.z,
      x,
      y,
      z,
      0,
      Structure.PulmonaryArtery,
    );
    return true;
  }
  out.sdf = Math.min(out.sdf, d - PA_WALL_CM);
  return false;
}
