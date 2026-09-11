import type { ReactNode } from 'react';

type HoverTipProps = {
  label: string;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  disabled?: boolean;
};

export default function HoverTip({
  label,
  children,
  align = 'center',
  disabled = false,
}: HoverTipProps) {
  const alignClass =
    align === 'end'
      ? 'right-0 left-auto translate-x-0'
      : align === 'start'
        ? 'left-0 translate-x-0'
        : 'left-1/2 -translate-x-1/2';

  return (
    <span className="group relative inline-flex">
      {children}
      {!disabled && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute top-full z-[400] mt-1.5 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[11px] font-medium leading-none text-white opacity-0 shadow-lg ring-1 ring-white/15 transition-opacity duration-75 group-hover:opacity-100 dark:bg-slate-800 ${alignClass}`}
        >
          {label}
        </span>
      )}
    </span>
  );
}
