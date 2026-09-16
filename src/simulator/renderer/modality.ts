import type { ImagingModality } from './types';

/**
 * One description per imaging modality, the single place that says what a modality is (engineering audit,
 * C3): before, every consumer re-derived «is it a strip?», «does it have a gate?», «is it Doppler?» from
 * literal comparisons in ~10 files, so adding a modality meant finding all of them. The core, the strip
 * engine, the display canvas, the console and the mode bar read these flags instead.
 */
export interface ModalityDescriptor {
  id: ImagingModality;
  /** Short label of the mode bar. */
  label: string;
  /** Full name for section titles. */
  name: string;
  /** Keyboard shortcut as shown to the user (app/shortcuts.ts binds it). */
  key: string;
  /** The strip drawn under the sector, if any. */
  strip: 'spectral' | 'm-mode' | null;
  /** Any Doppler processing (colour field or spectral estimate) is on. */
  doppler: boolean;
  /** Spectral Doppler: strip with a velocity axis, auto-envelope and audio. */
  spectral: boolean;
  /** A sample volume at a depth on the cursor (PW/TDI); CW integrates the whole line. */
  gate: boolean;
  /** A colour field is computed over the colour box. */
  colorField: boolean;
  /** Velocities on this modality's strip are shown in these units. */
  velocityUnits: 'm/s' | 'cm/s';
  /** Spectral estimate folds at the scale (CW does not). */
  aliasing: boolean;
}

export const MODALITIES: Readonly<Record<ImagingModality, ModalityDescriptor>> = {
  '2d': {
    id: '2d',
    label: '2D',
    name: 'Modo B',
    key: '2',
    strip: null,
    doppler: false,
    spectral: false,
    gate: false,
    colorField: false,
    velocityUnits: 'm/s',
    aliasing: false,
  },
  color: {
    id: 'color',
    label: 'Color',
    name: 'Doppler color',
    key: 'C',
    strip: null,
    doppler: true,
    spectral: false,
    gate: false,
    colorField: true,
    velocityUnits: 'm/s',
    aliasing: true,
  },
  'm-mode': {
    id: 'm-mode',
    label: 'M',
    name: 'Modo M',
    key: 'M',
    strip: 'm-mode',
    doppler: false,
    spectral: false,
    gate: false,
    colorField: false,
    velocityUnits: 'm/s',
    aliasing: false,
  },
  cmm: {
    id: 'cmm',
    label: 'CMM',
    name: 'Modo M color',
    key: 'Shift+M',
    strip: 'm-mode',
    doppler: true,
    spectral: false,
    gate: false,
    colorField: true,
    velocityUnits: 'm/s',
    aliasing: true,
  },
  pw: {
    id: 'pw',
    label: 'PW',
    name: 'Doppler pulsado',
    key: 'P',
    strip: 'spectral',
    doppler: true,
    spectral: true,
    gate: true,
    colorField: false,
    velocityUnits: 'm/s',
    aliasing: true,
  },
  cw: {
    id: 'cw',
    label: 'CW',
    name: 'Doppler continuo',
    key: 'X',
    strip: 'spectral',
    doppler: true,
    spectral: true,
    gate: false,
    colorField: false,
    velocityUnits: 'm/s',
    aliasing: false,
  },
  tdi: {
    id: 'tdi',
    label: 'TDI',
    name: 'Doppler tisular',
    key: 'T',
    strip: 'spectral',
    doppler: true,
    spectral: true,
    gate: true,
    colorField: false,
    velocityUnits: 'cm/s',
    aliasing: true,
  },
};

/** In the order the mode bar shows them. */
export const MODALITY_LIST: readonly ModalityDescriptor[] = [
  MODALITIES['2d'],
  MODALITIES.color,
  MODALITIES['m-mode'],
  MODALITIES.cmm,
  MODALITIES.pw,
  MODALITIES.cw,
  MODALITIES.tdi,
];

export const isStripModality = (m: ImagingModality): boolean => MODALITIES[m].strip !== null;
export const isSpectralModality = (m: ImagingModality): boolean => MODALITIES[m].spectral;
export const hasGate = (m: ImagingModality): boolean => MODALITIES[m].gate;
