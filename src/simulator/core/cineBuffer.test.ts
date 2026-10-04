// @tier slow
import { expect, it } from 'vitest';
import { CineBuffer, type CineFrame } from './cineBuffer';
import { baseInput } from './baseInput';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { loadCaseById } from '@/cases';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';

const input = baseInput();
const models = buildCaseModels(loadCaseById('normal-excellent-window'), REST_PATIENT);
const scene = {
  heart: models.heart,
  thorax: models.thorax,
  heartPose: computeHeartPose(models.heart, cycleStateAt(models.tables, 0)),
  physics: { frequencyMHz: 2.5, harmonics: true, clutterLevel: 0, windowAttenuation: 0, seed: 1 },
};

function frame(frameId: number): CineFrame {
  return {
    scene,
    acquisition: {
      ...input,
      modelVersion: 0,
      stripAcquisitionId: null,
      colorTimeS: null,
      tablesVersion: 0,
      phaseMarks: {
        ejectionStart: 0.1,
        ejectionEnd: 0.35,
        endSystole: 0.4,
        mitralOpen: 0.45,
        eEnd: 0.65,
        aStart: 0.8,
        aEnd: 0.95,
        hasAWave: true,
      },
    },
    gate: null,
    spectrumColumn: null,
    spectralRange: { vMin: -1, vMax: 1 },
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
  const acquiredScale = source.acquisition.color.scaleMps;
  source.acquisition.color.scaleMps = 9;
  source.acquisition.probe.u = 17;
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
  expect(saved.acquisition.color.scaleMps).toBe(acquiredScale);
  expect(saved.acquisition.probe.u).not.toBe(17);
});
