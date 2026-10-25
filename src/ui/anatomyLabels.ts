import type { AnatomyChoice } from '@/simulator/core/protocol';

/**
 * The anatomy choices as the interface names them: a short label for the top bar's selector (decision 376), the panel's
 * label and the tooltip that says what each heart is. One table for the top bar and the Dev panel.
 */
export const ANATOMY_LABELS: Record<AnatomyChoice, { short: string; panel: string; tip: string }> =
  {
    analytic: {
      short: 'Analítico',
      panel: 'analítica',
      tip: 'El corazón del modelo analítico (por omisión)',
    },
    rodero: {
      short: 'Rodero',
      panel: 'Rodero (experimental)',
      tip: 'El corazón medio de Rodero et al. 2021 (TC, CC BY 4.0) movido por el ciclo del caso, en la CPU y en la GPU',
    },
  };
