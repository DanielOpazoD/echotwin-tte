import { Structure } from '@/simulator/anatomy/tissue';
import { STRUCTURE_NAME } from './structureNames';

/** The key of an unordered pair of structures, by their English names (decision 331). */
export const bloodPairKey = (a: number, b: number): string => {
  const na = STRUCTURE_NAME[a] ?? `#${a}`,
    nb = STRUCTURE_NAME[b] ?? `#${b}`;
  return na < nb ? `${na}|${nb}` : `${nb}|${na}`;
};

/**
 * Blood touches blood only where the heart is open: through the valves, between a chamber and its own outflow or its
 * vessels, and along the aorta and its branches (decision 331; shared with the volume census of decision 365).
 */
export const ALLOWED_BLOOD = new Set<string>(
  (
    [
      [Structure.LvCavity, Structure.Lvot],
      [Structure.LvCavity, Structure.LaCavity], // the mitral orifice
      [Structure.LvCavity, Structure.AorticRoot], // the outflow where the tube begins at the valve
      [Structure.Lvot, Structure.AorticRoot],
      [Structure.AorticRoot, Structure.AscendingAorta],
      [Structure.AscendingAorta, Structure.AorticArch],
      [Structure.AorticArch, Structure.BrachiocephalicArtery],
      [Structure.AorticArch, Structure.LeftCommonCarotid],
      [Structure.AorticArch, Structure.LeftSubclavian],
      [Structure.RvCavity, Structure.Rvot],
      [Structure.RvCavity, Structure.RaCavity], // the tricuspid orifice
      [Structure.RvCavity, Structure.PulmonaryArtery], // the outflow where the trunk begins at the valve
      [Structure.Rvot, Structure.PulmonaryArtery],
      [Structure.RaCavity, Structure.Svc],
      [Structure.RaCavity, Structure.Ivc],
      [Structure.RaCavity, Structure.CoronarySinus],
      [Structure.RaCavity, Structure.RaAppendage],
      [Structure.Ivc, Structure.HepaticVein],
      [Structure.LaCavity, Structure.PulmonaryVein],
      [Structure.LaCavity, Structure.LaAppendage],
    ] as const
  ).map(([a, b]) => bloodPairKey(a, b)),
);
