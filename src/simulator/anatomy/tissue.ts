/**
 * Tissue classes with approximate acoustic properties (spec 7.3). Values are educational
 * approximations, not measured constants: reflectivity is a relative diffuse backscatter level,
 * `specular` how strongly an interface reflects when perpendicular to the beam, `attenuation`
 * in dB/cm/MHz-ish relative scale, speckle grain frequency in cycles/cm.
 */
export const enum Tissue {
  None = 0,
  Blood = 1,
  Myocardium = 2,
  Valve = 3,
  Pericardium = 4,
  Fat = 5,
  Muscle = 6,
  Bone = 7,
  Cartilage = 8,
  Lung = 9,
  Fluid = 10,
  VesselWall = 11,
  Calcium = 12,
  Skin = 13,
  Liver = 14,
  Spine = 15,
  Fibrous = 16,
  Chordae = 17,
}

export interface TissueProps {
  reflect: number;
  specular: number;
  attenuation: number;
  /** Lattice frequency (cycles/cm) of the coherent grains of myocardium, muscle and liver (decision 145); the PSF sets the speckle cell. */
  grain: number;
  name: string;
}

export const TISSUE_PROPS: Record<number, TissueProps> = {
  [Tissue.None]: { reflect: 0.0, specular: 0, attenuation: 0.5, grain: 2, name: 'none' },
  [Tissue.Blood]: { reflect: 0.018, specular: 0, attenuation: 0.18, grain: 7, name: 'blood' },
  [Tissue.Myocardium]: {
    reflect: 0.21,
    specular: 0.12,
    attenuation: 0.9,
    grain: 6.5,
    name: 'myocardium',
  },
  [Tissue.Valve]: { reflect: 0.5, specular: 0.7, attenuation: 0.8, grain: 5, name: 'valve' },
  [Tissue.Pericardium]: {
    reflect: 0.85,
    specular: 1.0,
    attenuation: 0.9,
    grain: 3,
    name: 'pericardium',
  },
  [Tissue.Fat]: { reflect: 0.12, specular: 0.1, attenuation: 0.6, grain: 2.5, name: 'fat' },
  // 0.2 until decision 156: under the apical probe the chest-wall muscle read grey 145 at 1–2 cm against 119 for the
  // myocardium below it, and the 0–2 cm band of the sector 148 against 105 [84–124] in CAMUS Good. At 0.05 — the
  // myocardium's own backscatter spans 0.21 × MYO_ANISO_FLOOR (0.03) to 0.21 with the fibre angle — the band reads 112.
  // What keeps the muscle's mean grey above the myocardium's (101 against 94, medium tier at end-systole) is the skin
  // and fascia echoes the PSF spreads into it and the near-field clutter, not its backscatter. The subcutaneous fat
  // stays: it is also the epicardial fat of the heart.
  [Tissue.Muscle]: { reflect: 0.05, specular: 0.2, attenuation: 1.0, grain: 3, name: 'muscle' },
  [Tissue.Bone]: { reflect: 1.0, specular: 1.0, attenuation: 20, grain: 3, name: 'bone' },
  [Tissue.Cartilage]: {
    reflect: 0.45,
    specular: 0.5,
    attenuation: 3.5,
    grain: 3,
    name: 'cartilage',
  },
  [Tissue.Lung]: { reflect: 1.0, specular: 1.0, attenuation: 40, grain: 3, name: 'lung' },
  [Tissue.Fluid]: { reflect: 0.005, specular: 0, attenuation: 0.05, grain: 4, name: 'fluid' },
  [Tissue.VesselWall]: {
    reflect: 0.55,
    specular: 0.6,
    attenuation: 0.9,
    grain: 3,
    name: 'vessel wall',
  },
  [Tissue.Calcium]: { reflect: 1.0, specular: 1.0, attenuation: 25, grain: 3, name: 'calcium' },
  [Tissue.Skin]: { reflect: 0.5, specular: 0.4, attenuation: 1.2, grain: 4, name: 'skin' },
  [Tissue.Liver]: { reflect: 0.35, specular: 0.1, attenuation: 0.7, grain: 3, name: 'liver' },
  [Tissue.Spine]: { reflect: 1.0, specular: 1.0, attenuation: 20, grain: 3, name: 'spine' },
  [Tissue.Fibrous]: {
    reflect: 0.65,
    specular: 0.8,
    attenuation: 1.0,
    grain: 4,
    name: 'fibrous annulus',
  },
  [Tissue.Chordae]: { reflect: 0.3, specular: 0.4, attenuation: 0.8, grain: 5, name: 'chordae' },
};

/** Result of classifying a 3D point. Reused per sample to avoid allocation. */
export interface TissueSample {
  tissue: Tissue;
  /** Signed distance to the nearest relevant interface (cm), negative inside the structure. */
  sdf: number;
  /** Interface normal (unit) for the specular term. */
  nx: number;
  ny: number;
  nz: number;
  /** Material coordinates (cm) for tissue-attached speckle. */
  mx: number;
  my: number;
  mz: number;
  /** Local modifiers: extra reflectivity (e.g. calcification), 0 = none */
  extraReflect: number;
  /** Structure id for landmark/visibility analysis. */
  structure: Structure;
  /** Depth across the LV wall, 0 at the endocardium and 1 at the epicardium (fibre helix, decision 144); −1 elsewhere. */
  transmural: number;
  /**
   * LV myocardial segment code of `lvSegments.ts` (decision 152): 1–16 AHA segments, 17–20 the apical cap in the quadrant
   * of 13–16, 0 when the point is not LV compact myocardium (cavity, papillary muscles, valves and every other tissue).
   */
  segment: number;
}

export const enum Structure {
  None = 0,
  LvCavity,
  LvWallSeptal,
  LvWallLateral,
  LvWallAnterior,
  LvWallInferior,
  LvApex,
  RvCavity,
  RvWall,
  LaCavity,
  LaWall,
  RaCavity,
  RaWall,
  MitralAnterior,
  MitralPosterior,
  AorticValve,
  TricuspidValve,
  AorticRoot,
  Lvot,
  Rvot,
  PapillaryMuscle,
  Pericardium,
  PericardialEffusion,
  DescendingAorta,
  Ivc,
  ChestWall,
  Rib,
  Sternum,
  Lung,
  Liver,
  Spine,
  InteratrialSeptum,
  PulmonaryValve,
  MitralAnnulus,
  TricuspidAnnulus,
  Chordae,
  ModeratorBand,
  LaAppendage,
  PulmonaryVein,
  CoronarySinus,
  PulmonaryArtery,
  RvPapillary,
  Svc,
  HepaticVein,
  Diaphragm,
  EpicardialFat,
}

export function makeSample(): TissueSample {
  return {
    tissue: Tissue.None,
    sdf: 1e9,
    nx: 0,
    ny: 0,
    nz: 1,
    mx: 0,
    my: 0,
    mz: 0,
    extraReflect: 0,
    structure: Structure.None,
    transmural: -1,
    segment: 0,
  };
}
