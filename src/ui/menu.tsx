import { useEffect, useRef, useState } from 'react';
import { IconCheck } from './icons';

/**
 * Small popover-menu primitives shared by the mode bar overflow and the torso layer menu.
 * `usePopover` owns open state plus outside-click / Escape dismissal; the item components render
 * the `.menu` styles so every flyout in the app looks and behaves the same.
 */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, wrap };
}

export function MenuCap({ children }: { children: React.ReactNode }) {
  return <div className="menu-cap">{children}</div>;
}

export function CheckItem({
  label,
  checked,
  onToggle,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button role="menuitemcheckbox" aria-checked={checked} disabled={disabled} onClick={onToggle}>
      <span className="mi-check" aria-hidden="true">
        {checked ? <IconCheck size={12} /> : null}
      </span>
      <span className="mi-label">
        {label}
        {/* a disabled control gets no pointer events in every browser: the reason is printed, not tipped */}
        {disabled ? (
          <span className="mi-hint" aria-hidden="true">
            No disponible en modo examen
          </span>
        ) : hint ? (
          <span className="mi-hint" aria-hidden="true">
            {hint}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function ActionItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button role="menuitem" onClick={onClick}>
      <span className="mi-check" aria-hidden="true" />
      <span className="mi-label">{label}</span>
    </button>
  );
}
