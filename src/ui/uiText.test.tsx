// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { ReportScreen } from './ReportScreen';
import { CurriculumScreen } from './CurriculumScreen';
import { ProgressScreen } from './ProgressScreen';
import { ConsolePanel } from './ConsolePanel';
import { TopBar } from './TopBar';
import { ModeBar } from './ModeBar';
import { ImageHud } from './ImageHud';
import { ReferencesScreen, USED_BY_LABEL } from './ReferencesScreen';
import { MeasurementPanel } from './MeasurementPanel';
import { ShortcutsDialog } from './ShortcutsDialog';
import { CaseCard } from './CaseCard';
import { useHudStore, useSimStore, type ConsoleTab } from '@/app/store';
import type { ProductMode } from '@/app/modePolicy';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';
import { VIEW_TARGETS } from '@/simulator/windows/viewDefinitions';
import { VIEW_LABELS } from '@/simulator/windows/viewLabels';
import { MEASUREMENT_SPECS } from '@/simulator/measurements/protocol';
import { MODALITIES } from '@/simulator/renderer/modality';
import { FINDINGS } from '@/education/impression';
import { GUIDELINE_REFERENCES } from '@/clinical/guidelines/references';
import type { Measurement } from '@/simulator/measurements/types';
import type { ImagingModality } from '@/simulator/renderer/types';

/**
 * What the screens say, read the way a learner and a screen reader read them (decision 259): no key of the code (the
 * case id in the report's title, «PSAX-PM», «subcostal-ivc», «m-mode», «title-verified») and no English word of the
 * interface (score, sandbox, freeze, live), and every control with a name. The text is collected node by node, with the
 * names, tooltips and labels a pointer or a screen reader gets, for every case, in practice, in the exam and after it.
 */
/** The screens that change with the case, read for every case… */
const CASE_SCREENS: Record<string, ComponentType> = {
  CaseCard,
  ReportScreen,
  ProgressScreen,
  ConsolePanel,
  ImageHud,
  MeasurementPanel,
};
/** …and those that do not, read once. */
const FIXED_SCREENS: Record<string, ComponentType> = {
  CurriculumScreen,
  TopBar,
  ModeBar,
  ReferencesScreen,
  ShortcutsDialog,
};
const SCREENS = { ...CASE_SCREENS, ...FIXED_SCREENS };
const CONSOLE_TABS: ConsoleTab[] = ['adquirir', 'imagen', 'doppler', 'medir', 'lab', 'revisar'];
/** Keys of the code: ids with a hyphen in any case, and the single-word ones written in lower case. */
const IDS = [
  ...CASE_INPUTS.map((c) => c.id),
  ...VIEW_TARGETS.map((v) => v.id),
  ...MEASUREMENT_SPECS.map((m) => m.id),
  ...FINDINGS.map((f) => f.id),
  // «color» is also the Spanish word, and «2d» is caught upper-cased as the label; the others are keys
  ...Object.keys(MODALITIES).filter((m) => m !== 'color' && m !== '2d'),
  ...Object.keys(USED_BY_LABEL),
  'verified-online',
  'title-verified',
  'not-verified',
];
const ENGLISH =
  /\b(score|sandbox|freeze|live|view|case|loading|undefined|null|NaN|true|false|LVOT|RVOT|IVC)\b/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function rawIds(line: string): string[] {
  return IDS.filter((id) =>
    id.includes('-') || /\s/.test(id)
      ? new RegExp(`(^|[^\\w-])${esc(id)}($|[^\\w-])`, 'i').test(line)
      : new RegExp(`(^|[^\\w-])${esc(id)}($|[^\\w-])`).test(line),
  );
}
/** The source titles are cited as published, in English, and their keys (ase-tte-2019) are citation keys. */
const CITED = new Set(GUIDELINE_REFERENCES.flatMap((r) => [r.title, r.notes ?? '', r.society]));
const CITATION_KEY = new RegExp(GUIDELINE_REFERENCES.map((r) => esc(r.id)).join('|'), 'g');

function shownText(c: HTMLElement): string[] {
  const out: string[] = [];
  const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const el = w.currentNode.parentElement;
    if (el?.closest('code')) continue; // file paths and keys shown as code on purpose
    out.push(w.currentNode.textContent ?? '');
  }
  for (const el of c.querySelectorAll('*'))
    for (const a of ['aria-label', 'title', 'data-tip', 'placeholder', 'alt'])
      if (el.getAttribute(a)) out.push(el.getAttribute(a)!);
  return out
    .map((t) => t.trim())
    .filter((t) => t && !CITED.has(t))
    .map((t) => t.replace(CITATION_KEY, ''));
}

const MEASURED: [string, string, ImagingModality][] = [
  ['lvot-diameter', 'plax', '2d'],
  ['lv-edd', 'psax-pm', '2d'],
  ['ivc-diameter', 'subcostal-ivc', '2d'],
  ['tapse', 'rv-focused', 'm-mode'],
  ['av-vmax', 'a5c', 'cw'],
];
function measurement([measurementId, view, modality]: (typeof MEASURED)[number]): Measurement {
  const spec = MEASUREMENT_SPECS.find((m) => m.id === measurementId)!;
  return {
    id: measurementId,
    measurementId,
    kind: spec.kind,
    label: spec.label,
    value: 2,
    units: spec.units,
    modality,
    sourceViewId: view,
    viewScore: 85,
    frameId: 1,
    phase: 0,
    timeS: 0,
    geometry: [],
    imageQualityScore: 90,
    userAssisted: false,
    referenceGuidelineIds: [],
    createdAt: '2026-10-03T00:00:00Z',
  };
}

const initialSim = useSimStore.getState();
const initialHud = useHudStore.getState();
function seed(caseId: string, mode: ProductMode, examFinished: boolean) {
  useSimStore.setState(initialSim, true);
  const truth = computeGroundTruth(loadCaseById(caseId));
  useSimStore.setState({
    caseId,
    mode,
    examFinished,
    truth,
    measurements: MEASURED.map(measurement),
    viewProgress: Object.fromEntries(VIEW_TARGETS.map((v, i) => [v.id, 40 + i * 4])),
    impressionSelection: ['ef-normal', 'as-severe'],
    // the console opens on its measurement list, the part of it that changes with the case
    ui: { ...initialSim.ui, shortcutsOpen: true, consoleTab: 'medir' },
  });
  if (mode === 'exam' && examFinished) useSimStore.setState({ mode: 'exam', examFinished: false });
  if (mode === 'exam' && examFinished) useSimStore.getState().finishExam();
  // finishing freezes the image; the cine bar needs a recorded loop, which is not what is read here
  useSimStore.setState({
    frozen: false,
    ui: { ...useSimStore.getState().ui, shortcutsOpen: true },
  });
  useHudStore.setState({
    hud: {
      ...initialHud.hud,
      heartRateBpm: 72,
      simulatedFps: 30,
      colorFps: 0,
      view: { bestViewId: 'psax-pm', score: 80 },
    } as never,
  });
}
const SITUATIONS: [ProductMode, boolean][] = [
  ['guided', false],
  ['exam', false],
  ['exam', true],
];

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => cleanup());

describe('what the screens say', () => {
  // one test per case, so that each stays short
  for (const c of CASE_INPUTS)
    it(`no key of the code and no English word: ${c.id}, in practice, in the exam and after it`, () => {
      const found: string[] = [];
      const read = (where: string, Screen: ComponentType) => {
        cleanup();
        for (const line of shownText(render(<Screen />).container))
          if (rawIds(line).length || ENGLISH.test(line)) found.push(`${where}: «${line}»`);
      };
      for (const [mode, finished] of SITUATIONS) {
        seed(c.id, mode, finished);
        const where = `${mode}${finished ? ' (terminado)' : ''}`;
        for (const [name, Screen] of Object.entries(CASE_SCREENS)) read(`${where} ${name}`, Screen);
        // the console's other tabs and the fixed screens say the same for every case
        if (c.id !== 'aortic-stenosis-severe') continue;
        for (const tab of CONSOLE_TABS) {
          useSimStore.setState({ ui: { ...useSimStore.getState().ui, consoleTab: tab } });
          read(`${where} consola ${tab}`, ConsolePanel);
        }
        for (const [name, Screen] of Object.entries(FIXED_SCREENS))
          read(`${where} ${name}`, Screen);
      }
      expect([...new Set(found)].slice(0, 20)).toEqual([]);
    });

  it('every view and every module that cites a source has a label of its own', () => {
    for (const v of VIEW_TARGETS) expect(VIEW_LABELS[v.id], v.id).toBeTruthy();
    for (const r of GUIDELINE_REFERENCES)
      for (const u of r.usedBy) expect(USED_BY_LABEL[u], u).toBeTruthy();
  });
});

describe('accessibility of the screens', () => {
  const ROLES = [
    'button',
    'link',
    'textbox',
    'combobox',
    'checkbox',
    'radio',
    'slider',
    'tab',
    'switch',
    'spinbutton',
    'img',
  ] as const;
  it('every control has an accessible name and the ids are unique', () => {
    const unnamed: string[] = [];
    const duplicated: string[] = [];
    for (const [mode, finished] of SITUATIONS) {
      seed('aortic-stenosis-severe', mode, finished);
      for (const [name, Screen] of Object.entries(SCREENS)) {
        cleanup();
        const { container } = render(<Screen />);
        for (const role of ROLES)
          for (const el of within(container).queryAllByRole(role, {
            name: (n: string) => n.trim() === '',
          }))
            unnamed.push(`${mode} ${name}: ${role} ${el.outerHTML.slice(0, 90)}`);
        const ids = [...container.querySelectorAll('[id]')].map((e) => e.id);
        for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i)))
          duplicated.push(`${name}: #${id}`);
      }
    }
    expect(unnamed).toEqual([]);
    expect(duplicated).toEqual([]);
  });
});
