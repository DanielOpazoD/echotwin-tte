/**
 * Physical parameters of the simulated adult sector probe, shared by the image formation (renderer/acoustic/psf.ts:
 * lateral beam width) and the spectral Doppler (doppler/spectral/spectrum.ts: geometric spectral broadening).
 * They live in `probe` so neither engine has to import the other.
 */
/** Active aperture (mm). */
export const APERTURE_MM = 14;
