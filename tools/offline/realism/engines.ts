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
import { loadVolumeHeart } from '../anatomy2/volumeHeart';
import { runPhantoms, type PhantomResults } from './phantoms';
import { renderCine, type Cine } from './simCine';

/** The folder of the voxelised Rodero heart (tools/offline/anatomy2/rodero-voxelize.ts), outside the repository. */
function anatomy2Dir(): string {
  const dir = process.env['ANATOMY2_OUT'];
  if (!dir)
    throw new Error('el motor rodero-estatico necesita ANATOMY2_OUT (tools/offline/anatomy2)');
  return dir;
}

export type CineVariant = 'default' | 'noclutter';

export interface CineEngine {
  id: string;
  /** What it is, for the report. */
  label: string;
  /** `seed` picks the scatterer realization (the case's own when absent). */
  renderCine(
    caseId: string,
    view: string,
    o: { fps: number; variant: CineVariant; seed?: number },
  ): Cine | null;
  /** The phantoms of its image formation, when it has its own. */
  phantoms?: () => PhantomResults;
}

export const ENGINES: Readonly<Record<string, CineEngine>> = {
  actual: {
    id: 'actual',
    label: 'modelo analítico actual (trazador CPU, nivel calibrado)',
    renderCine: (caseId, view, { fps, variant, seed }) =>
      renderCine(caseId, view, {
        fps,
        seed,
        physics: variant === 'noclutter' ? { clutterLevel: 0 } : undefined,
      }),
    phantoms: runPhantoms,
  },
  // phase 1 of the reconstruction (decision 346): the same tracer, thorax and console; the heart is the mean CT heart
  // of Rodero et al. 2021, static at end diastole, with the analytic heart's valve apparatus at end diastole in its
  // cavities. The image formation is the current one, so its phantoms are too.
  'rodero-estatico': {
    id: 'rodero-estatico',
    label:
      'corazón medio de Rodero 2021 (TC, telediástole, estático) con el aparato valvular analítico',
    renderCine: (caseId, view, { fps, variant, seed }) =>
      renderCine(caseId, view, {
        fps,
        seed,
        physics: variant === 'noclutter' ? { clutterLevel: 0 } : undefined,
        heartClassifier: (heart, _pose, endDiastole) =>
          loadVolumeHeart(anatomy2Dir(), heart, endDiastole).classifier(endDiastole),
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
