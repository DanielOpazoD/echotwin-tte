// @tier slow
/**
 * The experimental image in the simulator core (decision 354): chosen, the core loads the convolution image formation
 * and forms the frames with it, the same anatomy in a different speckle; back to the lattice, the lattice again.
 */
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import type { SimInput } from './protocol';
import { baseInput } from './baseInput';
import { SimulatorCore } from './simulatorCore';

describe('experimental image formation in the core (decision 354)', () => {
  it('loads the convolution image, forms the frames with it and gives the lattice back when left', async () => {
    const c = loadCaseById('normal-excellent-window');
    const input = baseInput({ rendererBackend: 'procedural' });
    const a = new SimulatorCore(c, input),
      b = new SimulatorCore(c, input);
    const probe = canonicalControl(getViewTarget('a4c'), a.models.heart, a.models.thorax);
    /** The first frame of a core with the image formation chosen. */
    const firstFrame = async (core: SimulatorCore, extra: Partial<SimInput>) => {
      core.setInput({ ...input, probe, ...extra });
      await core.coleReady();
      return core.step(0)!;
    };
    try {
      const lattice = await firstFrame(a, {});
      expect(lattice.stats['imagen']).toBe('red');
      const cole = await firstFrame(b, { imageFormation: 'cole' });
      expect(cole.stats['imagen']).toBe('convolución');
      // the same anatomy, another image
      expect(Array.from(cole.structure)).toEqual(Array.from(lattice.structure));
      const pa = new Uint8ClampedArray(lattice.rgba),
        pb = new Uint8ClampedArray(cole.rgba);
      expect(pb.length).toBe(pa.length);
      expect(pa.length).toBeGreaterThan(0);
      let differ = 0;
      for (let i = 0; i < pa.length; i += 4) if (pa[i] !== pb[i]) differ++;
      expect(differ / (pa.length / 4)).toBeGreaterThan(0.2);
      b.setInput({ ...input, probe });
      expect(b.step(0.2)!.stats['imagen']).toBe('red');
    } finally {
      a.dispose();
      b.dispose();
    }
  });
});
