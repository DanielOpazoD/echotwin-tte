import { useHudStore, useSimStore } from '@/app/store';
import { useShallow } from 'zustand/shallow';
import { modePolicy } from '@/app/modePolicy';
import { formatClinical } from '@/clinical/reference-values';
import {
  ANATOMY_CHOICES,
  IMAGE_FORMATION_CHOICES,
  RENDERER_BACKEND_CHOICES,
  type AnatomyChoice,
  type ImageFormationChoice,
  type RendererBackendChoice,
} from '@/simulator/core/protocol';

const BACKEND_TITLES: Record<RendererBackendChoice, string> = {
  atlas: 'Caché de pose idéntica sobre la GPU (o la CPU si no hay WebGL2)',
  procedural: 'Trazador de referencia en CPU',
  webgl2: 'Trazador en GPU (WebGL2); vuelve al procedimental si no está disponible',
};

const ANATOMY_LABELS: Record<AnatomyChoice, [string, string]> = {
  analytic: ['analítica', 'El corazón del modelo analítico (por omisión)'],
  rodero: [
    'Rodero (experimental)',
    'El corazón medio de Rodero et al. 2021 (TC, CC BY 4.0) movido por el ciclo del caso, en la CPU y en la GPU',
  ],
};

const IMAGE_FORMATION_LABELS: Record<ImageFormationChoice, [string, string]> = {
  lattice: ['red', 'Fasor de red anclado al tejido en dos miradas promediadas (por omisión)'],
  cole: [
    'convolución (experimental)',
    'Dispersores puntuales anclados al tejido con los núcleos de un array de 64 elementos, en una mirada',
  ],
};

/** Developer panel (spec 15.4, 45). Never rendered in exam mode. */
export function DevPanel() {
  const s = useSimStore(
    useShallow((st) => ({
      mode: st.mode,
      probe: st.probe,
      rendererBackend: st.rendererBackend,
      setBackend: st.setBackend,
      anatomy: st.anatomy,
      setAnatomy: st.setAnatomy,
      imageFormation: st.imageFormation,
      setImageFormation: st.setImageFormation,
      truth: st.truth,
      ui: st.ui,
    })),
  );
  const hud = useHudStore((h) => h.hud);
  const t = s.truth;
  if (!modePolicy(s.mode).devToolsAllowed || !s.ui.devPanel) return null;
  const rows: [string, string][] = [];
  if (hud) {
    rows.push(
      ['frame', String(hud.frameId)],
      ['phase', hud.phase.toFixed(3)],
      ['beat', String(hud.beatIndex)],
      ['RR', `${(hud.rrS * 1000).toFixed(0)} ms`],
      ['sim fps', hud.simulatedFps.toFixed(1)],
      // the cadence the simulator forms frames at, bounded by the tier (decision 178)
      ['cadence', hud.cadenceHz.toFixed(1)],
    );
    for (const [k, v] of Object.entries(hud.stats)) rows.push([k, String(v)]);
    rows.push(
      ['beam origin', hud.probeBeam.origin.map((x) => x.toFixed(1)).join(', ')],
      ['beam fwd', hud.probeBeam.forward.map((x) => x.toFixed(2)).join(', ')],
    );
    if (hud.view)
      rows.push(
        ['view', `${hud.view.bestViewId} ${hud.view.score}`],
        [
          'plane err',
          `${hud.view.planeAngleDeg.toFixed(1)}° / rot ${hud.view.inPlaneRotationDeg.toFixed(1)}° / off ${hud.view.offsetCm.toFixed(1)} cm`,
        ],
        ['coverage', hud.view.heartCoverage.toFixed(2)],
        ['shadow', hud.view.shadowFraction.toFixed(2)],
      );
  }
  rows.push([
    'probe',
    `u ${s.probe.u.toFixed(1)} v ${s.probe.v.toFixed(1)} rot ${s.probe.rotationDeg.toFixed(0)} tilt ${s.probe.tiltDeg.toFixed(0)} rock ${s.probe.rockDeg.toFixed(0)} p ${s.probe.pressure.toFixed(2)}`,
  ]);
  const truthRows: [string, string][] = t
    ? [
        [
          'EDV / ESV',
          `${formatClinical(t.lv.edvMl, 'volumeMl')} / ${formatClinical(t.lv.esvMl, 'volumeMl')}`,
        ],
        ['EF', formatClinical(t.lv.efPct, 'percent')],
        [
          'SV / CO',
          `${formatClinical(t.lv.strokeVolumeMl, 'volumeMl')} / ${t.lv.cardiacOutputLpm.toFixed(1)} L/min`,
        ],
        [
          'LVEDD / IVS / PW',
          `${formatClinical(t.lv.eddCm, 'linearCm')} / ${formatClinical(t.lv.ivsdCm, 'linearCm')} / ${formatClinical(t.lv.lvpwdCm, 'linearCm')}`,
        ],
        [
          'LVOT d / VTI / Vmax',
          `${formatClinical(t.lvot.diameterCm, 'linearCm')} / ${formatClinical(t.lvot.vtiCm, 'vtiCm')} / ${formatClinical(t.lvot.vmaxMps, 'velocityMps')}`,
        ],
        [
          'AV Vmax / VTI',
          `${formatClinical(t.aorticValve.vmaxMps, 'velocityMps')} / ${formatClinical(t.aorticValve.vtiCm, 'vtiCm')}`,
        ],
        [
          'AV ΔP peak / mean',
          `${formatClinical(t.aorticValve.peakGradientMmHg, 'gradientMmHg')} / ${formatClinical(t.aorticValve.meanGradientMmHg, 'gradientMmHg')}`,
        ],
        [
          'AVA (cont.) / VR',
          `${formatClinical(t.aorticValve.continuityAvaCm2, 'areaCm2')} / ${t.aorticValve.velocityRatio.toFixed(2)}`,
        ],
        [
          'E / A / DT',
          `${formatClinical(t.mitral.ePeakMps, 'velocityMps')} / ${formatClinical(t.mitral.aPeakMps, 'velocityMps')} / ${formatClinical(t.mitral.decelerationTimeMs, 'timeMs')}`,
        ],
        [
          'e′ sept / lat / E/e′',
          `${t.mitral.ePrimeSeptalCmps} / ${t.mitral.ePrimeLateralCmps} / ${t.mitral.eOverEPrimeAvg.toFixed(1)}`,
        ],
        [
          'TR Vmax / RVSP',
          `${t.rightHeart.trVmaxMps ? formatClinical(t.rightHeart.trVmaxMps, 'velocityMps') : '—'} / ${t.rightHeart.rvspMmHg ? formatClinical(t.rightHeart.rvspMmHg, 'gradientMmHg') : '—'}`,
        ],
        ['LAVI', formatClinical(t.la.volumeIndexMlM2, 'volumeMl') + '/m²'],
      ]
    : [];
  return (
    <div className="dev" role="region" aria-label="Panel de desarrollador">
      {/* the experimental choices first, where they are seen without scrolling (decision 357) */}
      <h4>Anatomía</h4>
      <div className="row">
        {ANATOMY_CHOICES.map((a) => (
          <button
            key={a}
            className={s.anatomy === a ? 'active' : ''}
            aria-pressed={s.anatomy === a}
            onClick={() => s.setAnatomy(a)}
            data-tip={ANATOMY_LABELS[a][1]}
          >
            {ANATOMY_LABELS[a][0]}
          </button>
        ))}
      </div>
      <h4>Imagen</h4>
      <div className="row">
        {IMAGE_FORMATION_CHOICES.map((f) => (
          <button
            key={f}
            className={s.imageFormation === f ? 'active' : ''}
            aria-pressed={s.imageFormation === f}
            onClick={() => s.setImageFormation(f)}
            data-tip={IMAGE_FORMATION_LABELS[f][1]}
          >
            {IMAGE_FORMATION_LABELS[f][0]}
          </button>
        ))}
      </div>
      <h4>Backend</h4>
      <div className="row">
        {RENDERER_BACKEND_CHOICES.map((b) => (
          <button
            key={b}
            className={s.rendererBackend === b ? 'active' : ''}
            aria-pressed={s.rendererBackend === b}
            onClick={() => s.setBackend(b)}
            data-tip={BACKEND_TITLES[b]}
          >
            {b}
          </button>
        ))}
      </div>
      <h4>Runtime</h4>
      <table>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>Verdad de terreno (modelo)</h4>
      <table>
        <tbody>
          {truthRows.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
