import { describe, expect, it } from 'vitest';
import { GLSL_COMMON } from './glslCommon';
import { GLSL_HEART } from './glslHeart';

/**
 * Static guards on the GLSL port of the heart classifier. The shader cannot be compiled in Node
 * (no WebGL); CPU↔GPU equivalence is checked in the browser by e2e/gpu-equivalence.spec.ts. What
 * can be checked here is the wiring between the TS side and the shader text: every ALL_CAPS name
 * the heart code uses is declared (a parameter define, an enum define or an interpolated TS
 * constant), every interpolated constant is used, and every interpolated value is a well-formed
 * GLSL literal.
 */
const IDENT = /\b[A-Z][A-Z0-9_]{2,}\b/g;
const FLOAT_LITERAL = /^-?\d+\.\d+$|^-?\d+(?:\.\d+)?e-?\d+$/;
const INT_LITERAL = /^-?\d+$/;

function stripComments(glsl: string): string {
  return glsl.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** `const <type> NAME[N]? = <value>;` lines of the interpolated header. */
function headerConstants(
  glsl: string,
): { type: string; name: string; size: number | null; value: string }[] {
  return [...glsl.matchAll(/^const\s+(\w+)\s+([A-Z][A-Z0-9_]+)(\[(\d+)\])?\s*=\s*([^;]+);/gm)].map(
    (m) => ({
      type: m[1]!,
      name: m[2]!,
      size: m[4] ? Number(m[4]) : null,
      value: m[5]!.trim(),
    }),
  );
}

describe('GLSL heart classifier wiring', () => {
  // the fragment source of pass A is `#version 300 es` + GLSL_COMMON + GLSL_HEART + GLSL_THORAX + main
  const assembled = GLSL_COMMON + GLSL_HEART;
  const declared = new Set<string>();
  for (const m of assembled.matchAll(/^\s*(?:const\s+\w+\s+|#define\s+)([A-Z][A-Z0-9_]{2,})\b/gm)) {
    declared.add(m[1]!);
  }
  const body = stripComments(GLSL_HEART);
  const used = new Map<string, number>();
  for (const m of body.matchAll(IDENT)) used.set(m[0], (used.get(m[0]) ?? 0) + 1);

  it('every ALL_CAPS identifier the heart code uses is declared as a define or constant', () => {
    const undeclared = [...used.keys()].filter((n) => !declared.has(n)).sort();
    expect(undeclared, `undeclared in GLSL_HEART: ${undeclared.join(', ')}`).toEqual([]);
  });

  it('every constant interpolated into the header is used by the heart code', () => {
    const header = headerConstants(GLSL_HEART);
    expect(header.length).toBeGreaterThan(0);
    // one occurrence is the declaration itself
    const dead = header.filter((c) => (used.get(c.name) ?? 0) < 2).map((c) => c.name);
    expect(dead, `declared but never used: ${dead.join(', ')}`).toEqual([]);
  });

  it('every interpolated value is a well-formed GLSL literal of its declared type', () => {
    for (const c of headerConstants(GLSL_HEART)) {
      if (c.size !== null) {
        const m = c.value.match(/^(\w+)\[(\d+)\]\((.*)\)$/);
        expect(m, `${c.name}: array initialiser`).not.toBeNull();
        expect(m![1]).toBe(c.type);
        expect(Number(m![2])).toBe(c.size);
        const items = m![3]!.split(',').map((s) => s.trim());
        expect(items, `${c.name}: element count`).toHaveLength(c.size);
        for (const v of items)
          expect(v, `${c.name}: ${v}`).toMatch(c.type === 'int' ? INT_LITERAL : FLOAT_LITERAL);
      } else {
        expect(c.value, `${c.name}: ${c.value}`).toMatch(
          c.type === 'int' ? INT_LITERAL : FLOAT_LITERAL,
        );
      }
    }
  });
});
