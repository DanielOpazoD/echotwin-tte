import { useSimStore } from '@/app/store';
import { useShallow } from 'zustand/shallow';
import { loadCaseById } from '@/cases';
import { MEASUREMENT_SPECS, type MeasurementSpec } from '@/simulator/measurements/protocol';

const GROUP_LABEL: Record<MeasurementSpec['group'], string> = {
  lv: 'Ventrículo izquierdo',
  'lvot-av': 'TSVI y válvula aórtica',
  diastole: 'Función diastólica',
  right: 'Corazón derecho',
  atria: 'Aurículas',
};

/**
 * Measurement protocol panel (spec 16, 28): the case's required measurements first, then the rest
 * of the catalogue by group. Selecting one arms its tool with the semantic id, shows the technique
 * instruction and, once captured, the technique grade with its findings.
 */
export function MeasurementPanel() {
  const s = useSimStore(
    useShallow((st) => ({
      activeMeasurementId: st.activeMeasurementId,
      caseId: st.caseId,
      measurements: st.measurements,
      setActiveMeasurement: st.setActiveMeasurement,
    })),
  );
  const caseDef = loadCaseById(s.caseId);
  const requiredIds = caseDef.requiredMeasurements.map((r) => r.measurementId);
  const latestOf = (id: string) => {
    for (let i = s.measurements.length - 1; i >= 0; i--)
      if (s.measurements[i]!.measurementId === id) return s.measurements[i]!;
    return null;
  };
  const row = (spec: MeasurementSpec) => {
    const m = latestOf(spec.id);
    const level = m?.technique
      ? m.technique.findings.some((f) => f.level === 'invalid')
        ? 'invalid'
        : m.technique.findings.some((f) => f.level === 'warn')
          ? 'warn'
          : 'ok'
      : null;
    const isActive = s.activeMeasurementId === spec.id;
    return (
      <div
        key={spec.id}
        className={`protocol-row ${isActive ? 'active' : ''}`}
        data-measurement={spec.id}
      >
        <button
          className={isActive ? 'active' : ''}
          onClick={() => s.setActiveMeasurement(isActive ? null : spec.id)}
          title={spec.instruction}
          aria-label={`Medir ${spec.label}`}
        >
          {spec.shortLabel}
        </button>
        <span className="protocol-value">
          {m
            ? `${m.value.toFixed(spec.kind === 'time' || spec.kind === 'volume' ? 0 : spec.units === 'cm/s' ? 1 : 2)} ${spec.units}`
            : '—'}
          {level && (
            <span
              className={`pill ${level === 'ok' ? 'ok' : level === 'warn' ? 'warn' : 'bad'}`}
              title={
                m?.technique?.findings
                  .filter((f) => f.level !== 'ok')
                  .map((f) => f.message)
                  .join(' ') ?? ''
              }
            >
              {level === 'ok' ? 'técnica ok' : level === 'warn' ? 'revisar' : 'inválida'}
            </span>
          )}
        </span>
      </div>
    );
  };
  const required = MEASUREMENT_SPECS.filter((m) => requiredIds.includes(m.id));
  const groups = (['lv', 'lvot-av', 'diastole', 'right', 'atria'] as const).map((g) => ({
    g,
    items: MEASUREMENT_SPECS.filter((m) => m.group === g && !requiredIds.includes(m.id)),
  }));
  return (
    <div className="protocol">
      {required.length > 0 && (
        <>
          <div className="small">Requeridas por el caso</div>
          {required.map(row)}
        </>
      )}
      {groups.map(({ g, items }) =>
        items.length ? (
          <details key={g}>
            <summary className="small">{GROUP_LABEL[g]}</summary>
            {items.map(row)}
          </details>
        ) : null,
      )}
    </div>
  );
}
