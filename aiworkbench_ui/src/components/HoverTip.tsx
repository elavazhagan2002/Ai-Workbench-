import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type HoverTipProps = Readonly<{
  label: string;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  /** Preferred side; flips automatically when there isn't enough space. */
  side?: 'top' | 'bottom';
  disabled?: boolean;
}>;

const GAP = 8;
const VIEWPORT_PAD = 8;
const SHOW_DELAY_MS = 140;

export default function HoverTip({
  label,
  children,
  align = 'center',
  side = 'bottom',
  disabled = false,
}: HoverTipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const showTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  const clearTimers = useCallback(() => {
    if (showTimer.current != null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleOpen = useCallback(() => {
    if (disabled || !label.trim()) return;
    clearTimers();
    showTimer.current = window.setTimeout(() => {
      setOpen(true);
    }, SHOW_DELAY_MS);
  }, [clearTimers, disabled, label]);

  const close = useCallback(() => {
    clearTimers();
    setVisible(false);
    closeTimer.current = window.setTimeout(() => setOpen(false), 140);
  }, [clearTimers]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tip = tipRef.current;
    if (!trigger || !tip) return;

    const rect = trigger.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const tipWidth = tipRect.width || tip.offsetWidth;
    const tipHeight = tipRect.height || tip.offsetHeight;

    let left = rect.left + rect.width / 2 - tipWidth / 2;
    if (align === 'start') left = rect.left;
    else if (align === 'end') left = rect.right - tipWidth;

    left = Math.min(
      Math.max(left, VIEWPORT_PAD),
      window.innerWidth - tipWidth - VIEWPORT_PAD,
    );

    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PAD;
    const spaceAbove = rect.top - VIEWPORT_PAD;
    const preferBottom = side === 'bottom';
    const placeBottom = preferBottom
      ? spaceBelow >= tipHeight + GAP || spaceBelow >= spaceAbove
      : spaceAbove < tipHeight + GAP && spaceBelow > spaceAbove;

    setStyle({
      position: 'fixed',
      left,
      top: placeBottom ? rect.bottom + GAP : rect.top - tipHeight - GAP,
      zIndex: 1000,
    });
  }, [align, side]);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }

    updatePosition();
    const frame = window.requestAnimationFrame(() => {
      updatePosition();
      setVisible(true);
    });

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition, label]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (disabled) {
      clearTimers();
      setVisible(false);
      setOpen(false);
    }
  }, [clearTimers, disabled]);

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={scheduleOpen}
      onMouseLeave={close}
      onFocus={scheduleOpen}
      onBlur={close}
    >
      {children}
      {open && typeof document !== 'undefined' && createPortal(
        <span
          ref={tipRef}
          role="tooltip"
          style={style ?? { position: 'fixed', left: -9999, top: -9999, zIndex: 1000 }}
          className={`pointer-events-none max-w-[17.5rem] select-none whitespace-nowrap rounded-md bg-slate-950/95 px-2.5 py-1.5 text-center text-[11px] font-medium leading-snug text-white shadow-lg ring-1 ring-white/10 backdrop-blur-sm transition-[opacity,transform] duration-150 ease-out dark:bg-slate-800/95 ${
            visible ? 'translate-y-0 opacity-100' : 'translate-y-0.5 opacity-0'
          }`}
        >
          {label}
        </span>,
        document.body,
      )}
    </span>
  );
}
