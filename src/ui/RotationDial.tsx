import { useRef } from 'react';
import { useSimStore } from '@/app/store';

/**
 * On-screen index-marker dial (spec 4.3): shows where the probe marker points as seen from the
 * front of the patient and lets the user rotate the probe by dragging the marker dot.
 * 0° = marker toward the patient's right shoulder (upper-left on screen); positive = clockwise.
 */
const R = 34;
const CX = 44,
  CY = 44;

function screenAngleDeg(rotationDeg: number): number {
  return 135 - rotationDeg; // math convention (y up), degrees
}

export function RotationDial() {
  const rotation = useSimStore((s) => s.probe.rotationDeg);
  const setProbe = useSimStore((s) => s.setProbe);
  const nudge = useSimStore((s) => s.nudgeProbe);
  const dragging = useRef(false);
  const a = (screenAngleDeg(rotation) * Math.PI) / 180;
  const mx = CX + R * Math.cos(a);
  const my = CY - R * Math.sin(a);
  const fromEvent = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 88 - CX;
    const y = ((e.clientY - r.top) / r.height) * 88 - CY;
    const ang = (Math.atan2(-y, x) * 180) / Math.PI;
    let rot = 135 - ang;
    rot = ((((rot + 180) % 360) + 360) % 360) - 180;
    setProbe({ rotationDeg: Math.round(rot) });
  };
  return (
    <div
      className="dial"
      title="Orientación del marcador de la sonda (arrastra el punto para rotar)"
    >
      <svg
        viewBox="0 0 88 88"
        width={88}
        height={88}
        role="slider"
        tabIndex={0}
        aria-label="Rotación de la sonda (marcador)"
        aria-valuenow={Math.round(rotation)}
        aria-valuetext={`${Math.round(rotation)}°`}
        aria-valuemin={-180}
        aria-valuemax={180}
        aria-keyshortcuts="ArrowLeft ArrowRight PageUp PageDown Home End"
        onKeyDown={(e) => {
          // the slider pattern (decision 176): arrows 3° (Shift 15°), Page Up/Down 15°, Home/End to its limits
          const step = e.shiftKey ? 15 : 3;
          const byKey: Record<string, number> = {
            ArrowRight: step,
            ArrowUp: step,
            ArrowLeft: -step,
            ArrowDown: -step,
            PageUp: 15,
            PageDown: -15,
          };
          if (e.key in byKey) nudge({ rotationDeg: byKey[e.key]! });
          else if (e.key === 'Home') setProbe({ rotationDeg: -180 });
          else if (e.key === 'End') setProbe({ rotationDeg: 180 });
          else return;
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          fromEvent(e);
        }}
        onPointerMove={(e) => {
          if (dragging.current) fromEvent(e);
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      >
        <circle cx={CX} cy={CY} r={R} fill="#151b23" stroke="#3a4656" />
        <circle cx={CX} cy={CY} r={9} fill="#2b6cb0" opacity={0.6} />
        <text x={CX} y={11} textAnchor="middle" fontSize={7} fill="#8b95a5">
          cabeza
        </text>
        <text x={CX} y={84} textAnchor="middle" fontSize={7} fill="#8b95a5">
          pies
        </text>
        <text x={7} y={CY + 2} textAnchor="middle" fontSize={7} fill="#8b95a5">
          D
        </text>
        <text x={81} y={CY + 2} textAnchor="middle" fontSize={7} fill="#8b95a5">
          I
        </text>
        <line x1={CX} y1={CY} x2={mx} y2={my} stroke="#5cc8ff" strokeWidth={2} />
        <circle cx={mx} cy={my} r={6} fill="#5cc8ff" stroke="#0b0e12" strokeWidth={1.5} />
      </svg>
      <div className="dial-controls">
        <button aria-label="Rotar 15° antihorario" onClick={() => nudge({ rotationDeg: -15 })}>
          ↺15°
        </button>
        <span className="val">{Math.round(rotation)}°</span>
        <button aria-label="Rotar 15° horario" onClick={() => nudge({ rotationDeg: 15 })}>
          ↻15°
        </button>
      </div>
    </div>
  );
}
