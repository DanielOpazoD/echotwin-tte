import type { Structure, Tissue, TissueSample } from '../tissue';
import type { AnchorsCached } from '../anchors';
import type { HeartModel } from '../heartModel';
import type { HeartPose } from '../heartPose';

/**
 * State one classification of a heart-frame point threads through its blocks (engineering audit, C2: the
 * classifier was one 1 100-line function whose blocks shared these as locals). The blocks run in a fixed
 * order of priority — valves, left ventricle, aortic root, atria, right ventricle, pericardium — and each may
 * read what the earlier ones computed. One instance is reused per thread: the classifier is single-threaded
 * and is called hundreds of thousands of times per frame.
 */
export interface ClassifyCtx {
  m: HeartModel;
  hp: HeartPose;
  A: AnchorsCached;
  /** Point in heart frame, after the tamponade swing. */
  x: number;
  y: number;
  z: number;
  out: TissueSample;

  // ---- aortic root coordinates (root.ts) ----
  /** Along the root axis, 0 at the annulus, negative toward the LV; -99 when far from the root. */
  rootT: number;
  /** Radial distance from the (bent) root axis. */
  rootRr: number;
  /** Root radius at (rootT, rootPhi). */
  rootR: number;
  rootQx: number;
  rootQy: number;
  rootQz: number;
  rootPhi: number;
  /** Inside the aortic lumen from the annulus upward: never LV wall or fibrous skeleton. */
  inRootLumen: boolean;
  /** Inside the outflow tract below it either. */
  inOutflowLumen: boolean;

  // ---- left ventricle (leftVentricle.ts) ----
  az: number;
  levelFrac: number;
  /** Normal of the cavity surface at the point (from lvCavitySdf). */
  nx0: number;
  ny0: number;
  nz0: number;
  /** Signed distance to the unclipped cavity profile united with the inflow, minus regional motion. */
  dEllR: number;
  /** Local wall thickness now. */
  wallT: number;
  /** Inside the profile but basal to the annulus and outside the root lumen. */
  inAnnularRegion: boolean;
}

/** The one context instance (single-threaded classifier). */
export const ctx: ClassifyCtx = {
  m: null as unknown as HeartModel,
  hp: null as unknown as HeartPose,
  A: null as unknown as AnchorsCached,
  x: 0,
  y: 0,
  z: 0,
  out: null as unknown as TissueSample,
  rootT: -99,
  rootRr: 0,
  rootR: 0,
  rootQx: 0,
  rootQy: 0,
  rootQz: 0,
  rootPhi: 0,
  inRootLumen: false,
  inOutflowLumen: false,
  az: 0,
  levelFrac: 0,
  nx0: 0,
  ny0: 0,
  nz0: 1,
  dEllR: 0,
  wallT: 0,
  inAnnularRegion: false,
};

export function setSample(
  out: TissueSample,
  tissue: Tissue,
  sdf: number,
  nx: number,
  ny: number,
  nz: number,
  mx: number,
  my: number,
  mz: number,
  extra: number,
  structure: Structure,
): void {
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  out.tissue = tissue;
  out.sdf = sdf;
  out.nx = nx / l;
  out.ny = ny / l;
  out.nz = nz / l;
  out.mx = mx;
  out.my = my;
  out.mz = mz;
  out.extraReflect = extra;
  out.structure = structure;
}
