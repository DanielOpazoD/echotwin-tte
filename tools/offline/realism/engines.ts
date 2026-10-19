/**
 * The engines the realism bench can judge (decision 345). The reconstruction (docs/RECONSTRUCCION.md) replaces the
 * anatomy, motion and image formation phase by phase behind a switch; each candidate registers here and the bench
 * measures it with the same cines, metrics and clinical references as the current model, so `--engine <id>
 * --baseline <baseline of the current one>` says gap by gap whether it brings the simulator closer.
 *
 * An engine renders one cycle of a canonical view (`Cine`: displayed grey on the 640-px canvas, the structure under
 * each pixel with the ids of `anatomy/tissue.ts`, and the pre-console polar frame), and may run the image-formation
 * phantoms. A variant it does not model (`noclutter`) returns null and the bench leaves that measurement out.
 */
import { runPhantoms, type PhantomResults } from './phantoms';
import { renderCine, type Cine } from './simCine';

export type CineVariant = 'default' | 'noclutter';

export interface CineEngine {
  id: string;
  /** What it is, for the report. */
  label: string;
  renderCine(caseId: string, view: string, fps: number, variant: CineVariant): Cine | null;
  /** The phantoms of its image formation, when it has its own. */
  phantoms?: () => PhantomResults;
}

export const ENGINES: Readonly<Record<string, CineEngine>> = {
  actual: {
    id: 'actual',
    label: 'modelo analítico actual (trazador CPU, nivel calibrado)',
    renderCine: (caseId, view, fps, variant) =>
      renderCine(caseId, view, {
        fps,
        physics: variant === 'noclutter' ? { clutterLevel: 0 } : undefined,
      }),
    phantoms: runPhantoms,
  },
};

export function engineById(id: string): CineEngine {
  const e = ENGINES[id];
  if (!e)
    throw new Error(`motor desconocido «${id}»; disponibles: ${Object.keys(ENGINES).join(', ')}`);
  return e;
}
