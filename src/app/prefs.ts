import { z } from 'zod';

/**
 * The interface preferences kept across sessions in localStorage, with the type each must have. One schema serves the
 * save and the load: a key saved is a key read back, and anything else in storage — an old or hand-edited entry, a
 * value of the wrong type — is dropped key by key instead of being spread into the store.
 */
const PERSISTED = {
  showTorso: z.boolean(),
  showSkeleton: z.boolean(),
  showHints: z.boolean(),
  showEcg: z.boolean(),
  tutorialDone: z.boolean(),
  showHud: z.boolean(),
  navSkin: z.boolean(),
  navHeart: z.boolean(),
  navChambers: z.boolean(),
  navValves: z.boolean(),
  navVessels: z.boolean(),
  navAxes: z.boolean(),
  navCut: z.boolean(),
  navWindows: z.boolean(),
  navSplit: z.boolean(),
  navLabels: z.boolean(),
  navSegments: z.boolean(),
  imageSegments: z.boolean(),
  segmentsOpen: z.boolean(),
  segmentModel: z.enum(['LV_AHA17', 'LV_16']),
  reviewFreezeOnMark: z.boolean(),
  railMini: z.boolean(),
  minimal: z.boolean(),
  roomMode: z.boolean(),
  consoleTab: z.enum(['adquirir', 'imagen', 'doppler', 'medir', 'lab', 'revisar']),
} as const;

export type PersistedPrefKey = keyof typeof PERSISTED;
export const PERSISTED_PREF_KEYS = Object.keys(PERSISTED) as PersistedPrefKey[];
export type PersistedPrefs = { [K in PersistedPrefKey]: z.infer<(typeof PERSISTED)[K]> };

/** The valid persisted keys of an unknown value parsed from storage; invalid or unknown keys are left out. */
export function parsePrefs(raw: unknown): Partial<PersistedPrefs> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of PERSISTED_PREF_KEYS) {
    const parsed = PERSISTED[key].safeParse(src[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out;
}

/** The persisted subset of the full preferences, ready to serialise. */
export function pickPrefs(ui: PersistedPrefs): PersistedPrefs {
  const out: Record<string, unknown> = {};
  for (const key of PERSISTED_PREF_KEYS) out[key] = ui[key];
  return out as PersistedPrefs;
}
