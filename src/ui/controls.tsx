import type { ReactNode } from 'react';

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  title?: string;
  disabled?: boolean;
  /** Keyboard shortcut shown beside the label, hidden from assistive technology (the name stays the label). */
  hint?: string;
}) {
  const fmt =
    props.format ??
    ((v: number) =>
      `${Number.isInteger(props.step ?? 1) ? Math.round(v) : v.toFixed(2)}${props.unit ?? ''}`);
  return (
    <div className="row" title={props.title}>
      <label>
        {props.label}
        {props.hint ? (
          <kbd className="kbd" aria-hidden="true">
            {props.hint}
          </kbd>
        ) : null}
      </label>
      <input
        type="range"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <span className="val">{fmt(props.value)}</span>
    </div>
  );
}

export function Segmented<T extends string>(props: {
  options: { id: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="seg" role="group" aria-label={props.ariaLabel}>
      {props.options.map((o) => (
        <button
          key={o.id}
          className={o.id === props.value ? 'active' : ''}
          onClick={() => props.onChange(o.id)}
          title={o.title}
          aria-pressed={o.id === props.value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle(props: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  title?: string;
}) {
  return (
    <div className="row" title={props.title}>
      <label>{props.label}</label>
      <button
        className={`switch${props.value ? ' on' : ''}`}
        aria-label={props.label}
        aria-pressed={props.value}
        onClick={() => props.onChange(!props.value)}
      >
        <span className="knob" />
      </button>
    </div>
  );
}

/**
 * A console section. `tip` is how to use it: shown on demand from a small ⓘ beside the title instead of a paragraph
 * under the controls (decision 186); the console passes none in exam mode.
 */
export function Section(props: { title: string; tip?: string; children: ReactNode }) {
  return (
    <div className="section">
      <h4>
        {props.title}
        {props.tip ? <InfoTip text={props.tip} /> : null}
      </h4>
      {props.children}
    </div>
  );
}

/** A small ⓘ that shows a usage note on hover or focus; its text is also its accessible name. */
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="info-tip" tabIndex={0} role="note" aria-label={text} data-tip={text}>
      i
    </span>
  );
}
