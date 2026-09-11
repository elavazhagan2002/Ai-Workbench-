import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type SelectMenuProps = {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  error?: boolean;
  size?: 'md' | 'sm';
  variant?: 'default' | 'filter' | 'auth';
  className?: string;
  wrapperClassName?: string;
  leadingIcon?: ReactNode;
  'aria-label'?: string;
  'aria-labelledby'?: string;
};

type MenuPos = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function viewportSize() {
  return {
    vw: document.documentElement.clientWidth || window.innerWidth,
    vh: document.documentElement.clientHeight || window.innerHeight,
  };
}

function optionLine(opt: Pick<SelectOption, 'label' | 'description'>, fallback = ''): string {
  const label = (opt.label || fallback).trim();
  const extra = (opt.description || '').trim();
  if (!extra || extra === label) return label;
  return `${label} - ${extra}`;
}

let measureCanvas: HTMLCanvasElement | undefined;

function measureLineWidth(text: string): number {
  if (typeof document === 'undefined') return text.length * 7.6;
  measureCanvas ??= document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return Math.ceil(text.length * 7.6);
  ctx.font = '13px "IBM Plex Sans", system-ui, sans-serif';
  return Math.ceil(ctx.measureText(text).width);
}

function neededMenuWidth(lines: string[]): number {
  const longest = lines.reduce((width, line) => Math.max(width, measureLineWidth(line)), 0);
  return longest + 52;
}

function clipBounds(trigger: HTMLElement, vw: number, pad: number) {
  const clipEl = trigger.closest('form, [data-dropdown-boundary], .wb-modal');
  const clip = clipEl instanceof HTMLElement ? clipEl.getBoundingClientRect() : null;
  return {
    minLeft: Math.max(pad, clip ? clip.left + 8 : pad),
    maxRight: Math.min(vw - pad, clip ? clip.right - 8 : vw - pad),
  };
}

const OPTION_ROW_PX = 32;

function computePosition(
  trigger: HTMLElement,
  optionCount: number,
  hasSearch: boolean,
  contentWidth: number
): MenuPos {
  const rect = trigger.getBoundingClientRect();
  const { vw, vh } = viewportSize();
  const gap = 6;
  const pad = 8;
  const { minLeft, maxRight } = clipBounds(trigger, vw, pad);
  const maxWidth = Math.max(rect.width, maxRight - minLeft);
  const width = Math.min(maxWidth, Math.max(rect.width, contentWidth));
  let left = rect.left;
  if (left + width > maxRight) left = maxRight - width;
  if (left < minLeft) left = minLeft;

  const estimated = (hasSearch ? 44 : 6) + Math.max(1, optionCount) * OPTION_ROW_PX;
  const spaceBelow = Math.max(0, vh - rect.bottom - pad);
  const spaceAbove = Math.max(0, rect.top - pad);
  const openDown = spaceBelow >= 120 || spaceBelow >= spaceAbove;
  const available = openDown ? spaceBelow : spaceAbove;
  const maxHeight = Math.max(96, Math.min(estimated, available, 320));

  if (openDown) {
    return { left, width, top: rect.bottom + gap, maxHeight };
  }

  return { left, width, bottom: vh - rect.top + gap, maxHeight };
}

export default function SelectMenu({
  id,
  name,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  required = false,
  searchable,
  searchPlaceholder = 'Search…',
  error = false,
  size = 'md',
  variant = 'default',
  className,
  wrapperClassName,
  leadingIcon,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: SelectMenuProps) {
  const autoId = useId();
  const listId = `${id || autoId}-listbox`;
  const searchId = `${id || autoId}-search`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState<MenuPos | null>(null);

  const placeholderText = placeholder || 'Select…';
  const menuOptions = useMemo(() => {
    if (required || options.some((opt) => opt.value === '')) return options;
    if (placeholder == null) return options;
    return [{ value: '', label: placeholder }, ...options];
  }, [options, placeholder, required]);

  const selected = useMemo(
    () => (value ? menuOptions.find((opt) => opt.value === value) || null : null),
    [menuOptions, value]
  );

  const enableSearch = searchable ?? (variant !== 'filter' && menuOptions.length >= 12);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return menuOptions;
    return menuOptions.filter((opt) => {
      const hay = `${opt.label} ${opt.description || ''} ${opt.value}`.toLowerCase();
      return hay.includes(q);
    });
  }, [menuOptions, query]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const contentWidth = neededMenuWidth(filtered.map((opt) => optionLine(opt, placeholderText)));
    setPos(computePosition(triggerRef.current, filtered.length, enableSearch, contentWidth));
  }, [enableSearch, filtered, placeholderText]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (open) return;
    setQuery('');
    setPos(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onWin = () => updatePosition();
    window.addEventListener('resize', onWin);
    window.addEventListener('scroll', onWin, true);
    return () => {
      window.removeEventListener('resize', onWin);
      window.removeEventListener('scroll', onWin, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('keydown', onKeyDown);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = Math.max(
      0,
      filtered.findIndex((opt) => opt.value === value)
    );
    setHighlight(selectedIndex < 0 ? 0 : selectedIndex);
  }, [open, filtered, value]);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const choose = useCallback(
    (opt: SelectOption) => {
      if (opt.disabled) return;
      onChange(opt.value);
      close();
    },
    [onChange, close]
  );

  const moveHighlight = useCallback(
    (delta: number) => {
      if (!filtered.length) return;
      setHighlight((prev) => {
        let next = prev;
        for (let i = 0; i < filtered.length; i += 1) {
          next = (next + delta + filtered.length) % filtered.length;
          if (!filtered[next]?.disabled) break;
        }
        optionRefs.current[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
    },
    [filtered]
  );

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveHighlight(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveHighlight(-1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setHighlight(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setHighlight(Math.max(0, filtered.length - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const opt = filtered[highlight];
      if (opt) choose(opt);
    }
  }

  const isAuth = variant === 'auth';
  const triggerSize = isAuth ? 'min-h-[38px] text-[12.5px]' : size === 'sm' ? 'min-h-10 text-[13px]' : 'min-h-11 text-sm';
  const triggerChrome = isAuth
    ? 'auth-theme-input rounded-[11px] border-slate-300/80 bg-white py-[0.55rem] text-[12.5px] text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-slate-950/45 dark:text-white'
    : 'rounded-xl border-line bg-surface-elevated text-ink';
  const themeClass = typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : '';

  const menuStyle: CSSProperties | undefined = pos
    ? {
        position: 'fixed',
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxHeight,
        top: pos.top,
        bottom: pos.bottom,
        zIndex: 5000,
      }
    : undefined;

  const listMaxHeight = enableSearch ? Math.max(80, (pos?.maxHeight || 240) - 44) : pos?.maxHeight;

  const menu =
    open && pos && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            tabIndex={-1}
            onKeyDown={onMenuKeyDown}
            onMouseDown={(event) => event.stopPropagation()}
            className={cx(
              themeClass,
              'wb-select-menu box-border flex min-w-0 flex-col overflow-hidden border border-line bg-surface-elevated text-ink shadow-lg',
              isAuth ? 'rounded-[11px]' : 'rounded-xl'
            )}
            style={menuStyle}
          >
            {enableSearch ? (
              <div className="shrink-0 border-b border-line px-2 py-1.5">
                <label htmlFor={searchId} className="sr-only">
                  Filter options
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
                  <input
                    ref={searchRef}
                    id={searchId}
                    type="text"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setHighlight(0);
                    }}
                    placeholder={searchPlaceholder}
                    autoComplete="off"
                    className="wb-input min-h-8 py-1 pl-8 pr-2 text-[13px]"
                  />
                </div>
              </div>
            ) : null}
            <div
              id={listId}
              role="listbox"
              aria-label={ariaLabel || placeholderText}
              className="wb-scroll-slim min-h-0 flex-1 overflow-x-clip overflow-y-auto overscroll-contain py-0.5"
              style={{ maxHeight: listMaxHeight }}
            >
              {filtered.length === 0 ? (
                <p className="px-3 py-5 text-center text-sm text-ink-muted">No matching options</p>
              ) : (
                filtered.map((opt, index) => {
                  const isSelected = opt.value === value;
                  const isActive = index === highlight;
                  return (
                    <button
                      key={opt.value || `empty-${index}`}
                      ref={(node) => {
                        optionRefs.current[index] = node;
                      }}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={opt.disabled}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => choose(opt)}
                      className={cx(
                        'flex min-h-8 w-full items-start gap-2 px-2.5 py-1.5 pr-3 text-left text-[13px] leading-snug text-ink transition',
                        opt.disabled ? 'cursor-not-allowed opacity-50' : '',
                        isSelected ? 'bg-cyan-500/12 font-medium' : isActive ? 'bg-surface-muted' : 'hover:bg-surface-muted/80'
                      )}
                    >
                      <span
                        className={cx(
                          'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
                          isSelected ? 'border-cyan-500 bg-cyan-500 text-white' : 'border-line bg-transparent'
                        )}
                        aria-hidden
                      >
                        {isSelected ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                      </span>
                      <span className="min-w-0 flex-1 whitespace-normal break-words">{optionLine(opt, placeholderText)}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className={cx('relative min-w-0', wrapperClassName)}>
      <select
        tabIndex={-1}
        aria-hidden
        name={name}
        required={required}
        disabled={disabled}
        value={value}
        onChange={() => {}}
        className="pointer-events-none absolute h-px w-px opacity-0"
      >
        {placeholderText ? <option value="">{placeholderText}</option> : null}
        {value && !menuOptions.some((opt) => opt.value === value) ? (
          <option value={value}>{selected ? optionLine(selected) : value}</option>
        ) : null}
        {menuOptions.filter((opt) => opt.value !== '').map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {optionLine(opt)}
          </option>
        ))}
      </select>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!disabled) setOpen((v) => !v);
        }}
        onKeyDown={onTriggerKeyDown}
        className={cx(
          'group relative flex w-full items-center gap-2 border px-3 text-left transition',
          triggerSize,
          triggerChrome,
          leadingIcon ? (isAuth ? 'pl-[2.625rem]' : 'pl-10') : '',
          error
            ? 'border-red-400 ring-2 ring-red-400/20'
            : open
              ? isAuth
                ? 'border-cyan-500/60 ring-4 ring-cyan-500/12 dark:border-cyan-300/60 dark:ring-cyan-300/12'
                : 'border-cyan-500 ring-2 ring-cyan-500/25'
              : isAuth
                ? 'hover:border-cyan-400/50 focus:border-cyan-500/60 focus:outline-none focus:ring-4 focus:ring-cyan-500/12 dark:focus:border-cyan-300/60 dark:focus:ring-cyan-300/12'
                : 'hover:border-cyan-400/50 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/25',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
          className
        )}
      >
        {leadingIcon ? (
          <span
            className={cx(
              'pointer-events-none absolute top-1/2 -translate-y-1/2 transition-colors',
              isAuth
                ? open
                  ? 'left-4 text-cyan-600 dark:text-cyan-200'
                  : 'left-4 text-slate-400 group-focus-within:text-cyan-600 dark:text-slate-500 dark:group-focus-within:text-cyan-200'
                : 'left-3 text-ink-subtle'
            )}
          >
            {leadingIcon}
          </span>
        ) : null}
        <span
          className={cx(
            'min-w-0 flex-1 truncate',
            selected ? (isAuth ? '' : 'text-ink') : isAuth ? 'text-slate-500 dark:text-slate-400' : 'text-ink-subtle'
          )}
        >
          {selected ? optionLine(selected) : placeholderText}
        </span>
        <ChevronDown
          className={cx(
            'h-4 w-4 shrink-0 text-ink-subtle transition-transform',
            open ? 'rotate-180 text-cyan-600 dark:text-cyan-400' : ''
          )}
          aria-hidden
        />
      </button>
      {menu}
    </div>
  );
}
