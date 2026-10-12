import { describe, expect, it } from 'vitest';
import { PROGRESS_KEY, loadProgress, type ProgressStorage } from './progress';

const storageWith = (value: unknown): ProgressStorage => ({
  getItem: (k) => (k === PROGRESS_KEY ? JSON.stringify(value) : null),
  setItem: () => {},
});

describe('loadProgress', () => {
  it('keeps the valid events and drops the malformed ones one by one', () => {
    const p = loadProgress(
      storageWith({
        version: 1,
        completedTasks: { 'plax-70': 5, bad: 'x' },
        events: [
          { t: 1, kind: 'case', caseId: 'normal-excellent-window' },
          { t: 2, kind: 'view', caseId: 'c', viewId: 'plax', score: '90' },
          { t: 3, kind: 'unknown' },
          'junk',
          { t: 4, kind: 'task', taskId: 'plax-70' },
        ],
      }),
    );
    expect(p.events.map((e) => e.t)).toEqual([1, 4]);
    // a task map with a non-numeric entry is not trusted as a whole
    expect(p.completedTasks).toEqual({});
  });
  it('starts empty from another version or a value that is not an object', () => {
    expect(loadProgress(storageWith({ version: 2, events: [] })).events).toEqual([]);
    expect(loadProgress(storageWith('text')).events).toEqual([]);
    expect(loadProgress(storageWith(null)).events).toEqual([]);
  });
});
