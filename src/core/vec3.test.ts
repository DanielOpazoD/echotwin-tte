import { describe, expect, it } from 'vitest';
import { cross, dot, normalize, orthonormalBasis, v3 } from './vec3';
import { qFromAxisAngle, qFromBasis, qMul, qRotate, qAngleBetween } from './quat';
import { createRng, hash3 } from './random';
import { valueNoise3 } from './noise';

describe('vec3/quat', () => {
  it('orthonormal basis is orthogonal and unit', () => {
    const n = normalize(v3(0.3, -0.5, 0.8));
    const { u, v } = orthonormalBasis(n);
    expect(Math.abs(dot(u, n))).toBeLessThan(1e-9);
    expect(Math.abs(dot(v, n))).toBeLessThan(1e-9);
    expect(Math.abs(dot(u, v))).toBeLessThan(1e-9);
    expect(Math.hypot(u.x, u.y, u.z)).toBeCloseTo(1, 9);
  });
  it('quaternion rotates 90° about z', () => {
    const q = qFromAxisAngle(v3(0, 0, 1), Math.PI / 2);
    const r = qRotate(q, v3(1, 0, 0));
    expect(r.x).toBeCloseTo(0, 9);
    expect(r.y).toBeCloseTo(1, 9);
  });
  it('qFromBasis round-trips a rotation', () => {
    const q = qFromAxisAngle(normalize(v3(1, 2, 3)), 0.7);
    const right = qRotate(q, v3(1, 0, 0));
    const up = qRotate(q, v3(0, 1, 0));
    const fwd = qRotate(q, v3(0, 0, 1));
    const q2 = qFromBasis(right, up, fwd);
    expect(qAngleBetween(q, q2)).toBeLessThan(1e-6);
    expect(Math.abs(dot(cross(right, up), fwd) - 1)).toBeLessThan(1e-9);
  });
  it('quaternion composition matches sequential rotation', () => {
    const a = qFromAxisAngle(v3(0, 1, 0), 0.4);
    const b = qFromAxisAngle(v3(1, 0, 0), -0.9);
    const v = v3(0.2, 0.5, -0.7);
    const seq = qRotate(a, qRotate(b, v));
    const comp = qRotate(qMul(a, b), v);
    expect(seq.x).toBeCloseTo(comp.x, 9);
    expect(seq.y).toBeCloseTo(comp.y, 9);
    expect(seq.z).toBeCloseTo(comp.z, 9);
  });
});

describe('random/noise determinism', () => {
  it('same seed → same sequence', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    for (let i = 0; i < 10; i++) expect(a.next()).toBe(b.next());
  });
  it('hash3 is deterministic and in [0,1)', () => {
    expect(hash3(1, 2, 3, 9)).toBe(hash3(1, 2, 3, 9));
    expect(hash3(1, 2, 3, 9)).not.toBe(hash3(1, 2, 3, 10));
    for (let i = 0; i < 100; i++) {
      const h = hash3(i, -i, i * 7, 42);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
  it('value noise is continuous', () => {
    const a = valueNoise3(1.5, 2.5, 3.5, 7);
    const b = valueNoise3(1.5001, 2.5, 3.5, 7);
    expect(Math.abs(a - b)).toBeLessThan(1e-3);
  });
});
