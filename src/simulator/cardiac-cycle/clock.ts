import type { RhythmConfig } from '@/cases/schema';
import { createRng, type Rng } from '@/core/random';

/**
 * Beat scheduler. Produces a deterministic RR sequence from the case seed (sinus with small
 * variability, or AF with log-normal irregularity). The clock only advances by explicit dt so
 * that tests and exam replays are reproducible.
 */
export interface ClockState {
  timeS: number;
  beatIndex: number;
  timeInBeatS: number;
  rrS: number;
  phase: number;
  /** RR of the previous beat (drives AF beat-to-beat preload). */
  previousRrS: number;
}

export class CardiacClock {
  private rng: Rng;
  private rrCurrent: number;
  private rrPrevious: number;
  private state: ClockState;

  constructor(
    private rhythm: RhythmConfig,
    seed: number,
  ) {
    this.rng = createRng(seed ^ 0x9e3779b9);
    this.rrCurrent = this.nextRr(60 / rhythm.heartRateBpm);
    this.rrPrevious = this.rrCurrent;
    this.state = {
      timeS: 0,
      beatIndex: 0,
      timeInBeatS: 0,
      rrS: this.rrCurrent,
      phase: 0,
      previousRrS: this.rrPrevious,
    };
  }

  get current(): ClockState {
    return this.state;
  }

  setRhythm(rhythm: RhythmConfig): void {
    this.rhythm = rhythm;
  }

  private nextRr(prev: number): number {
    const meanRr = 60 / this.rhythm.heartRateBpm;
    if (this.rhythm.type === 'atrial-fibrillation') {
      // log-normal irregularity, mild autocorrelation with the previous RR
      const sigma = Math.max(0.12, this.rhythm.rrVariabilityPct / 100);
      const z = this.rng.gaussian();
      const rr = meanRr * Math.exp(sigma * z - (sigma * sigma) / 2);
      return Math.max(0.28, Math.min(2.0, 0.7 * rr + 0.3 * prev));
    }
    const sigma = this.rhythm.rrVariabilityPct / 100;
    return Math.max(0.3, meanRr * (1 + sigma * this.rng.gaussian()));
  }

  advance(dtS: number): ClockState {
    let t = this.state.timeInBeatS + dtS;
    let beat = this.state.beatIndex;
    while (t >= this.rrCurrent) {
      t -= this.rrCurrent;
      beat += 1;
      this.rrPrevious = this.rrCurrent;
      this.rrCurrent = this.nextRr(this.rrCurrent);
    }
    this.state = {
      timeS: this.state.timeS + dtS,
      beatIndex: beat,
      timeInBeatS: t,
      rrS: this.rrCurrent,
      phase: t / this.rrCurrent,
      previousRrS: this.rrPrevious,
    };
    return this.state;
  }
}
