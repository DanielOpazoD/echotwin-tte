import { useHudStore, useSimStore } from '@/app/store';
import { formatClinical } from '@/clinical/reference-values';

/** Developer panel (spec 15.4, 45). Never rendered in exam mode. */
export function DevPanel() {
  const s = useSimStore();
  const hud = useHudStore((h) => h.hud);
  const t = s.truth;
  if (s.mode === 'exam' || !s.ui.devPanel) return null;
  const rows: [string, string][] = [];
  if (hud) {
    rows.push(['frame', String(hud.frameId)], ['phase', hud.phase.toFixed(3)], ['beat', String(hud.beatIndex)], ['RR', `${(hud.rrS * 1000).toFixed(0)} ms`], ['sim fps', hud.simulatedFps.toFixed(1)]);
    for (const [k, v] of Object.entries(hud.stats)) rows.push([k, String(v)]);
    rows.push(['beam origin', hud.probeBeam.origin.map((x) => x.toFixed(1)).join(', ')], ['beam fwd', hud.probeBeam.forward.map((x) => x.toFixed(2)).join(', ')]);
    if (hud.view) rows.push(['view', `${hud.view.bestViewId} ${hud.view.score}`], ['plane err', `${hud.view.planeAngleDeg.toFixed(1)}° / rot ${hud.view.inPlaneRotationDeg.toFixed(1)}° / off ${hud.view.offsetCm.toFixed(1)} cm`], ['coverage', hud.view.heartCoverage.toFixed(2)], ['shadow', hud.view.shadowFraction.toFixed(2)]);
  }
  rows.push(['probe', `u ${s.probe.u.toFixed(1)} v ${s.probe.v.toFixed(1)} rot ${s.probe.rotationDeg.toFixed(0)} tilt ${s.probe.tiltDeg.toFixed(0)} rock ${s.probe.rockDeg.toFixed(0)} p ${s.probe.pressure.toFixed(2)}`]);
  const truthRows: [string, string][] = t
    ? [
        ['EDV / ESV', `${formatClinical(t.lv.edvMl, 'volumeMl')} / ${formatClinical(t.lv.esvMl, 'volumeMl')}`],
        ['EF', formatClinical(t.lv.efPct, 'percent')],
        ['SV / CO', `${formatClinical(t.lv.strokeVolumeMl, 'volumeMl')} / ${t.lv.cardiacOutputLpm.toFixed(1)} L/min`],
        ['LVEDD / IVS / PW', `${formatClinical(t.lv.eddCm, 'linearCm')} / ${formatClinical(t.lv.ivsdCm, 'linearCm')} / ${formatClinical(t.lv.lvpwdCm, 'linearCm')}`],
        ['LVOT d / VTI / Vmax', `${formatClinical(t.lvot.diameterCm, 'linearCm')} / ${formatClinical(t.lvot.vtiCm, 'vtiCm')} / ${formatClinical(t.lvot.vmaxMps, 'velocityMps')}`],
        ['AV Vmax / VTI', `${formatClinical(t.aorticValve.vmaxMps, 'velocityMps')} / ${formatClinical(t.aorticValve.vtiCm, 'vtiCm')}`],
        ['AV ΔP peak / mean', `${formatClinical(t.aorticValve.peakGradientMmHg, 'gradientMmHg')} / ${formatClinical(t.aorticValve.meanGradientMmHg, 'gradientMmHg')}`],
        ['AVA (cont.) / VR', `${formatClinical(t.aorticValve.continuityAvaCm2, 'areaCm2')} / ${t.aorticValve.velocityRatio.toFixed(2)}`],
        ['E / A / DT', `${formatClinical(t.mitral.ePeakMps, 'velocityMps')} / ${formatClinical(t.mitral.aPeakMps, 'velocityMps')} / ${formatClinical(t.mitral.decelerationTimeMs, 'timeMs')}`],
        ["e′ sept / lat / E/e′", `${t.mitral.ePrimeSeptalCmps} / ${t.mitral.ePrimeLateralCmps} / ${t.mitral.eOverEPrimeAvg.toFixed(1)}`],
        ['TR Vmax / RVSP', `${t.rightHeart.trVmaxMps ? formatClinical(t.rightHeart.trVmaxMps, 'velocityMps') : '—'} / ${t.rightHeart.rvspMmHg ? formatClinical(t.rightHeart.rvspMmHg, 'gradientMmHg') : '—'}`],
        ['LAVI', formatClinical(t.la.volumeIndexMlM2, 'volumeMl') + '/m²'],
      ]
    : [];
  return (
    <div className="dev" role="region" aria-label="Panel de desarrollador">
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
      <h4>Backend</h4>
      <div className="row">
        <button className={s.rendererBackend === 'atlas' ? 'active' : ''} onClick={() => s.setBackend('atlas')}>
          atlas
        </button>
        <button className={s.rendererBackend === 'procedural' ? 'active' : ''} onClick={() => s.setBackend('procedural')}>
          procedural
        </button>
        <button className={s.rendererBackend === 'webgl2' ? 'active' : ''} onClick={() => s.setBackend('webgl2')} title="Trazador en GPU (WebGL2); vuelve al procedimental si no está disponible">
          webgl2
        </button>
      </div>
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
