/**
 * The short name of each view, the one a text shows (decision 259). The ids (`psax-pm`, `subcostal-ivc`) are keys of the
 * code; upper-cased they read «PSAX-PM» or «SUBCOSTAL-IVC», half an abbreviation and half English. The standard
 * abbreviations (PLAX, A4C…) stay; the rest are named in Spanish.
 */
export const VIEW_LABELS: Readonly<Record<string, string>> = {
  plax: 'PLAX',
  'psax-av': 'PSAX aórtico',
  'psax-mv': 'PSAX mitral',
  'psax-pm': 'PSAX papilar',
  'psax-apex': 'PSAX apical',
  a4c: 'A4C',
  a5c: 'A5C',
  a2c: 'A2C',
  a3c: 'A3C',
  'rv-focused': 'Apical del VD',
  'subcostal-4c': 'Subcostal 4C',
  'subcostal-ivc': 'Subcostal VCI',
};

/** The short name of a view; an unknown id is shown as it is rather than hidden. */
export function viewLabel(id: string): string {
  return VIEW_LABELS[id] ?? id;
}
