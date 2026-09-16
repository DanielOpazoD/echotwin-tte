/**
 * Colour Doppler map and overlay blend, shared by the CPU overlay (doppler/color/colorDoppler.ts
 * `overlayColorField`) and the GPU present pass (gpu/glslImage.ts): the constants below reach the shader as
 * `#define`s from `colorMapDefinesGlsl`, so neither side carries its own copy of the numbers.
 */
export const COLOR_MAP = {
  /** Base level and range of the dominant channel (red toward, blue away). */
  DOMINANT_BASE: 120,
  DOMINANT_RANGE: 135,
  DOMINANT_GAIN: 1.2,
  /** Green channel: base per direction, range and the |t| knee above which it brightens. */
  GREEN_BASE_TOWARD: 20,
  GREEN_BASE_AWAY: 40,
  GREEN_RANGE_TOWARD: 220,
  GREEN_RANGE_AWAY: 200,
  GREEN_KNEE: 0.55,
  GREEN_GAIN: 2.2,
  /** Level of the quiet channel. */
  QUIET: 20,
  /** Variance display: threshold, slope, the green it tends to and how much the other channels fade. */
  VARIANCE_MIN: 0.15,
  VARIANCE_GAIN: 1.5,
  VARIANCE_GREEN: 230,
  VARIANCE_FADE: 0.4,
} as const;

/** Colour over grey inside the colour box: this much colour, the rest grey. */
export const COLOR_BLEND = 0.85;

/** Velocity → RGB (red toward, blue away; brighter = faster; green = variance). */
export function colorMap(
  v: number,
  scale: number,
  variance: number,
  showVariance: boolean,
  out: [number, number, number],
): void {
  const M = COLOR_MAP;
  const t = Math.max(-1, Math.min(1, v / scale));
  const a = Math.abs(t);
  const dominant = M.DOMINANT_BASE + M.DOMINANT_RANGE * Math.min(1, a * M.DOMINANT_GAIN);
  if (t >= 0) {
    out[0] = dominant;
    out[1] =
      M.GREEN_BASE_TOWARD + M.GREEN_RANGE_TOWARD * Math.max(0, a - M.GREEN_KNEE) * M.GREEN_GAIN;
    out[2] = M.QUIET;
  } else {
    out[0] = M.QUIET;
    out[1] = M.GREEN_BASE_AWAY + M.GREEN_RANGE_AWAY * Math.max(0, a - M.GREEN_KNEE) * M.GREEN_GAIN;
    out[2] = dominant;
  }
  if (showVariance && variance > M.VARIANCE_MIN) {
    const g = Math.min(1, (variance - M.VARIANCE_MIN) * M.VARIANCE_GAIN);
    out[1] = out[1] * (1 - g) + M.VARIANCE_GREEN * g;
    out[0] = out[0] * (1 - g * M.VARIANCE_FADE);
    out[2] = out[2] * (1 - g * M.VARIANCE_FADE);
  }
}

const glslFloat = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/** `#define CM_<NAME>` for every colour-map constant plus `COLOR_BLEND`. */
export function colorMapDefinesGlsl(): string {
  return [
    ...Object.entries(COLOR_MAP).map(([k, v]) => `#define CM_${k} ${glslFloat(v)}`),
    `#define COLOR_BLEND ${glslFloat(COLOR_BLEND)}`,
  ].join('\n');
}
