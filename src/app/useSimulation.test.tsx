// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

// the hook's client, recorded instead of simulating: the test is about how often a case is loaded
const calls = vi.hoisted(() => ({ load: [] as string[], dispose: 0 }));
vi.mock('@/simulator/core/client', () => ({
  SimClient: class {
    mode = 'inline';
    loadCase(c: { id: string }): Promise<void> {
      calls.load.push(c.id);
      return Promise.resolve();
    }
    send(): void {}
    recycle(): void {}
    request(): Promise<null> {
      return Promise.resolve(null);
    }
    dispose(): void {
      calls.dispose++;
    }
  },
}));

import { useSimulation } from './useSimulation';
import { useSimStore } from './store';

function Harness(): null {
  useSimulation({ width: 320, height: 240 }, () => {});
  return null;
}

/**
 * One case load per case (decision 172): the mount loaded the case and the case effect, which runs after it, loaded it
 * again, so the worker built the first core twice (the panel counted 2 `loadCase` at start).
 */
describe('useSimulation loads each case once', () => {
  afterEach(() => {
    cleanup();
    calls.load.length = 0;
    calls.dispose = 0;
  });

  it('once at mount, again only for another case, and disposes its client on unmount', () => {
    const start = useSimStore.getState().caseId;
    const view = render(<Harness />);
    expect(calls.load).toEqual([start]);
    act(() => useSimStore.getState().loadCase('aortic-stenosis-severe'));
    expect(calls.load).toEqual([start, 'aortic-stenosis-severe']);
    act(() => useSimStore.getState().loadCase('aortic-stenosis-severe'));
    expect(calls.load).toHaveLength(2);
    view.unmount();
    expect(calls.dispose).toBe(1);
    act(() => useSimStore.getState().loadCase(start));
  });
});
