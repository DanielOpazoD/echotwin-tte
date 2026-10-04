import type { BeamFrame } from '@/simulator/probe/pose';
import type { FrameAcquisition, GateInfo } from './protocol';
import type { Scene } from '@/simulator/renderer/types';
import type { PolarFrameSpec } from '@/simulator/renderer/types';
import type { ViewAnalysis } from '@/simulator/view-recognition/viewQuality';

export interface CineFrame {
  acquisition: FrameAcquisition;
  /** Models are replaced, not mutated, by the core; retain the acquired pose and model references. */
  scene: Scene;
  gate: GateInfo | null;
  spectrumColumn: Float32Array | null;
  spectralRange: { vMin: number; vMax: number };
  display: Uint8ClampedArray;
  structure: Uint8Array;
  segment: Uint8Array;
  spec: PolarFrameSpec;
  frameId: number;
  rrS: number;
  phase: number;
  timeS: number;
  beatIndex: number;
  colorVel: Float32Array | null;
  colorVar: Float32Array | null;
  beam: BeamFrame;
  analysis: ViewAnalysis | null;
}

/** Bounded acquisition history. Capture owns its arrays; later renderer reuse cannot rewrite a frame. */
export class CineBuffer {
  private frames: (CineFrame | undefined)[];
  private head = 0;
  private count = 0;

  constructor(private readonly capacity = 96) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new RangeError('Cine capacity must be positive');
    this.frames = new Array<CineFrame | undefined>(capacity);
  }

  get length(): number {
    return this.count;
  }
  get oldest(): CineFrame | undefined {
    return this.at(0);
  }
  get newest(): CineFrame | undefined {
    return this.at(this.count - 1);
  }

  private at(index: number): CineFrame | undefined {
    if (index < 0 || index >= this.count) return undefined;
    return this.frames[(this.head - this.count + index + this.capacity) % this.capacity];
  }

  select(offset: number): CineFrame | undefined {
    const safeOffset = Number.isFinite(offset) ? Math.trunc(offset) : 0;
    return this.at(Math.max(0, Math.min(this.count - 1, this.count - 1 + safeOffset)));
  }

  capture(frame: CineFrame): void {
    this.frames[this.head] = {
      ...frame,
      acquisition: {
        ...frame.acquisition,
        probe: { ...frame.acquisition.probe },
        patient: { ...frame.acquisition.patient },
        settings: { ...frame.acquisition.settings, tgcDb: [...frame.acquisition.settings.tgcDb] },
        color: { ...frame.acquisition.color },
        spectral: { ...frame.acquisition.spectral },
        phaseMarks: { ...frame.acquisition.phaseMarks },
      },
      gate: frame.gate ? { ...frame.gate, lineStructures: [...frame.gate.lineStructures] } : null,
      spectrumColumn: frame.spectrumColumn?.slice() ?? null,
      spectralRange: { ...frame.spectralRange },
      display: frame.display.slice(),
      structure: frame.structure.slice(),
      segment: frame.segment.slice(),
      spec: { ...frame.spec },
      beam: {
        ...frame.beam,
        origin: { ...frame.beam.origin },
        forward: { ...frame.beam.forward },
        lateral: { ...frame.beam.lateral },
        normal: { ...frame.beam.normal },
      },
      colorVel: frame.colorVel?.slice() ?? null,
      colorVar: frame.colorVar?.slice() ?? null,
    };
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }
}
