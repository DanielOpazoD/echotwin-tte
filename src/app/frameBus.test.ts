import { describe, expect, it, vi } from 'vitest';
import { frameBus } from './frameBus';
import type { SimOutput } from '@/simulator/core/protocol';

describe('frame bus acknowledgement', () => {
  it('acknowledges frames at once while no display is mounted, so the worker keeps delivering', () => {
    const recycle = vi.fn();
    frameBus.recycle = recycle;
    const close = vi.fn();
    const buffer = new ArrayBuffer(0);
    frameBus.emit({ rgba: buffer, bitmap: { close } } as unknown as SimOutput);
    expect(recycle).toHaveBeenCalledWith(buffer);
    expect(close).toHaveBeenCalledTimes(1);
    const seen: SimOutput[] = [];
    const unsubscribe = frameBus.subscribe((o) => seen.push(o));
    frameBus.emit({ rgba: buffer, bitmap: { close } } as unknown as SimOutput);
    unsubscribe();
    expect(seen).toHaveLength(1);
    // with a display mounted, the display acknowledges after drawing
    expect(recycle).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
