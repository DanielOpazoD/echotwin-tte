import type { ViewAnalysis } from '@/simulator/view-recognition/viewQuality';
import type { AcquisitionSettings } from '@/simulator/renderer/types';

/**
 * Causal explanations (spec 91): every hint the tutor gives is tied to a physical cause and the effect
 * it has on the image or the measurement, so the learner understands *why*, not only *what to do*.
 */
export interface CausalExplanation {
  code: string;
  cause: string;
  effect: string;
  remedy: string;
}

export function explainAnalysis(v: ViewAnalysis, settings: AcquisitionSettings): CausalExplanation[] {
  const out: CausalExplanation[] = [];
  const c = v.components;
  if (c.plane < 0.7 || v.planeAngleDeg > 12) {
    out.push({
      code: 'oblique-plane',
      cause: `El plano de corte está ${v.planeAngleDeg.toFixed(0)}° fuera del plano canónico de la vista.`,
      effect: 'Las cavidades se ven ovaladas o acortadas y las paredes aparentan más grosor; los diámetros y volúmenes medidos no corresponden al eje real.',
      remedy: 'Rota o abanica la sonda siguiendo la sugerencia hasta que las referencias de la vista queden en el plano.',
    });
  }
  if (v.foreshorteningDeg > 10) {
    out.push({
      code: 'foreshortening',
      cause: `El haz no atraviesa el ápex verdadero (acortamiento ${v.foreshorteningDeg.toFixed(0)}°).`,
      effect: 'El VI se ve más corto y redondeado; Simpson subestima los volúmenes y el ápex parece hipercontráctil.',
      remedy: 'Desliza la sonda un espacio más abajo o lateral y angula hacia arriba para alargar la cavidad.',
    });
  }
  if (c.landmarks < 0.6 && v.missingLandmarks.length) {
    out.push({
      code: 'missing-landmarks',
      cause: `Faltan referencias de la vista: ${v.missingLandmarks.slice(0, 3).join(', ')}.`,
      effect: 'Sin ellas la vista no es reconocible ni reproducible y las mediciones pierden su punto de referencia.',
      remedy: 'Ajusta la profundidad y el ángulo hasta incluir las referencias; comprueba que no queden bajo una sombra.',
    });
  }
  if (v.shadowFraction > 0.2) {
    out.push({
      code: 'shadowing',
      cause: `Una costilla, el pulmón o una calcificación bloquea parte del sector (${(v.shadowFraction * 100).toFixed(0)} % en sombra).`,
      effect: 'Detrás del obstáculo no hay eco: las paredes desaparecen y los cálculos de área/volumen quedan incompletos.',
      remedy: 'Muévete al espacio intercostal vecino, pide espiración o rota levemente para esquivar el obstáculo; no subas la ganancia.',
    });
  }
  if (c.gain < 0.7) {
    const over = settings.gainDb > 0;
    out.push({
      code: over ? 'over-gain' : 'under-gain',
      cause: over ? 'Ganancia global excesiva: se amplifica también el ruido electrónico.' : 'Ganancia insuficiente: los ecos débiles del miocardio quedan bajo el umbral de la escala.',
      effect: over ? 'La sangre se vuelve gris, los bordes endocárdicos se pierden y las medidas de borde interno crecen.' : 'Las paredes se ven oscuras y discontinuas; los bordes son difíciles de seguir.',
      remedy: over ? 'Baja la ganancia hasta que la cavidad sea negra y ajusta la TGC por profundidad.' : 'Sube la ganancia o la TGC en la zona oscura; usa armónicos para mejorar la relación señal/ruido.',
    });
  }
  if (c.depth < 0.7) {
    out.push({
      code: 'depth',
      cause: settings.depthCm > 18 ? 'Profundidad excesiva para la vista.' : 'Profundidad insuficiente para la vista.',
      effect: settings.depthCm > 18 ? 'La imagen útil ocupa una fracción pequeña de la pantalla y el frame rate baja (más tiempo por línea).' : 'Las estructuras posteriores (aurícula, pericardio) quedan fuera del sector.',
      remedy: 'Ajusta la profundidad para que la estructura más posterior de interés quede cerca del borde inferior.',
    });
  }
  return out;
}

/** Physical causes of each Doppler and console effect, used by the artifact lab and the curriculum. */
export const DOPPLER_CAUSES: Record<string, CausalExplanation> = {
  aliasing: {
    code: 'aliasing',
    cause: 'La frecuencia de repetición de pulsos (PRF) es menor que el doble del desplazamiento Doppler: la fase entre pulsos se pliega.',
    effect: 'La velocidad aparece con el signo opuesto (el pico se "envuelve" desde abajo); el color muestra mosaico.',
    remedy: 'Sube la escala (PRF), desplaza la línea de base, usa una frecuencia más baja o cambia a Doppler continuo.',
  },
  angle: {
    code: 'angle',
    cause: 'El Doppler mide sólo la componente de la velocidad paralela al haz: v·cos θ.',
    effect: 'Con 20° se pierde el 6 % y con 40° el 23 % de la velocidad real; los gradientes (4v²) se subestiman aún más.',
    remedy: 'Alinea el haz con el flujo desde otra ventana o angulación; no uses corrección de ángulo en cardiología.',
  },
  blooming: {
    code: 'blooming',
    cause: 'La ganancia de color amplifica también las señales débiles fuera del chorro y en el tejido.',
    effect: 'El color «rebosa» sobre las paredes y el chorro parece mayor de lo que es.',
    remedy: 'Baja la ganancia de color hasta que el tejido quede sin color y el chorro conserve sus bordes.',
  },
};
