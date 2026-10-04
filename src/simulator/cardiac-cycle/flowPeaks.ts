/** Explicit per-beat snapshot. Runtime beat tables are replaced, not edited, when physiology changes.
 * Offline callers that edit arrays can omit the snapshot from cycleStateAt to measure current values.
 */
export interface FlowPeaks {
  readonly mitral: number;
  readonly tricuspid: number;
  readonly aortic: number;
  readonly pulmonary: number;
}
interface FlowTables {
  n: number;
  mitralFlowMlps: Float32Array;
  tricuspidFlowMlps: Float32Array;
  aorticFlowMlps: Float32Array;
  pulmonaryFlowMlps: Float32Array;
}
export function measureFlowPeaks(tables: FlowTables): FlowPeaks {
  let mitral = 1e-6,
    tricuspid = 1e-6,
    aortic = 1e-6,
    pulmonary = 1e-6;
  for (let i = 0; i < tables.n; i++) {
    mitral = Math.max(mitral, tables.mitralFlowMlps[i] ?? 0);
    tricuspid = Math.max(tricuspid, tables.tricuspidFlowMlps[i] ?? 0);
    aortic = Math.max(aortic, tables.aorticFlowMlps[i] ?? 0);
    pulmonary = Math.max(pulmonary, tables.pulmonaryFlowMlps[i] ?? 0);
  }
  return { mitral, tricuspid, aortic, pulmonary };
}
