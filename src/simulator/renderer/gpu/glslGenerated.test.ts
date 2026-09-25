import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateModule, OUTPUT, TARGETS, transpileFunction } from '../../../../tools/glsl/ts2glsl';
import { GLSL_GENERATED, GLSL_GENERATED_FREE_IDENTIFIERS } from './glslGenerated';
import { GLSL_COMMON } from './glslCommon';
import { GLSL_HEART } from './glslHeart';

/**
 * The generated shader functions are the TypeScript functions (engineering audit, C1-b): this test keeps the
 * committed output equal to a fresh generation, pins the accepted subset by example, and checks that every
 * constant the generated code reads is declared by the shader that includes it.
 */
describe('generated GLSL', () => {
  it('the committed module is what the generator produces now (run npm run glsl:gen)', () => {
    expect(readFileSync(join(process.cwd(), OUTPUT), 'utf8')).toBe(generateModule(process.cwd()));
  });

  it('covers every target function once', () => {
    for (const t of TARGETS)
      for (const fn of t.functions)
        expect(GLSL_GENERATED.match(new RegExp(`^float ${fn}\\(`, 'gm'))?.length, fn).toBe(1);
  });

  it('every free identifier of the generated code is a constant of the shader that includes it', () => {
    const declared = new Set<string>(['PI', 'TWO_PI']);
    for (const m of (GLSL_COMMON + GLSL_HEART).matchAll(
      /^\s*(?:const\s+\w+\s+|#define\s+)([A-Z][A-Z0-9_]{2,})\b/gm,
    ))
      declared.add(m[1]!);
    const missing = GLSL_GENERATED_FREE_IDENTIFIERS.filter((id) => !declared.has(id));
    expect(missing).toEqual([]);
  });

  it('nests a min or max of more than two arguments, which GLSL does not take (decision 213)', () => {
    const src = `
export function m3(a: number, b: number, c: number): number {
  return Math.min(a, b, c) + Math.max(a, b, c, 1);
}`;
    expect(transpileFunction(src, 'm3', new Set(['m3'])).glsl).toContain(
      'min(min(a, b), c) + max(max(max(a, b), c), 1.0)',
    );
    // and no generated call passes more than two arguments to either
    expect(GLSL_GENERATED).not.toMatch(
      /\b(min|max)\((?:[^(),]|\([^()]*\))*,(?:[^(),]|\([^()]*\))*,/,
    );
  });

  it('squares a negative base as JavaScript does: a whole exponent becomes a product, not pow (decision 169)', () => {
    const src = `
export function sq(x: number): number {
  return 1 - Math.pow((x - 0.45) / 0.45, 2) + Math.pow(x, 3) + Math.pow(Math.max(0, x), 0.7);
}`;
    expect(transpileFunction(src, 'sq', new Set(['sq'])).glsl).toBe(
      [
        'float sq(float x) {',
        '  return 1.0 - (((x - 0.45) / 0.45) * ((x - 0.45) / 0.45)) + ((x) * (x) * (x)) + pow(max(0.0, x), 0.7);',
        '}',
      ].join('\n'),
    );
    // no generated function raises a base to a whole power through pow any more
    expect(GLSL_GENERATED).not.toMatch(/pow\([^;]*,\s*[234]\.0\)/);
  });
  it('transpiles the subset: locals, ifs, loops with int counters, Math calls, ternaries', () => {
    const src = `
export function demo(a: number, b: number): number {
  if (a <= 0) return 0;
  const c = Math.max(0, a - 0.5),
    d = Math.pow(c, 2) / b;
  let acc = 0;
  for (let i = 0; i < 3; i++) {
    acc += d * Math.exp(-i) + (i > 1 ? 1e-4 : 0);
    acc *= 0.9;
  }
  return acc > 1 ? 1 : acc * Math.PI;
}`;
    const g = transpileFunction(src, 'demo', new Set(['demo']));
    expect(g.glsl).toBe(
      [
        'float demo(float a, float b) {',
        '  if (a <= 0.0) {',
        '    return 0.0;',
        '  }',
        '  float c = max(0.0, a - 0.5);',
        '  float d = ((c) * (c)) / b;',
        '  float acc = 0.0;',
        '  for (int i = 0; i < 3; i++) {',
        '    acc += d * exp(-float(i)) + (float(i) > 1.0 ? 0.0001 : 0.0);',
        '    acc *= 0.9;',
        '  }',
        '  return acc > 1.0 ? 1.0 : acc * PI;',
        '}',
      ].join('\n'),
    );
    expect(g.free).toEqual([]);
  });

  it('rejects syntax outside the subset with the offending node', () => {
    const fns = new Set(['bad']);
    expect(() =>
      transpileFunction('export function bad(a: number): number { return [a][0]!; }', 'bad', fns),
    ).toThrow(/unsupported/);
    expect(() =>
      transpileFunction('export function bad(a: string): number { return 1; }', 'bad', fns),
    ).toThrow(/must be number/);
    expect(() =>
      transpileFunction(
        'export function bad(a: number): number { return Math.random() * a; }',
        'bad',
        fns,
      ),
    ).toThrow(/Math.random/);
    expect(() =>
      transpileFunction('export function bad(a: number): number { return other(a); }', 'bad', fns),
    ).toThrow(/call target/);
  });
});
