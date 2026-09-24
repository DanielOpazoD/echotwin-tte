import { useRef } from 'react';
import { useSimStore } from '@/app/store';

/**
 * On-screen index-marker dial (spec 4.3): shows where the probe marker points as seen from the
 * front of the patient and lets the user rotate the probe by dragging the marker dot.
 * 0° = marker toward the patient's right shoulder (upper-left on screen); positive = clockwise. Decision 188: the value
 * sits in the middle and the ±15° buttons went away (a click on the ring jumps there, Page Up/Down and Q E step 15°).
 */
const R = 28;
const CX = 44,
  CY = 44;
/** A tick every 30° of rotation; 0°, ±90° and 180° (the shoulders and the hips) are longer. */
const TICKS = Array.from({ length: 12 }, (_, i) => i * 30 - 150);

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
      data-tip="Orientación del marcador de la sonda: arrastra el punto o haz clic en el anillo"
    >
      <svg
        viewBox="0 0 88 88"
        width={76}
        height={76}
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
        <circle className="dial-ring" cx={CX} cy={CY} r={R} />
        {TICKS.map((deg) => {
          const t = (screenAngleDeg(deg) * Math.PI) / 180;
          const r0 = deg % 90 === 0 ? R - 5 : R - 3;
          return (
            <line
              key={deg}
              className="dial-tick"
              x1={CX + r0 * Math.cos(t)}
              y1={CY - r0 * Math.sin(t)}
              x2={CX + R * Math.cos(t)}
              y2={CY - R * Math.sin(t)}
            />
          );
        })}
        <text className="dial-lbl" x={CX} y={8} textAnchor="middle">
          cabeza
        </text>
        <text className="dial-lbl" x={CX} y={86} textAnchor="middle">
          pies
        </text>
        <text className="dial-lbl" x={5} y={CY + 3} textAnchor="middle">
          D
        </text>
        <text className="dial-lbl" x={83} y={CY + 3} textAnchor="middle">
          I
        </text>
        <line
          className="dial-needle"
          x1={CX + 13 * Math.cos(a)}
          y1={CY - 13 * Math.sin(a)}
          x2={mx}
          y2={my}
        />
        <circle className="dial-knob" cx={mx} cy={my} r={5.5} />
        <text className="dial-val" x={CX} y={CY + 4} textAnchor="middle">
          {Math.round(rotation)}°
        </text>
      </svg>
    </div>
  );
}
