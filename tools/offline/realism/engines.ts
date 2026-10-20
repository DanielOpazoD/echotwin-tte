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
import { COLE_FORMATION } from '@/simulator/core/coleImage';
import { runPhantoms, type PhantomResults } from './phantoms';
import { renderCine, type Cine } from './simCine';

/**
 * Phase 3 of the reconstruction (decision 351): the image as the convolution of point scatterers anchored in tissue with
 * the delay-and-sum PSF of the bench's reference array, detected in one look.
 */
const COLE = COLE_FORMATION;

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
          loadVolumeHeart(anatomy2Dir(), heart, endDiastole).classifier({ apparatus: endDiastole }),
      }),
    phantoms: runPhantoms,
  },
  // phase 2 of the reconstruction (decision 350): the same heart moved by the cycle of the case — the base's descent
  // (MAPSE, TAPSE on the right), the LV's incompressible radial motion with the case's volume curve and the twist of
  // Kocabay 2014, the atria's reservoir and booster — with the analytic leaflets of each frame and the papillary
  // muscles carried with the walls.
  'rodero-movil': {
    id: 'rodero-movil',
    label: 'corazón medio de Rodero 2021 movido por el ciclo del caso (cinemático, con torsión)',
    renderCine: (caseId, view, { fps, variant, seed }) =>
      renderCine(caseId, view, {
        fps,
        seed,
        physics: variant === 'noclutter' ? { clutterLevel: 0 } : undefined,
        heartClassifier: (heart, pose, endDiastole) =>
          loadVolumeHeart(anatomy2Dir(), heart, endDiastole).classifier({
            apparatus: pose,
            motion: { pose, endDiastole },
          }),
      }),
    phantoms: runPhantoms,
  },
  // the current anatomy through the convolution image formation: what the image formation alone changes
  cole: {
    id: 'cole',
    label:
      'modelo analítico actual con imagen por convolución (dispersores puntuales, PSF de DAS, una mirada)',
    renderCine: (caseId, view, { fps, variant, seed }) =>
      renderCine(caseId, view, {
        fps,
        seed,
        physics: variant === 'noclutter' ? { clutterLevel: 0 } : undefined,
        formation: COLE,
      }),
    phantoms: () => runPhantoms(COLE),
  },
  // Rodero's moving heart through the convolution image formation (phases 2 and 3 together)
  'rodero-cole': {
    id: 'rodero-cole',
    label: 'corazón de Rodero movido por el ciclo, con imagen por convolución',
    renderCine: (caseId, view, { fps, variant, seed }) =>
      renderCine(caseId, view, {
        fps,
        seed,
        physics: variant === 'noclutter' ? { clutterLevel: 0 } : undefined,
        formation: COLE,
        heartClassifier: (heart, pose, endDiastole) =>
          loadVolumeHeart(anatomy2Dir(), heart, endDiastole).classifier({
            apparatus: pose,
            motion: { pose, endDiastole },
          }),
      }),
    phantoms: () => runPhantoms(COLE),
  },
};

export function engineById(id: string): CineEngine {
  const e = ENGINES[id];
  if (!e)
    throw new Error(`motor desconocido «${id}»; disponibles: ${Object.keys(ENGINES).join(', ')}`);
  return e;
}
