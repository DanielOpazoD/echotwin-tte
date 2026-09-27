// @tier slow
import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listCases, loadCaseById } from '@/cases';
import { baseInput } from '@/simulator/core/baseInput';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { renderApical } from './clinicalImage';
import { ProceduralSliceRenderer } from './procedural/sliceRenderer';
import type { ScenePhysics } from './types';

/**
 * One scene physics (decision 238): the clinical calibration, the goldens, the backend comparison and the offline tools
 * each wrote their own, without the case's near-field clutter, so the normal case was calibrated against CAMUS with a
 * clutter of 0.10 while the app showed it with 0.28. The physics is read where it is used, in the renderer's call.
 */
function physicsOfFirstRender(run: () => void): ScenePhysics {
  const spy = vi.spyOn(ProceduralSliceRenderer.prototype, 'render');
  try {
    run();
    expect(spy).toHaveBeenCalled();
    return spy.mock.calls[0]![0].physics;
  } finally {
    spy.mockRestore();
  }
}

describe('one scene physics (decision 238)', () => {
  it.each(listCases().map((c) => c.id))(
    '%s: the clinical calibration renders with the physics the app renders',
    (id) => {
      const c = loadCaseById(id);
      const app = physicsOfFirstRender(() => new SimulatorCore(c, baseInput()).step(1 / 30));
      const calibration = physicsOfFirstRender(() => renderApical(id, 'a4c', true));
      // the flowing blood's frame is the console's frame counter in the app and the first frame in the calibration
      const { bloodFrame: _app, ...appPhysics } = app;
      const { bloodFrame: _cal, ...calibrationPhysics } = calibration;
      expect(calibrationPhysics).toEqual(appPhysics);
    },
    120_000,
  );

  it('no module outside scenePhysics.ts writes a scene physics of its own (src/, tools/, the goldens)', () => {
    const OWN = new Set([
      'src/simulator/renderer/scenePhysics.ts',
      'src/simulator/renderer/types.ts',
    ]);
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
        // a physics literal gives the window attenuation a value; the renderer only copies the one it was given, and a
        // type only declares it
        if (/\bwindowAttenuation\s*:(?!\s*(?:physics\.|number\b))/.test(readFileSync(p, 'utf8')))
          offenders.push(rel);
      }
    };
    for (const dir of ['src', 'tools']) walk(join(process.cwd(), dir));
    expect(offenders, 'build the scene physics with scenePhysicsFor').toEqual([]);
  });
});
