// @tier fast
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadCaseById } from '@/cases';
import { buildCaseModels } from './caseModels';

const EXPIRATION = {
  position: 'left-lateral',
  respiration: 'expiration',
  headElevationDeg: 0,
} as const;
const INSPIRATION = { ...EXPIRATION, respiration: 'inspiration' } as const;

describe('buildCaseModels', () => {
  it('threads the patient breathing into the heart: the IVC collapses on inspiration', () => {
    const c = loadCaseById('normal-excellent-window');
    const exp = buildCaseModels(c, EXPIRATION);
    const insp = buildCaseModels(c, INSPIRATION);
    expect(exp.thorax.ivcCollapse).toBe(0);
    expect(insp.thorax.ivcCollapse).toBeCloseTo(c.anatomy.ivc.collapsePct / 100, 6);
    // the heart model carries the collapse the thorax computed (the main-thread copy used to drop it)
    expect(insp.heart.ivcCollapse).toBeCloseTo(insp.thorax.ivcCollapse, 6);
    expect(exp.heart.ivcCollapse).toBe(0);
  });

  it('builds the beat tables at the case heart rate with the landmarks cached', () => {
    const c = loadCaseById('normal-excellent-window');
    const m = buildCaseModels(c, EXPIRATION);
    expect(m.tables.rrS).toBeCloseTo(60 / c.rhythm.heartRateBpm, 9);
    expect(m.caseDef).toBe(c);
  });

  it('is the only chain that builds the models: in src/, in tools/ and in the goldens (decision 237)', () => {
    // the builder and the constructors' own modules; the anatomy's unit tests build variants on purpose, but the goldens
    // stand for the app's image and the offline tools measure it, so they take the app's models
    const OWN = new Set(
      ['caseModels', 'heartModel', 'thoraxModel', 'diaphragm'].map(
        (m) => `src/simulator/anatomy/${m}.ts`,
      ),
    );
    const APP_CHAIN_TESTS = new Set(['src/tests/goldens.test.ts']);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== 'node_modules' && name !== 'out') walk(p);
          continue;
        }
        const rel = p.slice(process.cwd().length + 1);
        if (!/\.tsx?$/.test(name) || OWN.has(rel)) continue;
        if (/\.test\.tsx?$/.test(name) && !APP_CHAIN_TESTS.has(rel)) continue;
        const s = readFileSync(p, 'utf8');
        if (/\b(createHeartModel|createThoraxModel|fitDiaphragmMap)\(/.test(s)) offenders.push(rel);
      }
    };
    for (const dir of ['src', 'tools']) walk(join(process.cwd(), dir));
    expect(offenders, 'build the models through buildCaseModels').toEqual([]);
  });
});
