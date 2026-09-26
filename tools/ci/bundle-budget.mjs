// Bundle budget: fails the build when a JavaScript asset in dist/ outgrows its limit. Plain Node so it
// runs after `vite build` without tsx. Budgets are ~15 % above the sizes measured on 2026-09-16 (entry
// 703 kB, three 528 kB, workers 255/177 kB) after the navigator, the secondary screens and the backend
// comparison moved to lazy chunks (engineering audit, B4); raise a budget only on purpose, in the same
// change that explains the growth.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(process.cwd(), 'dist', 'assets');
const KB = 1024;
/** [pattern, max bytes]; every JS asset must match one pattern. */
const BUDGETS = [
  // entry: the imaging app without three.js, the secondary screens, the backend-comparison hook and — since the
  // navigator model comes from the mesh worker and the inline core loads on demand (audit B7) — without the
  // anatomy engine: 499 kB measured on 2026-09-16, down from 703 kB.
  [/^index-.*\.js$/, 575 * KB],
  [/^three-.*\.js$/, 600 * KB], // three.js, loaded with the navigator
  [/^react-.*\.js$/, 40 * KB],
  [/^TorsoView-.*\.js$/, 60 * KB],
  [/^sim\.worker-.*\.js$/, 320 * KB],
  // the WebGL2 port and its shaders: shared by the simulation worker and the lazy backend comparison. 119.7 kB at
  // decision 151; the LV segment code in GLSL and its read-back (decision 152) took it to 121.0 kB; the mirrors of the
  // right atrium beside the root and the membranous septum, the open venae cavae, the septal tricuspid hinge and the
  // pleura whose incidence comes from the neighbouring lines (decisions 218-222) to 128.1 kB, 127.3 kB once the comments
  // those shaders carried in the bundle were cut to their decision numbers; 132.0 kB at decision 227, and 114.8 kB since
  // the build strips the shaders' comments and indentation (decision 228), which leaves the budget 15 % above it
  [/^webgl2Renderer-.*\.js$/, 132 * KB],
  [/^heartMesh\.worker-.*\.js$/, 220 * KB],
  [/^(ReportScreen|CurriculumScreen|ProgressScreen|ReferencesScreen)-.*\.js$/, 80 * KB],
  [/\.js$/, 80 * KB], // any other chunk Rollup splits out
];
const TOTAL_JS_BUDGET = 2000 * KB;

let files;
try {
  files = readdirSync(DIST).filter((f) => f.endsWith('.js'));
} catch {
  console.error(`bundle-budget: ${DIST} not found; run vite build first`);
  process.exit(1);
}
let total = 0;
let failed = false;
for (const f of files.sort()) {
  const size = statSync(join(DIST, f)).size;
  total += size;
  const budget = BUDGETS.find(([re]) => re.test(f))?.[1] ?? 0;
  const over = size > budget;
  failed ||= over;
  console.log(
    `${over ? 'OVER ' : 'ok   '} ${f.padEnd(34)} ${(size / KB).toFixed(1).padStart(7)} kB / ${(budget / KB).toFixed(0)} kB`,
  );
}
console.log(
  `      total JS ${(total / KB).toFixed(1)} kB / ${(TOTAL_JS_BUDGET / KB).toFixed(0)} kB`,
);
if (total > TOTAL_JS_BUDGET) failed = true;
if (failed) {
  console.error('bundle-budget: over budget (tools/ci/bundle-budget.mjs)');
  process.exit(1);
}
