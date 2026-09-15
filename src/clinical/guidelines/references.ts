/**
 * Versioned clinical references (spec 39, 66, 90). Every clinical rule in this project points
 * to one of these ids. `accessedAt` records when the reference was last reviewed by the team.
 * No tables are copied from the guidelines; only the specific rules needed are encoded in
 * reference-values/ with an explicit referenceId.
 */
export interface GuidelineReference {
  id: string;
  society: string;
  title: string;
  year: number;
  url: string;
  versionLabel?: string;
  accessedAt: string; // ISO date
  usedBy: string[]; // module ids that depend on this reference
  verification: 'verified-online' | 'title-verified' | 'not-verified';
  notes?: string;
}

export const GUIDELINE_REFERENCES: GuidelineReference[] = [
  {
    id: 'ase-tte-2019',
    society: 'ASE',
    title:
      'Guidelines for Performing a Comprehensive Transthoracic Echocardiographic Examination in Adults',
    year: 2019,
    url: 'https://www.asecho.org/guideline/comprehensive-tte-in-adults/',
    accessedAt: '2026-09-10',
    usedBy: ['view-targets', 'acquisition-protocol', 'measurement-sites'],
    verification: 'title-verified',
  },
  {
    id: 'ase-diastolic-2025',
    society: 'ASE',
    title:
      'Recommendations for the Evaluation of Left Ventricular Diastolic Function by Echocardiography and for Heart Failure With Preserved Ejection Fraction Diagnosis: An Update From the ASE',
    year: 2025,
    url: 'https://www.asecho.org/guideline/left-ventricular-diastolic-function-by-echo/',
    accessedAt: '2026-09-10',
    usedBy: ['diastolic-function'],
    verification: 'title-verified',
    notes:
      'Diastolic algorithm module is scaffolded; cutoffs must be re-verified before enabling grading.',
  },
  {
    id: 'ase-right-heart-2025',
    society: 'ASE',
    title:
      'Guidelines for the Echocardiographic Assessment of the Right Heart in Adults and Special Considerations in Pulmonary Hypertension',
    year: 2025,
    url: 'https://www.asecho.org/guideline/right-heart-in-adults-pulmonary-hypertension/',
    accessedAt: '2026-09-10',
    usedBy: ['right-heart', 'rap-estimation'],
    verification: 'title-verified',
  },
  {
    id: 'ase-reporting-2025',
    society: 'ASE',
    title: 'Guidelines for the Standardization of Adult Echocardiography Reporting',
    year: 2025,
    url: 'https://www.asecho.org/guideline/guidelines-for-the-standardization-of-adult-echocardiography-reporting/',
    accessedAt: '2026-09-10',
    usedBy: ['reporting'],
    verification: 'title-verified',
  },
  {
    id: 'ase-eacvi-strain-2025',
    society: 'ASE/EACVI',
    title: 'Clinical Applications of Strain Echocardiography',
    year: 2025,
    url: 'https://www.asecho.org/guideline/clinical-applications-of-strain-echocardiography/',
    accessedAt: '2026-09-10',
    usedBy: ['strain (future)'],
    verification: 'title-verified',
  },
  {
    id: 'ase-artifacts-2026',
    society: 'ASE',
    title: 'Recommendations for the Identification and Mitigation of Cardiac Ultrasound Artifacts',
    year: 2026,
    url: 'https://www.asecho.org/guideline/identification-and-mitigation-of-cardiac-ultrasound-artifacts/',
    accessedAt: '2026-09-10',
    usedBy: ['artifact-engine', 'artifact-lab'],
    verification: 'title-verified',
  },
  {
    id: 'ase-scmr-regurgitation-2017',
    society: 'ASE/SCMR',
    title: 'Recommendations for Noninvasive Evaluation of Native Valvular Regurgitation',
    year: 2017,
    url: 'https://www.asecho.org/guideline/native-valvular-regurgitation-by-echo/',
    accessedAt: '2026-09-10',
    usedBy: ['regurgitation (future)'],
    verification: 'title-verified',
  },
  {
    id: 'ase-prosthetic-2024',
    society: 'ASE/SCMR/SCCT',
    title: 'Guidelines for the Evaluation of Prosthetic Valve Function With Cardiovascular Imaging',
    year: 2024,
    url: 'https://www.asecho.org/guideline/evaluation-of-prosthetic-valve-function/',
    accessedAt: '2026-09-10',
    usedBy: ['prosthetic valves (future)'],
    verification: 'title-verified',
  },
  {
    id: 'ase-eacvi-chamber-2015',
    society: 'ASE/EACVI',
    title: 'Recommendations for Cardiac Chamber Quantification by Echocardiography in Adults',
    year: 2015,
    url: 'https://www.asecho.org/guideline/cardiac-chamber-quantification-by-echo-in-adults/',
    accessedAt: '2026-09-10',
    usedBy: ['reference-values', 'simpson', 'chamber-dimensions'],
    verification: 'title-verified',
  },
  {
    id: 'ase-eacvi-aortic-stenosis-2017',
    society: 'EACVI/ASE',
    title:
      'Recommendations on the Echocardiographic Assessment of Aortic Valve Stenosis: A Focused Update',
    year: 2017,
    url: 'https://www.asecho.org/guideline/echocardiographic-assessment-of-aortic-valve-stenosis/',
    accessedAt: '2026-09-10',
    usedBy: ['aortic-stenosis-grading', 'continuity-equation'],
    verification: 'title-verified',
  },
];

export function getReference(id: string): GuidelineReference {
  const ref = GUIDELINE_REFERENCES.find((r) => r.id === id);
  if (!ref) throw new Error(`Unknown guideline reference id: ${id}`);
  return ref;
}
