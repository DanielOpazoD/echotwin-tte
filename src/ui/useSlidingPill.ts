import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/**
 * The place of the chosen option in a segmented control, for a pill that slides under it instead of a fill that
 * jumps from one button to the next (decision 209). Measured a frame after the control renders, again when its fonts
 * arrive and whenever it changes size; `undefined` until then, so the stylesheet keeps the plain fill as a fallback.
 */
export function useSlidingPill(
  ref: RefObject<HTMLElement | null>,
  active: string,
  selector = '.active',
): CSSProperties | undefined {
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const a = el.querySelector<HTMLElement>(selector);
      if (!a) return setBox(null);
      setBox((prev) =>
        prev && prev.left === a.offsetLeft && prev.width === a.offsetWidth
          ? prev
          : { left: a.offsetLeft, width: a.offsetWidth },
      );
    };
    const raf = requestAnimationFrame(measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    // the option itself can change size without the control doing so (a badge, a neighbour that appears)
    const a = el.querySelector<HTMLElement>(selector);
    if (a) ro?.observe(a);
    if (typeof document !== 'undefined' && 'fonts' in document)
      void document.fonts.ready.then(measure);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [ref, active, selector]);
  return box ? { transform: `translateX(${box.left}px)`, width: box.width } : undefined;
}
