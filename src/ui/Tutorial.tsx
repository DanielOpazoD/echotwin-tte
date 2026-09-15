import { useState } from 'react';
import { useSimStore } from '@/app/store';

/**
 * Optional 8-step controls tutorial (spec 51). Can be skipped and restarted; completion is the only
 * thing persisted. It never moves the probe for the user.
 */
const STEPS: { title: string; body: string }[] = [
  {
    title: '1 · Mover la sonda',
    body: 'Arrastra la sonda sobre el torso 3D (o usa las flechas) para deslizarla por la piel. La imagen responde de forma continua: no hay vistas "por botón".',
  },
  {
    title: '2 · Marcador y rotación',
    body: 'La rueda del ratón (o Q/E) rota la sonda sobre su eje. El punto azul es el marcador: lo que está hacia el marcador aparece a la derecha de la pantalla (R).',
  },
  {
    title: '3 · Rock y tilt',
    body: 'Shift+arrastrar rockea (angula dentro del plano); Alt+arrastrar inclina/abanica (cambia el plano). Desde PLAX, rotar ~90° y abanicar recorre los niveles de PSAX.',
  },
  {
    title: '4 · Profundidad',
    body: 'Ajusta la profundidad ([ y ]). Más profundidad muestra estructuras posteriores pero baja el frame rate y la resolución.',
  },
  {
    title: '5 · Ganancia y TGC',
    body: 'La ganancia (- / +) aclara toda la imagen; con exceso, la sangre se aclara hacia el gris del miocardio y sube el ruido. Los deslizadores TGC compensan por profundidad.',
  },
  {
    title: '6 · Color y escala',
    body: 'Tecla C activa Color. Arrastra la caja sobre el flujo. Baja la escala (Nyquist) y verás aliasing; sube la ganancia de color y verás blooming sobre el tejido.',
  },
  {
    title: '7 · PW y gate',
    body: 'Tecla P activa Doppler pulsado. Clic sobre la imagen coloca el cursor y el gate. La velocidad medida depende del ángulo entre el haz y el flujo: alinea la sonda, no corrijas con un botón.',
  },
  {
    title: '8 · Freeze y medir',
    body: 'Espacio congela; el cine permite elegir el cuadro. Con una herramienta (Caliper, Vel, VTI, t) haz clic sobre la imagen. Cada medición guarda vista y calidad: medir sobre un plano malo penaliza.',
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
      <h4>{s.title}</h4>
      <p>{s.body}</p>
      <div className="row">
        <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
          Anterior
        </button>
        {step < STEPS.length - 1 ? (
          <button className="active" onClick={() => setStep(step + 1)}>
            Siguiente
          </button>
        ) : (
          <button
            className="active"
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
