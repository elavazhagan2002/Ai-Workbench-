import { forwardRef, useCallback, useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import {
  ArrowLeft,
  Building,
  Check,
  Cpu,
  Eye,
  EyeOff,
  Folder,
  Headset,
  Layers3,
  Lightbulb,
  Lock,
  Mail,
  MonitorPlay,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Smartphone,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import WorkbenchMetrics3DCarousel from '../components/auth/WorkbenchMetrics3DCarousel';
import TotpEnrollmentCard from '../components/auth/TotpEnrollmentCard';
import { useAuth } from '../contexts/AuthContext';
import { api, type LoginMfaMethod, type PasswordValidationResult, type UsernameAvailabilityResult } from '../lib/api';
import type { User as AuthUser } from '../types';
import { logger } from '../utils/logger';
import sciagenLogoWhite from '../assets/images/sciagen_white.png';
import SelectMenu from '../components/SelectMenu';

const APP_VERSION = ((import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || '1.0.1');
const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() || undefined;
const AUTH_API_BASE_URL = import.meta.env.DEV ? '/api' : (import.meta.env.VITE_API_URL || 'http://localhost:8000/api');
const EXTERNAL_SUPPORT_URL = 'https://www.sciagen.ai/contact';

const AUTH_INPUT_BASE_CLASS =
  'auth-theme-input min-h-[38px] w-full rounded-[11px] border border-slate-300/80 bg-white px-3 py-[0.55rem] text-[12.5px] text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.04)] outline-none transition duration-200 placeholder:text-slate-500 caret-cyan-700 focus:border-cyan-500/60 focus:ring-4 focus:ring-cyan-500/12 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-slate-950/45 dark:text-white dark:placeholder:text-slate-400 dark:caret-cyan-200 dark:focus:border-cyan-300/60 dark:focus:ring-cyan-300/12';
const AUTH_INPUT_WITH_ICON_CLASS = `${AUTH_INPUT_BASE_CLASS} pl-[2.625rem]`;
const PRIMARY_BUTTON_CLASS =
  'inline-flex min-h-[38px] w-full items-center justify-center gap-2 rounded-[11px] bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 px-3.5 py-[0.6rem] text-[12.5px] font-semibold text-white shadow-[0_10px_24px_rgba(14,165,233,0.18)] transition duration-200 hover:brightness-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/18 disabled:cursor-not-allowed disabled:opacity-55 dark:from-cyan-400 dark:via-sky-400 dark:to-blue-500';
const SECONDARY_BUTTON_CLASS =
  'inline-flex min-h-[38px] w-full items-center justify-center gap-2 rounded-[11px] border border-slate-300/80 bg-white px-3.5 py-[0.6rem] text-[12.5px] font-medium text-slate-700 transition duration-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/12 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-100 dark:hover:bg-white/[0.08] dark:focus-visible:ring-cyan-300/12';
const GHOST_BUTTON_CLASS =
  'inline-flex min-h-[34px] items-center justify-center gap-2 rounded-[11px] border border-slate-300/70 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 transition duration-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/12 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:hover:bg-white/[0.08] dark:focus-visible:ring-cyan-300/12';
const MODAL_CARD_CLASS =
  'w-full overflow-hidden rounded-2xl border border-slate-200/85 bg-white/95 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.18)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/90 dark:shadow-[0_24px_80px_rgba(2,12,32,0.55)] sm:p-6';
const AUTH_LEFT_PANEL_DARK_BG_CLASS =
  'dark:bg-[radial-gradient(circle_at_18%_11%,rgba(248,250,252,0.08),transparent_18%),radial-gradient(circle_at_14%_14%,rgba(34,211,238,0.1),transparent_24%),radial-gradient(circle_at_82%_10%,rgba(59,130,246,0.08),transparent_22%),radial-gradient(circle_at_52%_86%,rgba(37,99,235,0.08),transparent_32%),linear-gradient(180deg,#10254f_0%,#11264e_36%,#122750_68%,#16345d_100%)]';
const AUTH_LOGO_CLASS =
  'h-[22px] w-auto max-w-[116px] object-contain [filter:drop-shadow(0_1px_1px_rgba(2,6,23,0.32))_drop-shadow(0_0_12px_rgba(248,250,252,0.06))]';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: { sitekey: string }) => string;
      getResponse: (widgetId: string) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

interface OrgTypeOption {
  org_type_id: string;
  name: string;
}

interface PublicDomainOption {
  domain_id: string;
  domain_name: string;
}

interface PublicAppSummary {
  domains_count: number;
  use_cases_count: number;
  demo_use_cases_count: number;
  status_counts: Record<string, number>;
  domain_summaries: Array<{
    domain_id: string;
    domain_name: string;
    use_cases_count: number;
    demo_count: number;
  }>;
}

type AuthView = 'login' | 'register';
type RightPanelMode = 'summary' | 'idea';
type LoginStep = 'CREDENTIALS' | 'MFA' | 'TOTP_SETUP';
type ForgotPasswordStep = 'email' | 'passcode' | 'password' | 'success';

type UsernameValidationState = { username: string; result: UsernameAvailabilityResult };
type UsernameValidationErrorState = { username: string; message: string };
type PasswordValidationState = { password: string; result: PasswordValidationResult };
type PasswordValidationErrorState = { password: string; message: string };

interface ViewportAuthShellProps {
  authPanel: ReactNode;
  rightPanel: ReactNode;
  children?: ReactNode;
}

interface AuthPanelProps {
  activeView: AuthView;
  onSelectView: (view: AuthView) => void;
  children: ReactNode;
}

interface StatCarouselSlide {
  key: string;
  label: string;
  value: number;
  helper: string;
  icon: LucideIcon;
}

interface StatCarouselCardProps {
  title: string;
  subtitle: string;
  slides: StatCarouselSlide[];
}

interface AnimatedMetricValueProps {
  value: number;
  suffix?: string;
  durationMs?: number;
  className?: string;
}

interface ThemeSafeInputProps extends Omit<ComponentPropsWithoutRef<'input'>, 'className'> {
  icon?: LucideIcon;
  endAdornment?: ReactNode;
  className?: string;
  wrapperClassName?: string;
}

interface MessageBannerProps {
  tone: 'success' | 'error' | 'info';
  children: ReactNode;
  className?: string;
}

const AUTH_PANEL_COPY: Record<AuthView, { title: string; description: string }> = {
  login: {
    title: 'AI Governance Workbench',
    description: 'Sign in to continue into governed AI workbench',
  },
  register: {
    title: 'Create your enterprise access',
    description: 'Register with the same passcode verification.',
  },
};

const APPLICATION_VALUE_BULLETS = [
  'Manage AI domains and use cases',
  'Track and audit all activities',
  'Enterprise-grade security and permissions',
];

const REGISTER_USERNAME_MIN_LENGTH = 4;
const REGISTER_USERNAME_MAX_LENGTH = 25;
const REGISTER_VALIDATION_DEBOUNCE_MS = 350;
const LOGIN_MFA_CODE_LENGTH = 6;
const LOGIN_MFA_RESEND_COOLDOWN_SECONDS = 30;

const PASSWORD_RULE_DEFINITIONS = [
  {
    key: 'minLength',
    label: 'Minimum 8 characters',
    shortLabel: '8 characters',
    test: (password: string) => password.length >= 8,
  },
  {
    key: 'uppercase',
    label: 'At least 1 uppercase letter',
    shortLabel: 'uppercase',
    test: (password: string) => /[A-Z]/.test(password),
  },
  {
    key: 'lowercase',
    label: 'At least 1 lowercase letter',
    shortLabel: 'lowercase',
    test: (password: string) => /[a-z]/.test(password),
  },
  {
    key: 'number',
    label: 'At least 1 number',
    shortLabel: 'number',
    test: (password: string) => /\d/.test(password),
  },
  {
    key: 'special',
    label: 'At least 1 special character',
    shortLabel: 'special character',
    test: (password: string) => /[^A-Za-z0-9]/.test(password),
  },
] as const;

const PASSWORD_VALID_TICK_CLASS = 'text-emerald-600 dark:text-emerald-300';

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function formatCount(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toLocaleString() : '0';
}

function getPasswordRuleStates(password: string) {
  return PASSWORD_RULE_DEFINITIONS.map((rule) => ({
    key: rule.key,
    label: rule.label,
    shortLabel: rule.shortLabel,
    passed: rule.test(password),
  }));
}

function formatPasswordRequirementList(labels: string[]): string {
  const normalizedLabels = labels.map((label) => `${label.charAt(0).toLowerCase()}${label.slice(1)}`);

  if (normalizedLabels.length <= 1) {
    return normalizedLabels[0] ?? '';
  }

  if (normalizedLabels.length === 2) {
    return `${normalizedLabels[0]} and ${normalizedLabels[1]}`;
  }

  return `${normalizedLabels.slice(0, -1).join(', ')}, and ${normalizedLabels[normalizedLabels.length - 1]}`;
}

function formatUsernameValidationMessage(result: UsernameAvailabilityResult): string {
  if (result.message) return result.message;

  switch (result.code) {
    case 'TAKEN':
      return 'This username is already taken';
    case 'TOO_SHORT':
      return `Enter at least ${REGISTER_USERNAME_MIN_LENGTH} characters`;
    case 'TOO_LONG':
      return `Enter no more than ${REGISTER_USERNAME_MAX_LENGTH} characters`;
    case 'REQUIRED':
      return 'Username is required';
    default:
      return result.available === false ? 'Username is already taken' : 'Enter a valid username';
  }
}

function maskEmailAddress(value: string): string {
  const [localPart, domain] = value.trim().split('@');
  if (!localPart || !domain) return value.trim();

  return `${localPart.charAt(0)}***@${domain}`;
}

function sanitizePasscodeInput(value: string): string {
  return value.replace(/\D/g, '').slice(0, LOGIN_MFA_CODE_LENGTH);
}

function formatLoginMfaError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const normalized = message.toLowerCase();

  if (normalized.includes('expired')) return 'Code expired. Please resend';
  if (normalized.includes('too many') || normalized.includes('attempt') || normalized.includes('rate')) {
    return message || 'Too many attempts. Please try again later';
  }

  return 'Invalid or expired code';
}

function MessageBanner({ tone, children, className }: MessageBannerProps) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-400/10 dark:text-emerald-200'
      : tone === 'error'
        ? 'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:border-rose-300/20 dark:bg-rose-400/10 dark:text-rose-200'
        : 'border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:border-cyan-300/20 dark:bg-cyan-400/10 dark:text-cyan-200';

  return <div className={cn('rounded-xl border px-3 py-2 text-[12.5px]', toneClass, className)}>{children}</div>;
}

function ModalCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(MODAL_CARD_CLASS, className)}>{children}</div>;
}

function GlassPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('relative isolate overflow-hidden', className)}>
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(180deg,rgba(148,163,184,0.06),rgba(15,23,42,0.02)_20%,transparent_62%)]" />
      <div className="pointer-events-none absolute left-[8%] top-[-14%] h-28 w-[46%] rounded-full bg-cyan-200/6 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-12%] right-[-4%] h-36 w-36 rounded-full bg-blue-300/8 blur-3xl" />
      <div className="pointer-events-none absolute inset-x-[7%] top-0 h-px bg-gradient-to-r from-transparent via-cyan-100/20 to-transparent" />
      <div className="relative">{children}</div>
    </div>
  );
}

const ThemeSafeInput = forwardRef<HTMLInputElement, ThemeSafeInputProps>(function ThemeSafeInput({
  icon: Icon,
  endAdornment,
  className,
  wrapperClassName,
  ...props
}, ref) {
  return (
    <div className={cn('group relative', wrapperClassName)}>
      {Icon ? (
        <Icon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-cyan-600 dark:text-slate-500 dark:group-focus-within:text-cyan-200" />
      ) : null}
      <input
        ref={ref}
        {...props}
        className={cn(Icon ? AUTH_INPUT_WITH_ICON_CLASS : AUTH_INPUT_BASE_CLASS, endAdornment ? 'pr-11' : '', className)}
      />
      {endAdornment ? <div className="absolute right-3 top-1/2 -translate-y-1/2">{endAdornment}</div> : null}
    </div>
  );
});

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia(query);
    const handleChange = () => setMatches(mediaQuery.matches);

    handleChange();
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [query]);

  return matches;
}

function AnimatedMetricValue({ value, suffix = '', durationMs = 1400, className }: AnimatedMetricValueProps) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const hasRevealedRef = useRef(false);
  const displayValueRef = useRef(0);
  const [displayValue, setDisplayValue] = useState(() => (prefersReducedMotion ? value : 0));
  const [hasEnteredView, setHasEnteredView] = useState(prefersReducedMotion);

  useEffect(() => {
    displayValueRef.current = displayValue;
  }, [displayValue]);

  useEffect(() => {
    if (prefersReducedMotion) {
      setHasEnteredView(true);
      setDisplayValue(value);
      hasRevealedRef.current = true;
    }
  }, [prefersReducedMotion, value]);

  useEffect(() => {
    if (prefersReducedMotion || hasEnteredView) return;

    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setHasEnteredView(true);
        observer.disconnect();
      },
      { threshold: 0.35 },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [hasEnteredView, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion || !hasEnteredView) return;

    const startValue = hasRevealedRef.current ? displayValueRef.current : 0;
    if (startValue === value) {
      setDisplayValue(value);
      return;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    const startTime = performance.now();
    const animate = (timestamp: number) => {
      const progress = Math.min(1, (timestamp - startTime) / durationMs);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const nextValue = Math.round(startValue + (value - startValue) * easedProgress);

      displayValueRef.current = nextValue;
      setDisplayValue(nextValue);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      hasRevealedRef.current = true;
      animationFrameRef.current = null;
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [durationMs, hasEnteredView, prefersReducedMotion, value]);

  return (
    <span ref={containerRef} className={className}>
      {formatCount(displayValue)}
      {suffix}
    </span>
  );
}

function ViewportAuthShell({ authPanel, rightPanel, children }: ViewportAuthShellProps) {
  return (
    <div className="relative isolate min-h-[100dvh] w-full overflow-x-hidden bg-slate-50 text-slate-950 dark:bg-[#020617] dark:text-slate-50 xl:h-[100dvh] xl:overflow-hidden">
      {/* Background layer */}
      <div className="pointer-events-none fixed inset-0 z-0 hidden xl:flex">
        <div className={cn('relative h-screen shrink-0 basis-[42%] overflow-hidden bg-[radial-gradient(circle_at_16%_14%,rgba(34,211,238,0.07),transparent_24%),radial-gradient(circle_at_84%_10%,rgba(59,130,246,0.06),transparent_24%),linear-gradient(180deg,#eff4fb_0%,#e7eef8_44%,#dde6f3_100%)]', AUTH_LEFT_PANEL_DARK_BG_CLASS)}>
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.32),transparent_20%,rgba(56,189,248,0.025)_100%)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.045),transparent_24%,rgba(34,211,238,0.028)_100%)]" />
          <div className="absolute left-[-10%] top-[8%] hidden h-72 w-72 rounded-full bg-cyan-300/12 blur-3xl dark:block" />
          <div className="absolute bottom-[-8%] right-[-12%] hidden h-80 w-80 rounded-full bg-blue-400/12 blur-3xl dark:block" />
        </div>
        <div className="relative h-screen min-w-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_18%_18%,rgba(96,165,250,0.2),transparent_18%),radial-gradient(circle_at_84%_14%,rgba(34,211,238,0.14),transparent_24%),linear-gradient(160deg,#1130ab_0%,#0b238f_34%,#08196d_68%,#060f43_100%)]">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.055),transparent_30%,rgba(255,255,255,0.016))]" />
          <div className="absolute left-[-12%] top-[10%] h-72 w-72 rounded-full bg-cyan-300/12 blur-3xl" />
          <div className="absolute bottom-[-12%] right-[-10%] h-80 w-80 rounded-full bg-blue-300/14 blur-3xl" />
          <div className="absolute left-[8%] top-[9%] h-px w-[34%] rotate-[18deg] bg-gradient-to-r from-transparent via-cyan-100/25 to-transparent" />
          <div className="absolute left-[26%] top-[22%] h-3 w-3 rounded-full bg-cyan-100/16 blur-sm" />
        </div>
      </div>

      {/* Content layer */} 
      <div className="relative z-10 mx-auto grid min-h-[100dvh] xl:h-[100dvh] xl:min-h-0 xl:grid-cols-[minmax(340px,50%)_minmax(0,50%)] 2xl:grid-cols-[minmax(380px,50%)_minmax(0,50%)]">
        {authPanel}
        {rightPanel}
      </div>
      {children}
    </div>
  );
}

function AuthPanel({ activeView, onSelectView, children }: AuthPanelProps) {
  const panelCopy = AUTH_PANEL_COPY[activeView];

  return (
    <section className={cn('relative order-1 min-w-0 overflow-hidden border-t border-slate-200/80 bg-[radial-gradient(circle_at_16%_14%,rgba(34,211,238,0.07),transparent_24%),radial-gradient(circle_at_84%_10%,rgba(59,130,246,0.06),transparent_24%),linear-gradient(180deg,#eff4fb_0%,#e7eef8_44%,#dde6f3_100%)] dark:border-white/10 xl:order-1 xl:h-[100dvh] xl:border-t-0 xl:bg-transparent dark:xl:bg-transparent', AUTH_LEFT_PANEL_DARK_BG_CLASS)}>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.32),transparent_20%,rgba(56,189,248,0.025)_100%)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.045),transparent_24%,rgba(34,211,238,0.028)_100%)] xl:hidden" />
      <div className="pointer-events-none absolute left-[-10%] top-[8%] hidden h-72 w-72 rounded-full bg-cyan-300/12 blur-3xl dark:block xl:hidden" />
      <div className="pointer-events-none absolute bottom-[-8%] right-[-12%] hidden h-80 w-80 rounded-full bg-blue-400/12 blur-3xl dark:block xl:hidden" />
      <div className="mx-auto flex h-full w-full min-w-0 max-w-[560px] flex-col px-4 py-3 sm:px-5 sm:py-3.5 md:px-6 md:py-4 xl:max-w-none xl:px-6 xl:py-5 2xl:px-7">
        <div className="mx-auto flex h-full w-full min-w-0 max-w-[448px] flex-col lg:max-w-[500px] xl:max-w-[440px]">
          <div className="flex items-start justify-between gap-2.5">
            <div className="auth-logo-holo inline-flex items-center">
              <img src={sciagenLogoWhite} alt="Sciagen" className={AUTH_LOGO_CLASS} />
            </div>
          </div>

          <div className="mt-2.5 flex flex-col">
            <div className="min-h-[84px] space-y-1 sm:min-h-[88px]">
              <div>
                <p className="text-[8.5px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Unified AI Engineering Platform{APP_VERSION ? <><span aria-hidden> &middot; </span>v{APP_VERSION}</> : null}
                </p>
                <h1 className="mt-1 text-[clamp(1.25rem,1.1rem+0.45vw,1.65rem)] font-semibold leading-[1.05] text-slate-950 dark:text-white">
                  {panelCopy.title}
                </h1>
                <p className="mt-0.5 max-w-xl text-[12px] leading-[1.45] text-slate-600 dark:text-slate-300 sm:text-[12.5px]">
                  {panelCopy.description}
                </p>
              </div>
            </div>

            <div className="mt-2" role="tablist" aria-label="Authentication views">
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(246,249,253,0.96)_100%)] p-[2.5px] shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_12px_28px_-24px_rgba(148,163,184,0.45)] backdrop-blur-sm dark:border-white/12 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(20,33,72,0.28)_100%)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] dark:backdrop-blur-xl">
                {[
                  { id: 'login' as const, label: 'Sign In' },
                  { id: 'register' as const, label: 'Create Account' },
                ].map((item) => {
                  const isActive = activeView === item.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => onSelectView(item.id)}
                      className={cn(
                        'min-h-[32px] rounded-[9px] px-1 py-1 text-[10px] font-medium leading-tight transition duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/12 sm:px-1.5 sm:text-[11.5px] dark:focus-visible:ring-cyan-300/12',
                        isActive
                          ? 'bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 text-white shadow-[0_8px_18px_rgba(14,165,233,0.22)]'
                          : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white',
                      )}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-2 rounded-[22px] border border-slate-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(248,250,252,0.96)_18%,rgba(241,245,249,0.94)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_22px_52px_-34px_rgba(148,163,184,0.45)] backdrop-blur-md dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(14,27,63,0.28)_18%,rgba(10,20,48,0.18)_100%)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_22px_54px_-32px_rgba(8,47,73,0.5)] dark:backdrop-blur-xl">
              <div className="flex flex-col">{children}</div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}

export function StatCarouselCard({ title, subtitle, slides }: StatCarouselCardProps) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const wheelTargetRef = useRef<HTMLElement | null>(null);
  const wheelLockUntilRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (activeIndex <= slides.length - 1) return;
    setActiveIndex(0);
  }, [activeIndex, slides.length]);

  useEffect(() => {
    if (prefersReducedMotion || isPaused || slides.length < 2) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % slides.length);
    }, 4200);
    return () => window.clearInterval(timer);
  }, [isPaused, prefersReducedMotion, slides.length]);

  const goToIndex = (nextIndex: number) => {
    if (slides.length === 0) return;
    setActiveIndex((nextIndex + slides.length) % slides.length);
  };

  const stepSlide = (direction: -1 | 1) => {
    goToIndex(activeIndex + direction);
  };

  const handleWheel = useCallback((event: WheelEvent) => {
    if (slides.length < 2) return;
    const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(rawDelta) < 18) return;

    if (event.cancelable) {
      event.preventDefault();
    }
    const now = Date.now();
    if (now < wheelLockUntilRef.current) return;

    wheelLockUntilRef.current = now + 520;
    const direction = rawDelta > 0 ? 1 : -1;
    setActiveIndex((current) => (current + direction + slides.length) % slides.length);
  }, [slides.length]);

  useEffect(() => {
    const wheelTarget = wheelTargetRef.current;
    if (!wheelTarget) return;

    wheelTarget.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      wheelTarget.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  return (
    <article
      ref={wheelTargetRef}
      className="group relative min-h-[176px] overflow-hidden rounded-[28px] bg-[linear-gradient(180deg,rgba(14,30,84,0.9),rgba(8,20,54,0.9))] px-4 py-2 text-white shadow-[0_28px_72px_rgba(2,12,43,0.34)] ring-1 ring-white/10 backdrop-blur-xl dark:border-cyan-300/10 dark:bg-[linear-gradient(180deg,rgba(39, 56, 105, 0.92),rgba(7,19,51,0.94))] dark:shadow-[0_28px_80px_rgba(2,8,23,0.4)] dark:ring-white/10 sm:px-5 sm:py-2.5"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setIsPaused(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        stepSlide(event.key === 'ArrowRight' ? 1 : -1);
      }}
      tabIndex={0}
    >
      <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />
      <div className="pointer-events-none absolute right-[-10%] top-[-18%] h-40 w-40 rounded-full bg-cyan-300/18 blur-3xl dark:bg-cyan-300/16" />
      <div className="pointer-events-none absolute bottom-[-22%] left-[-8%] h-40 w-40 rounded-full bg-blue-400/14 blur-3xl dark:bg-blue-400/14" />

      <div className="relative flex h-full flex-col">
        <div className="flex items-start justify-between gap-1.5">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.26em] text-cyan-200">{title}</p>
            <p className="mt-0 text-[11.5px] leading-[1.22rem] text-slate-200/84">{subtitle}</p>
          </div>

          {slides.length > 1 ? <div className="h-[34px] w-[69px] shrink-0" aria-hidden="true" /> : null}
        </div>

        <div className="relative mt-2.5 min-h-[120px] overflow-hidden">
          {slides.map((slide, index) => {
            const Icon = slide.icon;
            const isActive = index === activeIndex;

            return (
              <div
                key={slide.key}
                aria-hidden={!isActive}
                className={cn(
                  'absolute inset-0 flex flex-col justify-between transition-all',
                  prefersReducedMotion ? 'duration-0' : 'duration-500 ease-out',
                  isActive
                    ? 'translate-y-0 opacity-100'
                    : index < activeIndex
                      ? 'translate-y-2 opacity-0'
                      : '-translate-y-2 opacity-0',
                )}
              >
                <div className="flex items-start justify-between gap-1.5">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-200/70">{slide.label}</p>
                    <div className="mt-1 text-[clamp(1.95rem,1.8rem+0.48vw,2.45rem)] font-semibold leading-none text-white">
                      <AnimatedMetricValue value={slide.value} durationMs={1350} />
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white/10 p-2 text-cyan-100 ring-1 ring-white/10">
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                </div>


                <p className="max-w-[28rem] text-[12px] leading-[1.1rem] text-slate-200/84">{slide.helper}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-2 flex items-center justify-center gap-2">
          {slides.map((slide, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                key={slide.key}
                type="button"
                onClick={() => goToIndex(index)}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/12 dark:focus-visible:ring-cyan-300/12',
                  isActive ? 'w-7 bg-cyan-500 dark:bg-cyan-300' : 'w-1.5 bg-slate-300 dark:bg-white/[0.18]',
                )}
                aria-label={`Show ${slide.label.toLowerCase()}`}
              />
            );
          })}
        </div>
      </div>
    </article>
  );
}

function RightPanelContent({
  mode,
  onChangeMode,
  portfolioSlides,
  workflowSlides,
  ideaForm,
  ideaDomains,
  ideaMessage,
  ideaLoading,
  onIdeaFieldChange,
  onSubmitIdea,
}: {
  mode: RightPanelMode;
  onChangeMode: (mode: RightPanelMode) => void;
  portfolioSlides: StatCarouselSlide[];
  workflowSlides: StatCarouselSlide[];
  ideaForm: {
    domain_id: string;
    idea_text: string;
    submitted_by_email: string;
    submitted_by_organization: string;
  };
  ideaDomains: PublicDomainOption[];
  ideaMessage: { type: 'success' | 'error'; text: string } | null;
  ideaLoading: boolean;
  onIdeaFieldChange: (field: 'domain_id' | 'idea_text' | 'submitted_by_email' | 'submitted_by_organization', value: string) => void;
  onSubmitIdea: (event: React.FormEvent) => void;
}) {
  const rightPanelSurfaceClass =
    'rounded-[10px] bg-[linear-gradient(180deg,rgba(12, 51, 228, 0.56),rgba(12, 44, 204, 0.5)_18%,rgba(53, 65, 134, 0.42)_100%)] shadow-[0_30px_90px_rgba(2,10,38,0.26)]';
  const rightPanelCenteredColumnClass = 'mx-auto w-full max-w-[42rem]';

  const summaryDetails = (
    <div className="text-white">
      <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/12 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-100">
        <Sparkles className="h-3.5 w-3.5" />
        Application Details
      </div>
      <h2 className="mt-4 text-[clamp(1.4rem,1.2rem+0.6vw,2rem)] font-semibold leading-[1.08] text-white">
        Welcome to AI Governance Workbench 
      </h2>
      <p className="mt-3 max-w-3xl text-[13px] leading-6 text-slate-200/82">
        Your unified platform for managing AI use cases, domains, and engineering workflows </p>

      <ul className="mt-5 space-y-3">
        {APPLICATION_VALUE_BULLETS.map((item) => (
          <li key={item} className="flex items-start gap-3 text-[12.5px] leading-5 text-slate-100/88">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cyan-300" />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-col items-start gap-3">
        <button
          type="button"
          onClick={() => onChangeMode('idea')}
          className="group inline-flex items-center gap-3 text-left text-[13px] font-semibold text-cyan-100 transition hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/12"
        >
          <span className="auth-action-icon auth-action-icon-bulb">
            <span className="auth-action-glow auth-action-glow-bulb" />
            <Lightbulb className="relative z-[1] h-4.5 w-4.5" />
          </span>
          <span className="border-b border-cyan-200/25 pb-0.5 transition group-hover:border-cyan-100/60">Submit Idea</span>
        </button>

        <a
          href={EXTERNAL_SUPPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center gap-3 text-left text-[13px] font-medium text-slate-200/88 transition hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/12"
        >
          <span className="auth-action-icon auth-action-icon-support">
            <span className="auth-action-glow auth-action-glow-support" />
            <Headset className="relative z-[1] h-4.5 w-4.5" />
          </span>
          <span className="border-b border-white/15 pb-0.5 transition group-hover:border-white/45">Contact Support</span>
        </a>
      </div>
    </div>
  );

  const summaryCarouselCards = [
    ...portfolioSlides.map((slide) => ({
      ...slide,
      cardVariant: 'portfolio' as const,
    })),
    ...workflowSlides.map((slide) => ({
      ...slide,
      cardVariant: 'workflow' as const,
    })),
  ];

  const ideaPanel = (
    <GlassPanel className={cn(rightPanelSurfaceClass, 'mx-auto w-full max-w-[820px]')}>
      <div className="flex min-h-[460px] flex-col p-5 text-white sm:p-6 lg:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-100">Anonymous Intake</p>
          <h2 className="mt-1 text-[1.2rem] font-semibold text-white">Submit an AI idea</h2>
          <p className="mt-1 text-[12.5px] leading-5 text-slate-200/82">
            Share a use case signal without changing the existing anonymous submission flow.
          </p>
        </div>
        <button type="button" onClick={() => onChangeMode('summary')} className={cn(GHOST_BUTTON_CLASS, 'border-white/14 bg-white/[0.05] text-white hover:bg-white/[0.08]')}>
          <ArrowLeft className="h-4 w-4" />
          Back to overview
        </button>
      </div>

      <form onSubmit={onSubmitIdea} className="mt-6 flex flex-1 flex-col gap-3.5">
        <div className="space-y-1">
          <label className="block text-[11.5px] font-medium text-slate-100">Domain *</label>
          <SelectMenu
            value={ideaForm.domain_id}
            onChange={(domain_id) => onIdeaFieldChange('domain_id', domain_id)}
            required
            variant="auth"
            placeholder="Select domain"
            leadingIcon={<Folder className="h-4 w-4" />}
            options={ideaDomains.map((domain) => ({
              value: domain.domain_id,
              label: domain.domain_name,
            }))}
            aria-label="Domain"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-[11.5px] font-medium text-slate-100">Your idea *</label>
          <textarea
            value={ideaForm.idea_text}
            onChange={(event) => onIdeaFieldChange('idea_text', event.target.value)}
            placeholder="Describe the use case, intended audience, expected value, and any POC direction."
            rows={4}
            maxLength={5000}
            className={cn(AUTH_INPUT_BASE_CLASS, 'min-h-[200px] flex-1 resize-y py-2.5')}
            required
          />
          <p className="text-[11px] text-slate-300/75">{ideaForm.idea_text.length}/5000 characters</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <input
            type="email"
            value={ideaForm.submitted_by_email}
            onChange={(event) => onIdeaFieldChange('submitted_by_email', event.target.value)}
            placeholder="Your email *"
            maxLength={255}
            className={AUTH_INPUT_BASE_CLASS}
            required
          />
          <input
            type="text"
            value={ideaForm.submitted_by_organization}
            onChange={(event) => onIdeaFieldChange('submitted_by_organization', event.target.value)}
            placeholder="Organization (optional)"
            maxLength={200}
            className={AUTH_INPUT_BASE_CLASS}
          />
        </div>

        <div className="mt-auto space-y-2 pt-2">
          {ideaMessage ? <MessageBanner tone={ideaMessage.type}>{ideaMessage.text}</MessageBanner> : null}
          <button type="submit" disabled={ideaLoading} className={PRIMARY_BUTTON_CLASS}>
            <Lightbulb className="h-4 w-4" />
            {ideaLoading ? 'Submitting...' : 'Submit idea'}
          </button>
        </div>
      </form>
      </div>
    </GlassPanel>
  );

  return (
    <section className="relative order-2 min-w-0 overflow-hidden border-b border-slate-200/80 bg-[radial-gradient(circle_at_18%_18%,rgba(96,165,250,0.2),transparent_18%),radial-gradient(circle_at_84%_14%,rgba(34,211,238,0.14),transparent_24%),linear-gradient(160deg,#1130ab_0%,#0b238f_34%,#08196d_68%,#060f43_100%)] xl:order-2 xl:h-[100dvh] xl:border-b-0 xl:bg-transparent">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.055),transparent_30%,rgba(255,255,255,0.016))] xl:hidden" />
      <div className="pointer-events-none absolute left-[-12%] top-[10%] h-72 w-72 rounded-full bg-cyan-300/12 blur-3xl xl:hidden" />
      <div className="pointer-events-none absolute bottom-[-12%] right-[-10%] h-80 w-80 rounded-full bg-blue-300/14 blur-3xl xl:hidden" />
      <div className="pointer-events-none absolute left-[8%] top-[9%] h-px w-[34%] rotate-[18deg] bg-gradient-to-r from-transparent via-cyan-100/25 to-transparent xl:hidden" />
      <div className="pointer-events-none absolute left-[26%] top-[22%] h-3 w-3 rounded-full bg-cyan-100/16 blur-sm xl:hidden" />

        <div className="relative flex w-full min-w-0 flex-col px-4 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6 xl:px-7">
        <div className="flex min-w-0 flex-col gap-4 xl:items-center">
          {mode === 'summary' ? (
            <GlassPanel className={cn(rightPanelSurfaceClass, 'mx-auto w-full max-w-[820px]')}>
              <div className="flex flex-col p-4 text-white sm:p-5">
              <div className={rightPanelCenteredColumnClass}>
                <WorkbenchMetrics3DCarousel cards={summaryCarouselCards} showControls={false} />
                <div className="mt-4 border-t border-white/10 pt-4">
                  {summaryDetails}
                </div>
              </div>
              </div>
            </GlassPanel>
          ) : (
            ideaPanel
          )}
        </div>
      </div>
    </section>
  );
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordStep, setForgotPasswordStep] = useState<ForgotPasswordStep>('email');
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [forgotPasswordPasscode, setForgotPasswordPasscode] = useState('');
  const [forgotPasswordResetToken, setForgotPasswordResetToken] = useState('');
  const [forgotPasswordNewPassword, setForgotPasswordNewPassword] = useState('');
  const [forgotPasswordConfirmPassword, setForgotPasswordConfirmPassword] = useState('');
  const [showForgotPasswordNewPassword, setShowForgotPasswordNewPassword] = useState(false);
  const [showForgotPasswordConfirmPassword, setShowForgotPasswordConfirmPassword] = useState(false);
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [forgotPasswordMessage, setForgotPasswordMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [forgotPasswordCooldownSeconds, setForgotPasswordCooldownSeconds] = useState(0);
  const [isValidatingForgotPassword, setIsValidatingForgotPassword] = useState(false);
  const [forgotPasswordValidation, setForgotPasswordValidation] = useState<PasswordValidationState | null>(null);
  const [forgotPasswordValidationError, setForgotPasswordValidationError] = useState<PasswordValidationErrorState | null>(null);
  const forgotPasswordValidationRequestRef = useRef(0);
  const validateForgotPasswordAbortRef = useRef<AbortController | null>(null);
  const [loginStep, setLoginStep] = useState<LoginStep>('CREDENTIALS');
  const [loginChallengeId, setLoginChallengeId] = useState('');
  const [loginMfaCode, setLoginMfaCode] = useState('');
  const [loginMfaMessage, setLoginMfaMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isVerifyingLoginMfa, setIsVerifyingLoginMfa] = useState(false);
  const [isResendingLoginMfa, setIsResendingLoginMfa] = useState(false);
  const [loginMfaResendCooldown, setLoginMfaResendCooldown] = useState(0);
  const [loginMfaMethod, setLoginMfaMethod] = useState<LoginMfaMethod>('email_passcode');
  const [loginMfaMethods, setLoginMfaMethods] = useState<LoginMfaMethod[]>(['email_passcode']);
  const [isSwitchingLoginMfaMethod, setIsSwitchingLoginMfaMethod] = useState(false);
  const [pendingLoginUser, setPendingLoginUser] = useState<AuthUser | null>(null);
  const loginMfaInputRef = useRef<HTMLInputElement | null>(null);
  const [authView, setAuthView] = useState<AuthView>('login');
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>('summary');
  const [appSummary, setAppSummary] = useState<PublicAppSummary | null>(null);
  const [orgTypes, setOrgTypes] = useState<OrgTypeOption[]>([]);
  const [registerDomains, setRegisterDomains] = useState<PublicDomainOption[]>([]);
  const [registerForm, setRegisterForm] = useState({
    user_name: '',
    email: '',
    password: '',
    organization: '',
    organization_type: '',
    interested_domain_id: '',
  });
  const [isSubmittingRegistration, setIsSubmittingRegistration] = useState(false);
  const [resendTimer, setResendTimer] = useState(30);
  const [isResendingPasscode, setIsResendingPasscode] = useState(false);
  const [showPasscodeOverlay, setShowPasscodeOverlay] = useState(false);
  const [isCheckingRegisterEmail, setIsCheckingRegisterEmail] = useState(false);
  const [registerEmailExists, setRegisterEmailExists] = useState(false);
  const checkEmailAbortRef = useRef<AbortController | null>(null);
  const [isCheckingRegisterUsername, setIsCheckingRegisterUsername] = useState(false);
  const [registerUsernameValidation, setRegisterUsernameValidation] = useState<UsernameValidationState | null>(null);
  const [registerUsernameValidationError, setRegisterUsernameValidationError] = useState<UsernameValidationErrorState | null>(null);
  const checkUsernameAbortRef = useRef<AbortController | null>(null);
  const usernameValidationRequestRef = useRef(0);
  const [isValidatingRegisterPassword, setIsValidatingRegisterPassword] = useState(false);
  const [registerPasswordValidation, setRegisterPasswordValidation] = useState<PasswordValidationState | null>(null);
  const [registerPasswordValidationError, setRegisterPasswordValidationError] = useState<PasswordValidationErrorState | null>(null);
  const validatePasswordAbortRef = useRef<AbortController | null>(null);
  const passwordValidationRequestRef = useRef(0);
  const [registrationStep, setRegistrationStep] = useState<'form' | 'verify' | 'success'>('form');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [registerMessage, setRegisterMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [registerFormOpenedAt, setRegisterFormOpenedAt] = useState<number | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const [ideaDomains, setIdeaDomains] = useState<PublicDomainOption[]>([]);
  const [ideaForm, setIdeaForm] = useState({
    domain_id: '',
    idea_text: '',
    submitted_by_email: '',
    submitted_by_organization: '',
  });
  const [ideaLoading, setIdeaLoading] = useState(false);
  const [ideaMessage, setIdeaMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isVerifyingPasscode, setIsVerifyingPasscode] = useState(false);
  const { signIn, verifyLoginPasscode, completePendingLogin } = useAuth();
  const showRegister = authView === 'register';
  const showIdeaPanel = rightPanelMode === 'idea';

  useEffect(() => {
    let isMounted = true;

    (async () => {
      const summary = await api.getPublicAppSummary();

      if (!isMounted) return;
      setAppSummary(summary);
    })().catch((err: unknown) => {
      logger.error('Failed to load login summary data', err);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (showRegister && orgTypes.length === 0) {
      api.getPublicOrganizationTypes().then(setOrgTypes);
    }
  }, [showRegister, orgTypes.length]);

  useEffect(() => {
    if (showRegister && registerDomains.length === 0) {
      api.getPublicDomains().then(setRegisterDomains);
    }
  }, [showRegister, registerDomains.length]);

  useEffect(() => {
    if (showIdeaPanel && ideaDomains.length === 0) {
      api.getPublicDomains().then(setIdeaDomains);
    }
  }, [ideaDomains.length, showIdeaPanel]);

  useEffect(() => {
    if (registrationStep !== 'verify' || resendTimer <= 0) return;
    const interval = setInterval(() => {
      setResendTimer((previous) => previous - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [resendTimer, registrationStep]);

  useEffect(() => {
    if (loginStep !== 'MFA' || loginMfaResendCooldown <= 0) return;
    const interval = window.setInterval(() => {
      setLoginMfaResendCooldown((previous) => Math.max(0, previous - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [loginMfaResendCooldown, loginStep]);

  useEffect(() => {
    if (!showForgotPassword || forgotPasswordCooldownSeconds <= 0) return;
    const interval = window.setInterval(() => {
      setForgotPasswordCooldownSeconds((previous) => Math.max(0, previous - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [forgotPasswordCooldownSeconds, showForgotPassword]);

  useEffect(() => {
    const requestId = forgotPasswordValidationRequestRef.current + 1;
    forgotPasswordValidationRequestRef.current = requestId;
    validateForgotPasswordAbortRef.current?.abort();
    validateForgotPasswordAbortRef.current = null;

    if (!showForgotPassword || forgotPasswordStep !== 'password') {
      setIsValidatingForgotPassword(false);
      return;
    }

    const passwordToValidate = forgotPasswordNewPassword;
    setForgotPasswordValidation(null);
    setForgotPasswordValidationError(null);

    if (!passwordToValidate) {
      setIsValidatingForgotPassword(false);
      return;
    }

    setIsValidatingForgotPassword(true);

    const timer = window.setTimeout(async () => {
      const controller = new AbortController();
      validateForgotPasswordAbortRef.current = controller;

      try {
        const result = await api.validatePassword(passwordToValidate, controller.signal);
        if (requestId !== forgotPasswordValidationRequestRef.current) return;
        setForgotPasswordValidation({ password: passwordToValidate, result });
        setForgotPasswordValidationError(null);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        if (requestId !== forgotPasswordValidationRequestRef.current) return;
        logger.error('Validate forgot password error', err);
        setForgotPasswordValidation(null);
        setForgotPasswordValidationError({
          password: passwordToValidate,
          message: 'Unable to validate password right now',
        });
      } finally {
        if (requestId === forgotPasswordValidationRequestRef.current) {
          setIsValidatingForgotPassword(false);
        }
      }
    }, REGISTER_VALIDATION_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      validateForgotPasswordAbortRef.current?.abort();
      validateForgotPasswordAbortRef.current = null;
      if (forgotPasswordValidationRequestRef.current === requestId) {
        forgotPasswordValidationRequestRef.current += 1;
      }
    };
  }, [showForgotPassword, forgotPasswordStep, forgotPasswordNewPassword]);

  useEffect(() => {
    if (loginStep !== 'MFA') return;
    loginMfaInputRef.current?.focus();
  }, [loginStep]);

  useEffect(() => {
    if (!showRegister) return;
    setRegistrationStep('form');
    setOtpDigits(['', '', '', '', '', '']);
    setResendTimer(30);
    setIsResendingPasscode(false);
    setIsCheckingRegisterEmail(false);
    setRegisterEmailExists(false);
    checkEmailAbortRef.current?.abort();
    checkEmailAbortRef.current = null;
    setIsCheckingRegisterUsername(false);
    setRegisterUsernameValidation(null);
    setRegisterUsernameValidationError(null);
    checkUsernameAbortRef.current?.abort();
    checkUsernameAbortRef.current = null;
    usernameValidationRequestRef.current += 1;
    setIsValidatingRegisterPassword(false);
    setRegisterPasswordValidation(null);
    setRegisterPasswordValidationError(null);
    validatePasswordAbortRef.current?.abort();
    validatePasswordAbortRef.current = null;
    passwordValidationRequestRef.current += 1;
  }, [showRegister]);

  const isRegisterEmailValid = (() => {
    const value = registerForm.email.trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  })();

  useEffect(() => {
    if (!showRegister || registrationStep !== 'form') return;
    const emailToCheck = registerForm.email.trim();
    if (!emailToCheck || !isRegisterEmailValid) {
      setIsCheckingRegisterEmail(false);
      setRegisterEmailExists(false);
      return;
    }

    setRegisterEmailExists(false);
    setIsCheckingRegisterEmail(true);

    const timer = window.setTimeout(async () => {
      checkEmailAbortRef.current?.abort();
      const controller = new AbortController();
      checkEmailAbortRef.current = controller;

      try {
        const response = await fetch(`${AUTH_API_BASE_URL}/auth/check-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailToCheck }),
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = (body as { detail?: string })?.detail || response.statusText || 'Failed to validate email';
          throw new Error(message);
        }
        setRegisterEmailExists(Boolean((body as { exists?: boolean })?.exists));
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        logger.error('Check email error', err);
        setRegisterEmailExists(false);
      } finally {
        setIsCheckingRegisterEmail(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      checkEmailAbortRef.current?.abort();
    };
  }, [showRegister, registerForm.email, registrationStep, isRegisterEmailValid]);

  useEffect(() => {
    const requestId = usernameValidationRequestRef.current + 1;
    usernameValidationRequestRef.current = requestId;
    checkUsernameAbortRef.current?.abort();
    checkUsernameAbortRef.current = null;

    if (!showRegister || registrationStep !== 'form') {
      setIsCheckingRegisterUsername(false);
      return;
    }

    const usernameToCheck = registerForm.user_name.trim();
    setRegisterUsernameValidation(null);
    setRegisterUsernameValidationError(null);

    if (
      !usernameToCheck ||
      usernameToCheck.length < REGISTER_USERNAME_MIN_LENGTH ||
      usernameToCheck.length > REGISTER_USERNAME_MAX_LENGTH
    ) {
      setIsCheckingRegisterUsername(false);
      return;
    }

    setIsCheckingRegisterUsername(true);

    const timer = window.setTimeout(async () => {
      const controller = new AbortController();
      checkUsernameAbortRef.current = controller;

      try {
        const result = await api.checkUsername(usernameToCheck, controller.signal);
        if (requestId !== usernameValidationRequestRef.current) return;
        setRegisterUsernameValidation({ username: usernameToCheck, result });
        setRegisterUsernameValidationError(null);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        if (requestId !== usernameValidationRequestRef.current) return;
        logger.error('Check username error', err);
        setRegisterUsernameValidation(null);
        setRegisterUsernameValidationError({
          username: usernameToCheck,
          message: 'Unable to verify username right now',
        });
      } finally {
        if (requestId === usernameValidationRequestRef.current) {
          setIsCheckingRegisterUsername(false);
        }
      }
    }, REGISTER_VALIDATION_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      checkUsernameAbortRef.current?.abort();
      checkUsernameAbortRef.current = null;
      if (usernameValidationRequestRef.current === requestId) {
        usernameValidationRequestRef.current += 1;
      }
    };
  }, [showRegister, registerForm.user_name, registrationStep]);

  useEffect(() => {
    const requestId = passwordValidationRequestRef.current + 1;
    passwordValidationRequestRef.current = requestId;
    validatePasswordAbortRef.current?.abort();
    validatePasswordAbortRef.current = null;

    if (!showRegister || registrationStep !== 'form') {
      setIsValidatingRegisterPassword(false);
      return;
    }

    const passwordToValidate = registerForm.password;
    setRegisterPasswordValidation(null);
    setRegisterPasswordValidationError(null);

    if (!passwordToValidate) {
      setIsValidatingRegisterPassword(false);
      return;
    }

    setIsValidatingRegisterPassword(true);

    const timer = window.setTimeout(async () => {
      const controller = new AbortController();
      validatePasswordAbortRef.current = controller;

      try {
        const result = await api.validatePassword(passwordToValidate, controller.signal);
        if (requestId !== passwordValidationRequestRef.current) return;
        setRegisterPasswordValidation({ password: passwordToValidate, result });
        setRegisterPasswordValidationError(null);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        if (requestId !== passwordValidationRequestRef.current) return;
        logger.error('Validate password error', err);
        setRegisterPasswordValidation(null);
        setRegisterPasswordValidationError({
          password: passwordToValidate,
          message: 'Unable to validate password right now',
        });
      } finally {
        if (requestId === passwordValidationRequestRef.current) {
          setIsValidatingRegisterPassword(false);
        }
      }
    }, REGISTER_VALIDATION_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      validatePasswordAbortRef.current?.abort();
      validatePasswordAbortRef.current = null;
      if (passwordValidationRequestRef.current === requestId) {
        passwordValidationRequestRef.current += 1;
      }
    };
  }, [showRegister, registerForm.password, registrationStep]);

  function resetRegisterForm() {
    setRegisterForm({
      user_name: '',
      email: '',
      password: '',
      organization: '',
      organization_type: '',
      interested_domain_id: '',
    });
    setRegistrationStep('form');
    setOtpDigits(['', '', '', '', '', '']);
    setIsCheckingRegisterEmail(false);
    setRegisterEmailExists(false);
    checkEmailAbortRef.current?.abort();
    checkEmailAbortRef.current = null;
    setIsCheckingRegisterUsername(false);
    setRegisterUsernameValidation(null);
    setRegisterUsernameValidationError(null);
    checkUsernameAbortRef.current?.abort();
    checkUsernameAbortRef.current = null;
    usernameValidationRequestRef.current += 1;
    setIsValidatingRegisterPassword(false);
    setRegisterPasswordValidation(null);
    setRegisterPasswordValidationError(null);
    validatePasswordAbortRef.current?.abort();
    validatePasswordAbortRef.current = null;
    passwordValidationRequestRef.current += 1;
  }

  function handleRegisterUsernameChange(value: string) {
    setRegisterForm((form) => ({ ...form, user_name: value }));
    setRegisterUsernameValidation(null);
    setRegisterUsernameValidationError(null);
    setIsCheckingRegisterUsername(false);
    checkUsernameAbortRef.current?.abort();
    checkUsernameAbortRef.current = null;
    usernameValidationRequestRef.current += 1;
  }

  function handleRegisterPasswordChange(value: string) {
    setRegisterForm((form) => ({ ...form, password: value }));
    setRegisterPasswordValidation(null);
    setRegisterPasswordValidationError(null);
    setIsValidatingRegisterPassword(false);
    validatePasswordAbortRef.current?.abort();
    validatePasswordAbortRef.current = null;
    passwordValidationRequestRef.current += 1;
  }

  useEffect(() => {
    if (!showRegister || !TURNSTILE_SITE_KEY || registrationStep !== 'form') return;
    const container = turnstileContainerRef.current;
    if (!container) return;

    const renderWidget = () => {
      if (!container.isConnected || !window.turnstile) return;
      if (turnstileWidgetIdRef.current) {
        try {
          window.turnstile.remove(turnstileWidgetIdRef.current);
        } catch {
          // ignore widget cleanup errors
        }
        turnstileWidgetIdRef.current = null;
      }
      turnstileWidgetIdRef.current = window.turnstile.render(container, { sitekey: TURNSTILE_SITE_KEY });
    };

    if (document.querySelector('script[src*="challenges.cloudflare. /turnstile"]') && window.turnstile) {
      renderWidget();
      return () => {
        if (turnstileWidgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.remove(turnstileWidgetIdRef.current);
          } catch {
            // ignore widget cleanup errors
          }
          turnstileWidgetIdRef.current = null;
        }
      };
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = renderWidget;
    document.head.appendChild(script);

    return () => {
      if (turnstileWidgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(turnstileWidgetIdRef.current);
        } catch {
          // ignore widget cleanup errors
        }
        turnstileWidgetIdRef.current = null;
      }
    };
  }, [showRegister, registrationStep]);

  const forgotPasswordOnCooldown = forgotPasswordCooldownSeconds > 0;

  function resetLoginMfaState() {
    setLoginStep('CREDENTIALS');
    setLoginChallengeId('');
    setLoginMfaCode('');
    setLoginMfaMessage(null);
    setIsVerifyingLoginMfa(false);
    setIsResendingLoginMfa(false);
    setLoginMfaResendCooldown(0);
    setLoginMfaMethod('email_passcode');
    setLoginMfaMethods(['email_passcode']);
    setIsSwitchingLoginMfaMethod(false);
    setPendingLoginUser(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoginMfaMessage(null);
    setLoading(true);

    try {
      const emailToSignIn = email.trim();
      const response = await signIn(emailToSignIn, password);

      if (response.status === 'MFA_REQUIRED') {
        const nextMethod = (response.method === 'totp' ? 'totp' : 'email_passcode') as LoginMfaMethod;
        const nextMethods = (response.methods?.length ? response.methods : [nextMethod]) as LoginMfaMethod[];
        setEmail(emailToSignIn);
        setPassword('');
        setLoginChallengeId(response.challenge_id);
        setLoginMfaCode('');
        setLoginMfaMethod(nextMethod);
        setLoginMfaMethods(nextMethods);
        setLoginMfaMessage({
          type: 'info',
          text: nextMethod === 'totp'
            ? 'Enter the 6-digit code from your authenticator app'
            : 'Enter the verification code sent to your email',
        });
        setLoginMfaResendCooldown(nextMethod === 'email_passcode' ? LOGIN_MFA_RESEND_COOLDOWN_SECONDS : 0);
        setLoginStep('MFA');
      } else if (response.status === 'LOGIN_SUCCESS' && response.totp_setup_suggested) {
        setPendingLoginUser(response.user);
        setLoginStep('TOTP_SETUP');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleLoginMfaVerify(codeOverride?: string) {
    const passcode = sanitizePasscodeInput(codeOverride ?? loginMfaCode);
    if (!loginChallengeId || passcode.length !== LOGIN_MFA_CODE_LENGTH || isVerifyingLoginMfa) return;

    setLoginMfaCode(passcode);
    setLoginMfaMessage(null);
    setIsVerifyingLoginMfa(true);

    try {
      const response = await verifyLoginPasscode(loginChallengeId, passcode);
      if (response.totp_setup_suggested) {
        setPendingLoginUser(response.user);
        setLoginMfaMessage({ type: 'success', text: 'Verification complete' });
        setLoginStep('TOTP_SETUP');
        return;
      }
      setLoginMfaMessage({ type: 'success', text: 'Verification complete' });
    } catch (err: unknown) {
      setLoginMfaMessage({ type: 'error', text: formatLoginMfaError(err) });
    } finally {
      setIsVerifyingLoginMfa(false);
    }
  }

  async function handleLoginMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    await handleLoginMfaVerify();
  }

  function handleLoginMfaCodeChange(value: string) {
    const nextCode = sanitizePasscodeInput(value);
    setLoginMfaCode(nextCode);
    if (loginMfaMessage?.type === 'error') {
      setLoginMfaMessage(null);
    }

    if (nextCode.length === LOGIN_MFA_CODE_LENGTH && !isVerifyingLoginMfa) {
      window.setTimeout(() => {
        void handleLoginMfaVerify(nextCode);
      }, 0);
    }
  }

  function handleLoginMfaPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const pastedCode = sanitizePasscodeInput(event.clipboardData.getData('text'));
    if (!pastedCode) return;

    event.preventDefault();
    handleLoginMfaCodeChange(pastedCode);
  }

  async function handleResendLoginMfaCode() {
    if (!loginChallengeId || loginMfaResendCooldown > 0 || isResendingLoginMfa || loginMfaMethod !== 'email_passcode') return;

    setIsResendingLoginMfa(true);
    setLoginMfaMessage(null);

    try {
      const response = await api.resendLoginPasscode(loginChallengeId);
      setLoginMfaCode('');
      setLoginMfaMessage({ type: 'success', text: response.message || 'Code resent' });
      setLoginMfaResendCooldown(LOGIN_MFA_RESEND_COOLDOWN_SECONDS);
      loginMfaInputRef.current?.focus();
    } catch (err: unknown) {
      setLoginMfaMessage({ type: 'error', text: formatLoginMfaError(err) });
    } finally {
      setIsResendingLoginMfa(false);
    }
  }

  async function handleSwitchLoginMfaMethod(nextMethod: LoginMfaMethod) {
    if (!loginChallengeId || nextMethod === loginMfaMethod || isSwitchingLoginMfaMethod || isVerifyingLoginMfa) return;
    setIsSwitchingLoginMfaMethod(true);
    setLoginMfaMessage(null);
    try {
      const response = await api.switchLoginMfaMethod(loginChallengeId, nextMethod);
      setLoginMfaMethod(response.method);
      if (response.methods?.length) setLoginMfaMethods(response.methods);
      setLoginMfaCode('');
      setLoginMfaMessage({
        type: 'info',
        text: response.message || (response.method === 'totp'
          ? 'Enter the 6-digit code from your authenticator app'
          : 'Enter the verification code sent to your email'),
      });
      setLoginMfaResendCooldown(response.method === 'email_passcode' ? LOGIN_MFA_RESEND_COOLDOWN_SECONDS : 0);
      loginMfaInputRef.current?.focus();
    } catch (err: unknown) {
      setLoginMfaMessage({ type: 'error', text: formatLoginMfaError(err) });
    } finally {
      setIsSwitchingLoginMfaMethod(false);
    }
  }

  function finishLoginFromTotp(userData: AuthUser) {
    completePendingLogin(userData || pendingLoginUser as AuthUser);
  }

  function handleBackToCredentials() {
    resetLoginMfaState();
    setError('');
    setPassword('');
  }

  function resetForgotPasswordFlow() {
    setShowForgotPassword(false);
    setForgotPasswordStep('email');
    setForgotPasswordEmail('');
    setForgotPasswordPasscode('');
    setForgotPasswordResetToken('');
    setForgotPasswordNewPassword('');
    setForgotPasswordConfirmPassword('');
    setShowForgotPasswordNewPassword(false);
    setShowForgotPasswordConfirmPassword(false);
    setForgotPasswordMessage(null);
    setForgotPasswordLoading(false);
    setForgotPasswordCooldownSeconds(0);
    setIsValidatingForgotPassword(false);
    setForgotPasswordValidation(null);
    setForgotPasswordValidationError(null);
    validateForgotPasswordAbortRef.current?.abort();
    validateForgotPasswordAbortRef.current = null;
    forgotPasswordValidationRequestRef.current += 1;
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    if (forgotPasswordOnCooldown || forgotPasswordStep !== 'email') return;

    const resetEmail = forgotPasswordEmail.trim();
    if (!resetEmail) {
      setForgotPasswordMessage({ type: 'error', text: 'Enter your email address' });
      return;
    }

    setForgotPasswordMessage(null);
    setForgotPasswordLoading(true);

    try {
      const response = await api.forgotPassword(resetEmail);
      setForgotPasswordEmail(resetEmail);
      setForgotPasswordStep('success');
      setForgotPasswordMessage({
        type: 'success',
        text: response.message || 'If your email is registered, a temporary password has been sent.',
      });
      setForgotPasswordCooldownSeconds(0);
    } catch (err: any) {
      setForgotPasswordMessage({ type: 'error', text: err.message || 'Failed to process forgot password request. Please try again.' });
      logger.error('Forgot password error', err);
    } finally {
      setForgotPasswordLoading(false);
    }
  }

  async function handleVerifyForgotPasswordPasscode(e: React.FormEvent) {
    e.preventDefault();
    if (forgotPasswordStep !== 'passcode') return;

    const passcode = sanitizePasscodeInput(forgotPasswordPasscode);
    if (passcode.length !== LOGIN_MFA_CODE_LENGTH) {
      setForgotPasswordMessage({ type: 'error', text: 'Enter the 6-digit passcode' });
      return;
    }

    setForgotPasswordMessage(null);
    setForgotPasswordLoading(true);

    try {
      const response = await api.verifyForgotPasswordPasscode(forgotPasswordEmail.trim(), passcode);
      setForgotPasswordResetToken(response.reset_token);
      setForgotPasswordNewPassword('');
      setForgotPasswordConfirmPassword('');
      setForgotPasswordValidation(null);
      setForgotPasswordValidationError(null);
      setIsValidatingForgotPassword(false);
      forgotPasswordValidationRequestRef.current += 1;
      setForgotPasswordStep('password');
      setForgotPasswordMessage({ type: 'success', text: response.message || 'Passcode verified. Set your new password.' });
    } catch (err: any) {
      setForgotPasswordMessage({ type: 'error', text: err.message || 'Invalid or expired passcode. Please request a new code.' });
      logger.error('Forgot password passcode verification error', err);
    } finally {
      setForgotPasswordLoading(false);
    }
  }

  async function handleResendForgotPasswordPasscode() {
    if (forgotPasswordStep !== 'passcode' || forgotPasswordOnCooldown || forgotPasswordLoading) return;

    setForgotPasswordMessage(null);
    setForgotPasswordLoading(true);

    try {
      const response = await api.forgotPassword(forgotPasswordEmail.trim());
      setForgotPasswordPasscode('');
      setForgotPasswordCooldownSeconds(60);
      setForgotPasswordMessage({ type: 'success', text: response.message || 'A new passcode has been sent.' });
    } catch (err: any) {
      setForgotPasswordMessage({ type: 'error', text: err.message || 'Failed to resend passcode. Please try again.' });
      logger.error('Forgot password passcode resend error', err);
    } finally {
      setForgotPasswordLoading(false);
    }
  }

  function handleForgotPasswordNewPasswordChange(value: string) {
    setForgotPasswordNewPassword(value);
    setForgotPasswordMessage(null);
    setForgotPasswordValidation(null);
    setForgotPasswordValidationError(null);
    setIsValidatingForgotPassword(false);
    validateForgotPasswordAbortRef.current?.abort();
    validateForgotPasswordAbortRef.current = null;
    forgotPasswordValidationRequestRef.current += 1;
  }

  function handleForgotPasswordConfirmPasswordChange(value: string) {
    setForgotPasswordConfirmPassword(value);
    setForgotPasswordMessage(null);
  }

  async function handleResetForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    if (forgotPasswordStep !== 'password') return;

    const missingRules = getPasswordRuleStates(forgotPasswordNewPassword).filter((rule) => !rule.passed);
    if (missingRules.length > 0) {
      setForgotPasswordMessage({
        type: 'error',
        text: `Password needs ${formatPasswordRequirementList(missingRules.map((rule) => rule.shortLabel))}.`,
      });
      return;
    }

    if (forgotPasswordNewPassword !== forgotPasswordConfirmPassword) {
      setForgotPasswordMessage({ type: 'error', text: 'Passwords do not match' });
      return;
    }

    if (!forgotPasswordResetToken) {
      setForgotPasswordMessage({ type: 'error', text: 'Password reset session expired. Please request a new passcode.' });
      setForgotPasswordStep('email');
      return;
    }

    setForgotPasswordMessage(null);
    setForgotPasswordLoading(true);

    try {
      const response = await api.resetPassword(forgotPasswordEmail.trim(), forgotPasswordResetToken, forgotPasswordNewPassword);
      setForgotPasswordStep('success');
      setForgotPasswordMessage({ type: 'success', text: response.message || 'Password updated successfully. Sign in with your new password.' });
      setPassword('');
    } catch (err: any) {
      setForgotPasswordMessage({ type: 'error', text: err.message || 'Failed to update password. Please request a new passcode.' });
      logger.error('Reset password error', err);
    } finally {
      setForgotPasswordLoading(false);
    }
  }

  async function handleSelfRegister(e: React.FormEvent) {
    e.preventDefault();
    setRegisterMessage(null);
    if (registrationStep !== 'form') return;
    if (!isRegisterEmailValid) {
      setRegisterMessage({ type: 'error', text: 'Enter a valid email address' });
      return;
    }
    if (isCheckingRegisterEmail) {
      setRegisterMessage({ type: 'error', text: 'Please wait for email availability check to finish' });
      return;
    }
    if (registerEmailExists) {
      setRegisterMessage({ type: 'error', text: 'Email already registered' });
      return;
    }
    if (registerUsernameValue.length < REGISTER_USERNAME_MIN_LENGTH) {
      setRegisterMessage({ type: 'error', text: `Enter at least ${REGISTER_USERNAME_MIN_LENGTH} characters for username` });
      return;
    }
    if (registerUsernameValue.length > REGISTER_USERNAME_MAX_LENGTH) {
      setRegisterMessage({ type: 'error', text: `Enter no more than ${REGISTER_USERNAME_MAX_LENGTH} characters for username` });
      return;
    }
    if (isCheckingRegisterUsername || (!currentRegisterUsernameValidation && !currentRegisterUsernameValidationError)) {
      setRegisterMessage({ type: 'error', text: 'Please wait for username availability check to finish' });
      return;
    }
    if (currentRegisterUsernameValidationError) {
      setRegisterMessage({ type: 'error', text: currentRegisterUsernameValidationError });
      return;
    }
    if (currentRegisterUsernameValidation?.valid === false) {
      setRegisterMessage({ type: 'error', text: formatUsernameValidationMessage(currentRegisterUsernameValidation) });
      return;
    }
    if (currentRegisterUsernameValidation && currentRegisterUsernameValidation.available !== true) {
      setRegisterMessage({
        type: 'error',
        text: formatUsernameValidationMessage(currentRegisterUsernameValidation),
      });
      return;
    }
    if (!doesRegisterPasswordMeetLocalRules) {
      setRegisterMessage({ type: 'error', text: 'Password must meet all listed requirements' });
      return;
    }
    if (isValidatingRegisterPassword || (!currentRegisterPasswordValidation && !currentRegisterPasswordValidationError)) {
      setRegisterMessage({ type: 'error', text: 'Please wait for password validation to finish' });
      return;
    }
    if (currentRegisterPasswordValidation?.valid === false) {
      setRegisterMessage({
        type: 'error',
        text:
          currentRegisterPasswordValidation.message ||
          currentRegisterPasswordValidation.errors[0] ||
          'Password does not meet policy',
      });
      return;
    }

    setIsSubmittingRegistration(true);
    const form = e.currentTarget as HTMLFormElement;
    const honeypot = (form.elements.namedItem('website') as HTMLInputElement | null)?.value ?? '';
    const turnstileToken =
      TURNSTILE_SITE_KEY && turnstileWidgetIdRef.current && window.turnstile
        ? window.turnstile.getResponse(turnstileWidgetIdRef.current)
        : undefined;

    try {
      await api.selfRegister({
        user_name: registerForm.user_name.trim(),
        email: registerForm.email.trim(),
        password: registerForm.password,
        organization: registerForm.organization.trim(),
        organization_type: registerForm.organization_type,
        interested_domain_id: registerForm.interested_domain_id,
        website: honeypot,
        form_opened_at: registerFormOpenedAt ?? undefined,
        turnstile_token: turnstileToken || undefined,
      });
      setRegistrationStep('verify');
      setShowPasscodeOverlay(true);
      setOtpDigits(['', '', '', '', '', '']);
      setResendTimer(30);
      setIsResendingPasscode(false);
      if (turnstileWidgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.reset(turnstileWidgetIdRef.current);
        } catch {
          // ignore widget reset errors
        }
      }
    } catch (err: any) {
      setRegisterMessage({ type: 'error', text: err.message || 'Registration failed' });
      logger.error('Self-register error', err);
      if (turnstileWidgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.reset(turnstileWidgetIdRef.current);
        } catch {
          // ignore widget reset errors
        }
      }
    } finally {
      setIsSubmittingRegistration(false);
    }
  }

  const handleOtpChange = (index: number, value: string) => {
    const newOtpDigits = [...otpDigits];
    newOtpDigits[index] = value.replace(/\D/g, '').slice(0, 1);
    setOtpDigits(newOtpDigits);

    if (value && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }

    if (newOtpDigits.join('').length === 6) {
      handleVerifyPasscode();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    } else if (e.key === 'Enter') {
      const otp = otpDigits.join('');
      if (otp.length === 6) handleVerifyPasscode();
    }
  };

  async function handleVerifyPasscode() {
    const emailToVerify = registerForm.email.trim();
    const otp = otpDigits.join('');
    if (!emailToVerify || otp.length !== 6) return;

    setRegisterMessage(null);
    setIsVerifyingPasscode(true);
    try {
      const response = await fetch(`${AUTH_API_BASE_URL}/auth/verify-email-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToVerify, otp }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = (body as { detail?: string })?.detail || response.statusText || 'Invalid passcode';
        throw new Error(message);
      }

      setRegistrationStep('success');
    } catch (err: any) {
      setRegisterMessage({ type: 'error', text: err?.message || 'Invalid passcode' });
      logger.error('Verify passcode error', err);
    } finally {
      setIsVerifyingPasscode(false);
    }
  }

  async function handleResendPasscode() {
    if (isResendingPasscode || resendTimer > 0 || registrationStep !== 'verify') return;
    const emailToResend = registerForm.email.trim();
    if (!emailToResend) return;

    setIsResendingPasscode(true);
    setRegisterMessage(null);
    try {
      await api.resendPasscode(emailToResend);
      setResendTimer(30);
      setOtpDigits(['', '', '', '', '', '']);
      otpInputRefs.current[0]?.focus();
      setRegisterMessage({ type: 'success', text: 'New passcode sent to your email.' });
    } catch (err: any) {
      setRegisterMessage({ type: 'error', text: err.message || 'Failed to resend passcode' });
      logger.error('Resend passcode error', err);
    } finally {
      setIsResendingPasscode(false);
    }
  }

  function returnToRegistrationForm() {
    if (registrationStep !== 'verify' || isVerifyingPasscode || isResendingPasscode) return;
    setShowPasscodeOverlay(false);
    setRegistrationStep('form');
    setRegisterMessage(null);
    setOtpDigits(['', '', '', '', '', '']);
    setResendTimer(30);
  }

  async function handleSubmitIdea(e: React.FormEvent) {
    e.preventDefault();
    setIdeaMessage(null);
    if (!ideaForm.domain_id || !ideaForm.idea_text.trim() || !ideaForm.submitted_by_email.trim()) {
      setIdeaMessage({ type: 'error', text: 'Please select a domain, describe your idea, and enter your email.' });
      return;
    }
    setIdeaLoading(true);
    try {
      await api.submitAnonymousIdea({
        domain_id: ideaForm.domain_id,
        idea_text: ideaForm.idea_text.trim(),
        submitted_by_email: ideaForm.submitted_by_email.trim(),
        submitted_by_organization: ideaForm.submitted_by_organization.trim() || undefined,
      });
      setIdeaMessage({ type: 'success', text: 'Thank you. Your idea has been submitted.' });
      setIdeaForm({ domain_id: '', idea_text: '', submitted_by_email: '', submitted_by_organization: '' });
    } catch (err: any) {
      setIdeaMessage({ type: 'error', text: err.message || 'Submission failed' });
      logger.error('Submit idea error', err);
    } finally {
      setIdeaLoading(false);
    }
  }

  function handleIdeaFieldChange(field: 'domain_id' | 'idea_text' | 'submitted_by_email' | 'submitted_by_organization', value: string) {
    setIdeaForm((current) => ({ ...current, [field]: value }));
    if (ideaMessage) setIdeaMessage(null);
  }

  function openLoginView() {
    setAuthView('login');
    setShowPasscodeOverlay(false);
    resetLoginMfaState();
    setRegisterMessage(null);
    setError('');
  }

  function openRegisterView() {
    setAuthView('register');
    setShowPasscodeOverlay(false);
    resetLoginMfaState();
    setRegisterMessage(null);
    setError('');
    setRegisterFormOpenedAt(Date.now());
  }

  function handleSelectView(view: AuthView) {
    if (loginStep === 'MFA' || loginStep === 'TOTP_SETUP') {
      loginMfaInputRef.current?.focus();
      return;
    }

    if (view === authView) {
      return;
    }

    if (view === 'login') {
      openLoginView();
      return;
    }
    openRegisterView();
  }

  const activeView = authView;
  const totalDomains = appSummary?.domains_count ?? 0;
  // Public summary currently exposes use_cases_count as the metric used for qualified use case display.
  const qualifiedUseCases = appSummary?.use_cases_count ?? 0;
  const totalDemoUseCases = appSummary?.demo_use_cases_count ?? 0;
  const statusCounts = appSummary?.status_counts ?? {};

  const portfolioSlides: StatCarouselSlide[] = [
    {
      key: 'domains',
      label: 'Domains Registered',
      value: totalDomains,
      helper: 'Governed AI domains currently registered in the public portfolio snapshot.',
      icon: Layers3,
    },
    {
      key: 'qualified-use-cases',
      label: 'Qualified Use Cases',
      value: qualifiedUseCases,
      helper: 'Use cases that currently make up the published workbench portfolio signal.',
      icon: Cpu,
    },
    {
      key: 'demo-videos',
      label: 'POC / Demo Videos',
      value: totalDemoUseCases,
      helper: 'Demo-ready work that helps teams review execution maturity and value.',
      icon: MonitorPlay,
    },
  ];

  const workflowSlides: StatCarouselSlide[] = [
    {
      key: 'approved',
      label: 'Approved Use Cases',
      value: statusCounts.Approved ?? 0,
      helper: 'Items that have passed review and are ready for the next governed step.',
      icon: ShieldCheck,
    },
    {
      key: 'new',
      label: 'New Use Cases',
      value: statusCounts.New ?? 0,
      helper: 'Fresh signals entering the workbench for triage and qualification.',
      icon: Lightbulb,
    },
    {
      key: 'analysis',
      label: 'Analysis Queue',
      value: statusCounts.Analysis ?? 0,
      helper: 'Use cases currently under assessment for readiness, value, and controls.',
      icon: Sparkles,
    },
  ];

  const isRegisterFormLocked = isSubmittingRegistration || registrationStep !== 'form' || isVerifyingPasscode;
  const registerUsernameValue = registerForm.user_name.trim();
  const isRegisterUsernameTooShort = registerUsernameValue.length > 0 && registerUsernameValue.length < REGISTER_USERNAME_MIN_LENGTH;
  const isRegisterUsernameTooLong = registerUsernameValue.length > REGISTER_USERNAME_MAX_LENGTH;
  const currentRegisterUsernameValidation =
    registerUsernameValidation?.username === registerUsernameValue ? registerUsernameValidation.result : null;
  const currentRegisterUsernameValidationError =
    registerUsernameValidationError?.username === registerUsernameValue ? registerUsernameValidationError.message : null;
  const registerPasswordRuleStates = getPasswordRuleStates(registerForm.password);
  const registerPasswordMissingRules = registerPasswordRuleStates.filter((rule) => !rule.passed);
  const doesRegisterPasswordMeetLocalRules =
    registerForm.password.length > 0 && registerPasswordMissingRules.length === 0;
  const currentRegisterPasswordValidation =
    registerPasswordValidation?.password === registerForm.password ? registerPasswordValidation.result : null;
  const currentRegisterPasswordValidationError =
    registerPasswordValidationError?.password === registerForm.password ? registerPasswordValidationError.message : null;
  const hasRegisterPasswordBackendCheckFailure = currentRegisterPasswordValidation
    ? Object.values(currentRegisterPasswordValidation.checks).some((check) => check === false)
    : false;
  const isRegisterPasswordFullyValid = Boolean(
    registerForm.password &&
      doesRegisterPasswordMeetLocalRules &&
      currentRegisterPasswordValidation?.valid === true &&
      !hasRegisterPasswordBackendCheckFailure
  );
  const isRegisterPasswordTickVisible = isRegisterPasswordFullyValid;
  const registerPasswordMissingText =
    registerPasswordMissingRules.length > 0
      ? `Add ${formatPasswordRequirementList(registerPasswordMissingRules.map((rule) => rule.label))}`
      : null;

  const registerEmailInlineMessage = registerEmailExists
    ? { tone: 'text-rose-600 dark:text-rose-300', text: 'Email already registered' }
    : isCheckingRegisterEmail
      ? { tone: 'text-cyan-700 dark:text-cyan-200', text: 'Checking email availability...' }
      : isRegisterEmailValid && registerForm.email.trim()
        ? { tone: 'text-emerald-700 dark:text-emerald-200', text: 'Email looks available for registration' }
        : null;

  const registerUsernameInlineMessage = !registerUsernameValue
    ? null
    : isCheckingRegisterUsername
      ? { tone: 'text-cyan-700 dark:text-cyan-200', text: 'Checking username availability...' }
      : isRegisterUsernameTooShort
      ? { tone: 'text-rose-600 dark:text-rose-300', text: `Enter at least ${REGISTER_USERNAME_MIN_LENGTH} characters` }
      : isRegisterUsernameTooLong
        ? { tone: 'text-rose-600 dark:text-rose-300', text: `Enter no more than ${REGISTER_USERNAME_MAX_LENGTH} characters` }
        : currentRegisterUsernameValidation &&
            (currentRegisterUsernameValidation.valid === false || currentRegisterUsernameValidation.available === false)
          ? { tone: 'text-rose-600 dark:text-rose-300', text: formatUsernameValidationMessage(currentRegisterUsernameValidation) }
          : currentRegisterUsernameValidation?.available === true
            ? { tone: 'text-emerald-700 dark:text-emerald-200', text: currentRegisterUsernameValidation.message || 'Username looks available for registration' }
          : currentRegisterUsernameValidationError
            ? { tone: 'text-rose-600 dark:text-rose-300', text: currentRegisterUsernameValidationError }
            : null;

  const registerPasswordInlineMessage = !registerForm.password
    ? null
    : isRegisterPasswordFullyValid
      ? null
      : registerPasswordMissingText
        ? { tone: 'text-rose-600 dark:text-rose-300', text: registerPasswordMissingText }
        : isValidatingRegisterPassword
          ? { tone: 'text-cyan-700 dark:text-cyan-200', text: 'Checking password policy...' }
          : currentRegisterPasswordValidation?.valid === false
        ? {
            tone: 'text-rose-600 dark:text-rose-300',
            text:
              currentRegisterPasswordValidation.message ||
              currentRegisterPasswordValidation.errors[0] ||
              'Password does not meet policy',
          }
          : currentRegisterPasswordValidationError
            ? { tone: 'text-rose-600 dark:text-rose-300', text: currentRegisterPasswordValidationError }
            : null;

  const hasRequiredRegistrationFields = Boolean(
    registerUsernameValue &&
      registerForm.email.trim() &&
      registerForm.password &&
      registerForm.organization.trim() &&
      registerForm.organization_type &&
      registerForm.interested_domain_id
  );
  const isRegisterUsernameSubmitReady =
    registerUsernameValue.length >= REGISTER_USERNAME_MIN_LENGTH &&
    registerUsernameValue.length <= REGISTER_USERNAME_MAX_LENGTH &&
    !isCheckingRegisterUsername &&
    currentRegisterUsernameValidation?.valid !== false &&
    currentRegisterUsernameValidation?.available === true;
  const isRegisterPasswordSubmitReady =
    doesRegisterPasswordMeetLocalRules &&
    !isValidatingRegisterPassword &&
    (currentRegisterPasswordValidation ? isRegisterPasswordFullyValid : Boolean(currentRegisterPasswordValidationError));
  const canSubmitRegistration =
    !isRegisterFormLocked &&
    hasRequiredRegistrationFields &&
    isRegisterEmailValid &&
    !isCheckingRegisterEmail &&
    !registerEmailExists &&
    isRegisterUsernameSubmitReady &&
    isRegisterPasswordSubmitReady;
  const turnstileNode =
    TURNSTILE_SITE_KEY && registrationStep === 'form'
      ? <div ref={turnstileContainerRef} className="flex min-h-[65px] items-center justify-center" />
      : null;

  const inlineActionClass =
    'inline-flex items-center gap-1.5 rounded-full border border-slate-300/80 bg-white px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/12 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white dark:focus-visible:ring-cyan-300/12';
  const subtleLinkClass =
    'inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-600 transition hover:text-slate-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/12 dark:text-slate-300 dark:hover:text-white dark:focus-visible:ring-cyan-300/12';
  const authMessageSlotClass = 'min-h-0';
  const maskedLoginEmail = maskEmailAddress(email);
  const canSubmitLoginMfa =
    Boolean(loginChallengeId) &&
    loginMfaCode.length === LOGIN_MFA_CODE_LENGTH &&
    !isVerifyingLoginMfa;
  const loginMfaResendLabel = isResendingLoginMfa
    ? 'Resending...'
    : loginMfaResendCooldown > 0
      ? `Resend in ${loginMfaResendCooldown}s`
      : 'Resend code';
  const forgotPasswordRuleStates = getPasswordRuleStates(forgotPasswordNewPassword);
  const forgotPasswordMissingRules = forgotPasswordRuleStates.filter((rule) => !rule.passed);
  const doesForgotPasswordMeetLocalRules =
    forgotPasswordNewPassword.length > 0 && forgotPasswordMissingRules.length === 0;
  const currentForgotPasswordValidation =
    forgotPasswordValidation?.password === forgotPasswordNewPassword ? forgotPasswordValidation.result : null;
  const currentForgotPasswordValidationError =
    forgotPasswordValidationError?.password === forgotPasswordNewPassword ? forgotPasswordValidationError.message : null;
  const hasForgotPasswordBackendCheckFailure = currentForgotPasswordValidation
    ? Object.values(currentForgotPasswordValidation.checks).some((check) => check === false)
    : false;
  const isForgotPasswordNewPasswordValid = Boolean(
    forgotPasswordNewPassword &&
      doesForgotPasswordMeetLocalRules &&
      currentForgotPasswordValidation?.valid === true &&
      !hasForgotPasswordBackendCheckFailure
  );
  const forgotPasswordMissingText =
    forgotPasswordMissingRules.length > 0
      ? `Add ${formatPasswordRequirementList(forgotPasswordMissingRules.map((rule) => rule.label))}`
      : null;
  const forgotPasswordInlineMessage = !forgotPasswordNewPassword
    ? null
    : isForgotPasswordNewPasswordValid
      ? null
      : forgotPasswordMissingText
        ? { tone: 'text-rose-600 dark:text-rose-300', text: forgotPasswordMissingText }
        : isValidatingForgotPassword
          ? { tone: 'text-cyan-700 dark:text-cyan-200', text: 'Checking password policy...' }
          : currentForgotPasswordValidation?.valid === false
            ? {
                tone: 'text-rose-600 dark:text-rose-300',
                text:
                  currentForgotPasswordValidation.message ||
                  currentForgotPasswordValidation.errors[0] ||
                  'Password does not meet policy',
              }
            : currentForgotPasswordValidationError
              ? { tone: 'text-rose-600 dark:text-rose-300', text: currentForgotPasswordValidationError }
              : null;
  const isForgotPasswordSubmitReady =
    doesForgotPasswordMeetLocalRules &&
    !isValidatingForgotPassword &&
    (currentForgotPasswordValidation ? isForgotPasswordNewPasswordValid : Boolean(currentForgotPasswordValidationError));
  const forgotPasswordPasswordsMatch =
    forgotPasswordConfirmPassword.length > 0 && forgotPasswordNewPassword === forgotPasswordConfirmPassword;
  const canSubmitForgotPassword =
    forgotPasswordStep === 'email'
      ? !forgotPasswordOnCooldown && Boolean(forgotPasswordEmail.trim())
      : forgotPasswordStep === 'passcode'
        ? forgotPasswordPasscode.length === LOGIN_MFA_CODE_LENGTH
        : forgotPasswordStep === 'password'
          ? isForgotPasswordSubmitReady &&
            forgotPasswordPasswordsMatch &&
            Boolean(forgotPasswordResetToken)
          : false;
  const forgotPasswordTitle =
    forgotPasswordStep === 'email'
      ? 'Forgot Password'
      : forgotPasswordStep === 'passcode'
        ? 'Enter passcode'
        : forgotPasswordStep === 'password'
          ? 'Set new password'
          : 'Temporary password sent';

  return (
    <ViewportAuthShell
      authPanel={
        <AuthPanel activeView={activeView} onSelectView={handleSelectView}>
          {activeView === 'login' ? (
            <div className="login-form flex flex-col gap-2">
              {loginStep === 'CREDENTIALS' ? (
                <form onSubmit={handleSubmit} className="flex flex-col gap-2">
                  <div className="space-y-2">
                    <div>
                      <label className="mb-0.5 block text-[11.5px] font-medium text-slate-700 dark:text-slate-200">Email</label>
                      <ThemeSafeInput type="email" icon={Mail} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your work email" autoComplete="email" required />
                    </div>

                    <div>
                      <label className="mb-0.5 block text-[11.5px] font-medium text-slate-700 dark:text-slate-200">Password</label>
                      <ThemeSafeInput
                        type={showLoginPassword ? 'text' : 'password'}
                        icon={Lock}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        maxLength={72}
                        placeholder="Enter your password"
                        autoComplete="current-password"
                        required
                        endAdornment={
                          <button
                            type="button"
                            onClick={() => setShowLoginPassword((value) => !value)}
                            className="rounded-full p-1 text-slate-400 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/15 dark:text-slate-500 dark:hover:text-white dark:focus-visible:ring-cyan-300/15"
                            aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                          >
                            {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        }
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setForgotPasswordStep('email');
                        setForgotPasswordEmail(email.trim());
                        setForgotPasswordPasscode('');
                        setForgotPasswordResetToken('');
                        setForgotPasswordNewPassword('');
                        setForgotPasswordConfirmPassword('');
                        setForgotPasswordMessage(null);
                        setShowForgotPassword(true);
                      }}
                      className="text-[11.5px] font-medium text-cyan-700 transition hover:text-cyan-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/12 dark:text-cyan-200 dark:hover:text-white dark:focus-visible:ring-cyan-300/12"
                    >
                      Forgot Password?
                    </button>
                    <div className="rounded-full border border-slate-300/80 bg-white px-2.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300">
                      Cookies enabled
                    </div>
                  </div>

                  <div className={authMessageSlotClass} aria-live="polite">
                    {error ? <MessageBanner tone="error">{error}</MessageBanner> : null}
                  </div>

                  <div className="pt-0.5">
                    <button type="submit" disabled={loading} className={PRIMARY_BUTTON_CLASS}>
                      <Lock className="h-4 w-4" />
                      {loading ? 'Signing in...' : 'Sign In'}
                    </button>
                  </div>
                </form>
              ) : loginStep === 'TOTP_SETUP' ? (
                <div className="flex flex-col gap-2.5">
                  <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/[0.06] px-3 py-2.5 text-[12.5px] text-cyan-900 dark:border-cyan-200/14 dark:bg-cyan-300/[0.06] dark:text-cyan-50">
                    <p className="font-semibold">One more step before you continue</p>
                    <p className="mt-1 text-[12px] font-medium leading-5 text-cyan-950 dark:text-white">
                      Email verification succeeded. Set up an authenticator for faster sign-in on unknown networks.
                    </p>
                  </div>
                  <TotpEnrollmentCard
                    showSkip
                    onFinished={finishLoginFromTotp}
                    onSkip={finishLoginFromTotp}
                  />
                </div>
              ) : (
                <form onSubmit={handleLoginMfaSubmit} className="flex flex-col gap-2.5">
                  <button type="button" onClick={handleBackToCredentials} className={subtleLinkClass}>
                    <ArrowLeft className="h-4 w-4" />
                    Back to sign in
                  </button>

                  {loginMfaMethods.length > 1 ? (
                    <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(246,249,253,0.96)_100%)] p-[2.5px] dark:border-white/12 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(20,33,72,0.28)_100%)]">
                      {([
                        { id: 'totp' as const, label: 'Authenticator', icon: Smartphone },
                        { id: 'email_passcode' as const, label: 'Email code', icon: Mail },
                      ]).map((item) => {
                        const isActive = loginMfaMethod === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => void handleSwitchLoginMfaMethod(item.id)}
                            disabled={isSwitchingLoginMfaMethod || isVerifyingLoginMfa}
                            className={cn(
                              'inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-[9px] px-1.5 text-[11px] font-medium transition duration-200 sm:text-[12px]',
                              isActive
                                ? 'bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 text-white shadow-[0_8px_18px_rgba(14,165,233,0.22)]'
                                : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white',
                            )}
                          >
                            <item.icon className="h-3.5 w-3.5" />
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/[0.06] px-3 py-2.5 text-[12.5px] text-cyan-900 dark:border-cyan-200/14 dark:bg-cyan-300/[0.06] dark:text-cyan-50">
                    {loginMfaMethod === 'totp' ? (
                      <>
                        <p className="font-semibold">Authenticator verification</p>
                        <p className="mt-1 text-[12px] font-medium leading-5 text-cyan-950 dark:text-white">
                          Open your authenticator app and enter the current 6-digit code.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-semibold">Email verification required</p>
                        <p className="mt-1 text-[12px] font-medium leading-5 text-cyan-950 dark:text-white">
                          Code sent to <span className="font-semibold text-cyan-950 dark:text-cyan-50">{maskedLoginEmail}</span>
                        </p>
                      </>
                    )}
                  </div>

                  <div>
                    <label className="mb-0.5 block text-[11.5px] font-medium text-slate-700 dark:text-slate-200">Verification code</label>
                    <ThemeSafeInput
                      ref={loginMfaInputRef}
                      type="text"
                      icon={loginMfaMethod === 'totp' ? Smartphone : Lock}
                      value={loginMfaCode}
                      onChange={(event) => handleLoginMfaCodeChange(event.target.value)}
                      onPaste={handleLoginMfaPaste}
                      placeholder="Enter 6-digit code"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={LOGIN_MFA_CODE_LENGTH}
                      autoComplete="one-time-code"
                      disabled={isVerifyingLoginMfa || isSwitchingLoginMfaMethod}
                      required
                    />
                  </div>

                  <div className={authMessageSlotClass} aria-live="polite">
                    {loginMfaMessage ? <MessageBanner tone={loginMfaMessage.type}>{loginMfaMessage.text}</MessageBanner> : null}
                  </div>

                  <button type="submit" disabled={!canSubmitLoginMfa || isSwitchingLoginMfaMethod} className={PRIMARY_BUTTON_CLASS}>
                    <Lock className="h-4 w-4" />
                    {isVerifyingLoginMfa ? 'Verifying...' : 'Verify code'}
                  </button>

                  {loginMfaMethod === 'email_passcode' ? (
                    <button
                      type="button"
                      onClick={handleResendLoginMfaCode}
                      disabled={isResendingLoginMfa || loginMfaResendCooldown > 0}
                      className={SECONDARY_BUTTON_CLASS}
                    >
                      <RotateCcw className="h-4 w-4" />
                      {loginMfaResendLabel}
                    </button>
                  ) : loginMfaMethods.includes('email_passcode') ? (
                    <button
                      type="button"
                      onClick={() => void handleSwitchLoginMfaMethod('email_passcode')}
                      disabled={isSwitchingLoginMfaMethod}
                      className={SECONDARY_BUTTON_CLASS}
                    >
                      <Mail className="h-4 w-4" />
                      {isSwitchingLoginMfaMethod ? 'Switching...' : 'Use email code instead'}
                    </button>
                  ) : null}
                </form>
              )}
            </div>
          ) : activeView === 'register' ? (
            <div className="register-form flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2.5">
                <button type="button" onClick={openLoginView} className={subtleLinkClass}>
                  <ArrowLeft className="h-4 w-4" />
                  Back to sign in
                </button>
                <button type="button" onClick={resetRegisterForm} aria-label="Reset registration form" className={inlineActionClass}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </button>
              </div>

              <form onSubmit={handleSelfRegister} className="flex flex-col gap-1.5">
                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  className="pointer-events-none absolute -left-[9999px] h-0 w-0 opacity-0"
                  aria-hidden
                />

                <div className="grid gap-[0.4375rem] sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <ThemeSafeInput
                      type="text"
                      icon={User}
                      placeholder="Full name *"
                      value={registerForm.user_name}
                      onChange={(e) => handleRegisterUsernameChange(e.target.value)}
                      minLength={REGISTER_USERNAME_MIN_LENGTH}
                      maxLength={REGISTER_USERNAME_MAX_LENGTH}
                      disabled={isRegisterFormLocked}
                      required
                    />
                    <div className="mt-1 h-4 overflow-hidden" aria-live="polite">
                      {registerUsernameInlineMessage ? <p className={cn('truncate text-xs font-medium leading-4', registerUsernameInlineMessage.tone)}>{registerUsernameInlineMessage.text}</p> : null}
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <ThemeSafeInput type="email" icon={Mail} placeholder="Email *" value={registerForm.email} onChange={(e) => setRegisterForm((form) => ({ ...form, email: e.target.value }))} autoComplete="email" readOnly={isRegisterFormLocked} required />
                    <div className="mt-1 min-h-[0.875rem]" aria-live="polite">
                      {registerEmailInlineMessage ? <p className={cn('text-xs font-medium', registerEmailInlineMessage.tone)}>{registerEmailInlineMessage.text}</p> : null}
                    </div>
                  </div>

                  <ThemeSafeInput type="text" icon={Building} placeholder="Organization *" value={registerForm.organization} onChange={(e) => setRegisterForm((form) => ({ ...form, organization: e.target.value }))} maxLength={100} disabled={isRegisterFormLocked} required wrapperClassName="sm:col-span-2" />

                  <SelectMenu
                    value={registerForm.organization_type}
                    onChange={(organization_type) => setRegisterForm((form) => ({ ...form, organization_type }))}
                    required
                    variant="auth"
                    disabled={isRegisterFormLocked}
                    placeholder="Organization type *"
                    leadingIcon={<Building className="h-4 w-4" />}
                    options={orgTypes.map((type) => ({ value: type.name, label: type.name }))}
                    aria-label="Organization type"
                  />

                  <SelectMenu
                    value={registerForm.interested_domain_id}
                    onChange={(interested_domain_id) => setRegisterForm((form) => ({ ...form, interested_domain_id }))}
                    required
                    variant="auth"
                    disabled={isRegisterFormLocked}
                    placeholder="Interested domain *"
                    leadingIcon={<Folder className="h-4 w-4" />}
                    options={registerDomains.map((domain) => ({
                      value: domain.domain_id,
                      label: domain.domain_name,
                    }))}
                    aria-label="Interested domain"
                  />

                  <div className="relative sm:col-span-2">
                    <ThemeSafeInput
                      type={showRegisterPassword ? 'text' : 'password'}
                      icon={Lock}
                      placeholder="Password *"
                      value={registerForm.password}
                      onChange={(e) => handleRegisterPasswordChange(e.target.value)}
                      minLength={8}
                      maxLength={72}
                      autoComplete="new-password"
                      disabled={isRegisterFormLocked}
                      required
                      className="!pr-[5.25rem]"
                      endAdornment={
                        <div className="flex items-center gap-1.5">
                          {isRegisterPasswordTickVisible ? (
                            <span
                              className="inline-flex h-6 w-6 items-center justify-center rounded-full"
                              aria-label="Password requirements met"
                            >
                              <Check className={cn('h-4 w-4', PASSWORD_VALID_TICK_CLASS)} aria-hidden />
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setShowRegisterPassword((value) => !value)}
                            className="rounded-full p-1 text-slate-400 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/15 dark:text-slate-500 dark:hover:text-white dark:focus-visible:ring-cyan-300/15"
                            aria-label={showRegisterPassword ? 'Hide password' : 'Show password'}
                            disabled={isRegisterFormLocked}
                          >
                            {showRegisterPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      }
                    />
                    {registerPasswordInlineMessage ? (
                      <div className="mt-1 px-1" aria-live="polite">
                        <p className={cn('text-xs font-medium', registerPasswordInlineMessage.tone)}>
                          {registerPasswordInlineMessage.text}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>

                {turnstileNode ? <div className="rounded-[11px] border border-dashed border-slate-300/80 bg-slate-900/[0.03] p-[0.3125rem] dark:border-white/10 dark:bg-white/[0.03]">{turnstileNode}</div> : null}

                <div className="space-y-1.5 pt-0.5">
                  <div className={authMessageSlotClass} aria-live="polite">
                    {registerMessage ? <MessageBanner tone={registerMessage.type}>{registerMessage.text}</MessageBanner> : null}
                  </div>

                  {registrationStep === 'form' ? (
                    <button type="submit" disabled={!canSubmitRegistration} className={PRIMARY_BUTTON_CLASS}>
                      <Lock className="h-4 w-4" />
                      {isSubmittingRegistration ? 'Submitting...' : 'Submit registration'}
                    </button>
                  ) : null}

                  <button type="button" disabled className={SECONDARY_BUTTON_CLASS} title="Coming soon">
                    Register with Google (coming soon)
                  </button>
                </div>
              </form>
            </div>
          ) : null}
        </AuthPanel>
      }
            rightPanel={
        <RightPanelContent
          mode={rightPanelMode}
          onChangeMode={setRightPanelMode}
          portfolioSlides={portfolioSlides}
          workflowSlides={workflowSlides}
          ideaForm={ideaForm}
          ideaDomains={ideaDomains}
          ideaMessage={ideaMessage}
          ideaLoading={ideaLoading}
          onIdeaFieldChange={handleIdeaFieldChange}
          onSubmitIdea={handleSubmitIdea}
        />
      }
    >
      {showPasscodeOverlay ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-md dark:bg-[#020817]/70">
          <ModalCard className="max-w-lg">
            {registrationStep === 'verify' ? (
              <>
                <div className="relative mb-5 text-center">
                  <button
                    type="button"
                    onClick={returnToRegistrationForm}
                    disabled={isVerifyingPasscode || isResendingPasscode}
                    className="absolute right-0 top-0 rounded-full p-2 text-slate-400 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/12 disabled:cursor-not-allowed disabled:opacity-45 dark:text-slate-500 dark:hover:text-white dark:focus-visible:ring-cyan-300/12"
                    aria-label="Close passcode verification and return to registration"
                  >
                    <X className="h-5 w-5" />
                  </button>
                  <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:border-cyan-300/20 dark:bg-cyan-400/10 dark:text-cyan-200">
                    <Lock className="h-4 w-4" />
                    Verify passcode
                  </div>
                  <h3 className="mt-3 text-[1.4rem] font-semibold text-slate-950 dark:text-white">Confirm your email to complete registration</h3>
                  <p className="mt-2 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
                    Enter the 6-digit passcode sent to <span className="font-medium text-slate-950 dark:text-white">{registerForm.email.trim() || 'your email'}</span>.
                  </p>
                </div>

                <div className="mb-5 grid grid-cols-6 gap-2 sm:gap-2.5">
                  {otpDigits.map((digit, index) => (
                    <input key={index} ref={(element) => { otpInputRefs.current[index] = element; }} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={1} value={digit} onChange={(e) => handleOtpChange(index, e.target.value)} onKeyDown={(e) => handleOtpKeyDown(index, e)} className={cn(AUTH_INPUT_BASE_CLASS, 'h-12 px-0 text-center font-mono text-base tracking-[0.18em]')} />
                  ))}
                </div>

                <div className="mb-3 min-h-[2.75rem]" aria-live="polite">
                  {registerMessage ? <MessageBanner tone={registerMessage.type}>{registerMessage.text}</MessageBanner> : null}
                </div>

                <button type="button" onClick={handleVerifyPasscode} disabled={otpDigits.join('').length !== 6 || isVerifyingPasscode} className={PRIMARY_BUTTON_CLASS}>
                  <Lock className="h-4 w-4" />
                  {isVerifyingPasscode ? 'Verifying...' : 'Verify Passcode'}
                </button>

                <button type="button" onClick={handleResendPasscode} disabled={isResendingPasscode || resendTimer > 0} className={cn(SECONDARY_BUTTON_CLASS, 'mt-2.5')}>
                  <RotateCcw className="h-4 w-4" />
                  {isResendingPasscode ? 'Resending...' : resendTimer > 0 ? `Resend Passcode (${resendTimer}s)` : 'Resend Passcode'}
                </button>

                <button
                  type="button"
                  onClick={returnToRegistrationForm}
                  disabled={isVerifyingPasscode || isResendingPasscode}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[11px] px-3.5 py-2 text-[12.5px] font-medium text-slate-600 transition hover:text-slate-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/12 disabled:cursor-not-allowed disabled:opacity-45 dark:text-slate-300 dark:hover:text-white dark:focus-visible:ring-cyan-300/12"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to registration
                </button>
              </>
            ) : registrationStep === 'success' ? (
              <div className="py-6 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-400/10 dark:text-emerald-200">
                  <ShieldCheck className="h-8 w-8" />
                </div>
                <h3 className="mt-4 text-[1.65rem] font-semibold text-slate-950 dark:text-white">Registration submitted successfully</h3>
                <p className="mt-2.5 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
                  Your account is created and waiting for administrator approval. You can return to sign in once approval is completed.
                </p>    
                <button type="button" onClick={() => { setShowPasscodeOverlay(false); resetRegisterForm(); openLoginView(); }} className={cn(PRIMARY_BUTTON_CLASS, 'mt-6')}>
                  Done
                </button>
              </div>
            ) : null}
          </ModalCard>
        </div>
      ) : null}

      {showForgotPassword ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/35 backdrop-blur-md dark:bg-[#020817]/70">
          <div className="flex min-h-screen items-center justify-center px-4 py-8">
            <ModalCard className="max-w-lg">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-[1.45rem] font-semibold text-slate-950 dark:text-white">{forgotPasswordTitle}</h2>
                  <p className="mt-1 text-[12.5px] leading-5 text-slate-600 dark:text-slate-300">
                    {forgotPasswordStep === 'email'
                      ? 'Enter your registered email address. We will send a temporary password to your email.'
                      : forgotPasswordStep === 'passcode'
                        ? `Enter the 6-digit passcode sent to ${forgotPasswordEmail.trim() || 'your email'}.`
                        : forgotPasswordStep === 'password'
                          ? 'Choose a password you will use the next time you sign in.'
                          : 'Check your inbox and sign in using the temporary password.'}
                  </p>
                </div>
                <button type="button" onClick={resetForgotPasswordFlow} className="rounded-full p-2 text-slate-400 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/12 dark:text-slate-500 dark:hover:text-white dark:focus-visible:ring-cyan-300/12">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {forgotPasswordStep === 'email' ? (
                <form onSubmit={handleForgotPassword} className="space-y-3.5">
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-slate-700 dark:text-slate-200">Email Address</label>
                    <input
                      type="email"
                      value={forgotPasswordEmail}
                      onChange={(e) => setForgotPasswordEmail(e.target.value)}
                      className={AUTH_INPUT_BASE_CLASS}
                      placeholder="Enter your email address"
                      autoComplete="email"
                      required
                    />
                  </div>

                  <div className="min-h-[2.75rem]" aria-live="polite">
                    {forgotPasswordMessage ? <MessageBanner tone={forgotPasswordMessage.type}>{forgotPasswordMessage.text}</MessageBanner> : null}
                  </div>

                  <div className="flex gap-2.5">
                    <button type="button" onClick={resetForgotPasswordFlow} className={cn(SECONDARY_BUTTON_CLASS, 'flex-1')}>
                      Cancel
                    </button>
                    <button type="submit" disabled={forgotPasswordLoading || !canSubmitForgotPassword} className={cn(PRIMARY_BUTTON_CLASS, 'flex-1')}>
                      {forgotPasswordLoading ? 'Sending...' : forgotPasswordOnCooldown ? `Wait ${forgotPasswordCooldownSeconds}s` : 'Send temporary password'}
                    </button>
                  </div>
                </form>
              ) : forgotPasswordStep === 'passcode' ? (
                <form onSubmit={handleVerifyForgotPasswordPasscode} className="space-y-3.5">
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-slate-700 dark:text-slate-200">Passcode</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={LOGIN_MFA_CODE_LENGTH}
                      value={forgotPasswordPasscode}
                      onChange={(e) => setForgotPasswordPasscode(sanitizePasscodeInput(e.target.value))}
                      className={cn(AUTH_INPUT_BASE_CLASS, 'text-center font-mono text-base tracking-[0.18em]')}
                      placeholder="000000"
                      autoComplete="one-time-code"
                      required
                    />
                  </div>

                  <div className="min-h-[2.75rem]" aria-live="polite">
                    {forgotPasswordMessage ? <MessageBanner tone={forgotPasswordMessage.type}>{forgotPasswordMessage.text}</MessageBanner> : null}
                  </div>

                  <button
                    type="button"
                    onClick={handleResendForgotPasswordPasscode}
                    disabled={forgotPasswordLoading || forgotPasswordOnCooldown}
                    className={cn(GHOST_BUTTON_CLASS, 'w-full')}
                  >
                    {forgotPasswordLoading
                      ? 'Please wait...'
                      : forgotPasswordOnCooldown
                        ? `Resend passcode in ${forgotPasswordCooldownSeconds}s`
                        : 'Resend passcode'}
                  </button>

                  <div className="flex gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setForgotPasswordStep('email');
                        setForgotPasswordPasscode('');
                        setForgotPasswordResetToken('');
                        setForgotPasswordMessage(null);
                      }}
                      className={cn(SECONDARY_BUTTON_CLASS, 'flex-1')}
                    >
                      Change email
                    </button>
                    <button type="submit" disabled={forgotPasswordLoading || !canSubmitForgotPassword} className={cn(PRIMARY_BUTTON_CLASS, 'flex-1')}>
                      {forgotPasswordLoading ? 'Verifying...' : 'Verify passcode'}
                    </button>
                  </div>
                </form>
              ) : forgotPasswordStep === 'password' ? (
                <form onSubmit={handleResetForgotPassword} className="space-y-3.5">
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-slate-700 dark:text-slate-200">New password</label>
                    <ThemeSafeInput
                      type={showForgotPasswordNewPassword ? 'text' : 'password'}
                      icon={Lock}
                      value={forgotPasswordNewPassword}
                      onChange={(e) => handleForgotPasswordNewPasswordChange(e.target.value)}
                      maxLength={72}
                      autoComplete="new-password"
                      required
                      className="!pr-[5.25rem]"
                      endAdornment={
                        <div className="flex items-center gap-1.5">
                          {isForgotPasswordNewPasswordValid ? (
                            <span
                              className="inline-flex h-6 w-6 items-center justify-center rounded-full"
                              aria-label="Password requirements met"
                            >
                              <Check className={cn('h-4 w-4', PASSWORD_VALID_TICK_CLASS)} aria-hidden />
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setShowForgotPasswordNewPassword((value) => !value)}
                            className="rounded-full p-1 text-slate-400 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/15 dark:text-slate-500 dark:hover:text-white dark:focus-visible:ring-cyan-300/15"
                            aria-label={showForgotPasswordNewPassword ? 'Hide password' : 'Show password'}
                          >
                            {showForgotPasswordNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      }
                    />
                    <div className="mt-1 min-h-[2rem] px-1" aria-live="polite">
                      {forgotPasswordInlineMessage ? (
                        <p className={cn('text-xs font-medium', forgotPasswordInlineMessage.tone)}>
                          {forgotPasswordInlineMessage.text}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-slate-700 dark:text-slate-200">Confirm password</label>
                    <ThemeSafeInput
                      type={showForgotPasswordConfirmPassword ? 'text' : 'password'}
                      icon={Lock}
                      value={forgotPasswordConfirmPassword}
                      onChange={(e) => handleForgotPasswordConfirmPasswordChange(e.target.value)}
                      maxLength={72}
                      autoComplete="new-password"
                      required
                      endAdornment={
                        <button
                          type="button"
                          onClick={() => setShowForgotPasswordConfirmPassword((value) => !value)}
                          className="rounded-full p-1 text-slate-400 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/15 dark:text-slate-500 dark:hover:text-white dark:focus-visible:ring-cyan-300/15"
                          aria-label={showForgotPasswordConfirmPassword ? 'Hide password' : 'Show password'}
                        >
                          {showForgotPasswordConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      }
                    />
                  </div>

                  <div className="min-h-[2.75rem]" aria-live="polite">
                    {forgotPasswordMessage ? (
                      <MessageBanner tone={forgotPasswordMessage.type}>{forgotPasswordMessage.text}</MessageBanner>
                    ) : forgotPasswordConfirmPassword && !forgotPasswordPasswordsMatch ? (
                      <MessageBanner tone="error">Passwords do not match</MessageBanner>
                    ) : null}
                  </div>

                  <div className="flex gap-2.5">
                    <button type="button" onClick={resetForgotPasswordFlow} className={cn(SECONDARY_BUTTON_CLASS, 'flex-1')}>
                      Cancel
                    </button>
                    <button type="submit" disabled={forgotPasswordLoading || !canSubmitForgotPassword} className={cn(PRIMARY_BUTTON_CLASS, 'flex-1')}>
                      {forgotPasswordLoading ? 'Updating...' : 'Update password'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  {forgotPasswordMessage ? <MessageBanner tone={forgotPasswordMessage.type}>{forgotPasswordMessage.text}</MessageBanner> : null}
                  <button
                    type="button"
                    onClick={() => {
                      const resetEmail = forgotPasswordEmail.trim();
                      resetForgotPasswordFlow();
                      setEmail(resetEmail);
                    }}
                    className={PRIMARY_BUTTON_CLASS}
                  >
                    Go to sign in
                  </button>
                </div>
              )}
            </ModalCard>
          </div>
        </div>
      ) : null}
    </ViewportAuthShell>
  );
}
