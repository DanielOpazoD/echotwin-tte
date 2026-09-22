/**
 * Myocardial segmentation catalogues (decision 152). Clinical base: the AHA 17-segment model (Cerqueira et al.,
 * Circulation 2002;105:539–542, reference `aha-segmentation-2002`) for anatomy, its 16-segment use for regional wall
 * motion (ASE/EACVI chamber quantification 2015, `ase-eacvi-chamber-2015`, §3.1–3.2) and the 18-segment topology some
 * deformation analyses use (EACVI/ASE/Industry 2D speckle-tracking standard 2015, `eacvi-ase-ste-2015`). The names and
 * SNOMED CT codes are those of DICOM PS3.16 CID 3782/3783/3784 and 3717 (`dicom-cid-3717`, current edition, checked on
 * 2026-09-22). The right ventricle has schemes of its own (`ase-right-heart-2025`, `ase-eacvi-strain-2025`).
 *
 * What is clinical and what is ours: the ids, names, levels, walls and nominal views are the standards'; the polar-map
 * angles (centre and width of each wedge in the display convention below), the view lists as data and the split of
 * models into anatomy / wall motion / strain are software decisions of this project. Nothing here is a validated
 * clinical tool.
 */

/** Anatomical identity of left-ventricular myocardium: AHA 17. */
export type AhaId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17;
/** Regional wall-motion scoring uses 16 segments: the apical cap is not scored on its own. */
export type WallMotionId = Exclude<AhaId, 17>;
/** Segment ids of the separate 18-segment strain topology (six apical segments). */
export type Lv18Id = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18;

export type SegmentLevel = 'basal' | 'mid' | 'apical' | 'cap';
export type SegmentWall =
  | 'anterior'
  | 'anteroseptal'
  | 'inferoseptal'
  | 'inferior'
  | 'inferolateral'
  | 'anterolateral'
  | 'septal'
  | 'lateral'
  | 'apex';

/** Views of this simulator whose nominal plane shows a segment (reference planes; the drawn plane is measured). */
export type SegmentViewId = 'a4c' | 'a2c' | 'a3c' | 'plax' | 'psax-mv' | 'psax-pm' | 'psax-apex';

export interface LvSegmentInfo {
  id: AhaId;
  level: SegmentLevel;
  wall: SegmentWall;
  nameEs: string;
  nameEn: string;
  /** SNOMED CT code of DICOM CID 3782/3783/3784 (segments 1–16) or CID 3717 (apex). */
  snomed: string;
  /**
   * Polar-map wedge, display convention: 0° = anterior at the top, positive counter-clockwise toward the septum on the
   * left. Null for the cap, drawn as the central disc. Not the heart-frame azimuth.
   */
  polarCentreDeg: number | null;
  polarWidthDeg: number | null;
  /** Views whose nominal plane shows the segment (AHA 2002 and ASE/EACVI 2015, figures 3–4). */
  canonicalViews: readonly SegmentViewId[];
  /** Scored in the 16-segment wall-motion model. */
  wallMotionEligible: boolean;
  /** Usual coronary territory; orientative only (variable, especially at the apex). Never a culprit-artery diagnosis. */
  coronaryTerritoryHint: 'LAD' | 'RCA' | 'LCx' | 'LAD/variable';
}

const seg = (
  id: AhaId,
  level: SegmentLevel,
  wall: SegmentWall,
  nameEs: string,
  nameEn: string,
  snomed: string,
  polarCentreDeg: number | null,
  polarWidthDeg: number | null,
  canonicalViews: readonly SegmentViewId[],
  coronaryTerritoryHint: LvSegmentInfo['coronaryTerritoryHint'],
): LvSegmentInfo => ({
  id,
  level,
  wall,
  nameEs,
  nameEn,
  snomed,
  polarCentreDeg,
  polarWidthDeg,
  canonicalViews,
  wallMotionEligible: id !== 17,
  coronaryTerritoryHint,
});

/** AHA 17-segment catalogue, in id order (index = id − 1). */
export const LV_AHA17: readonly LvSegmentInfo[] = [
  seg(
    1,
    'basal',
    'anterior',
    'Basal anterior',
    'Basal anterior',
    '264850008',
    0,
    60,
    ['a2c', 'psax-mv'],
    'LAD',
  ),
  seg(
    2,
    'basal',
    'anteroseptal',
    'Basal anteroseptal',
    'Basal anteroseptal',
    '396482007',
    60,
    60,
    ['a3c', 'plax', 'psax-mv'],
    'LAD',
  ),
  seg(
    3,
    'basal',
    'inferoseptal',
    'Basal inferoseptal',
    'Basal inferoseptal',
    '396646008',
    120,
    60,
    ['a4c', 'psax-mv'],
    'RCA',
  ),
  seg(
    4,
    'basal',
    'inferior',
    'Basal inferior',
    'Basal inferior',
    '264846001',
    180,
    60,
    ['a2c', 'psax-mv'],
    'RCA',
  ),
  seg(
    5,
    'basal',
    'inferolateral',
    'Basal inferolateral',
    'Basal inferolateral',
    '396652009',
    240,
    60,
    ['a3c', 'plax', 'psax-mv'],
    'LCx',
  ),
  seg(
    6,
    'basal',
    'anterolateral',
    'Basal anterolateral',
    'Basal anterolateral',
    '396654005',
    300,
    60,
    ['a4c', 'psax-mv'],
    'LCx',
  ),
  seg(
    7,
    'mid',
    'anterior',
    'Medio anterior',
    'Mid anterior',
    '264848000',
    0,
    60,
    ['a2c', 'psax-pm'],
    'LAD',
  ),
  seg(
    8,
    'mid',
    'anteroseptal',
    'Medio anteroseptal',
    'Mid anteroseptal',
    '396647004',
    60,
    60,
    ['a3c', 'plax', 'psax-pm'],
    'LAD',
  ),
  seg(
    9,
    'mid',
    'inferoseptal',
    'Medio inferoseptal',
    'Mid inferoseptal',
    '396649001',
    120,
    60,
    ['a4c', 'psax-pm'],
    'RCA',
  ),
  seg(
    10,
    'mid',
    'inferior',
    'Medio inferior',
    'Mid inferior',
    '264847005',
    180,
    60,
    ['a2c', 'psax-pm'],
    'RCA',
  ),
  seg(
    11,
    'mid',
    'inferolateral',
    'Medio inferolateral',
    'Mid inferolateral',
    '396655006',
    240,
    60,
    ['a3c', 'plax', 'psax-pm'],
    'LCx',
  ),
  seg(
    12,
    'mid',
    'anterolateral',
    'Medio anterolateral',
    'Mid anterolateral',
    '396656007',
    300,
    60,
    ['a4c', 'psax-pm'],
    'LCx',
  ),
  seg(
    13,
    'apical',
    'anterior',
    'Apical anterior',
    'Apical anterior',
    '264844003',
    0,
    90,
    ['a2c', 'psax-apex'],
    'LAD',
  ),
  seg(
    14,
    'apical',
    'septal',
    'Apical septal',
    'Apical septal',
    '264845002',
    90,
    90,
    ['a4c', 'a3c', 'psax-apex'],
    'LAD',
  ),
  seg(
    15,
    'apical',
    'inferior',
    'Apical inferior',
    'Apical inferior',
    '264849008',
    180,
    90,
    ['a2c', 'psax-apex'],
    'RCA',
  ),
  seg(
    16,
    'apical',
    'lateral',
    'Apical lateral',
    'Apical lateral',
    '264853005',
    270,
    90,
    ['a4c', 'a3c', 'psax-apex'],
    'LCx',
  ),
  seg(
    17,
    'cap',
    'apex',
    'Ápex / casquete apical',
    'Apex / apical cap',
    '128564006',
    null,
    null,
    [],
    'LAD/variable',
  ),
];

export const WALL_MOTION_IDS: readonly WallMotionId[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
];

export function aha17Info(id: number): LvSegmentInfo | null {
  return Number.isInteger(id) && id >= 1 && id <= 17 ? LV_AHA17[id - 1]! : null;
}

/**
 * Reference walls of the apical and parasternal long-axis views (AHA 2002, ASE/EACVI 2015 figure 4): base → mid → apex
 * along each wall. Which side of the screen each wall lands on depends on the marker, left–right inversion and the
 * plane, not on this table. PLAX does not usually show the true apex.
 */
export const VIEW_WALLS: Readonly<
  Record<'a4c' | 'a2c' | 'a3c' | 'plax', readonly (readonly AhaId[])[]>
> = {
  a4c: [
    [3, 9, 14],
    [6, 12, 16],
  ],
  a2c: [
    [4, 10, 15],
    [1, 7, 13],
  ],
  a3c: [
    [2, 8, 14],
    [5, 11, 16],
  ],
  plax: [
    [2, 8],
    [5, 11],
  ],
};

/** Separate 18-segment topology (strain): the apical level has six segments like the basal and mid ones. */
export interface Lv18SegmentInfo {
  id: Lv18Id;
  level: Exclude<SegmentLevel, 'cap'>;
  wall: Exclude<SegmentWall, 'septal' | 'lateral' | 'apex'>;
  nameEs: string;
  nameEn: string;
}
const WALLS6: readonly [Lv18SegmentInfo['wall'], string, string][] = [
  ['anterior', 'anterior', 'anterior'],
  ['anteroseptal', 'anteroseptal', 'anteroseptal'],
  ['inferoseptal', 'inferoseptal', 'inferoseptal'],
  ['inferior', 'inferior', 'inferior'],
  ['inferolateral', 'inferolateral', 'inferolateral'],
  ['anterolateral', 'anterolateral', 'anterolateral'],
];
const LEVELS3: readonly [Lv18SegmentInfo['level'], string, string][] = [
  ['basal', 'Basal', 'Basal'],
  ['mid', 'Medio', 'Mid'],
  ['apical', 'Apical', 'Apical'],
];
/** LV_18: a topology of its own, not «AHA plus one». Its ids 13–18 do not correspond to AHA 13–17. */
export const LV_18: readonly Lv18SegmentInfo[] = LEVELS3.flatMap(([level, es, en], l) =>
  WALLS6.map(([wall, wEs, wEn], w) => ({
    id: (l * 6 + w + 1) as Lv18Id,
    level,
    wall,
    nameEs: `${es} ${wEs}`,
    nameEn: `${en} ${wEn}`,
  })),
);

/**
 * Right-ventricular schemes, kept apart from the LV ids (ASE right heart 2025; ASE/EACVI strain 2025): the free wall of
 * the RV-focused view divided into three equal lengths at end-diastole, and the four-chamber scheme that adds three
 * septal regions. The septum is one tissue observed by two analyses, not two walls. Identifiers only: the simulator does
 * not classify RV regions yet.
 */
export const RV_FREE_WALL_3 = ['basal', 'mid', 'apical'] as const;
export const RV_4CH_6 = [
  'free_wall_basal',
  'free_wall_mid',
  'free_wall_apical',
  'septal_basal',
  'septal_mid',
  'septal_apical',
] as const;
export type RvFreeWall3Id = `RV_FREE_WALL_3:${(typeof RV_FREE_WALL_3)[number]}`;
export type Rv4ch6Id = `RV_4CH_6:${(typeof RV_4CH_6)[number]}`;

/** A segment id always travels with its model, so LV_AHA17:9, LV_16:9 and RV_4CH_6:septal_mid never mix. */
export type SegmentModel = 'LV_AHA17' | 'LV_16' | 'LV_18' | 'RV_FREE_WALL_3' | 'RV_4CH_6';
export const segmentKey = (model: SegmentModel, id: number | string): string => `${model}:${id}`;

/**
 * Polar-map point for a wedge angle (display convention): x = cx − r·sin θ, y = cy − r·cos θ, with θ in degrees,
 * 0 = anterior (up), positive toward the septum (left).
 */
export function polarPoint(cx: number, cy: number, r: number, thetaDeg: number): [number, number] {
  const t = (thetaDeg * Math.PI) / 180;
  return [cx - r * Math.sin(t), cy - r * Math.cos(t)];
}
