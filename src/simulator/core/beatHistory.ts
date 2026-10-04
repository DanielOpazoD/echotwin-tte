import type { ClockState } from '@/simulator/cardiac-cycle/clock';

export interface TimedBeat<T> {
  startS: number;
  rrS: number;
  beatIndex: number;
  context: T;
}

/** Last three immutable beat contexts, sufficient for the core's <=100 ms retrospective acquisition. */
export class BeatHistory<T> {
  private beats: TimedBeat<T>[] = [];

  remember(clock: ClockState, context: T): void {
    const beat = {
      startS: clock.timeS - clock.timeInBeatS,
      rrS: clock.rrS,
      beatIndex: clock.beatIndex,
      context,
    };
    const last = this.beats.at(-1);
    if (last?.beatIndex === beat.beatIndex) this.beats[this.beats.length - 1] = beat;
    else {
      this.beats.push(beat);
      if (this.beats.length > 3) this.beats.shift();
    }
  }

  at(timeS: number): TimedBeat<T> & { phase: number } {
    const beat = this.beats.findLast((b) => b.startS <= timeS + 1e-10);
    if (!beat) throw new RangeError('Acquisition timestamp is outside retained beat history');
    return { ...beat, phase: Math.max(0, Math.min(1, (timeS - beat.startS) / beat.rrS)) };
  }
}
