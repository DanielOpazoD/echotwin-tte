import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GLSL_COMMON } from './glslCommon';
import {
  GLSL_PASS_A_MAIN,
  GLSL_PASS_B_MAIN,
  GLSL_PASS_C_MAIN,
  GLSL_PASS_D_MAIN,
} from './glslPasses';
import {
  GLSL_CONSOLE_FRAG,
  GLSL_NOISE_AXIAL_FRAG,
  GLSL_NOISE_LATERAL_FRAG,
  GLSL_PRESENT_FRAG,
} from './glslImage';
import { ACOUSTIC_GLSL_CONSTANTS } from '../acoustic/acoustics';

/**
 * Drift guard for the acoustic image chain, which exists twice by design: CPU (procedural/sliceRenderer.ts,
 * acoustic/psf.ts, postprocess/consolePipeline.ts, postprocess/colorMap.ts) and GLSL (glslPasses.ts,
 * glslImage.ts). The shader cannot run in Node, so the numeric equivalence is checked in the browser
 * (e2e/gpu-equivalence.spec.ts); what this test enforces is the *mechanism* that keeps the two from drifting:
 * every number both sides need is a named constant that reaches the shader as a `#define`, never a literal
 * copied by hand on both sides (the 2026-09-16 engineering audit found ~60 such copies in this chain alone).
 */
const ROOT = process.cwd();
const src = (rel: string) => readFileSync(join(ROOT, 'src/simulator/renderer', rel), 'utf8');

const CPU_SOURCES = [
  'procedural/sliceRenderer.ts',
  'acoustic/psf.ts',
  'postprocess/consolePipeline.ts',
  'postprocess/colorMap.ts',
].map(src);
const GLSL_BODIES = [
  GLSL_PASS_A_MAIN,
  GLSL_PASS_B_MAIN,
  GLSL_PASS_C_MAIN,
  GLSL_PASS_D_MAIN,
  GLSL_NOISE_AXIAL_FRAG,
  GLSL_NOISE_LATERAL_FRAG,
  GLSL_CONSOLE_FRAG,
  GLSL_PRESENT_FRAG,
];

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Non-trivial numeric literals: anything with a decimal point or exponent, except the structural values below. */
const TRIVIAL = new Set([
  '0.0',
  '0.5',
  '1.0',
  '2.0',
  '3.0',
  '4.0',
  '0.25',
  '255.0',
  '0.4342944819032518', // log10(e), written once in GLSL where TS has Math.log10
  '6.283185307179586', // 2π
]);
function numericLiterals(code: string): Set<string> {
  const out = new Set<string>();
  // skip `#define NAME <value>` lines: those are the shared constants arriving in the shader
  const body = stripComments(code)
    .split('\n')
    .filter((l) => !/^\s*#define\b/.test(l))
    .join('\n');
  for (const m of body.matchAll(/(?<![\w.])-?\d+\.\d+(?:e-?\d+)?|(?<![\w.])-?\d+e-?\d+/g)) {
    const v = m[0].replace(/^-/, '');
    if (!TRIVIAL.has(v)) out.add(v);
  }
  return out;
}

/** Numeric value of a literal as TypeScript would write it, so `0.60` and `0.6` compare equal. */
const norm = (s: string) => String(Number(s));

describe('acoustic chain: CPU ↔ GLSL parity mechanism', () => {
  it('no numeric literal is written on both sides of the chain', () => {
    const cpu = new Set<string>();
    for (const s of CPU_SOURCES) for (const v of numericLiterals(s)) cpu.add(norm(v));
    const shared: string[] = [];
    for (const body of GLSL_BODIES)
      for (const v of numericLiterals(body)) if (cpu.has(norm(v))) shared.push(v);
    expect(
      [...new Set(shared)].sort(),
      'literals present in both the CPU sources and the GLSL bodies: move each to a named constant emitted as a #define',
    ).toEqual([]);
  });

  it('every acoustic define reaches some GLSL body', () => {
    const all = GLSL_BODIES.map(stripComments).join('\n');
    const dead = Object.keys(ACOUSTIC_GLSL_CONSTANTS).filter(
      (name) => !new RegExp(`\\b${name}\\b`).test(all),
    );
    expect(dead, 'defined for the shader but never read by a pass').toEqual([]);
  });

  it('every ALL_CAPS name the passes use is declared in the common header or the pass itself', () => {
    const declared = new Set<string>();
    const header = GLSL_COMMON + GLSL_NOISE_AXIAL_FRAG + GLSL_CONSOLE_FRAG + GLSL_PRESENT_FRAG;
    for (const m of header.matchAll(
      /^\s*(?:const\s+\w+\s+|#define\s+|uniform\s+\w+\s+)([A-Z][A-Z0-9_]{2,})\b/gm,
    ))
      declared.add(m[1]!);
    // GLSL keywords/builtins in caps that are not ours
    for (const k of ['PI', 'TWO_PI']) declared.add(k);
    const undeclared = new Set<string>();
    for (const body of [GLSL_PASS_A_MAIN, GLSL_PASS_B_MAIN, GLSL_PASS_C_MAIN, GLSL_PASS_D_MAIN]) {
      for (const m of stripComments(body).matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g))
        if (!declared.has(m[0])) undeclared.add(m[0]);
    }
    expect([...undeclared].sort(), 'used by a pass but never defined').toEqual([]);
  });
});
