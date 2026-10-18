// @tier fast
import { describe, expect, it } from 'vitest';
import {
  buildReviewReport,
  explainLine,
  markerDistanceCm,
  markerReport,
  regionLine,
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

  it('writes what a click picked and where its echo comes from, and carries a lasso through the report (decision 340)', () => {
    const lasso = [
      { rCm: 6, thetaRad: -0.1 },
      { rCm: 6, thetaRad: 0.1 },
      { rCm: 8, thetaRad: 0 },
    ];
    const blood = marker({
      region: {
        areaCm2: 8.24,
        structures: [{ id: Structure.LaCavity, share: 1 }],
        grey: { p10: 40, median: 55, p90: 80 },
      },
      explain: {
        rCm: 7.9,
        thetaRad: 0.05,
        structure: Structure.LaCavity,
        tissue: Tissue.Blood,
        behindPleura: false,
        transmissionDb: -27,
        shadow: { structure: Structure.Rib, tissue: Tissue.Cartilage, atCm: 1.04, dropDb: 6.7 },
        sources: [
          { id: 'clutter', share: 0.8, db: 7 },
          { id: 'chestWall', share: 0.16, db: 0.8 },
          { id: 'sideLobe', share: 0.01, db: 0.04 },
        ],
        ownShare: 0.04,
        mirrorLevel: 0,
      },
    });
    expect(regionLine(blood)).toBe(
      'zona resaltada 8.2 cm² · 100 % aurícula izquierda · gris mediana 55 (p10 40, p90 80)',
    );
    // a source under 5 % is left out of the line, and the loss names the rib's tissue
    expect(explainLine(blood)).toBe(
      'eco aquí: 80 % ruido de campo cercano, 16 % reverberación de la pared torácica; propio del tejido 4 % · mayor pérdida en el camino: costilla (cartílago) a 1.0 cm, −6.7 dB',
    );
    const lung = marker({
      id: 'r2',
      n: 2,
      lasso,
      explain: {
        ...blood.explain!,
        tissue: Tissue.Lung,
        behindPleura: true,
        sources: [],
        ownShare: 1,
        shadow: { structure: Structure.Lung, tissue: Tissue.Lung, atCm: 12, dropDb: 60 },
      },
    });
    // behind the pleura what is left is the pleura's reverberation, and a total loss reads as such
    expect(explainLine(lung)).toBe(
      'eco aquí: tras la pleura: lo dibujado es la reverberación pleural, no tejido · reverberación pleural (ninguna fuente conmutable aporta un 5 %) · mayor pérdida en el camino: pulmón (pulmón) a 12.0 cm, no pasa nada (más de 60 dB)',
    );
    expect(markerPlace(lung)).toMatch(/^lazo a mano de 3 puntos; centro: válvula aórtica/);
    const report = buildReviewReport({
      caseId: 'normal-excellent-window',
      caseTitle: 'Normal',
      mode: 'sandbox',
      workerMode: 'worker',
      input: baseInput(),
      hud: null,
      note: 'general',
      markers: [blood, lung, marker({ id: 'r3', n: 3, parentId: 'r2' })],
    });
    const md = reportToMarkdown(report);
    expect(md).toContain('   zona resaltada 8.2 cm²');
    expect(md).toContain('   eco aquí: 80 % ruido de campo cercano');
    const back = parseReviewReport(md)!;
    expect(back.markers[1]!.lasso).toEqual(lasso);
    expect(back.markers[0]!.explain).toEqual(blood.explain);
    // «copiar este»: the marker with its secondary points, without the general note
    const one = markerReport(report, 'r3');
    expect(one.markers.map((m) => m.id)).toEqual(['r2', 'r3']);
    expect(one.note).toBe('');
    // reports written before decision 340 read back with no region, lasso or explanation
    const old = JSON.parse(JSON.stringify(report)) as { markers: Record<string, unknown>[] };
    for (const m of old.markers) {
      delete m['lasso'];
      delete m['region'];
      delete m['explain'];
    }
    const oldBack = parseReviewReport(JSON.stringify(old))!;
    expect(oldBack.markers[0]!.lasso).toBeNull();
    expect(oldBack.markers[0]!.explain).toBeNull();
  });
});
