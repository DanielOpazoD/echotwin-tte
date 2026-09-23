// @tier slow
import { describe, expect, it } from 'vitest';
import { serialize } from 'node:v8';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';
import { frameTransferList, type SimOutput } from './protocol';

/**
 * What a frame costs to send to the main thread (decision 173): the buffers `frameTransferList` names travel
 * transferred, everything else is cloned. The structure and segment maps and the ECG's 1200 point objects were cloned in
 * every frame, 73 KiB at medium quality (the expert panel measured 66). The transferred buffers must be the frame's own,
 * or transferring them would detach the core's.
 */
function frame(): { core: SimulatorCore; out: SimOutput } {
  const core = new SimulatorCore(
    loadCaseById('normal-excellent-window'),
    baseInput({ quality: 'medium' }),
  );
  let out: SimOutput | null = null;
  for (let i = 0; i < 80; i++) out = core.step(1 / 30) ?? out;
  return { core, out: out! };
}

describe('a frame travels mostly transferred (decision 173)', () => {
  it(
    'clones less than 40 KiB besides the buffers it transfers, which are its own',
    // 166 s with coverage on the loaded CI runner (pipeline of main a7048aa)
    { timeout: 300_000 },
    () => {
      const { core, out } = frame();
      const transferred = new Set<unknown>(frameTransferList(out));
      expect(transferred.has(out.structure.buffer)).toBe(true);
      expect(transferred.has(out.ecg.buffer)).toBe(true);
      let cloned = 0;
      for (const [k, v] of Object.entries(out)) {
        if (
          v instanceof ArrayBuffer
            ? transferred.has(v)
            : ArrayBuffer.isView(v) && transferred.has(v.buffer)
        )
          continue;
        if (k === 'bitmap') continue;
        cloned += serialize(v).length;
      }
      expect(cloned / 1024).toBeLessThan(40);
      // the maps and the ECG are copies: writing to them leaves the core's frame as it was
      const before = core.lastFrame!.structure[0]!;
      out.structure[0] = (before + 1) % 256;
      expect(core.lastFrame!.structure[0]).toBe(before);
      expect(out.ecg.length % 2).toBe(0);
      expect(out.ecg.length).toBeGreaterThan(2);
    },
  );
});
