import { useSimStore } from '@/app/store';
import { Section, Slider, Segmented, Toggle } from './controls';
import { VIEW_TARGETS } from '@/simulator/windows/viewTargets';
import { listCases } from '@/cases';
import { PresetViews } from './PresetViews';
import { MeasurementPanel } from './MeasurementPanel';
import { ArtifactLab } from './ArtifactLab';

/** Right-hand console: controls grouped by modality (spec 29.2). Every control alters the render. */
export function ConsolePanel() {
  const s = useSimStore();
  const mod = s.modality;
  const training = s.mode !== 'exam';
  const tip = (t: string) => (training ? t : undefined);
  return (
    <div>
      <PresetViews />
      <Section title="Caso y paciente">
        <div className="row">
          <label>Caso</label>
          <select aria-label="Caso" value={s.caseId} onChange={(e) => s.loadCase(e.target.value)} disabled={s.mode === 'exam'}>
            {listCases().map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <label>Posición</label>
          <select aria-label="Posición del paciente" value={s.patient.position} onChange={(e) => s.setPatient({ position: e.target.value as typeof s.patient.position })}>
            <option value="left-lateral">Decúbito lateral izq.</option>
            <option value="supine">Supino</option>
            <option value="subcostal-supine">Supino (subcostal)</option>
          </select>
        </div>
        <div className="row">
          <label>Respiración</label>
          <Segmented
            ariaLabel="Respiración"
            value={s.patient.respiration}
            onChange={(v) => s.setPatient({ respiration: v })}
            options={[
              { id: 'expiration', label: 'Esp' },
              { id: 'breath-hold', label: 'Apnea' },
              { id: 'inspiration', label: 'Insp' },
            ]}
          />
        </div>
      </Section>
      <Section title="Sonda">
        <Slider label="Rotación" value={s.probe.rotationDeg} min={-180} max={180} unit="°" onChange={(v) => s.setProbe({ rotationDeg: v })} title={tip('Gira la sonda sobre su eje largo (Q/E).')} />
        <Slider label="Tilt (abanico)" value={s.probe.tiltDeg} min={-70} max={70} unit="°" onChange={(v) => s.setProbe({ tiltDeg: v })} title={tip('Inclina el plano hacia adelante/atrás (Alt+↑↓).')} />
        <Slider label="Rock" value={s.probe.rockDeg} min={-60} max={60} unit="°" onChange={(v) => s.setProbe({ rockDeg: v })} title={tip('Angula dentro del plano (Alt+←→).')} />
        <Slider label="Presión" value={s.probe.pressure} min={0} max={1} step={0.05} onChange={(v) => s.setProbe({ pressure: v })} title={tip('Poca presión = mal acoplamiento (dropout).')} />
        <div className="row small">
          <span>u {s.probe.u.toFixed(1)} · v {s.probe.v.toFixed(1)} cm</span>
          <button onClick={() => s.resetProbe()}>Reiniciar sonda</button>
        </div>
      </Section>
      <Section title="2D">
        <Slider label="Profundidad" value={s.settings.depthCm} min={6} max={30} unit=" cm" onChange={(v) => s.setSettings({ depthCm: v })} title={tip('Más profundidad = menos frame rate y resolución.')} />
        <Slider label="Ganancia" value={s.settings.gainDb} min={-30} max={30} unit=" dB" onChange={(v) => s.setSettings({ gainDb: v })} title={tip('Exceso: la sangre se aclara hacia el gris del miocardio y sube el ruido.')} />
        <Slider label="Rango dinámico" value={s.settings.dynamicRangeDb} min={30} max={90} unit=" dB" onChange={(v) => s.setSettings({ dynamicRangeDb: v })} title={tip('Menor RD = imagen más contrastada.')} />
        <Slider label="Frecuencia" value={s.settings.frequencyMHz} min={1.5} max={5} step={0.25} unit=" MHz" format={(v) => `${v.toFixed(2)} MHz`} onChange={(v) => s.setSettings({ frequencyMHz: v })} title={tip('Mayor frecuencia = más resolución, menos penetración.')} />
        <Toggle label="Armónicos (THI)" value={s.settings.harmonics} onChange={(v) => s.setSettings({ harmonics: v })} title={tip('Reduce clutter y mejora bordes; algo menos de penetración.')} />
        <Slider label="Foco" value={s.settings.focusCm} min={2} max={s.settings.depthCm} step={0.5} unit=" cm" format={(v) => `${v.toFixed(1)} cm`} onChange={(v) => s.setSettings({ focusCm: v })} title={tip('Mejor resolución lateral cerca del foco.')} />
        <Slider label="Sector" value={s.settings.sectorDeg} min={30} max={100} unit="°" onChange={(v) => s.setSettings({ sectorDeg: v })} title={tip('Sector más ancho = menos frame rate.')} />
        <div className="row">
          <label>Densidad de líneas</label>
          <Segmented ariaLabel="Densidad de líneas" value={s.settings.lineDensity} onChange={(v) => s.setSettings({ lineDensity: v })} options={[{ id: 'low', label: 'Baja' }, { id: 'medium', label: 'Media' }, { id: 'high', label: 'Alta' }]} />
        </div>
        <Slider label="Persistencia" value={s.settings.persistence} min={0} max={0.9} step={0.05} onChange={(v) => s.setSettings({ persistence: v })} />
        <Slider label="Realce de bordes" value={s.settings.edgeEnhance} min={0} max={1} step={0.1} onChange={(v) => s.setSettings({ edgeEnhance: v })} />
        <div className="row">
          <label>Mapa de grises</label>
          <Segmented ariaLabel="Mapa de grises" value={s.settings.grayMap} onChange={(v) => s.setSettings({ grayMap: v })} options={[{ id: 'linear', label: 'Lin' }, { id: 's-curve', label: 'S' }, { id: 'high-contrast', label: 'Alto' }]} />
        </div>
        <Slider label="Zoom" value={s.settings.zoom} min={1} max={2.5} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => s.setSettings({ zoom: v })} />
        <Toggle label="Invertir izq/der" value={s.settings.invertLR} onChange={(v) => s.setSettings({ invertLR: v })} />
        <h4 style={{ marginTop: 8 }}>TGC</h4>
        <div className="tgc" aria-label="TGC por profundidad">
          {s.settings.tgcDb.map((db, i) => (
            <input key={i} type="range" aria-label={`TGC banda ${i + 1}`} min={-15} max={15} step={1} value={db} onChange={(e) => s.setTgc(i, Number(e.target.value))} />
          ))}
        </div>
      </Section>
      {mod === 'color' && (
        <Section title="Color Doppler">
          <Slider label="Ganancia color" value={s.color.gainDb} min={-20} max={20} unit=" dB" onChange={(v) => s.setColor({ gainDb: v })} title={tip('Exceso de ganancia produce blooming sobre el tejido.')} />
          <Slider label="Escala (Nyquist)" value={s.color.scaleMps} min={0.15} max={1.2} step={0.01} unit=" m/s" format={(v) => `${v.toFixed(2)} m/s`} onChange={(v) => s.setColor({ scaleMps: v })} title={tip('Escala baja = aliasing en flujos normales.')} />
          <Slider label="Línea base" value={s.color.baselineShiftMps} min={-0.6} max={0.6} step={0.02} unit=" m/s" format={(v) => `${v.toFixed(2)}`} onChange={(v) => s.setColor({ baselineShiftMps: v })} />
          <Slider label="Filtro de pared" value={s.color.wallFilterMps} min={0} max={0.3} step={0.01} format={(v) => `${Math.round(v * 100)} cm/s`} onChange={(v) => s.setColor({ wallFilterMps: v })} />
          <Slider label="Persistencia" value={s.color.persistence} min={0} max={0.9} step={0.05} onChange={(v) => s.setColor({ persistence: v })} />
          <Toggle label="Mapa de varianza" value={s.color.showVariance} onChange={(v) => s.setColor({ showVariance: v })} />
          <Toggle label="Invertir mapa" value={s.color.invert} onChange={(v) => s.setColor({ invert: v })} />
          <div className="small">Arrastra la caja para moverla; Shift+arrastrar para redimensionar; clic fuera para crear otra.</div>
        </Section>
      )}
      {(mod === 'pw' || mod === 'cw' || mod === 'tdi') && (
        <Section title={mod === 'pw' ? 'Doppler pulsado' : mod === 'cw' ? 'Doppler continuo' : 'Doppler tisular'}>
          <Slider label="Escala" value={s.spectral.scaleMps} min={mod === 'tdi' ? 0.1 : 0.3} max={mod === 'cw' ? 7 : mod === 'tdi' ? 0.4 : 2.5} step={0.05} format={(v) => `±${v.toFixed(2)} m/s`} onChange={(v) => s.setSpectral({ scaleMps: v })} title={tip(mod === 'pw' ? 'Si la velocidad supera Nyquist, el espectro se pliega (aliasing).' : 'CW no aliasa: integra todo el trayecto del haz.')} />
          <Slider label="Línea base" value={s.spectral.baselineShiftMps} min={-2} max={2} step={0.05} format={(v) => `${v.toFixed(2)} m/s`} onChange={(v) => s.setSpectral({ baselineShiftMps: v })} />
          <Slider label="Ganancia espectral" value={s.spectral.gainDb} min={-20} max={20} unit=" dB" onChange={(v) => s.setSpectral({ gainDb: v })} />
          <Slider label="Filtro de pared" value={s.spectral.wallFilterMps} min={0} max={0.4} step={0.01} format={(v) => `${Math.round(v * 100)} cm/s`} onChange={(v) => s.setSpectral({ wallFilterMps: v })} />
          <div className="row">
            <label>Velocidad de barrido</label>
            <Segmented ariaLabel="Velocidad de barrido" value={String(s.spectral.sweepSpeedMmPerS)} onChange={(v) => s.setSpectral({ sweepSpeedMmPerS: Number(v) })} options={[{ id: '25', label: '25' }, { id: '50', label: '50' }, { id: '100', label: '100' }]} />
          </div>
          {(mod === 'pw' || mod === 'tdi') && (
            <>
              <Slider label="Tamaño de gate" value={s.spectral.gateLengthCm} min={0.1} max={1.5} step={0.05} format={(v) => `${(v * 10).toFixed(0)} mm`} onChange={(v) => s.setSpectral({ gateLengthCm: v })} title={tip('Gate grande = ensanchamiento espectral.')} />
              <Slider label="Profundidad del gate" value={s.gateDepthCm} min={1} max={s.settings.depthCm} step={0.1} format={(v) => `${v.toFixed(1)} cm`} onChange={(v) => s.setCursor(s.cursorThetaRad, v)} />
            </>
          )}
          <Slider label="Ángulo del cursor" value={(s.cursorThetaRad * 180) / Math.PI} min={-s.settings.sectorDeg / 2} max={s.settings.sectorDeg / 2} unit="°" onChange={(v) => s.setCursor((v * Math.PI) / 180)} />
          <Toggle label="Invertir espectro" value={s.spectral.invert} onChange={(v) => s.setSpectral({ invert: v })} />
          <Toggle label="Audio Doppler" value={s.spectral.audioOn} onChange={(v) => s.setSpectral({ audioOn: v })} />
          <Slider label="Volumen" value={s.spectral.volume} min={0} max={1} step={0.05} onChange={(v) => s.setSpectral({ volume: v })} disabled={!s.spectral.audioOn} />
          <div className="small">Clic/arrastrar sobre la imagen 2D mueve el cursor{mod !== 'cw' ? ' y el gate' : ''}.</div>
        </Section>
      )}
      {mod === 'm-mode' && (
        <Section title="M-mode">
          <div className="row">
            <label>Velocidad de barrido</label>
            <Segmented ariaLabel="Velocidad de barrido" value={String(s.spectral.sweepSpeedMmPerS)} onChange={(v) => s.setSpectral({ sweepSpeedMmPerS: Number(v) })} options={[{ id: '25', label: '25' }, { id: '50', label: '50' }, { id: '100', label: '100' }]} />
          </div>
          <Slider label="Ángulo del cursor" value={(s.cursorThetaRad * 180) / Math.PI} min={-s.settings.sectorDeg / 2} max={s.settings.sectorDeg / 2} unit="°" onChange={(v) => s.setCursor((v * Math.PI) / 180)} />
        </Section>
      )}
      {s.mode === 'guided' && (
        <Section title="Vista objetivo (guiado)">
          <select aria-label="Vista objetivo" value={s.targetViewId ?? ''} onChange={(e) => s.setTargetView(e.target.value || null)}>
            <option value="">— libre —</option>
            {VIEW_TARGETS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Section>
      )}
      <Section title="Laboratorio de artefactos">
        <ArtifactLab />
      </Section>
      <Section title="Mediciones">
        <MeasurementPanel />
        <div className="small">Herramientas libres (sin evaluación de técnica):</div>
        <div className="row">
          <Segmented
            ariaLabel="Herramienta de medición"
            value={s.activeMeasurementId ? 'none' : s.activeTool}
            onChange={(v) => s.setActiveTool(v)}
            options={[
              { id: 'none', label: '—' },
              { id: 'caliper', label: 'Caliper', title: 'Distancia lineal (2D)' },
              { id: 'velocity', label: 'Vel', title: 'Velocidad pico sobre el espectro' },
              { id: 'vti', label: 'VTI', title: 'Trazado manual del envelope' },
              { id: 'auto-vti', label: 'VTI auto', title: 'Envolvente automática entre dos instantes' },
              { id: 'time', label: 't', title: 'Intervalo de tiempo' },
              { id: 'slope', label: 'TD', title: 'Tiempo de desaceleración (pico → pendiente)' },
              { id: 'simpson', label: 'Simpson', title: 'Volumen del VI por discos (trazado del endocardio)' },
              { id: 'tapse', label: 'TAPSE', title: 'Excursión vertical en modo M' },
            ]}
          />
        </div>
        <div className="measure-list">
          {s.measurements.length === 0 && <div className="small">Sin mediciones. Congela (Espacio) y usa una herramienta.</div>}
          {s.measurements.map((m) => (
            <div key={m.id}>
              <span>
                {m.label} ({m.modality}{m.sourceViewId ? `, ${m.sourceViewId}` : ''})
              </span>
              <span>
                {m.value.toFixed(m.kind === 'time' || m.kind === 'volume' ? 0 : 2)} {m.units}
                {m.derived?.gradientMmHg !== undefined ? ` · ${m.derived.gradientMmHg.toFixed(0)} mmHg` : ''}
                {m.derived?.meanGradientMmHg !== undefined ? ` · media ${m.derived.meanGradientMmHg.toFixed(0)} mmHg` : ''}
              </span>
              <button aria-label="Eliminar medición" onClick={() => s.removeMeasurement(m.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
