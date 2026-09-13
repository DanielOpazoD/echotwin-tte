import type { SimInput } from './protocol';
import { DEFAULT_ACQUISITION } from '@/simulator/renderer/types';
import { DEFAULT_COLOR } from '@/simulator/doppler/color/colorDoppler';
import { DEFAULT_SPECTRAL } from '@/simulator/doppler/spectral/spectrum';

/**
 * A complete SimInput with the default acquisition, for tests and offline measurement scripts. It lives outside any
 * *.test.ts file on purpose: importing it from simulatorCore.test.ts made every importer re-run that file's smoke
 * tests, so the 30-second core smoke test ran twice per suite.
 */
export function baseInput(over: Partial<SimInput> = {}): SimInput {
  return {
    probe: { u: 3.4, v: 0.4, rotationDeg: 25, tiltDeg: 6, rockDeg: -4, pressure: 0.55 },
    patient: { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 },
    settings: { ...DEFAULT_ACQUISITION, tgcDb: [...DEFAULT_ACQUISITION.tgcDb] },
    modality: '2d',
    frozen: false,
    cineOffset: 0,
    color: { ...DEFAULT_COLOR },
    spectral: { ...DEFAULT_SPECTRAL },
    cursorThetaRad: 0,
    gateDepthCm: 9,
    quality: 'low',
    display: { width: 320, height: 260 },
    rendererBackend: 'procedural',
    artifactOverrides: null,
    ...over,
  };
}
