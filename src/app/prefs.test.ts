import { describe, expect, it } from 'vitest';
import { PERSISTED_PREF_KEYS, parsePrefs, pickPrefs, type PersistedPrefs } from './prefs';
import { useSimStore } from './store';

describe('persisted preferences', () => {
  it('keep valid keys and drop unknown keys, wrong types and values outside an enum', () => {
    const parsed = parsePrefs({
      showTorso: false,
      consoleTab: 'doppler',
      segmentModel: 'LV_99',
      navSkin: 'yes',
      truth: { lv: 1 },
      screen: 'report',
      guidanceOpen: true,
    });
    expect(parsed).toEqual({ showTorso: false, consoleTab: 'doppler' });
  });
  it('read nothing from a value that is not an object', () => {
    for (const raw of [null, 3, 'x', [true], undefined]) expect(parsePrefs(raw)).toEqual({});
  });
  it('round-trip: what is saved from the store is read back whole', () => {
    const ui = useSimStore.getState().ui as unknown as PersistedPrefs;
    const saved = JSON.parse(JSON.stringify(pickPrefs(ui))) as unknown;
    const back = parsePrefs(saved);
    expect(Object.keys(back).sort()).toEqual([...PERSISTED_PREF_KEYS].sort());
    for (const k of PERSISTED_PREF_KEYS) expect(back[k]).toEqual(ui[k]);
  });
});
