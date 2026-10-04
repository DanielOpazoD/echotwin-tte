import { expect, it } from 'vitest';
import { CineBuffer, type CineFrame } from './cineBuffer';

function frame(frameId: number): CineFrame {
  return {
    frameId,
    timeS: frameId / 30,
    phase: 0,
    beatIndex: 0,
    rrS: 1,
    display: new Uint8ClampedArray([100]),
    structure: new Uint8Array([1]),
    segment: new Uint8Array([2]),
    colorVel: new Float32Array([0.5]),
    colorVar: new Float32Array([0.1]),
    spec: { lines: 1, samples: 1, depthCm: 16, sectorRad: 1, focusCm: 9, elevationSamples: 1 },
    beam: {
      origin: { x: 0, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: 1 },
      lateral: { x: 1, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      contact: 1,
    },
    analysis: null,
  };
}

it('keeps chronological selection after multiple ring wraps, including out-of-range offsets', () => {
  const cine = new CineBuffer(3);
  expect(cine.select(0)).toBeUndefined();
  for (let id = 1; id <= 10; id++) cine.capture(frame(id));
  expect(cine.length).toBe(3);
  expect(cine.oldest?.frameId).toBe(8);
  expect(cine.newest?.frameId).toBe(10);
  expect(cine.select(-1)?.frameId).toBe(9);
  expect(cine.select(-99)?.frameId).toBe(8);
  expect(cine.select(99)?.frameId).toBe(10);
});

it('owns capture buffers and geometry after the renderer reuses its working state', () => {
  const cine = new CineBuffer();
  const source = frame(1);
  cine.capture(source);
  source.display.fill(0);
  source.structure.fill(0);
  source.segment.fill(0);
  source.colorVel!.fill(0);
  source.colorVar!.fill(0);
  source.spec.depthCm = 24;
  source.beam.origin.x = 8;
  const saved = cine.newest!;
  expect(saved.display[0]).toBe(100);
  expect(saved.structure[0]).toBe(1);
  expect(saved.segment[0]).toBe(2);
  expect(saved.colorVel![0]).toBe(0.5);
  expect(saved.colorVar![0]).toBeCloseTo(0.1);
  expect(saved.spec.depthCm).toBe(16);
  expect(saved.beam.origin.x).toBe(0);
});
