import type { CaseDefinition } from '@/cases/schema';
import type { ArtifactSettings } from './postprocess/consolePipeline';
import type { AcquisitionSettings, ScenePhysics } from './types';

/**
 * The case-configurable artifacts (spec 12) at their intensity. Side lobe, mirror and beam width act in the console and in
 * the renderer's lateral response; the near-field clutter raises the physics' clutter term. The geometric artifacts (rib,
 * lung and calcium shadows) come from the anatomy and are not here.
 */
export interface ArtifactLevels extends ArtifactSettings {
  clutter: number;
}

export function caseArtifactLevels(c: CaseDefinition): ArtifactLevels {
  const level = (type: string) =>
    c.artifacts
      .filter((x) => x.enabled && x.type === type)
      .reduce((m, x) => Math.max(m, x.intensity), 0);
  return {
    sideLobe: level('side-lobe'),
    mirror: level('mirror'),
    beamWidth: level('beam-width'),
    clutter: level('near-field-clutter'),
  };
}

export interface ScenePhysicsOptions {
  /** The artifact lab's levels in place of the case's. */
  artifacts?: ArtifactLevels;
  /** Scatterer realization; the case seed by default. */
  seed?: number;
  /** The frame being formed (the flowing blood's speckle changes with it, decision 163); 0 by default. */
  bloodFrame?: number;
}

/**
 * The physics of a case's scene, the one the app renders (decision 238). The clinical calibration, the goldens, the
 * backend comparison and the offline tools each wrote their own, and none carried the case's near-field clutter: the
 * normal case was calibrated against CAMUS with a clutter of 0.10 while the app showed it with 0.28.
 */
export function scenePhysicsFor(
  c: CaseDefinition,
  settings: Pick<AcquisitionSettings, 'frequencyMHz' | 'harmonics'>,
  opts: ScenePhysicsOptions = {},
): ScenePhysics {
  const a = opts.artifacts ?? caseArtifactLevels(c);
  const w = c.acousticWindow;
  return {
    frequencyMHz: settings.frequencyMHz,
    harmonics: settings.harmonics,
    clutterLevel: Math.min(1, w.clutterLevel + 0.6 * a.clutter) + w.emphysemaScatter * 0.5,
    windowAttenuation: w.chestWallAttenuation,
    seed: opts.seed ?? c.seed,
    beamWidth: a.beamWidth,
    sideLobe: a.sideLobe,
    bloodFrame: opts.bloodFrame ?? 0,
  };
}

/** The console's share of the artifact levels. */
export function consoleArtifacts(a: ArtifactLevels): ArtifactSettings {
  return { sideLobe: a.sideLobe, mirror: a.mirror, beamWidth: a.beamWidth };
}
