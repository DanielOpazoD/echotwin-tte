import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';
import { expectedFindings } from './impression';

/**
 * A case's written impression and the findings its truth makes the scorer expect say the same thing. Five cases said
 * «alteración de la relajación» where the model found no dysfunction, or left out what the scorer expects (pulmonary
 * hypertension, RV dysfunction, a dilated LA), and the artifact case called its LA dilated at 30 mL/m²: a learner who
 * followed the case text lost points. Each claim the text can make is read with a pattern; a finding the scorer expects
 * must be stated, and a claim stated must be expected.
 */
const IMPRESSION_CLAIMS: { id: string; re: RegExp }[] = [
  { id: 'lvh', re: /hipertrofia (concéntrica|ventricular izquierda|del ventrículo izquierdo)/i },
  { id: 'asymmetric-septal-hypertrophy', re: /hipertrofia septal asimétrica/i },
  {
    id: 'lv-dilated',
    re: /ventrículo izquierdo (severamente |moderadamente |levemente )?dilatado/i,
  },
  { id: 'la-dilated', re: /aurícula izquierda (severamente |moderadamente |levemente )?dilatada/i },
  {
    id: 'rv-dilated',
    re: /ventrículo derecho (severamente |moderadamente |levemente )?dilatado|VD dilatado/i,
  },
  {
    id: 'rv-dysfunction',
    re: /(ventrículo derecho|VD)[^.]*disfunción|disfunción[^.]*del (VD|ventrículo derecho)/i,
  },
  {
    id: 'ph-probable',
    re: /hipertensión pulmonar|presión sistólica pulmonar (levemente )?elevada|PSVD/i,
  },
  { id: 'diastolic-dysfunction', re: /disfunción diastólica|alteración de la relajación/i },
  { id: 'filling-pressure-elevated', re: /presi(ón|ones) de llenado (izquierda )?elevadas?/i },
  { id: 'filling-pressure-indeterminate', re: /presión de llenado indeterminada/i },
  { id: 'mr-mild', re: /insuficiencia mitral[^.;]*leve/i },
  { id: 'mr-moderate', re: /insuficiencia mitral[^.;]*moderad/i },
  { id: 'mr-severe', re: /insuficiencia mitral[^.;]*severa/i },
  { id: 'as-mild', re: /estenosis (aórtica )?leve|esclerosis aórtica/i },
  { id: 'as-moderate', re: /estenosis aórtica moderada/i },
  { id: 'as-severe', re: /estenosis aórtica severa/i },
  { id: 'effusion', re: /(?<!sin )derrame/i },
  { id: 'tamponade', re: /taponamiento/i },
  { id: 'af', re: /fibrilación auricular/i },
  { id: 'lvot-obstruction', re: /obstrucción dinámica del TSVI/i },
  { id: 'rwma', re: /segmentaria|acinesia|acinético/i },
  { id: 'tr-significant', re: /insuficiencia tricuspídea (moderada|severa)/i },
];

describe('the case impressions match the expected findings', () => {
  for (const input of CASE_INPUTS)
    it(input.id, () => {
      const c = loadCaseById(input.id);
      const expected = new Set(expectedFindings(computeGroundTruth(c)));
      const text = c.impressionTruth.join(' ');
      const said = IMPRESSION_CLAIMS.filter((k) => k.re.test(text)).map((k) => k.id);
      const notSaid = [...expected].filter(
        (id) => IMPRESSION_CLAIMS.some((k) => k.id === id) && !said.includes(id),
      );
      const notExpected = said.filter((id) => !expected.has(id));
      expect({ notSaid, notExpected }).toEqual({ notSaid: [], notExpected: [] });
    });
});
