import type { HemodynamicConfig } from '@/cases/schema';
import type { CycleTimings } from './timing';

/** The existing reduced TR waveform, now shared by the flow field and volume ledger.
 * Constant declared EROA: Q(t)=EROA*v(t), RVol=EROA*VTI (ASE regurgitation 2017).
 * The empirical systolic envelope is not a solved RV pressure waveform.
 */
export function tricuspidRegurgitation(
  hemo: HemodynamicConfig,
  timings: CycleTimings,
  rrS: number,
  n: number,
) {
  const velocityMps = new Float32Array(n);
  const flowMlps = new Float32Array(n);
  const vmaxMps = hemo.trPresent ? Math.sqrt(Math.max(0, (hemo.paspMmHg - hemo.rapMmHg) / 4)) : 0;
  const eroaCm2 = hemo.regurgitation.tr?.eroaCm2 ?? 0;
  const dt = rrS / n;
  let vtiCm = 0,
    volumeMl = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * dt;
    const u =
      (t - timings.ejectionStartS + 0.02) / (timings.ejectionEndS - timings.ejectionStartS + 0.04);
    const velocity = u > 0 && u < 1 ? vmaxMps * Math.pow(Math.sin(Math.PI * u), 0.8) : 0;
    velocityMps[i] = velocity;
    flowMlps[i] = velocityMps[i]! * 100 * eroaCm2;
    vtiCm += velocityMps[i]! * 100 * dt;
    volumeMl += flowMlps[i]! * dt;
  }
  return { velocityMps, flowMlps, vmaxMps, vtiCm, volumeMl };
}
