import { describe, expect, it } from 'vitest';
import {
  hasGate,
  isSpectralModality,
  isStripModality,
  MODALITIES,
  MODALITY_LIST,
} from './modality';
import type { ImagingModality } from './types';

const ALL: ImagingModality[] = ['2d', 'm-mode', 'cmm', 'color', 'pw', 'cw', 'tdi'];

describe('modality descriptors', () => {
  it('describe every modality once, in the mode-bar list', () => {
    expect(new Set(MODALITY_LIST.map((d) => d.id))).toEqual(new Set(ALL));
    for (const id of ALL) expect(MODALITIES[id].id).toBe(id);
  });

  it('keep the flags consistent with each other', () => {
    for (const d of MODALITY_LIST) {
      // a spectral modality is a spectral strip; a gate belongs to a spectral modality; colour fields are Doppler
      if (d.spectral) expect(d.strip).toBe('spectral');
      if (d.gate) expect(d.spectral).toBe(true);
      if (d.colorField) expect(d.doppler).toBe(true);
      if (d.spectral) expect(d.doppler).toBe(true);
      // only the tissue Doppler reads in cm/s
      expect(d.velocityUnits === 'cm/s').toBe(d.id === 'tdi');
    }
  });

  it('has unique shortcuts and labels', () => {
    expect(new Set(MODALITY_LIST.map((d) => d.key)).size).toBe(MODALITY_LIST.length);
    expect(new Set(MODALITY_LIST.map((d) => d.label)).size).toBe(MODALITY_LIST.length);
  });

  it('answers the questions the code used to re-derive', () => {
    expect(ALL.filter(isStripModality)).toEqual(['m-mode', 'cmm', 'pw', 'cw', 'tdi']);
    expect(ALL.filter(isSpectralModality)).toEqual(['pw', 'cw', 'tdi']);
    expect(ALL.filter(hasGate)).toEqual(['pw', 'tdi']);
    expect(MODALITIES.cw.aliasing).toBe(false);
  });
});
