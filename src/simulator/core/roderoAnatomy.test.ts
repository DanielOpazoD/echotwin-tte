// @tier slow
/**
 * The experimental anatomy in the simulator core (decision 352): chosen, the core loads the shipped Rodero heart and draws
 * it with the CPU tracer, the GPU port not reading it; back to the analytic heart, the usual backend again.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { baseInput } from './baseInput';
import { SimulatorCore } from './simulatorCore';

const fromPublic = (path: string): Promise<ArrayBuffer> => {
  const b = readFileSync(join(process.cwd(), 'public', path));
  return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe('experimental Rodero anatomy in the core (decision 352)', () => {
  it('loads the shipped heart, draws it with the CPU tracer and gives the backend back when left', async () => {
    const c = loadCaseById('normal-excellent-window');
    const input = baseInput({ rendererBackend: 'atlas' });
    const core = new SimulatorCore(c, input, { fetchAsset: fromPublic });
    try {
      const probe = canonicalControl(getViewTarget('a4c'), core.models.heart, core.models.thorax);
      core.setInput({ ...input, probe });
      const analytic = core.step(0)!;
      expect(analytic.stats['anatomy']).toBe('analítica');
      core.setInput({ ...input, probe, anatomy: 'rodero' });
      await core.roderoReady();
      const rodero = core.step(0.2)!;
      expect(rodero.stats['anatomy']).toBe('Rodero (CPU)');
      expect(rodero.stats['backend']).toBe('procedural');
      // another heart in the same plane
      let differ = 0;
      for (let i = 0; i < rodero.structure.length; i++)
        if (rodero.structure[i] !== analytic.structure[i]) differ++;
      expect(differ / rodero.structure.length).toBeGreaterThan(0.05);
      core.setInput({ ...input, probe });
      const back = core.step(0.2)!;
      expect(back.stats['anatomy']).toBe('analítica');
      expect(back.stats['backend']).toBe('atlas');
    } finally {
      core.dispose();
    }
  });

  it('says so when the volume cannot be fetched, and keeps drawing the analytic heart', async () => {
    const c = loadCaseById('normal-excellent-window');
    const input = baseInput({ anatomy: 'rodero' });
    const core = new SimulatorCore(c, input, {
      fetchAsset: () => Promise.reject(new Error('sin red')),
    });
    try {
      await core.roderoReady();
      const out = core.step(0)!;
      expect(String(out.stats['anatomy'])).toMatch(/error.*sin red/);
      expect(out.structure.length).toBeGreaterThan(0);
    } finally {
      core.dispose();
    }
  });
});
