import { afterEach, describe, expect, it, vi } from 'vitest';
import { SPECTRAL_BINS } from '../spectral/spectrum';
import { dopplerShiftHz } from '@/clinical/formulas';
import { DopplerAudio } from './dopplerAudio';

class FakeParam {
  value = 0;
  target = 0;
  setTargetAtTime(v: number) {
    this.target = v;
  }
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = '';
  connections: { to: unknown; input?: number }[] = [];
  started = false;
  connect(to: unknown, _out?: number, input?: number) {
    this.connections.push({ to, input });
    return to as FakeNode;
  }
  start() {
    this.started = true;
  }
}
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  closed = false;
  oscillators: FakeNode[] = [];
  gains: FakeNode[] = [];
  createOscillator() {
    const o = new FakeNode();
    this.oscillators.push(o);
    return o;
  }
  createGain() {
    const g = new FakeNode();
    this.gains.push(g);
    return g;
  }
  createChannelMerger() {
    return new FakeNode();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

describe('Doppler audio (spec 14)', () => {
  let ctx: FakeAudioContext;
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  function makeAudio(): DopplerAudio {
    ctx = new FakeAudioContext();
    vi.stubGlobal('AudioContext', function () {
      return ctx;
    });
    return new DopplerAudio();
  }

  it('builds one oscillator pair per velocity band, silent until an update arrives', () => {
    const a = makeAudio();
    a.start();
    expect(ctx.oscillators).toHaveLength(48); // 24 bands × toward/away
    expect(ctx.oscillators.every((o) => o.started && o.type === 'sawtooth')).toBe(true);
    expect(ctx.gains.slice(1).every((g) => g.gain.value === 0)).toBe(true);
  });

  it('routes toward-flow to the left channel and away-flow to the right', () => {
    const a = makeAudio();
    a.start();
    // even band index → positive sign → merger input 0 (left); odd → input 1 (right)
    const towardGain = ctx.gains[1]!;
    const awayGain = ctx.gains[2]!;
    expect(towardGain.connections[0]!.input).toBe(0);
    expect(awayGain.connections[0]!.input).toBe(1);
  });

  it('gives each oscillator the Doppler shift of its velocity band and the energy of its bin', () => {
    const a = makeAudio();
    a.start();
    a.update(new Float32Array(SPECTRAL_BINS).fill(1), -0.5, 1, 2.5e6);
    // band 23, toward-flow (oscillator index 46): vBand = (23.5/24)·max(1, 0.5)
    const vBand = (23.5 / 24) * 1;
    expect(ctx.oscillators[46]!.frequency.target).toBeCloseTo(
      Math.max(80, Math.abs(dopplerShiftHz(2.5e6, vBand, 1))),
      6,
    );
    expect(ctx.gains[47]!.gain.target).toBeGreaterThan(0);
    // an empty column silences every band again
    a.update(new Float32Array(SPECTRAL_BINS), -0.5, 1, 2.5e6);
    expect(ctx.gains.slice(1).every((g) => g.gain.target === 0)).toBe(true);
  });

  it('clamps volume, silences and closes the context on stop', () => {
    const a = makeAudio();
    a.start();
    a.setVolume(2);
    expect(ctx.gains[0]!.gain.value).toBe(0.4);
    a.setVolume(-1);
    expect(ctx.gains[0]!.gain.value).toBe(0);
    a.stop();
    expect(ctx.closed).toBe(true);
    expect(ctx.gains.slice(1).every((g) => g.gain.value === 0)).toBe(true);
  });

  it('does nothing when AudioContext is unavailable', () => {
    vi.stubGlobal('AudioContext', undefined);
    const a = new DopplerAudio();
    expect(() => {
      a.start();
      a.update(new Float32Array(SPECTRAL_BINS), -1, 1);
      a.stop();
    }).not.toThrow();
  });
});
