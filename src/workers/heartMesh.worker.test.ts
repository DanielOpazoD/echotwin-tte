// @tier fast
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeshReply, NavigatorModel } from './heartMesh.worker';

/**
 * The mesh worker is the navigator's only source of models (audit B7): it must announce the NavigatorModel
 * (thorax, heart frame, ghost) before any mesh, so the torso view can build the scene at once, and then one
 * mesh reply per requested phase. Loaded with a fake `self`, one coarse phase, so the test stays light.
 */
type FakeSelf = {
  onmessage: ((ev: { data: unknown }) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
};

describe('heartMesh.worker', () => {
  let fakeSelf: FakeSelf;
  beforeEach(async () => {
    fakeSelf = { onmessage: null, postMessage: vi.fn() };
    (globalThis as { self?: unknown }).self = fakeSelf;
    vi.resetModules();
    await import('./heartMesh.worker');
  });
  afterEach(() => {
    delete (globalThis as { self?: unknown }).self;
  });

  it('posts the navigator model first, then one mesh reply per phase', () => {
    fakeSelf.onmessage!({
      data: {
        caseId: 'normal-excellent-window',
        patient: { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 },
        stepCm: 0.6,
        phases: [0, 0.5],
      },
    });
    const posted = fakeSelf.postMessage.mock.calls.map((c) => c[0] as NavigatorModel | MeshReply);
    expect(posted.length).toBe(3);
    const model = posted[0] as NavigatorModel;
    expect(model.kind).toBe('model');
    expect(model.caseId).toBe('normal-excellent-window');
    expect(model.thorax.chestWall).toBeGreaterThan(0);
    expect(model.lvLengthCm).toBeGreaterThan(5);
    expect(model.ghost.length).toBeGreaterThan(3);
    expect(Number.isFinite(model.frame.origin.x)).toBe(true);
    for (const [i, reply] of (posted.slice(1) as MeshReply[]).entries()) {
      expect(reply.index).toBe(i);
      expect(reply.total).toBe(2);
      expect(reply.groups.length).toBeGreaterThan(3);
    }
  });
});
