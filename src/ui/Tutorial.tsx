import { useState } from 'react';
import { useSimStore } from '@/app/store';

/**
 * Optional 8-step controls tutorial (spec 51). Can be skipped and restarted; completion is the only
 * thing persisted. It never moves the probe for the user.
 */
const STEPS: { title: string; body: string }[] = [
  {
    title: 'Mover la sonda',
    body: 'Arrastra la sonda sobre el torso 3D (o usa las flechas) para deslizarla por la piel. La imagen responde de forma continua: no hay vistas "por botón".',
  },
  {
    title: 'Marcador y rotación',
    body: 'La rueda del ratón (o Q/E) rota la sonda sobre su eje. El punto azul es el marcador: lo que está hacia el marcador aparece a la derecha de la pantalla (R).',
  },
  {
    title: 'Rock y tilt',
    body: 'Shift+arrastrar rockea (angula dentro del plano); Alt+arrastrar inclina/abanica (cambia el plano). Desde PLAX, rotar ~90° y abanicar recorre los niveles de PSAX.',
  },
  {
    title: 'Profundidad',
    body: 'Ajusta la profundidad con [ y ] o con los pasos que aparecen al pasar el ratón por la imagen. Más profundidad muestra estructuras posteriores pero baja el frame rate y la resolución.',
  },
  {
    title: 'Ganancia y TGC',
    body: 'La ganancia (- / +) aclara toda la imagen; con exceso, la sangre se aclara hacia el gris del miocardio y sube el ruido. Los deslizadores TGC compensan por profundidad.',
  },
  {
    title: 'Color y escala',
    body: 'Tecla C activa Color. Arrastra la caja sobre el flujo. Baja la escala (Nyquist) y verás aliasing; sube la ganancia de color y verás blooming sobre el tejido.',
  },
  {
    title: 'PW y gate',
    body: 'Tecla P activa Doppler pulsado. Clic sobre la imagen coloca el cursor y el gate. La velocidad medida depende del ángulo entre el haz y el flujo: alinea la sonda, no corrijas con un botón.',
  },
  {
    title: 'Freeze y medir',
    body: 'Espacio congela; arrastrando sobre el ECG o con la barra de cine se elige el cuadro. Con una herramienta (Caliper, Velocidad, VTI, Tiempo) haz clic sobre la imagen. Cada medición guarda vista y calidad: medir sobre un plano malo penaliza.',
  },
];

export function Tutorial() {
  const done = useSimStore((s) => s.ui.tutorialDone);
  const setUi = useSimStore((s) => s.setUi);
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(!done);
  if (!open) return null;
  const s = STEPS[step]!;
  return (
    <div className="tutorial" role="dialog" aria-label="Tutorial de controles">
      <div className="tut-head">
        <span className="tut-kicker">
          Tutorial · paso {step + 1} de {STEPS.length}
        </span>
        <span className="tut-steps" aria-hidden="true">
          {STEPS.map((_, i) => (
            <i key={i} className={i === step ? 'now' : i < step ? 'done' : ''} />
          ))}
        </span>
      </div>
      <h4>{s.title}</h4>
      <p>{s.body}</p>
      <div className="row">
        <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
          Anterior
        </button>
        {step < STEPS.length - 1 ? (
          <button className="primary" onClick={() => setStep(step + 1)}>
            Siguiente
          </button>
        ) : (
          <button
            className="primary"
            onClick={() => {
              setUi({ tutorialDone: true });
              setOpen(false);
            }}
          >
            Terminar
          </button>
        )}
        <span className="spacer" style={{ flex: 1 }} />
        <button
          className="ghost"
          onClick={() => {
            setUi({ tutorialDone: true });
            setOpen(false);
          }}
        >
          Saltar
        </button>
      </div>
    </div>
  );
}

export function useRestartTutorial(): () => void {
  const setUi = useSimStore((s) => s.setUi);
  return () => {
    setUi({ tutorialDone: false });
    window.location.reload();
  };
}
