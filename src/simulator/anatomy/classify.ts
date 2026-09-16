import type { TissueSample } from './tissue';
import { anchorsCached } from './anchors';
import type { HeartModel } from './heartModel';
import type { HeartPose } from './heartPose';
import { ctx } from './classify/context';
import { rootCoordinates } from './classify/root';
import { classifyValves } from './classify/valves';
import { classifyLeftVentricle } from './classify/leftVentricle';
import { classifyAorticRoot } from './classify/aorticRoot';
import { classifyAtria } from './classify/atria';
import { classifyRightVentricle } from './classify/rightVentricle';
import { classifyPericardium } from './classify/pericardium';

/**
 * Classify a heart-frame point. Writes into `out` and returns true when the point belongs to a
 * cardiac structure (including pericardium/effusion); false when outside the heart.
 *
 * The blocks run in priority order and share a context (`classify/context.ts`): thin structures first
 * (valves, annuli, chordae), then the left ventricle, the aortic root and curtain, the atria and veins, the
 * right ventricle with its outflow, and last the pericardial sac around everything. `gpu/glslHeart.ts`
 * mirrors the same order; `e2e/gpu-equivalence.spec.ts` compares the two.
 */
export function classifyHeart(
  m: HeartModel,
  hp: HeartPose,
  x0: number,
  y: number,
  z: number,
  out: TissueSample,
): boolean {
  // swinging heart (tamponade): rigid translation of the whole heart inside the pericardial sac
  const x = x0 - hp.swingX;
  const bc = m.boundCenter;
  const bdx = x - bc.x,
    bdy = y - bc.y,
    bdz = z - bc.z;
  if (bdx * bdx + bdy * bdy + bdz * bdz > m.boundRadius * m.boundRadius) return false;

  const c = ctx;
  c.m = m;
  c.hp = hp;
  c.A = anchorsCached(m);
  c.x = x;
  c.y = y;
  c.z = z;
  c.out = out;
  rootCoordinates(c);
  if (classifyValves(c)) return true;
  if (classifyLeftVentricle(c)) return true;
  if (classifyAorticRoot(c)) return true;
  if (classifyAtria(c)) return true;
  if (classifyRightVentricle(c)) return true;
  return classifyPericardium(c);
}
