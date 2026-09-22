import { loadavg, cpus } from 'node:os';

/**
 * The E2E suite runs the simulator on a software WebGL renderer with tight budgets (frames within 30 s, GPU
 * comparisons within 2 min). On this machine other sessions push the load average past 300, and then every
 * test fails at its first `waitForFrames` with nothing wrong in the working tree (2026-09-21: 6 of 6, all green
 * again at load 60). A run that starts on a saturated machine is not a test of the code, so it waits — up to
 * E2E_LOAD_WAIT_MIN minutes (default 20) — until the 1-minute load falls below E2E_MAX_LOAD (default 6 × the
 * CPU count, i.e. clearly beyond "busy"), reporting what it is waiting for; then it runs whatever the load is.
 */
export default async function globalSetup(): Promise<void> {
  const maxLoad = Number(process.env['E2E_MAX_LOAD'] ?? 6 * cpus().length);
  const waitMin = Number(process.env['E2E_LOAD_WAIT_MIN'] ?? 20);
  const deadline = Date.now() + waitMin * 60_000;
  let load = loadavg()[0] ?? 0;
  if (load <= maxLoad) return;
  process.stdout.write(
    `e2e: load average ${load.toFixed(0)} > ${maxLoad}; waiting up to ${waitMin} min for the machine to calm down\n`,
  );
  while (load > maxLoad && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 30_000));
    load = loadavg()[0] ?? 0;
  }
  process.stdout.write(
    load > maxLoad
      ? `e2e: still at load ${load.toFixed(0)} after ${waitMin} min; running anyway (failures may be load, not code)\n`
      : `e2e: load ${load.toFixed(0)}, starting\n`,
  );
}
