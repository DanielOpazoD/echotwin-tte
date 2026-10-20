// @tier fast
/**
 * The stylesheet stays one system (decision 339). PR 173 rewrote it by appending overrides: 34 selectors were defined two
 * to four times (the later rule winning), radii took 13 pixel values beside the token scale, 12.5 px sat off the type
 * scale, and literal slate greys and whites painted light surfaces under the dark room mode (decision 205), where the
 * case history and the preset views' names turned light on light. Checked here, on the source:
 *  - no top-level selector is defined twice;
 *  - every radius comes from the scale (--r-xs/sm/md/lg), or is a circle, a pill, 0 or inherited;
 *  - every font size comes from the type scale (--fs-*) or is a pixel size of at least 12 (decision 198; SVG text in a
 *    scaled viewBox is in user units and is listed apart);
 *  - no surface or border takes a literal light grey or white: they follow the theme's tokens (white stays only on the
 *    physical knobs and thumbs of switches and sliders).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');
const root = postcss.parse(css);
const rules: Rule[] = [];
root.walkRules((r) => {
  if (
    !r.parent ||
    r.parent.type === 'root' ||
    (r.parent.type === 'atrule' && (r.parent as { name?: string }).name === 'media')
  )
    rules.push(r);
});
const where = (r: Rule): string =>
  `${r.selector.replace(/\s+/g, ' ')} (line ${r.source?.start?.line})`;

/** SVG text sized in viewBox user units, not CSS pixels. */
const SVG_TEXT = new Set(['.segment-panel .bullseye-dir']);
const RADIUS_OK = /^(var\(--r-(xs|sm|md|lg)\)|50%|999px|0|inherit)$/;
const SIZE_OK = /^var\(--fs-(xs|caps|sm|md|lg|xl)\)$/;
/** A literal light, nearly neutral grey or white: every channel at least 0xc0 and within 0x24 of each other. */
function lightGrey(value: string): string | null {
  for (const m of value.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
    const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    if (Math.min(...c) >= 0xc0 && Math.max(...c) - Math.min(...c) <= 0x24) return m[0];
  }
  return null;
}
/**
 * Icons drawn in CSS (the brand mark, the segments' bullseye), the physical knobs and thumbs, and the review markers'
 * number chips (dark figures on a fixed marker colour) keep their own colours in both themes.
 */
const DRAWN = /brand-mark|img-seg-icon|knob|thumb|review-n/;

describe('the stylesheet is one system (decision 339)', () => {
  it('defines each top-level selector once', () => {
    const seen = new Map<string, number>();
    const dup: string[] = [];
    root.each((n) => {
      if (n.type !== 'rule') return;
      const k = n.selectors.map((s) => s.trim()).join(', ');
      if (seen.has(k)) dup.push(`${k} (lines ${seen.get(k)} and ${n.source?.start?.line})`);
      else seen.set(k, n.source?.start?.line ?? 0);
    });
    expect(dup).toEqual([]);
  });

  it('takes every radius from the scale', () => {
    const off: string[] = [];
    for (const r of rules)
      r.walkDecls('border-radius', (d) => {
        if (!d.value.split(/\s+/).every((v) => RADIUS_OK.test(v)))
          off.push(`${where(r)}: ${d.value}`);
      });
    expect(off).toEqual([]);
  });

  it('takes every font size from the type scale, never under 12 px', () => {
    const off: string[] = [];
    for (const r of rules)
      r.walkDecls('font-size', (d) => {
        if (SIZE_OK.test(d.value) || SVG_TEXT.has(r.selector.replace(/\s+/g, ' '))) return;
        const px = /^(\d+(?:\.\d+)?)px$/.exec(d.value);
        if (!px || Number(px[1]) < 12 || !Number.isInteger(Number(px[1])))
          off.push(`${where(r)}: ${d.value}`);
      });
    expect(off).toEqual([]);
  });

  it('paints no surface or border with a literal light grey or white', () => {
    const off: string[] = [];
    for (const r of rules) {
      if (r.selector.trim() === ':root') continue;
      if (DRAWN.test(r.selector)) continue;
      r.walkDecls(
        /^(background|background-color|border|border-(top|right|bottom|left)|border(-[a-z]+)?-color|outline)$/,
        (d) => {
          const grey = lightGrey(d.value);
          if (grey) off.push(`${where(r)}: ${d.prop}: ${grey}`);
        },
      );
    }
    expect(off).toEqual([]);
  });

  it('paints the Dev panel with the theme’s surface and text (decision 357)', () => {
    // a fixed dark surface under the light theme's dark text read dark on dark
    const dev = rules.find((r) => r.selector.trim() === '.dev')!;
    const decl = (prop: string) => {
      let v = '';
      dev.walkDecls(prop, (d) => {
        v = d.value;
      });
      return v;
    };
    expect(decl('background')).toMatch(/^var\(--/);
    expect(decl('color')).toMatch(/^var\(--/);
    // and its chosen buttons are filled with the accent, as a primary button
    const chosen = rules.find((r) => r.selector.trim() === '.dev button.active');
    let fill = '';
    chosen?.walkDecls('background', (d) => {
      fill = d.value;
    });
    expect(fill).toBe('var(--accent)');
  });
});
