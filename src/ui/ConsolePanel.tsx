import { hasGate, isSpectralModality, MODALITIES } from '@/simulator/renderer/modality';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useSimStore, type ConsoleTab, type SimStore } from '@/app/store';
import { useShallow } from 'zustand/shallow';
import { modePolicy } from '@/app/modePolicy';
import { Section, Slider, Segmented, Toggle } from './controls';
import { VIEW_TARGETS } from '@/simulator/windows/viewDefinitions';
import { MEASUREMENT_SPECS } from '@/simulator/measurements/protocol';
import { listCases } from '@/cases';
import { PresetViews } from './PresetViews';
import { MeasurementPanel } from './MeasurementPanel';
import { ArtifactLab } from './ArtifactLab';
import { ReviewPanel } from './ReviewPanel';
import { IconAcquire, IconDoppler, IconImage, IconLab, IconMeasure, IconReview } from './icons';

/** Section tooltips are teaching content — suppressed in exam mode like the other hints. */
function useTip() {
  const training = useSimStore((s) => s.mode !== 'exam');
  return (t: string) => (training ? t : undefined);
}

/**
 * Right-hand console, organised as tabs so only one control family is visible at a time
 * (spec 29.2). The console follows intent: entering a Doppler modality switches to the
 * Doppler tab; every control still alters the render.
 */
export function ConsolePanel() {
  const s = useSimStore(
    useShallow((st) => ({
      measurements: st.measurements,
      modality: st.modality,
      mode: st.mode,
      reviewCount: st.reviewMarkers.length,
      setUi: st.setUi,
      ui: st.ui,
    })),
  );
  const mod = s.modality;
  const policy = modePolicy(s.mode);

  // Follow the modality: enabling a Doppler mode surfaces its controls; returning to 2D
  // leaves the Doppler tab so the user is never left on an empty panel.
  useEffect(() => {
    const st = useSimStore.getState();
    if (mod !== '2d') st.setUi({ consoleTab: 'doppler' });
    else if (st.ui.consoleTab === 'doppler') st.setUi({ consoleTab: 'imagen' });
  }, [mod]);

  const tabs: {
    id: ConsoleTab;
    label: string;
    icon: ReactNode;
    show: boolean;
    badge?: number;
    dot?: boolean;
  }[] = [
    { id: 'adquirir', label: 'Adquirir', icon: <IconAcquire />, show: true },
    { id: 'imagen', label: 'Imagen', icon: <IconImage />, show: true },
    {
      id: 'doppler',
      label: 'Doppler',
      icon: <IconDoppler />,
      show: true,
      dot: MODALITIES[mod].doppler,
    },
    {
      id: 'medir',
      label: 'Medir',
      icon: <IconMeasure />,
      show: true,
      badge: s.measurements.length || undefined,
    },
    { id: 'lab', label: 'Lab', icon: <IconLab />, show: policy.devToolsAllowed },
    {
      id: 'revisar',
      label: 'Revisar',
      icon: <IconReview />,
      show: policy.devToolsAllowed && s.ui.reviewMode,
      badge: s.reviewCount || undefined,
    },
  ];
  const visible = tabs.filter((t) => t.show);
  const active = visible.some((t) => t.id === s.ui.consoleTab) ? s.ui.consoleTab : 'adquirir';
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onTabsKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = visible.findIndex((t) => t.id === active);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % visible.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + visible.length) % visible.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = visible.length - 1;
    if (n < 0) return;
    e.preventDefault();
    s.setUi({ consoleTab: visible[n]!.id });
    tabRefs.current[n]?.focus();
  };

  return (
    <div className="console">
      <div
        className="console-tabs"
        role="tablist"
        aria-label="Familia de controles"
        onKeyDown={onTabsKeyDown}
      >
        {visible.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`console-tab-${t.id}`}
            aria-selected={t.id === active}
            aria-controls={`console-panel-${t.id}`}
            tabIndex={t.id === active ? 0 : -1}
            className={t.id === active ? 'on' : ''}
            onClick={() => s.setUi({ consoleTab: t.id })}
          >
            {t.icon}
            <span>{t.label}</span>
            {t.badge ? (
              <span className="tab-badge" aria-hidden="true">
                {t.badge}
              </span>
            ) : null}
            {t.dot ? <span className="tab-dot" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
      <div className="console-scroll">
        <div
          role="tabpanel"
          id={`console-panel-${active}`}
          aria-labelledby={`console-tab-${active}`}
        >
          {active === 'adquirir' && <AcquireTab />}
          {active === 'imagen' && <ImageTab />}
          {active === 'doppler' && <DopplerTab />}
          {active === 'medir' && <MeasureTab />}
          {active === 'lab' && <LabTab />}
          {active === 'revisar' && <ReviewPanel />}
        </div>
      </div>
    </div>
  );
}

/** Acquisition: the window presets, probe manipulation and patient context. */
function AcquireTab() {
  const s = useSimStore(
    useShallow((st) => ({
      caseId: st.caseId,
      loadCase: st.loadCase,
      mode: st.mode,
      patient: st.patient,
      probe: st.probe,
      resetProbe: st.resetProbe,
      setPatient: st.setPatient,
      setProbe: st.setProbe,
      setTargetView: st.setTargetView,
      targetViewId: st.targetViewId,
    })),
  );
  const tip = useTip();
  return (
    <>
      <PresetViews />
      {s.mode === 'guided' && (
        <Section title="Vista objetivo (guiado)">
          <select
            aria-label="Vista objetivo"
            value={s.targetViewId ?? ''}
            onChange={(e) => s.setTargetView(e.target.value || null)}
          >
            <option value="">— libre —</option>
            {VIEW_TARGETS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Section>
      )}
      <Section title="Sonda">
        <Slider
          label="Rotación"
          hint="Q E"
          value={s.probe.rotationDeg}
          min={-180}
          max={180}
          unit="°"
          onChange={(v) => s.setProbe({ rotationDeg: v })}
          title={tip('Gira la sonda sobre su eje largo (Q/E).')}
        />
        <Slider
          label="Tilt (abanico)"
          hint="⌥↑↓"
          value={s.probe.tiltDeg}
          min={-70}
          max={70}
          unit="°"
          onChange={(v) => s.setProbe({ tiltDeg: v })}
          title={tip('Inclina el plano hacia adelante/atrás (Alt+↑↓).')}
        />
        <Slider
          label="Rock"
          hint="⌥←→"
          value={s.probe.rockDeg}
          min={-60}
          max={60}
          unit="°"
          onChange={(v) => s.setProbe({ rockDeg: v })}
          title={tip('Angula dentro del plano (Alt+←→).')}
        />
        <Slider
          label="Presión"
          hint="W S"
          value={s.probe.pressure}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => s.setProbe({ pressure: v })}
          title={tip('Poca presión = mal acoplamiento (dropout).')}
        />
        <div className="row small">
          <span>
            u {s.probe.u.toFixed(1)} · v {s.probe.v.toFixed(1)} cm
          </span>
          <button onClick={() => s.resetProbe()}>Reiniciar sonda</button>
        </div>
      </Section>
      <Section title="Caso y paciente">
        <div className="row stack">
          <label>Caso</label>
          <select
            aria-label="Caso"
            value={s.caseId}
            onChange={(e) => s.loadCase(e.target.value)}
            disabled={s.mode === 'exam'}
          >
            {listCases().map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <label>Posición</label>
          <select
            aria-label="Posición del paciente"
            value={s.patient.position}
            onChange={(e) =>
              s.setPatient({ position: e.target.value as typeof s.patient.position })
            }
          >
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
              { id: 'free-breathing', label: 'Libre' },
            ]}
          />
        </div>
      </Section>
    </>
  );
}

/** B-mode image controls: the frequent ones up front, the fine-tuning set under "Ajustes finos". */
function ImageTab() {
  const s = useSimStore(
    useShallow((st) => ({ setSettings: st.setSettings, setTgc: st.setTgc, settings: st.settings })),
  );
  const tip = useTip();
  return (
    <Section title="Imagen 2D">
      <Slider
        label="Profundidad"
        hint="[ ]"
        value={s.settings.depthCm}
        min={6}
        max={30}
        unit=" cm"
        onChange={(v) => s.setSettings({ depthCm: v })}
        title={tip('Más profundidad = menos frame rate y resolución.')}
      />
      <Slider
        label="Ganancia"
        hint="− +"
        value={s.settings.gainDb}
        min={-30}
        max={30}
        unit=" dB"
        onChange={(v) => s.setSettings({ gainDb: v })}
        title={tip('Exceso: la sangre se aclara hacia el gris del miocardio y sube el ruido.')}
      />
      <Slider
        label="Frecuencia"
        value={s.settings.frequencyMHz}
        min={1.5}
        max={5}
        step={0.25}
        unit=" MHz"
        format={(v) => `${v.toFixed(2)} MHz`}
        onChange={(v) => s.setSettings({ frequencyMHz: v })}
        title={tip('Mayor frecuencia = más resolución, menos penetración.')}
      />
      <Toggle
        label="Armónicos (THI)"
        value={s.settings.harmonics}
        onChange={(v) => s.setSettings({ harmonics: v })}
        title={tip('Reduce clutter y mejora bordes; algo menos de penetración.')}
      />
      <Slider
        label="Foco"
        value={s.settings.focusCm}
        min={2}
        max={s.settings.depthCm}
        step={0.5}
        unit=" cm"
        format={(v) => `${v.toFixed(1)} cm`}
        onChange={(v) => s.setSettings({ focusCm: v })}
        title={tip('Mejor resolución lateral cerca del foco.')}
      />
      <Slider
        label="Zoom"
        value={s.settings.zoom}
        min={1}
        max={2.5}
        step={0.1}
        format={(v) => `${v.toFixed(1)}×`}
        onChange={(v) => s.setSettings({ zoom: v })}
      />
      <Toggle
        label="Invertir izq/der"
        value={s.settings.invertLR}
        onChange={(v) => s.setSettings({ invertLR: v })}
      />
      <h4 className="subhead">TGC</h4>
      <div className="tgc" aria-label="TGC por profundidad">
        {s.settings.tgcDb.map((db, i) => (
          <input
            key={i}
            type="range"
            aria-label={`TGC banda ${i + 1}`}
            min={-15}
            max={15}
            step={1}
            value={db}
            onChange={(e) => s.setTgc(i, Number(e.target.value))}
          />
        ))}
      </div>
      <details className="adv">
        <summary>Ajustes finos</summary>
        <Slider
          label="Rango dinámico"
          value={s.settings.dynamicRangeDb}
          min={30}
          max={90}
          unit=" dB"
          onChange={(v) => s.setSettings({ dynamicRangeDb: v })}
          title={tip('Menor RD = imagen más contrastada.')}
        />
        <Slider
          label="Sector"
          value={s.settings.sectorDeg}
          min={30}
          max={100}
          unit="°"
          onChange={(v) => s.setSettings({ sectorDeg: v })}
          title={tip('Sector más ancho = menos frame rate.')}
        />
        <div className="row">
          <label>Densidad de líneas</label>
          <Segmented
            ariaLabel="Densidad de líneas"
            value={s.settings.lineDensity}
            onChange={(v) => s.setSettings({ lineDensity: v })}
            options={[
              { id: 'low', label: 'Baja' },
              { id: 'medium', label: 'Media' },
              { id: 'high', label: 'Alta' },
            ]}
          />
        </div>
        <Slider
          label="Persistencia"
          value={s.settings.persistence}
          min={0}
          max={0.9}
          step={0.05}
          onChange={(v) => s.setSettings({ persistence: v })}
        />
        <Slider
          label="Realce de bordes"
          value={s.settings.edgeEnhance}
          min={0}
          max={1}
          step={0.1}
          onChange={(v) => s.setSettings({ edgeEnhance: v })}
        />
        <div className="row">
          <label>Mapa de grises</label>
          <Segmented
            ariaLabel="Mapa de grises"
            value={s.settings.grayMap}
            onChange={(v) => s.setSettings({ grayMap: v })}
            options={[
              {
                id: 'clinical',
                label: 'Clín',
                title:
                  'Curva exponencial en dB que expande los grises altos, medida en imágenes clínicas',
              },
              { id: 'linear', label: 'Lin' },
              { id: 's-curve', label: 'S' },
              { id: 'high-contrast', label: 'Alto' },
            ]}
          />
        </div>
      </details>
    </Section>
  );
}

/** The contextual Doppler family, or an empty state with quick activators while in 2D. */
function DopplerTab() {
  const s = useSimStore(
    useShallow((st) => ({
      color: st.color,
      cursorThetaRad: st.cursorThetaRad,
      gateDepthCm: st.gateDepthCm,
      modality: st.modality,
      setColor: st.setColor,
      setCursor: st.setCursor,
      setModality: st.setModality,
      setSpectral: st.setSpectral,
      setUi: st.setUi,
      settings: st.settings,
      spectral: st.spectral,
    })),
  );
  const tip = useTip();
  const mod = s.modality;

  if (mod === '2d') {
    return (
      <div className="empty">
        <IconDoppler size={22} />
        <p>Activa una modalidad Doppler para ajustarla aquí.</p>
        <div className="quick">
          <button onClick={() => s.setModality('color')}>Color</button>
          <button onClick={() => s.setModality('pw')}>PW</button>
          <button onClick={() => s.setModality('cw')}>CW</button>
          <button onClick={() => s.setModality('tdi')}>TDI</button>
          <button onClick={() => s.setModality('m-mode')}>M</button>
        </div>
      </div>
    );
  }

  return (
    <>
      {mod === 'color' && (
        <Section title="Color Doppler">
          <Slider
            label="Ganancia color"
            value={s.color.gainDb}
            min={-20}
            max={20}
            unit=" dB"
            onChange={(v) => s.setColor({ gainDb: v })}
            title={tip('Exceso de ganancia produce blooming sobre el tejido.')}
          />
          <Slider
            label="Escala (Nyquist)"
            value={s.color.scaleMps}
            min={0.15}
            max={1.2}
            step={0.01}
            unit=" m/s"
            format={(v) => `${v.toFixed(2)} m/s`}
            onChange={(v) => s.setColor({ scaleMps: v })}
            title={tip('Escala baja = aliasing en flujos normales.')}
          />
          <Slider
            label="Persistencia"
            value={s.color.persistence}
            min={0}
            max={0.9}
            step={0.05}
            onChange={(v) => s.setColor({ persistence: v })}
          />
          <Toggle
            label="Mapa de varianza"
            value={s.color.showVariance}
            onChange={(v) => s.setColor({ showVariance: v })}
          />
          <Toggle
            label="Invertir mapa"
            value={s.color.invert}
            onChange={(v) => s.setColor({ invert: v })}
          />
          <details className="adv">
            <summary>Ajustes finos</summary>
            <Slider
              label="Línea base"
              value={s.color.baselineShiftMps}
              min={-0.6}
              max={0.6}
              step={0.02}
              unit=" m/s"
              format={(v) => `${v.toFixed(2)}`}
              onChange={(v) => s.setColor({ baselineShiftMps: v })}
            />
            <Slider
              label="Filtro de pared"
              value={s.color.wallFilterMps}
              min={0}
              max={0.3}
              step={0.01}
              format={(v) => `${Math.round(v * 100)} cm/s`}
              onChange={(v) => s.setColor({ wallFilterMps: v })}
            />
          </details>
          <div className="small">
            Arrastra la caja para moverla; Shift+arrastrar para redimensionar; clic fuera para crear
            otra.
          </div>
        </Section>
      )}
      {isSpectralModality(mod) && (
        <Section title={MODALITIES[mod].name}>
          <Slider
            label="Escala"
            value={s.spectral.scaleMps}
            min={mod === 'tdi' ? 0.1 : 0.3}
            max={mod === 'cw' ? 7 : mod === 'tdi' ? 0.4 : 2.5}
            step={0.05}
            format={(v) => `±${v.toFixed(2)} m/s`}
            onChange={(v) => s.setSpectral({ scaleMps: v })}
            title={tip(
              mod === 'pw'
                ? 'Si la velocidad supera Nyquist, el espectro se pliega (aliasing).'
                : 'CW no aliasa: integra todo el trayecto del haz.',
            )}
          />
          <Slider
            label="Ganancia espectral"
            value={s.spectral.gainDb}
            min={-20}
            max={20}
            unit=" dB"
            onChange={(v) => s.setSpectral({ gainDb: v })}
          />
          {hasGate(mod) && (
            <>
              <Slider
                label="Tamaño de gate"
                value={s.spectral.gateLengthCm}
                min={0.1}
                max={1.5}
                step={0.05}
                format={(v) => `${(v * 10).toFixed(0)} mm`}
                onChange={(v) => s.setSpectral({ gateLengthCm: v })}
                title={tip('Gate grande = ensanchamiento espectral.')}
              />
              <Slider
                label="Profundidad del gate"
                value={s.gateDepthCm}
                min={1}
                max={s.settings.depthCm}
                step={0.1}
                format={(v) => `${v.toFixed(1)} cm`}
                onChange={(v) => s.setCursor(s.cursorThetaRad, v)}
              />
            </>
          )}
          <Slider
            label="Ángulo del cursor"
            value={(s.cursorThetaRad * 180) / Math.PI}
            min={-s.settings.sectorDeg / 2}
            max={s.settings.sectorDeg / 2}
            unit="°"
            onChange={(v) => s.setCursor((v * Math.PI) / 180)}
          />
          <Toggle
            label="Invertir espectro"
            value={s.spectral.invert}
            onChange={(v) => s.setSpectral({ invert: v })}
          />
          <Toggle
            label="Audio Doppler"
            value={s.spectral.audioOn}
            onChange={(v) => s.setSpectral({ audioOn: v })}
          />
          <Slider
            label="Volumen"
            value={s.spectral.volume}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => s.setSpectral({ volume: v })}
            disabled={!s.spectral.audioOn}
          />
          <details className="adv">
            <summary>Ajustes finos</summary>
            <Slider
              label="Línea base"
              value={s.spectral.baselineShiftMps}
              min={-2}
              max={2}
              step={0.05}
              format={(v) => `${v.toFixed(2)} m/s`}
              onChange={(v) => s.setSpectral({ baselineShiftMps: v })}
            />
            <Slider
              label="Filtro de pared"
              value={s.spectral.wallFilterMps}
              min={0}
              max={0.4}
              step={0.01}
              format={(v) => `${Math.round(v * 100)} cm/s`}
              onChange={(v) => s.setSpectral({ wallFilterMps: v })}
            />
            <div className="row">
              <label>Velocidad de barrido</label>
              <Segmented
                ariaLabel="Velocidad de barrido"
                value={String(s.spectral.sweepSpeedMmPerS)}
                onChange={(v) => s.setSpectral({ sweepSpeedMmPerS: Number(v) })}
                options={[
                  { id: '25', label: '25' },
                  { id: '50', label: '50' },
                  { id: '100', label: '100' },
                ]}
              />
            </div>
          </details>
          <div className="small">
            Clic/arrastrar sobre la imagen 2D mueve el cursor{mod !== 'cw' ? ' y el gate' : ''}.
          </div>
        </Section>
      )}
      {mod === 'm-mode' && (
        <Section title="M-mode">
          <div className="row">
            <label>Velocidad de barrido</label>
            <Segmented
              ariaLabel="Velocidad de barrido"
              value={String(s.spectral.sweepSpeedMmPerS)}
              onChange={(v) => s.setSpectral({ sweepSpeedMmPerS: Number(v) })}
              options={[
                { id: '25', label: '25' },
                { id: '50', label: '50' },
                { id: '100', label: '100' },
              ]}
            />
          </div>
          <Slider
            label="Ángulo del cursor"
            value={(s.cursorThetaRad * 180) / Math.PI}
            min={-s.settings.sectorDeg / 2}
            max={s.settings.sectorDeg / 2}
            unit="°"
            onChange={(v) => s.setCursor((v * Math.PI) / 180)}
          />
        </Section>
      )}
      {mod === 'cmm' && (
        <div className="empty">
          <IconDoppler size={22} />
          <p>Modo M con color: ajusta el sector en «Imagen» y el mapa en «Color».</p>
          <div className="quick">
            <button onClick={() => s.setUi({ consoleTab: 'imagen' })}>Imagen</button>
          </div>
        </div>
      )}
    </>
  );
}

const FREE_TOOL_HINT: Partial<Record<SimStore['activeTool'], string>> = {
  caliper: 'Marca los dos extremos de la distancia sobre la imagen 2D.',
  velocity: 'Haz clic en el pico del espectro Doppler.',
  vti: 'Traza la envolvente punto a punto; doble clic cierra el trazado.',
  'auto-vti': 'Marca el inicio y el fin del latido sobre el espectro.',
  time: 'Marca los dos instantes del intervalo sobre el strip.',
  slope: 'Marca el pico y luego un punto sobre la pendiente de caída.',
  simpson: 'Traza el endocardio con al menos 5 puntos; doble clic cierra.',
  tapse: 'Marca la excursión del anillo tricuspídeo en el modo M.',
};

/** Protocol measurements, free tools and the captured list. */
function MeasureTab() {
  const s = useSimStore(
    useShallow((st) => ({
      activeMeasurementId: st.activeMeasurementId,
      activeTool: st.activeTool,
      measurements: st.measurements,
      mode: st.mode,
      removeMeasurement: st.removeMeasurement,
      setActiveMeasurement: st.setActiveMeasurement,
      setActiveTool: st.setActiveTool,
    })),
  );
  const tools: { id: typeof s.activeTool; label: string; title?: string }[] = [
    { id: 'none', label: '—', title: 'Ninguna herramienta' },
    { id: 'caliper', label: 'Caliper', title: 'Distancia lineal (2D)' },
    { id: 'velocity', label: 'Vel', title: 'Velocidad pico sobre el espectro' },
    { id: 'vti', label: 'VTI', title: 'Trazado manual del envelope' },
    { id: 'auto-vti', label: 'VTI auto', title: 'Envolvente automática entre dos instantes' },
    { id: 'time', label: 't', title: 'Intervalo de tiempo' },
    { id: 'slope', label: 'TD', title: 'Tiempo de desaceleración (pico → pendiente)' },
    {
      id: 'simpson',
      label: 'Simpson',
      title: 'Volumen del VI por discos (trazado del endocardio)',
    },
    { id: 'tapse', label: 'TAPSE', title: 'Excursión vertical en modo M' },
  ];
  const armed = s.activeMeasurementId ? 'none' : s.activeTool;
  const capturing = Boolean(s.activeMeasurementId) || s.activeTool !== 'none';
  if (capturing) {
    const spec = s.activeMeasurementId
      ? MEASUREMENT_SPECS.find((m) => m.id === s.activeMeasurementId)
      : undefined;
    const tool = tools.find((t) => t.id === s.activeTool);
    const cancel = () =>
      s.activeMeasurementId ? s.setActiveMeasurement(null) : s.setActiveTool('none');
    return (
      <>
        <Section title="Midiendo">
          {/* a live region: screen readers and the E2E flow learn which tool is armed and how to use it */}
          <div role="status">
            <div className="capture-head">
              <span className="capture-dot" aria-hidden="true" />
              <b>{spec ? spec.label : (tool?.title ?? tool?.label ?? s.activeTool)}</b>
            </div>
            {spec && (
              <div className="small">
                {spec.modalities.map((m) => m.toUpperCase()).join('/')} ·{' '}
                {spec.views.map((v) => v.toUpperCase()).join('/')}
              </div>
            )}
            <p className="capture-hint">{spec ? spec.instruction : FREE_TOOL_HINT[s.activeTool]}</p>
          </div>
          <button className="capture-cancel" onClick={cancel}>
            Cancelar <span className="small">(Esc)</span>
          </button>
        </Section>
        <Section title={`Mediciones (${s.measurements.length})`}>
          <MeasureList s={s} showView={modePolicy(s.mode).showViewFeedback} />
        </Section>
      </>
    );
  }
  return (
    <>
      <Section title="Protocolo de medición">
        <MeasurementPanel />
      </Section>
      <Section title="Herramientas libres">
        <div className="small">Sin evaluación de técnica:</div>
        <div className="tool-grid" role="group" aria-label="Herramienta de medición">
          {tools.map((t) => (
            <button
              key={t.id}
              className={t.id === armed ? 'on' : ''}
              aria-pressed={t.id === armed}
              aria-label={t.id === 'none' ? 'Ninguna herramienta' : undefined}
              title={t.title}
              onClick={() => s.setActiveTool(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <MeasureList s={s} showView={modePolicy(s.mode).showViewFeedback} />
      </Section>
    </>
  );
}

/** `showView` false (exam) leaves out the view each measurement was taken in: it names the view (decision 154). */
function MeasureList({
  s,
  showView,
}: {
  s: Pick<SimStore, 'measurements' | 'removeMeasurement'>;
  showView: boolean;
}) {
  return (
    <div className="measure-list">
      {s.measurements.length === 0 && (
        <div className="small">Sin mediciones. Congela (Espacio) y usa una herramienta.</div>
      )}
      {s.measurements.map((m) => (
        <div key={m.id}>
          <span>
            {m.label} ({m.modality}
            {showView && m.sourceViewId ? `, ${m.sourceViewId}` : ''})
          </span>
          <span>
            {m.value.toFixed(m.kind === 'time' || m.kind === 'volume' ? 0 : 2)} {m.units}
            {m.derived?.gradientMmHg !== undefined
              ? ` · ${m.derived.gradientMmHg.toFixed(0)} mmHg`
              : ''}
            {m.derived?.meanGradientMmHg !== undefined
              ? ` · media ${m.derived.meanGradientMmHg.toFixed(0)} mmHg`
              : ''}
          </span>
          <button aria-label="Eliminar medición" onClick={() => s.removeMeasurement(m.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** Artifact laboratory — a teaching tool, hidden in exam mode. */
function LabTab() {
  return (
    <Section title="Laboratorio de artefactos">
      <ArtifactLab />
    </Section>
  );
}
