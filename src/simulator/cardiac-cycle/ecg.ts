import type { RhythmConfig } from '@/cases/schema';
import { PR_INTERVAL_S, qrsBeforePhase0S } from './timing';
import { hash3 } from '@/core/random';

/**
 * Synthetic educational ECG (spec 24): sum of Gaussians anchored at the QRS onset, `qrsBeforePhase0S` before phase 0
 * (the mitral closure, decision 349); a wave that falls before phase 0 is drawn at the end of the beat too.
 * Not diagnostic. In AF: no P wave, fibrillatory baseline, irregular RR from the clock.
 */
function gauss(t: number, mu: number, sigma: number, amp: number): number {
  const d = (t - mu) / sigma;
  return amp * Math.exp(-0.5 * d * d);
}

export function ecgSample(
  timeInBeatS: number,
  rrS: number,
  rhythm: RhythmConfig,
  beatIndex = 0,
  seed = 1,
): number {
  const t = timeInBeatS;
  const qt = 0.39 * Math.sqrt(Math.min(rrS, 1.3)); // Bazett-like QT scaling
  const q = -qrsBeforePhase0S(rhythm.type !== 'atrial-fibrillation');
  // a wave of this beat and the same wave of the next one, so one centred before phase 0 shows at the end of the beat
  const wave = (mu: number, sigma: number, amp: number): number =>
    gauss(t, mu, sigma, amp) + gauss(t, mu + rrS, sigma, amp);
  let v = 0;
  // QRS
  v += wave(q + 0.028, 0.006, -0.12);
  v += wave(q + 0.042, 0.009, 1.0);
  v += wave(q + 0.058, 0.007, -0.25);
  // T wave
  v += gauss(t, q + qt - 0.06, 0.045, 0.28);
  if (rhythm.type === 'atrial-fibrillation') {
    // fibrillatory baseline: deterministic pseudo-random small waves ~6–8 Hz
    const k = Math.floor(t * 40);
    const n = hash3(k, beatIndex, 0, seed) - 0.5;
    v += 0.05 * Math.sin(t * 2 * Math.PI * 7 + n * 6) + 0.03 * n;
  } else {
    // P wave: PR before the QRS of the next beat
    v += wave(q - PR_INTERVAL_S + 0.04, 0.022, 0.15);
  }
  return v;
}
