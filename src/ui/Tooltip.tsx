import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The interface's one tooltip (decision 199). Any element with `data-tip` gets it: after 350 ms under the pointer
 * (120 ms on keyboard focus), below the element or above it near the bottom edge, clamped to the window. An optional
 * `data-tip-key` lists the keys as chips. While it shows, the element is described by it (`aria-describedby`). It
 * replaces the browser's `title` bubbles, which came late, unstyled and never on focus.
 */
const HOVER_MS = 350;
const FOCUS_MS = 120;
const GAP = 7;

interface Tip {
  text: string;
  keys: string[];
  x: number;
  y: number;
  above: boolean;
}

function tipFor(el: HTMLElement): Tip | null {
  const text = el.getAttribute('data-tip');
  if (!text) return null;
  const keys = (el.getAttribute('data-tip-key') ?? '').split(' ').filter(Boolean);
  const r = el.getBoundingClientRect();
  const above = r.bottom + 72 > window.innerHeight;
  return { text, keys, x: r.left + r.width / 2, y: above ? r.top - GAP : r.bottom + GAP, above };
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLElement | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
    const hide = () => {
      clear();
      target.current?.removeAttribute('aria-describedby');
      target.current = null;
      setTip(null);
    };
    const arm = (el: HTMLElement, delay: number) => {
      if (el === target.current) return;
      clear();
      target.current?.removeAttribute('aria-describedby');
      target.current = el;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        const t = tipFor(el);
        if (!t) return;
        el.setAttribute('aria-describedby', 'app-tooltip');
        setTip(t);
      }, delay);
    };
    const holder = (e: Event): HTMLElement | null =>
      e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tip]') : null;
    const onOver = (e: Event) => {
      const el = holder(e);
      if (el) arm(el, HOVER_MS);
    };
    const onOut = (e: Event) => {
      const el = holder(e);
      if (!el || el !== target.current) return;
      const to = (e as MouseEvent).relatedTarget;
      if (to instanceof Node && el.contains(to)) return;
      hide();
    };
    const onFocusIn = (e: Event) => {
      const el = holder(e);
      if (el) arm(el, FOCUS_MS);
    };
    const onFocusOut = (e: Event) => {
      if (holder(e) === target.current) hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', hide, true);
    return () => {
      clear();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);

  // once measured, the box stays inside the window with an 8 px margin
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    const w = el.offsetWidth;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, tip.x - w / 2));
    el.style.left = `${left}px`;
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={box}
      id="app-tooltip"
      role="tooltip"
      className={`tooltip${tip.above ? ' above' : ''}`}
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
      {tip.keys.length > 0 && (
        <span className="tooltip-keys" aria-hidden="true">
          {tip.keys.map((k, i) => (
            <kbd key={i} className="kbd">
              {k}
            </kbd>
          ))}
        </span>
      )}
    </div>
  );
}
