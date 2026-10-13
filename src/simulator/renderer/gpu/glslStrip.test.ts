import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { squeezeGlslSpaces, stripGlslTemplateComments } from './glslStrip';
import { GLSL_HEART } from './glslHeart';
import { GLSL_COMMON } from './glslCommon';
import { GLSL_THORAX } from './glslThorax';
import { GLSL_GENERATED } from './glslGenerated';
import * as passes from './glslPasses';
import * as image from './glslImage';

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
        'float f(float x){',
        'return x*2.0;',
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
      "const S = `${[1, 2].map((v) => ` v${v}\n`).join('')} tail`;",
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
        .map((l) => (l.startsWith('#') ? l : squeezeGlslSpaces(l)))
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

/** GLSL tokens: identifiers and numbers, then the longest operator first, then any other character. */
function tokens(glsl: string): string[] {
  return (
    glsl.match(
      /[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*(?:[eE][+-]?\d+)?[uUfF]?|\.\d+(?:[eE][+-]?\d+)?|<<=|>>=|\+\+|--|<<|>>|<=|>=|==|!=|&&|\|\||\^\^|[+\-*/%&|^]=|\S/g,
    ) ?? []
  );
}

describe('the spaces between tokens are squeezed out at build time (decision 303)', () => {
  it('keeps a space only where joining would make another token', () => {
    expect(squeezeGlslSpaces('float f(float x) {')).toBe('float f(float x){');
    expect(squeezeGlslSpaces('return x * 2.0 + y [ 1 ] ;')).toBe('return x*2.0+y[1];');
    expect(squeezeGlslSpaces('a - -b + +c')).toBe('a- -b+ +c');
    expect(squeezeGlslSpaces('a / *p')).toBe('a/ *p');
    expect(squeezeGlslSpaces('x = y == z ? 1.0 : .5;')).toBe('x=y==z?1.0:.5;');
    expect(squeezeGlslSpaces('if (a < b && c > d) i ++;')).toBe('if(a<b&&c>d)i++;');
  });

  it('leaves the preprocessor lines and the spaces next to interpolations alone', () => {
    expect(strip('const S = `\n  #define A (x)\n  #define B(x) (x * 2.)\n`;')).toBe(
      'const S = `\n#define A (x)\n#define B(x) (x * 2.)\n`;',
    );
    expect(strip('const S = `\n  return ${v} * 2.0 ;\n  x = ${a} ${b};\n`;')).toBe(
      'const S = `\nreturn ${v} *2.0;\nx= ${a} ${b};\n`;',
    );
  });

  it('leaves every shader with the same tokens', () => {
    const shaders = [
      GLSL_COMMON,
      GLSL_HEART,
      GLSL_THORAX,
      GLSL_GENERATED,
      ...(Object.values(passes) as unknown[]).filter((v): v is string => typeof v === 'string'),
      ...(Object.values(image) as unknown[]).filter((v): v is string => typeof v === 'string'),
    ];
    expect(shaders.length).toBeGreaterThan(10);
    let before = 0,
      after = 0;
    for (const glsl of shaders) {
      const code = glsl
        .split('\n')
        .map((l) => (l.includes('//') ? l.slice(0, l.indexOf('//')) : l).trim())
        .filter((l) => l.length);
      const squeezed = code.map((l) => (l.startsWith('#') ? l : squeezeGlslSpaces(l)));
      expect(tokens(squeezed.join('\n'))).toEqual(tokens(code.join('\n')));
      before += code.join('\n').length;
      after += squeezed.join('\n').length;
    }
    // the squeeze is worth its rule: a tenth of the shader text or more
    expect(after / before).toBeLessThan(0.9);
  });
});
