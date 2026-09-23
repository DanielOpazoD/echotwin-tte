import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Tissue, TISSUE_PROPS } from '@/simulator/anatomy/tissue';
import * as acoustics from '@/simulator/renderer/acoustic/acoustics';
import * as psf from '@/simulator/renderer/acoustic/psf';
import * as consolePipeline from '@/simulator/renderer/postprocess/consolePipeline';
import { DEFAULT_ACQUISITION, polarSpecFor } from '@/simulator/renderer/types';
import { simulatedFrameRate } from '@/simulator/renderer/frameRate';
import { DEFAULT_COLOR } from '@/simulator/doppler/color/colorDoppler';
import { loadCaseById } from '@/cases';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';

/**
 * The tables of docs/ULTRASOUND_PHYSICS.md marked `<!-- verificada: … -->` against the code (decision 160). The panel of
 * 2026-09-22 found the tissue table of that document with 17 numbers the code no longer had and two tissues missing,
 * and a console described as it was before decision 52: a table that nothing checks drifts. Each marked table starts
 * with a key in backticks — a tissue's `TISSUE_PROPS[..].name`, an exported constant, or `settings.<field>` of
 * DEFAULT_ACQUISITION — and its numbers are written the Spanish way (decimal comma, «−» for minus).
 */
const read = (doc: string) => readFileSync(join(process.cwd(), 'docs', doc), 'utf8');
const DOCS: Record<string, string> = {
  physics: read('ULTRASOUND_PHYSICS.md'),
  doppler: read('DOPPLER_ENGINE.md'),
};

/** Rows of the table after a marker: the cells of each row, header and separator dropped. */
function table(name: string, doc: 'physics' | 'doppler' = 'physics'): string[][] {
  const lines = DOCS[doc]!.split('\n');
  const at = lines.findIndex((l) => l.trim() === `<!-- verificada: ${name} -->`);
  expect(at, `the ${doc} document has no table marked ${name}`).toBeGreaterThanOrEqual(0);
  const rows: string[][] = [];
  for (let i = at + 1; i < lines.length && lines[i]!.trim().startsWith('|'); i++)
    rows.push(
      lines[i]!.trim()
        .replace(/^\||\|$/g, '')
        .split(/(?<!\\)\|/)
        .map((c) => c.trim()),
    );
  return rows.slice(2);
}

const num = (cell: string): number => Number(cell.replace(/−/g, '-').replace(',', '.'));
const key = (cell: string): string => cell.replace(/^`|`$/g, '');

/** Keys of a table, failing on duplicates. */
function keysOf(rows: string[][]): string[] {
  const keys = rows.map((r) => key(r[0]!));
  expect(
    keys.filter((k, i) => keys.indexOf(k) !== i),
    'duplicated rows',
  ).toEqual([]);
  return keys;
}

describe('docs/ULTRASOUND_PHYSICS.md states the numbers of the code', () => {
  it('lists every tissue once, with the reflectivity, specular coefficient, attenuation and grain of TISSUE_PROPS', () => {
    const rows = table('tissue-props');
    const keys = keysOf(rows);
    // every tissue of the table in the code but the empty one
    const tissues = Object.entries(TISSUE_PROPS)
      .filter(([id]) => Number(id) !== Tissue.None)
      .map(([, p]) => p);
    expect([...keys].sort()).toEqual(tissues.map((p) => p.name).sort());
    const wrong: string[] = [];
    for (const r of rows) {
      const p = tissues.find((t) => t.name === key(r[0]!))!;
      const doc = [num(r[2]!), num(r[3]!), num(r[4]!), num(r[5]!)];
      const code = [p.reflect, p.specular, p.attenuation, p.grain];
      if (doc.some((v, i) => v !== code[i]))
        wrong.push(`${p.name}: document ${doc.join(' / ')}, code ${code.join(' / ')}`);
    }
    expect(wrong).toEqual([]);
  });

  it('states the beam, PSF and scatterer constants as the code defines them', () => {
    const code: Record<string, unknown> = { ...acoustics, ...psf };
    const wrong: string[] = [];
    const rows = table('beam-psf');
    for (const k of keysOf(rows)) {
      const v = code[k];
      const doc = num(rows.find((r) => key(r[0]!) === k)![1]!);
      if (typeof v !== 'number') wrong.push(`${k}: not an exported number`);
      else if (v !== doc) wrong.push(`${k}: document ${doc}, code ${v}`);
    }
    expect(wrong).toEqual([]);
    expect(rows.length).toBeGreaterThan(15);
  });

  it('states the console defaults and constants as the code defines them', () => {
    const code: Record<string, unknown> = { ...consolePipeline };
    const settings = DEFAULT_ACQUISITION as unknown as Record<string, unknown>;
    const wrong: string[] = [];
    const rows = table('console-defaults');
    for (const k of keysOf(rows)) {
      const v = k.startsWith('settings.') ? settings[k.slice('settings.'.length)] : code[k];
      const cell = rows.find((r) => key(r[0]!) === k)![1]!;
      const doc = cell.startsWith('`') ? key(cell) : num(cell);
      if (v !== doc) wrong.push(`${k}: document ${String(doc)}, code ${String(v)}`);
    }
    expect(wrong).toEqual([]);
    expect(rows.length).toBeGreaterThan(12);
  });
});

/** A number as the document prints it: the same decimals as the cell. */
const asPrinted = (cell: string, v: number): number => {
  const decimals = (cell.split(',')[1] ?? '').length;
  return Number(v.toFixed(decimals));
};

describe('docs/DOPPLER_ENGINE.md states the values the code computes', () => {
  it("lists each case's expected Doppler values as computeGroundTruth gives them", () => {
    const rows = table('doppler-expected', 'doppler');
    const wrong: string[] = [];
    for (const id of keysOf(rows)) {
      const r = rows.find((row) => key(row[0]!) === id)!;
      const t = computeGroundTruth(loadCaseById(id));
      const code = [
        t.lvot.vmaxMps,
        t.lvot.vtiCm,
        t.aorticValve.vmaxMps,
        t.aorticValve.vtiCm,
        t.aorticValve.peakGradientMmHg,
        t.aorticValve.meanGradientMmHg,
        t.aorticValve.continuityAvaCm2,
        t.aorticValve.velocityRatio,
        t.mitral.ePeakMps,
        t.mitral.aPeakMps,
        t.rightHeart.trVmaxMps ?? Number.NaN,
        t.rightHeart.rvspMmHg ?? Number.NaN,
      ];
      code.forEach((v, i) => {
        const cell = r[i + 1]!;
        if (num(cell) !== asPrinted(cell, v))
          wrong.push(`${id} column ${i + 1}: document ${cell}, code ${v}`);
      });
    }
    expect(wrong).toEqual([]);
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it('states the simulated frame rate of each quality tier, with and without the default colour box', () => {
    const rows = table('frame-rate', 'doppler');
    const wrong: string[] = [];
    for (const tier of keysOf(rows) as ('low' | 'medium' | 'high')[]) {
      const r = rows.find((row) => key(row[0]!) === tier)!;
      const spec = polarSpecFor(DEFAULT_ACQUISITION, tier);
      const colorLines = Math.round(
        ((DEFAULT_COLOR.boxThetaMaxRad - DEFAULT_COLOR.boxThetaMinRad) / spec.sectorRad) *
          spec.lines,
      );
      const got = [
        `${spec.lines} × ${spec.samples}`,
        asPrinted(r[2]!, simulatedFrameRate(spec)),
        asPrinted(r[3]!, simulatedFrameRate(spec, { colorLines, packetSize: 8 })),
        colorLines,
      ];
      const doc = [r[1]!, num(r[2]!), num(r[3]!), num(r[4]!)];
      if (doc.some((v, i) => v !== got[i]))
        wrong.push(`${tier}: document ${doc.join(' | ')}, code ${got.join(' | ')}`);
    }
    expect(wrong).toEqual([]);
    expect(rows.length).toBe(3);
  });
});
