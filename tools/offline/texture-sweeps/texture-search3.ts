// Run from the texture worktree root. Grid over renders (smoothing, blood, noise are render/console-state knobs) and consoles.
// argv: ref.json  smooth(list lat/ax)  blood(list)  noise(list scale+q|+)  DR(list)  gain(list)
import { readFileSync } from 'node:fs';
import { imageStats, type ImageStats } from '@/clinical/regionStats';
import { presentApical, renderApical, type ConsoleOverride } from '@/simulator/renderer/clinicalImage';
import { COMPOUND, DISPLAY_SMOOTHING, POST_SMOOTHING } from '@/simulator/renderer/acoustic/psf';
import { BLOOD_ECHO } from '@/simulator/renderer/acoustic/acoustics';
import { CONSOLE_NOISE } from '@/simulator/renderer/postprocess/consolePipeline';
type Q = { median: number; p25: number; p75: number };
const ref = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Record<string, Record<string, Q>>;
const M: [string, (s: ImageStats) => number][] = [
  ['LV cavity grey (median)', (s) => s.cavity.median], ['LV myocardium grey (median)', (s) => s.myocardium.median], ['Left atrium grey (median)', (s) => s.atrium.median],
  ['Tissue/blood contrast (grey levels)', (s) => s.tissueBloodContrast], ['Myocardial local std (grey)', (s) => s.myocardialLocalStd], ['Myocardial detrended std (grey)', (s) => s.myocardialDetrendedStd],
  ['Speckle cell horizontal (mm)', (s) => s.speckleCellMm.horizontal], ['Speckle cell vertical (mm)', (s) => s.speckleCellMm.vertical],
  ['Cavity detrended std (grey)', (s) => s.cavityDetrendedStd],
];
const short = (m: string) => ({ 'LV cavity grey (median)': 'cav', 'LV myocardium grey (median)': 'myo', 'Left atrium grey (median)': 'la', 'Tissue/blood contrast (grey levels)': 'con', 'Myocardial local std (grey)': 'lstd', 'Myocardial detrended std (grey)': 'dstd', 'Speckle cell horizontal (mm)': 'ch', 'Speckle cell vertical (mm)': 'cv', 'Cavity detrended std (grey)': 'cstd' })[m]!;
const C = [['4CH-ED', 'a4c', true], ['4CH-ES', 'a4c', false], ['2CH-ED', 'a2c', true], ['2CH-ES', 'a2c', false]] as const;
const L = (i: number) => process.argv[i]!.split(',');
const rows: { cfg: string; score: number; out: number; txt: string }[] = [];
for (const sm of L(3)) for (const bl of L(4)) for (const cw of L(9)) {
  const [lat, ax] = sm.split('/').map(Number) as [number, number];
  DISPLAY_SMOOTHING.lateralMm = lat; DISPLAY_SMOOTHING.axialMm = ax; POST_SMOOTHING.lateralMm = 0; POST_SMOOTHING.axialMm = 0; BLOOD_ECHO.factor = Number(bl);
  COMPOUND.enabled = Number(cw) > 0; COMPOUND.weight = Number(cw);
  const renders = C.map(([k, v, ed]) => [k, renderApical('normal-excellent-window', v, ed)] as const);
  for (const nz of L(5)) {
    CONSOLE_NOISE.scale = parseFloat(nz); CONSOLE_NOISE.quadrature = nz.endsWith('q');
    for (const map of L(8)) for (const dr of L(6)) for (const g of L(7)) {
      const o: ConsoleOverride = { grayMap: map as 'linear' | 's-curve', dynamicRangeDb: Number(dr), gainDb: Number(g) };
      let score = 0, n = 0, out = 0; const outs: string[] = []; const vals: Record<string, string[]> = {};
      for (const [k, r] of renders) {
        const s = imageStats(presentApical(r, o));
        for (const [m, get] of M) {
          const q = ref[k]![m]!, v = get(s);
          score += Math.abs(v - q.median) / Math.max(1e-6, q.p75 - q.p25); n++;
          if (v < q.p25 || v > q.p75) { out++; outs.push(`${k.replace('CH-', '')}:${short(m)}`); }
          (vals[short(m)] ??= []).push(v.toFixed(m.includes('mm') || m.includes('std') ? 1 : 0));
        }
      }
      rows.push({ cfg: `psf ${sm} comp ${cw} blood ${bl} noise ${nz} ${map} DR ${dr} g ${g}`, score: score / n, out, txt: Object.entries(vals).map(([k, v]) => `${k} ${v.join('/')}`).join(' ') + ` | out ${outs.join(' ')}` });
    }
  }
  process.stderr.write(`done ${sm} ${bl} ${cw}\n`);
}
rows.sort((a, b) => a.score - b.score);
for (const r of rows.slice(0, Number(process.env['TOP'] ?? 10))) console.log(`${r.cfg.padEnd(44)} score ${r.score.toFixed(2)} out ${r.out}/36  ${r.txt}`);
