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

  it('is the only place in src/ (outside tests) that calls the model constructors', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const rel = p.slice(process.cwd().length + 1);
          // the builder, the constructors themselves and the offline measurer (which builds per case on purpose)
          if (rel.startsWith('src/simulator/anatomy/')) continue;
          const s = readFileSync(p, 'utf8');
          if (/\b(createHeartModel|createThoraxModel)\(/.test(s)) offenders.push(rel);
        }
      }
    };
    walk(join(process.cwd(), 'src'));
    expect(offenders, 'build the models through buildCaseModels').toEqual([]);
  });
});
