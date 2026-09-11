import { z } from 'zod';

/**
 * CaseDefinition schema (spec 22). Cases are data: validated with Zod, serializable, reproducible
 * by seed. Strings are never interpreted as code or HTML (spec 77).
 */
const pct = z.number().min(0).max(100);
const unit01 = z.number().min(0).max(1);

export const SyntheticDemographicsSchema = z.object({
  ageYears: z.number().int().min(18).max(100),
  sexForReference: z.enum(['male', 'female']),
  heightCm: z.number().min(120).max(220),
  weightKg: z.number().min(35).max(200),
});

export const BodyHabitusSchema = z.object({
  chestWallThicknessCm: z.number().min(1).max(6),
  chestWidthCm: z.number().min(24).max(44),
  chestDepthCm: z.number().min(16).max(30),
  ribSpacingCm: z.number().min(1.6).max(3.2),
  intercostalWidthCm: z.number().min(0.8).max(2.2),
});

export const RhythmSchema = z.object({
  type: z.enum(['sinus', 'sinus-tachycardia', 'sinus-bradycardia', 'atrial-fibrillation']),
  heartRateBpm: z.number().min(30).max(180),
  rrVariabilityPct: z.number().min(0).max(60).default(1),
  pvcProbability: unit01.default(0),
});

export const LvAnatomySchema = z.object({
  eddCm: z.number().min(2.5).max(9), // LV internal end-diastolic dimension
  lengthEdCm: z.number().min(5).max(12), // base (annulus) to apex, end diastole
  ivsdCm: z.number().min(0.4).max(3),
  lvpwdCm: z.number().min(0.4).max(3),
  sphericity: unit01.default(0.55), // 0 bullet-shaped, 1 spherical
  apexWallThicknessCm: z.number().min(0.3).max(2).default(0.7),
});

export const AnatomySchema = z.object({
  lv: LvAnatomySchema,
  la: z.object({ apDiameterCm: z.number().min(2).max(7), volumeMl: z.number().min(15).max(250) }),
  rv: z.object({
    basalDiameterCm: z.number().min(2).max(6),
    lengthCm: z.number().min(5).max(11),
    freeWallThicknessCm: z.number().min(0.2).max(1.2),
    /** Interventricular septal flattening toward the LV (D-shaped LV in short axis) 0..1, from RV pressure/volume overload. */
    septalFlattening: unit01.default(0),
  }),
  ra: z.object({ volumeMl: z.number().min(15).max(200) }),
  aorta: z.object({
    lvotDiameterCm: z.number().min(1.4).max(3.2),
    annulusCm: z.number().min(1.6).max(3.4),
    sinusCm: z.number().min(2.2).max(5.5),
    ascendingCm: z.number().min(2.0).max(5.5),
  }),
  mitral: z.object({
    annulusDiameterCm: z.number().min(2).max(5),
    anteriorLeafletLengthCm: z.number().min(1.5).max(3.5),
    posteriorLeafletLengthCm: z.number().min(0.8).max(2.5),
    maxOpeningDeg: z.number().min(10).max(85),
    calcification: unit01.default(0),
    thickeningCm: z.number().min(0.05).max(0.5).default(0.1),
    samSeverity: unit01.default(0),
    /** Leaflet body displacement beyond the annulus into the LA in systole (prolapse), 0 = none. */
    prolapse: unit01.default(0),
  }),
  aorticValve: z.object({
    maxOpeningFraction: unit01, // 1 = normal full opening
    calcification: unit01,
    cuspThicknessCm: z.number().min(0.05).max(0.5),
    bicuspid: z.boolean().default(false),
  }),
  tricuspid: z.object({ annulusDiameterCm: z.number().min(2).max(5.5) }),
  ivc: z.object({ diameterCm: z.number().min(0.8).max(3.5), collapsePct: pct }),
  pericardium: z.object({
    effusionCm: z.number().min(0).max(4).default(0),
    /** Tamponade physiology 0..1: RV early-diastolic collapse, RA late-diastolic collapse and swinging heart. */
    tamponade: unit01.default(0),
  }),
  heartPosition: z.object({
    // Position of the mitral annulus centre in torso frame (cm; x=left, y=superior, z=anterior)
    baseCm: z.object({ x: z.number(), y: z.number(), z: z.number() }),
    // Long axis direction (base → apex), torso frame, need not be unit
    longAxis: z.object({ x: z.number(), y: z.number(), z: z.number() }),
    // Anterior direction of the heart (toward RV), torso frame, need not be unit/orthogonal
    anterior: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  }),
  wallMotion: z
    .array(
      z.object({
        segment: z.number().int().min(1).max(17),
        amplitude: z.number().min(-0.5).max(1.2), // 1 normal, 0.5 hypokinetic, 0 akinetic, <0 dyskinetic
        delayPhase: z.number().min(0).max(0.3).default(0),
      }),
    )
    .default([]),
});

export const PhysiologySchema = z.object({
  edvMl: z.number().min(30).max(500),
  esvMl: z.number().min(10).max(450),
  mapseCm: z.number().min(0.2).max(2.5),
  tapseCm: z.number().min(0.3).max(3.5),
  ePeakMps: z.number().min(0.2).max(2.5), // mitral E
  aPeakMps: z.number().min(0).max(2), // mitral A (0 in AF)
  decelerationTimeMs: z.number().min(80).max(450),
  ivrtMs: z.number().min(30).max(160),
  ePrimeSeptalCmps: z.number().min(2).max(20),
  ePrimeLateralCmps: z.number().min(2).max(25),
  sPrimeTricuspidCmps: z.number().min(3).max(20),
  contractility: z.number().min(0.2).max(2).default(1),
});

export const HemodynamicsSchema = z.object({
  systolicBpMmHg: z.number().min(60).max(240),
  diastolicBpMmHg: z.number().min(30).max(140),
  rapMmHg: z.number().min(0).max(25),
  paspMmHg: z.number().min(10).max(120),
  avEffectiveAreaCm2: z.number().min(0.3).max(5),
  mvEffectiveAreaCm2: z.number().min(0.5).max(8).optional(), // derived from E/A when omitted
  trPresent: z.boolean().default(true),
  /** Peak LVOT gradient (mmHg) from a subaortic obstruction; dynamic (late-peaking) when mitral.samSeverity > 0. */
  lvotPeakGradientMmHg: z.number().min(0).max(150).default(0),
  regurgitation: z
    .object({
      mr: z.object({ eroaCm2: z.number().min(0).max(1.2), jetDirectionDeg: z.number().min(-60).max(60) }).optional(),
      ar: z.object({ eroaCm2: z.number().min(0).max(1.0), phtMs: z.number().min(100).max(1000).default(450) }).optional(),
      tr: z.object({ eroaCm2: z.number().min(0).max(1.5) }).optional(),
    })
    .default({}),
});

export const AcousticWindowSchema = z.object({
  chestWallAttenuation: unit01, // 0 excellent, 1 very poor
  lungOverlapCm: z.number().min(-2).max(6), // shifts the left lung border medially (positive = worse)
  clutterLevel: unit01,
  obesityAttenuation: unit01,
  emphysemaScatter: unit01,
  cardiacRotationDeg: z.number().min(-30).max(30).default(0),
});

export const FlowPrimitiveSchema = z.object({
  id: z.string(),
  site: z.enum(['mitral-inflow', 'lvot', 'aortic-valve', 'tricuspid-inflow', 'rvot', 'mr-jet', 'tr-jet', 'ar-jet', 'pulmonary-vein']),
  enabled: z.boolean().default(true),
  turbulence: unit01.default(0.05),
});

export const ArtifactConfigSchema = z.object({
  type: z.enum(['rib-shadow', 'lung-reverberation', 'near-field-clutter', 'calcium-shadow', 'mirror', 'side-lobe', 'beam-width']),
  intensity: unit01,
  enabled: z.boolean().default(true),
});

export const RequiredViewSchema = z.object({ viewId: z.string(), minScore: z.number().min(0).max(100).default(60) });
export const RequiredMeasurementSchema = z.object({
  measurementId: z.string(),
  tolerancePct: z.number().min(1).max(50).default(15),
});

export const GuidelineRefLinkSchema = z.object({ referenceId: z.string(), usage: z.string() });

export const CaseDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().max(120),
  seed: z.number().int().nonnegative(),
  history: z.string().max(2000).default(''),
  demographics: SyntheticDemographicsSchema,
  bodyHabitus: BodyHabitusSchema,
  rhythm: RhythmSchema,
  anatomy: AnatomySchema,
  physiology: PhysiologySchema,
  hemodynamics: HemodynamicsSchema,
  acousticWindow: AcousticWindowSchema,
  flowPrimitives: z.array(FlowPrimitiveSchema),
  artifacts: z.array(ArtifactConfigSchema).default([]),
  learningObjectives: z.array(z.string().max(300)),
  requiredViews: z.array(RequiredViewSchema),
  requiredMeasurements: z.array(RequiredMeasurementSchema),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  references: z.array(GuidelineRefLinkSchema),
  /** Free-text impression the report scorer compares against (structured truth is derived from physiology). */
  impressionTruth: z.array(z.string().max(300)),
  /** Measurement ids (see measureModel) that this case intentionally drives out of the reference range. */
  expectedDeviations: z.array(z.string()).default([]),
});

export type CaseDefinition = z.infer<typeof CaseDefinitionSchema>;
export type CaseDefinitionInput = z.input<typeof CaseDefinitionSchema>;
export type AnatomyConfig = z.infer<typeof AnatomySchema>;
export type PhysiologyConfig = z.infer<typeof PhysiologySchema>;
export type HemodynamicConfig = z.infer<typeof HemodynamicsSchema>;
export type RhythmConfig = z.infer<typeof RhythmSchema>;
export type AcousticWindowConfig = z.infer<typeof AcousticWindowSchema>;
export type BodyHabitusConfig = z.infer<typeof BodyHabitusSchema>;

export interface CaseValidationResult {
  ok: boolean;
  case?: CaseDefinition;
  errors: string[];
}

/** Validate untrusted JSON (never executes anything). Returns readable errors (spec 43). */
export function validateCase(input: unknown): CaseValidationResult {
  const parsed = CaseDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  const c = parsed.data;
  const errors: string[] = [];
  if (c.physiology.esvMl >= c.physiology.edvMl) errors.push('physiology.esvMl must be < edvMl');
  if (c.hemodynamics.diastolicBpMmHg >= c.hemodynamics.systolicBpMmHg) errors.push('diastolic BP must be < systolic BP');
  if (c.rhythm.type === 'atrial-fibrillation' && c.physiology.aPeakMps > 0)
    errors.push('atrial fibrillation cannot have an organized A wave (physiology.aPeakMps must be 0)');
  if (c.anatomy.aorta.lvotDiameterCm > c.anatomy.aorta.annulusCm + 0.3)
    errors.push('LVOT diameter should not exceed the aortic annulus by more than 3 mm');
  return errors.length ? { ok: false, errors } : { ok: true, case: c, errors: [] };
}
