import { useSimStore } from '@/app/store';
import { loadCaseById } from '@/cases';

/**
 * Artifact laboratory (spec 12, proposal 6): the learner turns each artifact up or down live and reads
 * its physical cause and the remedy. Overrides replace the case's own artifact configuration.
 */
const ITEMS: {
  key: 'sideLobe' | 'mirror' | 'beamWidth' | 'clutter';
  label: string;
  cause: string;
  remedy: string;
}[] = [
  {
    key: 'clutter',
    label: 'Clutter de campo cercano',
    cause:
      'Reverberaciones entre la sonda y las capas superficiales (piel, grasa, costillas) llenan de ecos difusos los primeros centímetros.',
    remedy:
      'Más presión y gel, armónicos (menos energía en el campo cercano), foco más superficial y TGC baja en el campo cercano.',
  },
  {
    key: 'sideLobe',
    label: 'Lóbulos laterales',
    cause:
      'Energía emitida fuera del haz principal: un reflector fuerte (pericardio, calcio, cuerdas) aparece «copiado» en líneas vecinas, como un velo lateral.',
    remedy:
      'Reducir la ganancia, usar armónicos y cambiar ligeramente el ángulo para separar el reflector fuerte de la estructura de interés.',
  },
  {
    key: 'mirror',
    label: 'Imagen en espejo',
    cause:
      'Una interfaz muy reflectante (pericardio, pleura, diafragma) actúa de espejo: la imagen superficial se repite, atenuada, más allá de la interfaz.',
    remedy:
      'Reconocer la simetría respecto de la interfaz y comprobar la estructura desde otra ventana; no medir ni interpretar el duplicado.',
  },
  {
    key: 'beamWidth',
    label: 'Anchura del haz',
    cause:
      'Lejos del foco el haz es más ancho: los puntos se ven como trazos laterales y las estructuras finas se emborronan.',
    remedy:
      'Colocar el foco a la profundidad de interés, usar mayor frecuencia si la penetración lo permite y reducir la profundidad.',
  },
];

export function ArtifactLab() {
  const lab = useSimStore((s) => s.artifactLab);
  const setLab = useSimStore((s) => s.setArtifactLab);
  const caseId = useSimStore((s) => s.caseId);
  const caseDef = loadCaseById(caseId);
  const fromCase = (type: string) =>
    caseDef.artifacts
      .filter((a) => a.enabled && a.type === type)
      .reduce((m, a) => Math.max(m, a.intensity), 0);
  const defaults = {
    sideLobe: fromCase('side-lobe'),
    mirror: fromCase('mirror'),
    beamWidth: fromCase('beam-width'),
    clutter: fromCase('near-field-clutter'),
  };
  const current = lab ?? defaults;
  return (
    <div className="artifact-lab">
      <div className="small">
        Ajusta cada artefacto y observa causa y remedio.{' '}
        {lab ? 'Valores del laboratorio (anulan los del caso).' : 'Valores del caso.'}
      </div>
      {ITEMS.map((it) => (
        <div key={it.key} className="artifact-row" data-artifact={it.key}>
          <label>
            <span>{it.label}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={current[it.key]}
              aria-label={it.label}
              onChange={(e) => setLab({ ...current, [it.key]: Number(e.target.value) })}
            />
            <span className="mono">{current[it.key].toFixed(2)}</span>
          </label>
          <details>
            <summary className="small">causa y remedio</summary>
            <div className="small">
              <b>Causa:</b> {it.cause}
              <br />
              <b>Remedio:</b> {it.remedy}
            </div>
          </details>
        </div>
      ))}
      {lab && (
        <button onClick={() => setLab(null)} className="small">
          Volver a los artefactos del caso
        </button>
      )}
    </div>
  );
}
