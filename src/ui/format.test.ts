import { describe, expect, it } from 'vitest';
import { formatMHz } from './format';

describe('formatMHz', () => {
  it('writes one decimal when exact and two when the quarter steps need them', () => {
    expect(formatMHz(2.5)).toBe('2.5 MHz');
    expect(formatMHz(3)).toBe('3.0 MHz');
    expect(formatMHz(2.25)).toBe('2.25 MHz');
    expect(formatMHz(4.75)).toBe('4.75 MHz');
  });
});
