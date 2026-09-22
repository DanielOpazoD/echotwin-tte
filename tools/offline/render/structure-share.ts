/**
 * Share of one structure in each canonical view, per case and phase, and its maximum over cases and phases:
 * what `viewContent.test.ts` measures, laid out for a sweep before and after moving a structure (decision 143:
 * the pulmonary veins were 1.9 % of the PLAX plane and 0 % of the A4C, the opposite of an examination).
 *   npx tsx tools/offline/render/structure-share.ts <StructureName> [caseId,...] [view,...]
 * e.g. npx tsx tools/offline/render/structure-share.ts PulmonaryVein normal-excellent-window plax,a4c
 */
import { listCases, loadCaseById } from '@/cases';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { VIEW_TARGETS } from '@/simulator/windows/viewTargets';
import { viewStructureFractions } from '@/simulator/windows/viewContent';

const STRUCTURES: Record<string, Structure> = {
  LvCavity: Structure.LvCavity,
  RvCavity: Structure.RvCavity,
  LaCavity: Structure.LaCavity,
  RaCavity: Structure.RaCavity,
  AorticRoot: Structure.AorticRoot,
  AorticValve: Structure.AorticValve,
  PulmonaryValve: Structure.PulmonaryValve,
  PulmonaryArtery: Structure.PulmonaryArtery,
  PulmonaryVein: Structure.PulmonaryVein,
  LaAppendage: Structure.LaAppendage,
  CoronarySinus: Structure.CoronarySinus,
  Svc: Structure.Svc,
  Ivc: Structure.Ivc,
  HepaticVein: Structure.HepaticVein,
  DescendingAorta: Structure.DescendingAorta,
  Lung: Structure.Lung,
  Liver: Structure.Liver,
  Pericardium: Structure.Pericardium,
};
const name = process.argv[2] ?? 'PulmonaryVein';
const structure = STRUCTURES[name];
if (structure === undefined)
  throw new Error(`unknown structure ${name}; one of ${Object.keys(STRUCTURES).join(', ')}`);
const only = process.argv[3]?.split(',');
const views = process.argv[4]?.split(',') ?? [
  'plax',
  'psax-av',
  'psax-mv',
  'a4c',
  'a5c',
  'a2c',
  'a3c',
  'subcostal-4c',
];
const phases = [0, 0.3, 0.55];
const maxBy = new Map<string, { v: number; who: string }>();
for (const c of listCases().map((x) => loadCaseById(x.id))) {
  if (only && !only.includes(c.id)) continue;
  const m = buildCaseModels(c, {
    position: 'left-lateral',
    respiration: 'expiration',
    headElevationDeg: 0,
  });
  for (const phase of phases) {
    const pose = computeHeartPose(m.heart, cycleStateAt(m.tables, phase));
    const parts: string[] = [];
    for (const id of views) {
      const view = VIEW_TARGETS.find((v) => v.id === id);
      if (!view) throw new Error(`unknown view ${id}`);
      const fr = viewStructureFractions(view, m.heart, m.thorax, pose, { stepCm: 0.1 });
      const pct = 100 * (fr.get(structure) ?? 0);
      parts.push(`${id} ${pct.toFixed(2)}`);
      const cur = maxBy.get(id);
      if (!cur || pct > cur.v) maxBy.set(id, { v: pct, who: `${c.id}@${phase}` });
    }
    process.stdout.write(`${c.id.padEnd(32)} ${phase}: ${parts.join(' | ')}\n`);
  }
}
process.stdout.write(`--- ${name}: max per view (percent of the sampled plane):\n`);
for (const [id, m] of maxBy)
  process.stdout.write(`${id.padEnd(14)} ${m.v.toFixed(3)}  (${m.who})\n`);
