import { SPECTRAL_BINS } from '../spectral/spectrum';
import { dopplerShiftHz } from '@/clinical/formulas';

/**
 * Doppler audio (spec 14): a bank of oscillators whose frequencies follow the Doppler equation for
 * each velocity bin; gains follow the current spectral column. Toward-flow to the left channel,
 * away-flow to the right. Not a recording: it is synthesized from the same spectrum that is drawn.
 */
export class DopplerAudio {
  private ctx: AudioContext | null = null;
  private oscs: { osc: OscillatorNode; gain: GainNode; sign: number }[] = [];
  private master: GainNode | null = null;
  private bins = 24;
  private enabled = false;

  start(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.3;
    const merger = ctx.createChannelMerger(2);
    for (let i = 0; i < this.bins; i++) {
      for (const sign of [1, -1]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(merger, 0, sign > 0 ? 0 : 1);
        osc.start();
        this.oscs.push({ osc, gain, sign });
      }
    }
    merger.connect(this.master);
    this.master.connect(ctx.destination);
    this.enabled = true;
  }

  setVolume(v: number): void {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v)) * 0.4;
  }

  /** Update from a spectral column (index 0 = vMax). */
  update(column: Float32Array | null, vMin: number, vMax: number, f0Hz = 2.5e6): void {
    if (!this.ctx || !this.enabled) return;
    const span = vMax - vMin;
    const now = this.ctx.currentTime;
    for (const o of this.oscs) {
      let g = 0;
      let f = 200;
      if (column) {
        // each oscillator owns a velocity band on its side of the baseline
        const idx = this.oscs.indexOf(o);
        const band = Math.floor(idx / 2);
        const vBand = ((band + 0.5) / this.bins) * Math.max(vMax, -vMin) * o.sign;
        const bin = Math.round(((vMax - vBand) / span) * SPECTRAL_BINS);
        if (bin >= 0 && bin < SPECTRAL_BINS) g = Math.pow(column[bin] ?? 0, 2) * 0.12;
        f = Math.max(80, Math.abs(dopplerShiftHz(f0Hz, vBand, 1)));
      }
      o.osc.frequency.setTargetAtTime(f, now, 0.02);
      o.gain.gain.setTargetAtTime(g, now, 0.03);
    }
  }

  stop(): void {
    for (const o of this.oscs) o.gain.gain.value = 0;
    this.enabled = false;
    void this.ctx?.close();
    this.ctx = null;
    this.oscs = [];
  }
}
