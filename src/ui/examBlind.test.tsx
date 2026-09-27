// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ImageHud } from './ImageHud';
import { ReportScreen } from './ReportScreen';
import { MeasurementPanel } from './MeasurementPanel';
import { ConsolePanel } from './ConsolePanel';
import { useHudStore, useSimStore } from '@/app/store';
import { exportCaseTag } from '@/app/modePolicy';
import { listCases, loadCaseById } from '@/cases';

/**
 * A case's title is its diagnosis, and so are the measurements it requires (decision 234). During an exam the image, the
 * case selector, the report and the measurement list named it — «Estenosis aórtica severa con flujo conservado» over the
 * image of the case the learner was asked to diagnose. Nothing names the case until the exam is finished.
 */
const initialSim = useSimStore.getState();
const initialHud = useHudStore.getState();
const CASE = 'aortic-stenosis-severe';
const names = listCases().flatMap((c) => [c.title, c.id]);
// the views this case requires and not every case does (a view every case requires names nothing)
const everyCase = (v: string) =>
  listCases().every((c) => loadCaseById(c.id).requiredViews.some((r) => r.viewId === v));
const telltaleViews = loadCaseById(CASE)
  .requiredViews.map((r) => r.viewId)
  .filter((v) => !everyCase(v));

function seed(examFinished: boolean) {
  useSimStore.setState({ mode: 'exam', examFinished, caseId: CASE });
  useHudStore.setState({
    hud: {
      heartRateBpm: 72,
      simulatedFps: 30,
      colorFps: 0,
      view: { bestViewId: 'a5c', score: 80 },
    } as never,
  });
}

beforeEach(() => {
  cleanup();
  useSimStore.setState(initialSim, true);
  useHudStore.setState(initialHud, true);
});

describe('the exam does not name the case (decision 234)', () => {
  it('the image, the console, the report and the measurement list show no case title or id', () => {
    expect(telltaleViews.length, 'the case requires views others do not').toBeGreaterThan(0);
    seed(false);
    const shown: string[] = [];
    for (const [label, node] of [
      ['image', <ImageHud key="h" />],
      ['console', <ConsolePanel key="c" />],
      ['report', <ReportScreen key="r" />],
      ['measurements', <MeasurementPanel key="m" />],
    ] as const) {
      const { container, unmount } = render(node);
      const text = container.textContent ?? '';
      for (const n of names) if (text.includes(n)) shown.push(`${label}: «${n}»`);
      if (text.includes('Requeridas por el caso'))
        shown.push(`${label}: the case's required measurements`);
      // the report's list of the views a case requires names it too: the aortic short axis and the A5C of a stenosis
      // (clean-context review); the console names every view for its presets
      if (label === 'report')
        for (const v of telltaleViews)
          if (text.includes(v.toUpperCase())) shown.push(`${label}: required view ${v}`);
      unmount();
    }
    expect(shown).toEqual([]);
  });

  it('an image saved during the exam is not named after the case', () => {
    expect(exportCaseTag('exam', false, CASE)).toBe('examen');
    expect(exportCaseTag('exam', true, CASE)).toBe(CASE);
    expect(exportCaseTag('sandbox', false, CASE)).toBe(CASE);
  });

  it('names it again once the exam is finished, for the debrief', () => {
    seed(true);
    const title = listCases().find((c) => c.id === CASE)!.title;
    const { container } = render(<ImageHud />);
    expect(container.textContent).toContain(title);
  });
});
