import { describe, expect, it } from 'vitest';
import { canvasFont, MIN_CANVAS_FONT_PX } from './canvasFonts';

describe('canvas fonts', () => {
  it('never draw text under the smallest size of the stylesheet', () => {
    expect(MIN_CANVAS_FONT_PX).toBe(12);
    expect(canvasFont(9.5)).toMatch(/^12px /);
    expect(canvasFont(10, 'mono')).toMatch(/^12px /);
    expect(canvasFont(14, 'ui', 600)).toMatch(/^600 14px /);
  });
});
