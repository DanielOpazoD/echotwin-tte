import type { HeartModel, HeartPose } from './heartModel';
import { DESC_AORTA_R, descAortaScale } from './thoraxModel';
import { buildAorticArch, type AorticArchGeometry } from './aorticArch';
import {
  compileVascularTube,
  VASCULAR_JOIN_EPS_CM,
  vascularTubeDistance,
  type TubeDistance,
  type VascularTube,
} from './vascularTube';
import { Structure, Tissue, type TissueSample } from './tissue';
import { anchorsCached } from './anchors';
import type { Vec3 } from '@/core/vec3';

export const AORTIC_EXTENSION_WALL_CM = 0.2;
/** 16 ascending and 32 arch segments and three proximal supra-aortic branches. */
export const AORTIC_EXTENSION_SEGMENTS = 51;
export interface AorticExtension {
  geometry: AorticArchGeometry;
  tube: VascularTube;
  structures: Uint8Array;
  joinAxis: Vec3;
}
/** Built once as part of the immutable acquisition pose: one anatomy for image, sampling and navigator. */
export function buildAorticExtension(
  heart: HeartModel,
  hp: Pick<HeartPose, 'zAnn' | 'swingX' | 'valves' | 'state'>,
): AorticExtension {
  const geometry = buildAorticArch(
    heart,
    hp,
    DESC_AORTA_R * descAortaScale(heart, hp.state.aorticPressure),
    anchorsCached(heart),
  );
  const paths = [geometry.arch, ...geometry.branches];
  const ids = [
    Structure.AorticArch,
    Structure.BrachiocephalicArtery,
    Structure.LeftCommonCarotid,
    Structure.LeftSubclavian,
  ];
  const structures = new Uint8Array(
    paths.flatMap((path, i) => Array<number>(path.length - 1).fill(ids[i]!)),
  );
  // The extra envelope allows the surrounding thorax to leave mediastinal tissue around the vessel.
  structures.fill(Structure.AscendingAorta, 0, 16);
  const tube = compileVascularTube(paths, AORTIC_EXTENSION_WALL_CM + 0.5);
  const result = { geometry, tube, structures, joinAxis: anchorsCached(heart).avAxis };
  return result;
}

const distance: TubeDistance = { distance: Infinity, nx: 0, ny: 0, nz: 1, segment: -1 };
/** On a miss, sdf is reduced to the distance from the outer vessel wall, for the pleural envelope. */
export function classifyAorticExtension(
  a: AorticExtension,
  x: number,
  y: number,
  z: number,
  out: TissueSample,
): boolean {
  const start = a.geometry.arch[0]!.p,
    axis = a.joinAxis;
  if (
    (x - start.x) * axis.x + (y - start.y) * axis.y + (z - start.z) * axis.z <
    -VASCULAR_JOIN_EPS_CM
  )
    return false;
  if (!vascularTubeDistance(a.tube, x, y, z, distance)) return false;
  const d = distance.distance;
  if (d >= AORTIC_EXTENSION_WALL_CM) {
    out.sdf = Math.min(out.sdf, d - AORTIC_EXTENSION_WALL_CM);
    return false;
  }
  out.tissue = d < 0 ? Tissue.Blood : Tissue.VesselWall;
  out.structure = a.structures[distance.segment]!;
  out.sdf = d < 0 ? d : -Math.min(d, AORTIC_EXTENSION_WALL_CM - d);
  out.nx = distance.nx;
  out.ny = distance.ny;
  out.nz = distance.nz;
  out.mx = x;
  out.my = y;
  out.mz = z;
  out.extraReflect = 0;
  out.segment = 0;
  out.transmural = -1;
  return true;
}
