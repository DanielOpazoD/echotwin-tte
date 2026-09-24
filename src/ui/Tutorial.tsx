import { useLayoutEffect, useState } from 'react';
import { useSimStore } from '@/app/store';

/**
 * Optional 8-step controls tutorial (spec 51), as a spotlight tour (decision 204): everything dims except the control
 * of the step, which is framed, and the card sits beside it with an arrow, instead of a card that covered the image.
 * Can be skipped and restarted; completion is the only thing persisted. It never moves the probe for the user.
 */
const STEPS: {
  title: string;
  body: string;
  /** The `data-tour` anchor the step points at. */
  target: string;
  /** What must be on screen for the anchor to exist (a console tab). */
  prepare?: () => void;
}[] = [
  {
    title: 'Mover la sonda',
    body: 'Arrastra la sonda sobre el torso 3D (o usa las flechas) para deslizarla por la piel. La imagen responde de forma continua: no hay vistas "por botón".',
    target: 'torso',
  },
  {
    title: 'Marcador y rotación',
    body: 'La rueda del ratón (o Q/E) rota la sonda sobre su eje. El punto azul es el marcador: lo que está hacia el marcador aparece a la derecha de la pantalla (R).',
    target: 'dial',
  },
  {
    title: 'Rock y tilt',
    body: 'Shift+arrastrar rockea (angula dentro del plano); Alt+arrastrar inclina/abanica (cambia el plano). Desde PLAX, rotar ~90° y abanicar recorre los niveles de PSAX.',
    target: 'sonda',
    prepare: () => useSimStore.getState().setUi({ consoleTab: 'adquirir' }),
  },
  {
    title: 'Profundidad',
    body: 'Ajusta la profundidad con [ y ] o con los pasos que aparecen al pasar el ratón por la imagen. Más profundidad muestra estructuras posteriores pero baja el frame rate y la resolución.',
    target: 'depth',
    prepare: () => useSimStore.getState().setUi({ consoleTab: 'imagen' }),
  },
  {
    title: 'Ganancia y TGC',
    body: 'La ganancia (- / +) aclara toda la imagen; con exceso, la sangre se aclara hacia el gris del miocardio y sube el ruido. Los deslizadores TGC compensan por profundidad.',
    target: 'gain',
    prepare: () => useSimStore.getState().setUi({ consoleTab: 'imagen' }),
  },
  {
    title: 'Color y escala',
    body: 'Tecla C activa Color. Arrastra la caja sobre el flujo. Baja la escala (Nyquist) y verás aliasing; sube la ganancia de color y verás blooming sobre el tejido.',
    target: 'color',
  },
  {
    title: 'PW y gate',
    body: 'Tecla P activa Doppler pulsado. Clic sobre la imagen coloca el cursor y el gate. La velocidad medida depende del ángulo entre el haz y el flujo: alinea la sonda, no corrijas con un botón.',
    target: 'pw',
  },
  {
    title: 'Freeze y medir',
    body: 'Espacio congela; arrastrando sobre el ECG o con la barra de cine se elige el cuadro. Con una herramienta (Caliper, Velocidad, VTI, Tiempo) haz clic sobre la imagen. Cada medición guarda vista y calidad: medir sobre un plano malo penaliza.',
    target: 'freeze',
  },
];

const CARD_W = 320;
const CARD_H = 210;
const PAD = 6;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the card goes for a framed target: beside it when there is room, under it otherwise. */
function placeCard(r: Rect): { left: number; top: number; arrow: 'left' | 'right' | 'up' } {
  const vw = window.innerWidth,
    vh = window.innerHeight;
  const top = Math.max(12, Math.min(vh - CARD_H - 12, r.top - 4));
  if (r.left + r.width + 16 + CARD_W < vw)
    return { left: r.left + r.width + 16, top, arrow: 'left' };
  if (r.left - 16 - CARD_W > 0) return { left: r.left - 16 - CARD_W, top, arrow: 'right' };
  return {
    left: Math.max(12, Math.min(vw - CARD_W - 12, r.left)),
    top: Math.min(vh - CARD_H - 12, r.top + r.height + 16),
    arrow: 'up',
  };
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.left === b.left &&
      a.top === b.top &&
      a.width === b.width &&
      a.height === b.height)
  );
}

export function Tutorial() {
  const done = useSimStore((s) => s.ui.tutorialDone);
  const setUi = useSimStore((s) => s.setUi);
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(!done);
  const [rect, setRect] = useState<Rect | null>(null);

  // the anchor of the step: measured when the step changes, on resize, and a few times a second while the layout
  // may still be settling (a console tab opening, the navigator arriving)
  useLayoutEffect(() => {
    if (!open) return;
    STEPS[step]?.prepare?.();
    const measure = () => {
      const target = STEPS[step]?.target;
      const el = target ? document.querySelector(`[data-tour="${target}"]`) : null;
      const r = el?.getBoundingClientRect();
      const next =
        r && r.width > 0 && r.height > 0
          ? { left: r.left, top: r.top, width: r.width, height: r.height }
          : null;
      setRect((prev) => (sameRect(prev, next) ? prev : next));
    };
    // the first measure waits a frame: the tab the step opened has to be laid out first
    const first = requestAnimationFrame(measure);
    const id = window.setInterval(measure, 300);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(first);
      window.clearInterval(id);
      window.removeEventListener('resize', measure);
    };
  }, [open, step]);

  if (!open) return null;
  const s = STEPS[step]!;
  const place = rect ? placeCard(rect) : null;
  const finish = () => {
    setUi({ tutorialDone: true });
    setOpen(false);
  };
  return (
    <>
      {rect && (
        <div
          className="tour-hole"
          aria-hidden="true"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
          }}
        />
      )}
      <div
        className={`tutorial${place ? ` arrow-${place.arrow}` : ' centered'}`}
        role="dialog"
        aria-label="Tutorial de controles"
        style={place ? { left: place.left, top: place.top } : undefined}
      >
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
            <button className="primary" onClick={finish}>
              Terminar
            </button>
          )}
          <span className="spacer" style={{ flex: 1 }} />
          <button className="ghost" onClick={finish}>
            Saltar
          </button>
        </div>
      </div>
    </>
  );
}

export function useRestartTutorial(): () => void {
  const setUi = useSimStore((s) => s.setUi);
  return () => {
    setUi({ tutorialDone: false });
    window.location.reload();
  };
}
