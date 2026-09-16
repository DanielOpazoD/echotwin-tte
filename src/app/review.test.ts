// @tier fast
import { describe, expect, it } from 'vitest';
import {
  buildReviewReport,
  markerDistanceCm,
  markerLabel,
  markerPlace,
  parseReviewReport,
  renumberMarkers,
  reportToMarkdown,
  structureLabel,
  tissueLabel,
  type ReviewMarker,
} from './review';
import { baseInput } from '@/simulator/core/baseInput';
import { Structure, Tissue } from '@/simulator/anatomy/tissue';

const sector = {
  apexX: 320,
  apexY: 10,
  pxPerCm: 24,
  width: 640,
  height: 420,
  sectorRad: 1.4,
  depthCm: 16,
  invertLR: false,
};

const marker = (over: Partial<ReviewMarker> = {}): ReviewMarker => ({
  id: 'r1',
  n: 1,
  space: 'image',
  torso: null,
  group: null,
  x: 330,
  y: 200,
  captureSector: sector,
  rCm: 7.9,
  thetaRad: 0.05,
  strip: null,
  frameId: 42,
  phase: 0.35,
  modality: '2d',
  structure: Structure.AorticValve,
  point: {
    rCm: 7.9,
    thetaRad: 0.05,
    offPlaneCm: 0,
    phase: 0.35,
    torso: { x: 1, y: 2, z: -6 },
    heart: { x: -0.7, y: 1.4, z: 0.2 },
    inHeart: true,
    structure: Structure.AorticValve,
    tissue: Tissue.Valve,
    sdfCm: -0.02,
    azRad: 2.0,
    levelFrac: 0.03,
    rootT: 0.45,
    rootR: 0.9,
  },
  note: 'línea brillante en la base del velo',
  category: 'anatomia',
  parentId: null,
  ...over,
});

describe('review report (decision 134)', () => {
  it('names structures and tissues in the words of the model, with a fallback for unknown ids', () => {
    expect(structureLabel(Structure.RvCavity)).toBe('cavidad del VD');
    expect(tissueLabel(Tissue.Myocardium)).toBe('miocardio');
    expect(structureLabel(250)).toBe('estructura 250');
  });

  it('places a marker with its structure, polar position and the anatomy coordinates the worker returned', () => {
    const place = markerPlace(marker());
    expect(place).toContain('válvula aórtica');
    expect(place).toContain('válvula ·');
    expect(place).toContain('7.9 cm · 3°');
    expect(place).toContain('corazón (-0.7, 1.4, 0.2)');
    expect(place).toContain('raíz t 0.45 r 0.90');
    // before the worker answers, the frame's own structure map names the place
    expect(markerPlace(marker({ point: null }))).toBe('válvula aórtica · 7.9 cm · 3°');
    expect(
      markerPlace(
        marker({
          rCm: null,
          thetaRad: null,
          strip: { kind: 'spectral', column: 120, value: -0.83 },
        }),
      ),
    ).toBe('tira espectral · columna 120 · -0.83 m/s');
  });

  it('writes a readable report with the exact input and reads it back from the pasted text', () => {
    const input = baseInput({ modality: 'pw', gateDepthCm: 4.2 });
    const report = buildReviewReport({
      caseId: 'normal-excellent-window',
      caseTitle: 'Normal — ventana excelente',
      mode: 'sandbox',
      workerMode: 'worker',
      input,
      hud: null,
      note: 'la raíz sale ovalada',
      markers: [marker(), marker({ id: 'r2', n: 2, note: '', category: 'movimiento' })],
    });
    const md = reportToMarkdown(report);
    expect(md).toMatch(/^## Informe de revisión EchoTwin — \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(md).toContain('Caso: normal-excellent-window (Normal — ventana excelente)');
    expect(md).toContain('Modalidad PW');
    expect(md).toContain('compuerta 4.2 cm');
    expect(md).toContain('Nota general: la raíz sale ovalada');
    expect(md).toContain('1. [Anatomía / forma] válvula aórtica');
    expect(md).toContain('«línea brillante en la base del velo»');
    expect(md).toContain('2. [Movimiento / ciclo]');
    const back = parseReviewReport(md);
    expect(back).not.toBeNull();
    expect(back!.input).toEqual(input);
    expect(back!.markers.map((m) => m.id)).toEqual(['r1', 'r2']);
    expect(parseReviewReport(JSON.stringify(report))!.caseId).toBe('normal-excellent-window');
  });

  it('places a marker put on the 3D model with its surface, the torso point and its distance from the image plane', () => {
    const base = marker();
    const model = marker({
      space: 'model',
      group: 'rv-myocardium',
      torso: { x: -2.1, y: 1.4, z: -5.2 },
      rCm: null,
      thetaRad: null,
      captureSector: null,
      point: {
        ...base.point!,
        structure: Structure.RvWall,
        tissue: Tissue.Myocardium,
        rootT: null,
        rootR: null,
        offPlaneCm: -1.24,
      },
    });
    const place = markerPlace(model);
    expect(place).toContain('3D · miocardio del VD');
    expect(place).toContain('pared libre del VD · miocardio');
    expect(place).toContain('torso (-2.1, 1.4, -5.2)');
    expect(place).toContain('a 1.2 cm del plano de imagen');
    expect(markerPlace({ ...model, point: { ...model.point!, offPlaneCm: 0.1 } })).toContain(
      'en el plano de imagen',
    );
    // a report written before 3D markers existed loads as image markers
    const old = JSON.parse(
      JSON.stringify(
        buildReviewReport({
          caseId: 'x',
          caseTitle: 'x',
          mode: 'sandbox',
          workerMode: 'worker',
          input: baseInput(),
          hud: null,
          note: '',
          markers: [base],
        }),
      ),
    ) as { markers: Record<string, unknown>[] };
    for (const mk of old.markers) {
      delete mk['space'];
      delete mk['torso'];
      delete mk['group'];
    }
    const back = parseReviewReport(JSON.stringify(old));
    expect(back!.markers[0]!.space).toBe('image');
    expect(back!.markers[0]!.group).toBeNull();
  });

  it('links secondary points to their primary: letters, distance and their place under it in the report', () => {
    const primary = marker({ id: 'p1', n: 0 });
    const other = marker({ id: 'p2', n: 0, rCm: 5, note: '' });
    const childA = marker({
      id: 'c1',
      n: 0,
      parentId: 'p1',
      rCm: 9.9,
      thetaRad: 0.35,
      note: 'mismo defecto',
      point: { ...primary.point!, torso: { x: 1, y: 2, z: -8 } },
    });
    const childB = marker({
      id: 'c2',
      n: 0,
      parentId: 'p1',
      note: '',
      point: null,
      rCm: 7.9,
      thetaRad: -0.25,
    });
    const ms = renumberMarkers([primary, other, childA, childB]);
    expect(ms.map((m) => m.n)).toEqual([1, 2, 1, 2]);
    expect(markerLabel(ms[2]!, ms)).toBe('1a');
    expect(markerLabel(ms[3]!, ms)).toBe('1b');
    expect(markerLabel(ms[1]!, ms)).toBe('2');
    // distance in the torso when both are placed there, in the image plane otherwise
    const dA = markerDistanceCm(ms[0]!, ms[2]!)!;
    expect(dA.where).toBe('torso');
    expect(dA.cm).toBeCloseTo(2, 5);
    const dB = markerDistanceCm(ms[0]!, ms[3]!)!;
    expect(dB.where).toBe('imagen');
    expect(dB.cm).toBeCloseTo(Math.sqrt(7.9 * 7.9 * 2 - 2 * 7.9 * 7.9 * Math.cos(0.3)), 5);
    const md = reportToMarkdown(
      buildReviewReport({
        caseId: 'x',
        caseTitle: 'x',
        mode: 'sandbox',
        workerMode: 'worker',
        input: baseInput(),
        hud: null,
        note: '',
        markers: ms,
      }),
    );
    const lines = md.split('\n');
    const i1 = lines.findIndex((l) => l.startsWith('1. '));
    expect(lines[i1 + 1]).toMatch(/^ {2}1a\. .*a 2\.0 cm de 1 \(torso\) — «mismo defecto»$/);
    expect(lines[i1 + 2]).toMatch(/^ {2}1b\. .*\(imagen\)$/);
    expect(lines[i1 + 3]).toMatch(/^2\. /);
    // secondaries survive the text round trip and old reports load them as null
    expect(parseReviewReport(md)!.markers.filter((m) => m.parentId === 'p1')).toHaveLength(2);
  });

  it('rejects text that carries no report', () => {
    expect(parseReviewReport('hola')).toBeNull();
    expect(parseReviewReport('```json\n{"format":"otro"}\n```')).toBeNull();
    expect(parseReviewReport('{"format":"echotwin-review"}')).toBeNull();
  });
});
