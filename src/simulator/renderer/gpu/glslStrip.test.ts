import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripGlslTemplateComments } from './glslStrip';
import { GLSL_HEART } from './glslHeart';

const strip = stripGlslTemplateComments;

describe('shader comments are stripped at build time (decision 228)', () => {
  it('drops comments, indentation and empty lines inside template literals only', () => {
    const src = [
      '// a TypeScript comment stays',
      'const A = 1; // so does this one',
      'export const S = `',
      '  // a whole-line comment',
      '  float f(float x) { // trailing',
      '    return x * 2.0;',
      '',
      '  }',
      '`;',
    ].join('\n');
    expect(strip(src)).toBe(
      [
        '// a TypeScript comment stays',
        'const A = 1; // so does this one',
        'export const S = `',
        'float f(float x) {',
        'return x * 2.0;',
        '}',
        '`;',
      ].join('\n'),
    );
  });

  it('keeps interpolations, the spaces around them, strings and division', () => {
    const src =
      'const S = `\n  const float ${name} = ${f(0.5 / 2)};\n  vec3(${a}, ${b}) // c\n  #define N ${n}\n`;';
    expect(strip(src)).toBe(
      'const S = `\nconst float ${name} = ${f(0.5 / 2)};\nvec3(${a}, ${b})\n#define N ${n}\n`;',
    );
    expect(strip("const s = 'a // not a comment'; const t = `x`;")).toBe(
      "const s = 'a // not a comment'; const t = `x`;",
    );
    expect(strip("const S = `${[1, 2].map((v) => `  v${v} // c\n`).join('')} tail`;")).toBe(
      "const S = `${[1, 2].map((v) => `  v${v}\n`).join('')} tail`;",
    );
  });

  it('refuses an interpolation inside a GLSL comment rather than emit broken code', () => {
    expect(() => strip('const S = `\n  // see ${x}\n`;')).toThrow();
  });

  it('leaves the heart shader with the same code, less its comments', () => {
    // the GLSL the module builds, with its comments and indentation removed by the same rule, line by line
    const clean = (glsl: string) =>
      glsl
        .split('\n')
        .map((l) => (l.includes('//') ? l.slice(0, l.indexOf('//')) : l).trim())
        .filter((l) => l.length)
        .join('\n');
    const src = readFileSync(new URL('./glslHeart.ts', import.meta.url), 'utf8');
    const stripped = strip(src);
    expect(stripped.length).toBeLessThan(src.length);
    // every code line of the shader survives in the stripped source text (interpolated values aside)
    const lines = clean(GLSL_HEART)
      .split('\n')
      // the header constants and defines are interpolated from TypeScript: their values are not in the source text
      .filter((l) => !/^(const |#define )|\d\.\d{4,}/.test(l));
    const missing = lines.filter((l) => !stripped.includes(l)).slice(0, 5);
    expect(missing).toEqual([]);
  });
});
