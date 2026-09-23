import { type Ref } from 'react';

const DEFAULT_LENGTH = 6;

export function sanitizeOtpCode(value: string, length = DEFAULT_LENGTH): string {
  return value.replace(/\D/g, '').slice(0, length);
}

interface OtpCodeFieldProps {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  length?: number;
  size?: 'sm' | 'md';
  inputRef?: Ref<HTMLInputElement>;
}

export default function OtpCodeField({
  id,
  value,
  onChange,
  disabled = false,
  length = DEFAULT_LENGTH,
  size = 'md',
  inputRef,
}: OtpCodeFieldProps) {
  const boxHeight = size === 'sm' ? 'h-10' : 'h-11';
  const textSize = size === 'sm' ? 'text-[15px]' : 'text-[16px]';

  return (
    <div className="relative">
      <div className="pointer-events-none flex gap-1.5 sm:gap-2" aria-hidden="true">
        {Array.from({ length }, (_, index) => {
          const digit = value[index] ?? '';
          const active = !disabled && value.length === index;
          return (
            <div
              key={index}
              className={[
                'flex min-w-0 flex-1 items-center justify-center rounded-xl border font-mono font-semibold tabular-nums',
                boxHeight,
                textSize,
                digit
                  ? 'border-cyan-400/45 bg-white text-slate-950 dark:border-cyan-300/40 dark:bg-white/[0.08] dark:text-white'
                  : 'border-slate-300/80 bg-white text-slate-300 dark:border-white/10 dark:bg-slate-950/45 dark:text-slate-600',
                active ? 'border-cyan-500/70 ring-4 ring-cyan-500/15 dark:border-cyan-300/70 dark:ring-cyan-300/15' : '',
              ].join(' ')}
            >
              {digit}
            </div>
          );
        })}
      </div>
      <input
        id={id}
        ref={inputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(event) => onChange(sanitizeOtpCode(event.target.value, length))}
        maxLength={length}
        autoComplete="one-time-code"
        disabled={disabled}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
      />
    </div>
  );
}
