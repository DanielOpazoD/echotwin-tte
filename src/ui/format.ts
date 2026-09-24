/** Figures shown to the learner, formatted the same everywhere (decision 201). */

/** A transducer frequency: one decimal when that is exact («2.5 MHz»), two otherwise («2.25 MHz»). */
export function formatMHz(mhz: number): string {
  return `${Number.isInteger(Math.round(mhz * 1000) / 100) ? mhz.toFixed(1) : mhz.toFixed(2)} MHz`;
}
