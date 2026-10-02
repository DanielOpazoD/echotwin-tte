import type { CaseDefinition } from '@/cases/schema';
import type { BeatOptions, BeatTables } from './cycleModel';

/**
 * The outflow tract's obstruction as physiology of the case (decision 245): how the SAM–septal contact narrows the tract
 * along the ejection, and the narrowing that gives the case's peak gradient. They lived with the flow field; the beat
 * tables need them too, for the left ventricular pressure that drives the mitral regurgitation.
 */
/** Fractional LVOT narrowing along the ejection (dynamic: late-peaking as SAM contact develops; static: constant). */
export function lvotNarrowing(fMax: number, dynamic: boolean, u: number): number {
  if (fMax <= 0) return 0;
  if (!dynamic) return fMax;
  const s = Math.min(1, Math.max(0, (u - 0.25) / 0.6));
  return fMax * s * s * (3 - 2 * s);
}

/** Solve the maximal LVOT narrowing so that the peak LVOT velocity matches the case's peak gradient. */
export function solveLvotObstruction(
  tables: Pick<BeatTables, 'n' | 'rrS' | 'timings' | 'aorticFlowMlps'>,
  lvotAreaCm2: number,
  peakGradientMmHg: number,
  dynamic: boolean,
): { fMax: number; dynamic: boolean } | null {
  if (peakGradientMmHg <= 0) return null;
  const vTarget = Math.sqrt(peakGradientMmHg / 4);
  const tm = tables.timings;
  const vmaxFor = (fMax: number): number => {
    let best = 0;
    for (let i = 0; i < tables.n; i++) {
      const q = tables.aorticFlowMlps[i] ?? 0;
      if (q <= 0) continue;
      const t = ((i + 0.5) / tables.n) * tables.rrS;
      const u = (t - tm.ejectionStartS) / (tm.ejectionEndS - tm.ejectionStartS);
      const area = lvotAreaCm2 * (1 - lvotNarrowing(fMax, dynamic, u));
      best = Math.max(best, q / Math.max(area, 0.05) / 100);
    }
    return best;
  };
  let lo = 0,
    hi = 0.97;
  if (vmaxFor(hi) < vTarget) return { fMax: hi, dynamic };
  for (let it = 0; it < 30; it++) {
    const mid = (lo + hi) / 2;
    if (vmaxFor(mid) < vTarget) lo = mid;
    else hi = mid;
  }
  return { fMax: (lo + hi) / 2, dynamic };
}

/** The outflow tract of a case, as the beat tables take it: its area and whether a SAM makes its obstruction dynamic. */
export function caseOutflow(c: CaseDefinition): NonNullable<BeatOptions['outflow']> {
  const r = c.anatomy.aorta.lvotDiameterCm / 2;
  return { lvotAreaCm2: Math.PI * r * r, dynamicObstruction: c.anatomy.mitral.samSeverity > 0 };
}

/** The case's obstruction solved on a beat's own aortic flow: the one solve the flow field and the truth share. */
export function caseLvotObstruction(
  c: CaseDefinition,
  tables: Pick<BeatTables, 'n' | 'rrS' | 'timings' | 'aorticFlowMlps'>,
): { fMax: number; dynamic: boolean } | null {
  const o = caseOutflow(c);
  return solveLvotObstruction(
    tables,
    o.lvotAreaCm2,
    c.hemodynamics.lvotPeakGradientMmHg,
    o.dynamicObstruction,
  );
}
