import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, KeyRound, Lock, Mail, QrCode, ShieldCheck, Smartphone } from 'lucide-react';
import { api, type TotpSetupResponse } from '../../lib/api';
import type { User } from '../../types';
import OtpCodeField, { sanitizeOtpCode } from './OtpCodeField';

const CODE_LENGTH = 6;

const PRIMARY_BUTTON_CLASS =
  'inline-flex min-h-[38px] items-center justify-center gap-2 rounded-[11px] bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 px-3.5 py-[0.6rem] text-[12.5px] font-semibold text-white shadow-[0_10px_24px_rgba(14,165,233,0.18)] transition duration-200 hover:brightness-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/18 disabled:cursor-not-allowed disabled:opacity-55 dark:from-cyan-400 dark:via-sky-400 dark:to-blue-500';
const COMPACT_PRIMARY_BUTTON_CLASS =
  'inline-flex min-h-[34px] w-full items-center justify-center gap-2 rounded-[11px] bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 px-3 py-[0.5rem] text-[12px] font-semibold text-white shadow-[0_8px_18px_rgba(14,165,233,0.16)] transition duration-200 hover:brightness-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/18 disabled:cursor-not-allowed disabled:opacity-55 dark:from-cyan-400 dark:via-sky-400 dark:to-blue-500';
const SECONDARY_BUTTON_CLASS =
  'inline-flex min-h-[38px] items-center justify-center gap-2 rounded-[11px] border border-slate-300/80 bg-white px-3.5 py-[0.6rem] text-[12.5px] font-medium text-slate-700 transition duration-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/12 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-100 dark:hover:bg-white/[0.08] dark:focus-visible:ring-cyan-300/12';
const COMPACT_SECONDARY_BUTTON_CLASS =
  'inline-flex min-h-[34px] w-full items-center justify-center gap-2 rounded-[11px] border border-slate-300/80 bg-white px-3 py-[0.5rem] text-[12px] font-medium text-slate-700 transition duration-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/12 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-100 dark:hover:bg-white/[0.08] dark:focus-visible:ring-cyan-300/12';
const INPUT_CLASS =
  'min-h-[38px] w-full rounded-[11px] border border-slate-300/80 bg-white px-3 py-[0.55rem] text-[12.5px] text-slate-950 outline-none transition duration-200 placeholder:text-slate-500 focus:border-cyan-500/60 focus:ring-4 focus:ring-cyan-500/12 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-slate-950/45 dark:text-white dark:placeholder:text-slate-400 dark:focus:border-cyan-300/60 dark:focus:ring-cyan-300/12';

const AUTHENTICATOR_APPS = ['Google Authenticator', 'Microsoft Authenticator', 'Authy'] as const;

function AppPills() {
  return (
    <div className="flex flex-wrap gap-1.5">
      {AUTHENTICATOR_APPS.map((app) => (
        <span
          key={app}
          className="rounded-full border border-cyan-400/25 bg-cyan-500/[0.08] px-2 py-0.5 text-[10px] font-semibold tracking-[0.01em] text-cyan-950 dark:border-cyan-200/20 dark:bg-cyan-300/[0.08] dark:text-cyan-50"
        >
          {app}
        </span>
      ))}
    </div>
  );
}

function secretGroups(secret: string): string[] {
  const chunks = secret.match(/.{1,4}/g);
  return chunks && chunks.length > 0 ? chunks : ['••••'];
}

function SecretKeyBlock({
  secret,
  copied,
  onCopy,
}: {
  secret?: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const groups = secret ? secretGroups(secret) : ['••••', '••••', '••••', '••••', '••••', '••••', '••••', '••••'];

  return (
    <div className="flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {groups.map((group, index) => (
          <span
            key={`${group}-${index}`}
            className="rounded-md border border-slate-200/80 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-[0.08em] text-slate-800 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-100"
          >
            {group}
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={onCopy}
        disabled={!secret}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-slate-200/90 bg-white px-2 text-[11px] font-semibold text-slate-600 transition hover:border-cyan-400/50 hover:text-slate-950 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:border-cyan-300/40 dark:hover:text-white"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function QrFrame({
  src,
  loading,
  compact,
  onLoad,
}: {
  src?: string;
  loading: boolean;
  compact: boolean;
  onLoad: () => void;
}) {
  const sizeClass = compact ? 'h-[112px] w-[112px] rounded-2xl p-1.5' : 'h-[168px] w-[168px] rounded-[22px] p-2.5';
  return (
    <div className={`flex shrink-0 items-center justify-center bg-white shadow-[0_12px_28px_rgba(15,23,42,0.14)] ring-1 ring-slate-200/90 ${sizeClass}`}>
      {src ? (
        <img src={src} alt="Authenticator QR code" className="h-full w-full object-contain" />
      ) : (
        <button type="button" onClick={onLoad} className="px-2 text-center text-[11px] font-medium text-cyan-700 dark:text-cyan-200">
          {loading ? 'Loading...' : 'Load QR'}
        </button>
      )}
    </div>
  );
}

function StepLabel({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500/15 text-[10px] font-bold text-cyan-800 dark:bg-cyan-300/15 dark:text-cyan-100">
        {n}
      </span>
      <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">{children}</p>
    </div>
  );
}

type EnrollmentView = 'suggest' | 'setup' | 'success' | 'manage';

interface TotpEnrollmentCardProps {
  showSkip?: boolean;
  alreadyEnabled?: boolean;
  compact?: boolean;
  onFinished: (user: User) => void;
  onSkip?: (user: User) => void;
  onCancel?: () => void;
}

function Banner({ tone, children }: { tone: 'success' | 'error' | 'info'; children: ReactNode }) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-100'
      : tone === 'error'
        ? 'border-rose-400/30 bg-rose-500/10 text-rose-800 dark:text-rose-100'
        : 'border-cyan-400/25 bg-cyan-500/10 text-cyan-900 dark:text-cyan-50';
  return <div className={`rounded-xl border px-3 py-2 text-[12px] font-medium leading-5 ${toneClass}`}>{children}</div>;
}

export default function TotpEnrollmentCard({
  showSkip = true,
  alreadyEnabled = false,
  compact = false,
  onFinished,
  onSkip,
  onCancel,
}: TotpEnrollmentCardProps) {
  const [view, setView] = useState<EnrollmentView>(alreadyEnabled ? 'manage' : showSkip ? 'suggest' : 'setup');
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [completedUser, setCompletedUser] = useState<User | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const setupRequestRef = useRef(0);

  useEffect(() => {
    if (alreadyEnabled || showSkip || setup) return;
    void startSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alreadyEnabled, showSkip]);

  useEffect(() => {
    if (view === 'setup') {
      codeInputRef.current?.focus();
    }
  }, [view, setup]);

  async function startSetup() {
    const requestId = setupRequestRef.current + 1;
    setupRequestRef.current = requestId;
    setLoading(true);
    setMessage(null);
    try {
      const response = await api.setupTotp();
      if (setupRequestRef.current !== requestId) return;
      setSetup(response);
      setView('setup');
    } catch (error) {
      if (setupRequestRef.current !== requestId) return;
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not start authenticator setup' });
    } finally {
      if (setupRequestRef.current === requestId) setLoading(false);
    }
  }

  async function handleSkip() {
    if (!onSkip || loading) return;
    setLoading(true);
    setMessage(null);
    try {
      const response = await api.skipTotp();
      onSkip(response.user);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not skip setup' });
      setLoading(false);
    }
  }

  async function handleConfirm(codeOverride?: string) {
    const passcode = sanitizeOtpCode(codeOverride ?? code, CODE_LENGTH);
    if (passcode.length !== CODE_LENGTH || loading) return;
    setCode(passcode);
    setLoading(true);
    setMessage(null);
    try {
      const response = await api.confirmTotp(passcode);
      setCompletedUser(response.user);
      setView('success');
      window.setTimeout(() => onFinished(response.user), 700);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Invalid authenticator code' });
      setLoading(false);
    }
  }

  async function handleDisable() {
    const passcode = sanitizeOtpCode(code, CODE_LENGTH);
    if (!password || passcode.length !== CODE_LENGTH || loading) return;
    setLoading(true);
    setMessage(null);
    try {
      const response = await api.disableTotp(password, passcode);
      onFinished(response.user);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not disable authenticator' });
      setLoading(false);
    }
  }

  async function copySecret() {
    if (!setup?.secret) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  function handleCodeChange(next: string) {
    setCode(next);
    if (next.length === CODE_LENGTH) {
      window.setTimeout(() => {
        void handleConfirm(next);
      }, 0);
    }
  }

  if (view === 'suggest') {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="rounded-2xl border border-cyan-500/15 bg-gradient-to-br from-cyan-500/[0.08] via-sky-500/[0.05] to-blue-600/[0.06] px-3 py-3 dark:border-cyan-200/14">
          <div className="flex items-start gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-[0_8px_18px_rgba(14,165,233,0.22)]">
              <Smartphone className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-slate-950 dark:text-white">Add an authenticator app</p>
              <p className="mt-1 text-[12px] leading-[1.45] text-slate-600 dark:text-slate-300">
                Scan a QR once. On a new office, home, or mobile network you can enter a 6-digit app code instead of waiting for email.
              </p>
            </div>
          </div>
          <div className="mt-2.5">
            <AppPills />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] font-medium text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-300" /> Works offline</span>
            <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-300" /> Email stays as backup</span>
          </div>
        </div>
        {message ? <Banner tone={message.type}>{message.text}</Banner> : null}
        <button type="button" onClick={() => void startSetup()} disabled={loading} className={compact ? COMPACT_PRIMARY_BUTTON_CLASS : `${PRIMARY_BUTTON_CLASS} w-full`}>
          <QrCode className="h-4 w-4" />
          {loading ? 'Preparing...' : 'Set up authenticator'}
        </button>
        {showSkip ? (
          <button type="button" onClick={() => void handleSkip()} disabled={loading} className={compact ? COMPACT_SECONDARY_BUTTON_CLASS : `${SECONDARY_BUTTON_CLASS} w-full`}>
            Maybe later
          </button>
        ) : null}
        {onCancel ? (
          <button type="button" onClick={onCancel} className="text-[12px] font-medium text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
            Cancel
          </button>
        ) : null}
      </div>
    );
  }

  if (view === 'success') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
          <Check className="h-7 w-7" />
        </div>
        <div>
          <p className="text-[15px] font-semibold text-slate-950 dark:text-white">Authenticator enabled</p>
          <p className="mt-1 text-[12.5px] text-slate-600 dark:text-slate-300">
            {completedUser ? 'Unknown networks will let you choose app or email.' : 'Continuing into the workbench...'}
          </p>
        </div>
      </div>
    );
  }

  if (view === 'manage') {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-700 dark:text-emerald-200">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-emerald-950 dark:text-emerald-50">Authenticator app is on</p>
            <p className="mt-1 text-[12px] leading-5 text-emerald-900/80 dark:text-emerald-100/85">
              Unknown networks will offer this app code or email verification.
            </p>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <p className="text-[12.5px] font-semibold text-slate-900 dark:text-white">Turn it off</p>
          <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-300">Confirm with your password and a current app code.</p>
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="totp-disable-password" className="mb-1 block text-[11.5px] font-medium text-slate-700 dark:text-slate-200">Password</label>
              <input id="totp-disable-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} className={INPUT_CLASS} autoComplete="current-password" />
            </div>
            <div>
              <label htmlFor="totp-disable-code" className="mb-1.5 block text-[11.5px] font-medium text-slate-700 dark:text-slate-200">Authenticator code</label>
              <OtpCodeField
                id="totp-disable-code"
                value={code}
                inputRef={codeInputRef}
                disabled={loading}
                onChange={setCode}
              />
            </div>
          </div>
        </div>
        {message ? <Banner tone={message.type}>{message.text}</Banner> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {onCancel ? (
            <button type="button" onClick={onCancel} className={`${SECONDARY_BUTTON_CLASS} w-full sm:w-auto sm:min-w-[120px]`}>Close</button>
          ) : null}
          <button type="button" onClick={() => void handleDisable()} disabled={loading || !password || code.length !== CODE_LENGTH} className={`${PRIMARY_BUTTON_CLASS} w-full sm:w-auto sm:min-w-[200px]`}>
            <Lock className="h-4 w-4" />
            {loading ? 'Disabling...' : 'Disable authenticator'}
          </button>
        </div>
      </div>
    );
  }

  const qr = (
    <QrFrame
      src={setup?.qr_data_uri}
      loading={loading}
      compact={compact}
      onLoad={() => {
        void startSetup();
      }}
    />
  );

  const keyBlock = (
    <div>
      <p className="mb-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">Can&apos;t scan? Use this setup key</p>
      <SecretKeyBlock secret={setup?.secret} copied={copied} onCopy={() => void copySecret()} />
    </div>
  );

  const codeBlock = (
    <div>
      <label htmlFor="totp-setup-code" className="mb-1.5 block text-[11.5px] font-medium text-slate-700 dark:text-slate-200">
        6-digit app code
      </label>
      <OtpCodeField
        id="totp-setup-code"
        value={code}
        inputRef={codeInputRef}
        disabled={loading || !setup}
        size={compact ? 'sm' : 'md'}
        onChange={handleCodeChange}
      />
    </div>
  );

  const actions = compact ? (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={() => void handleConfirm()} disabled={loading || !setup || code.length !== CODE_LENGTH} className={COMPACT_PRIMARY_BUTTON_CLASS}>
        <KeyRound className="h-4 w-4" />
        {loading ? 'Verifying...' : 'Enable authenticator'}
      </button>
      {showSkip ? (
        <button
          type="button"
          onClick={() => void handleSkip()}
          disabled={loading}
          className="inline-flex min-h-[28px] items-center justify-center text-[12px] font-medium text-slate-500 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/12 dark:text-slate-300 dark:hover:text-white"
        >
          Skip for now
        </button>
      ) : onCancel ? (
        <button type="button" onClick={onCancel} className={COMPACT_SECONDARY_BUTTON_CLASS}>Cancel</button>
      ) : null}
    </div>
  ) : (
    <div className="flex flex-col-reverse gap-2 border-t border-slate-200/80 pt-4 sm:flex-row sm:justify-end dark:border-white/10">
      {onCancel ? (
        <button type="button" onClick={onCancel} className={`${SECONDARY_BUTTON_CLASS} w-full sm:w-auto sm:min-w-[120px]`}>Cancel</button>
      ) : null}
      <button type="button" onClick={() => void handleConfirm()} disabled={loading || !setup || code.length !== CODE_LENGTH} className={`${PRIMARY_BUTTON_CLASS} w-full sm:w-auto sm:min-w-[200px]`}>
        <KeyRound className="h-4 w-4" />
        {loading ? 'Verifying...' : 'Enable authenticator'}
      </button>
    </div>
  );

  if (compact) {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex items-start gap-3">
          {qr}
          <div className="min-w-0 flex-1 pt-0.5">{keyBlock}</div>
        </div>
        {codeBlock}
        {message ? <Banner tone={message.type}>{message.text}</Banner> : null}
        {actions}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-5 sm:grid-cols-[188px_minmax(0,1fr)] sm:items-start">
        <div className="flex flex-col items-center gap-2 sm:items-start">
          {qr}
          <p className="text-center text-[11px] font-medium text-slate-500 sm:text-left dark:text-slate-400">Scan with your authenticator app</p>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <div>
            <StepLabel n={1}>Open your app and scan the QR</StepLabel>
            <AppPills />
            <div className="mt-3">{keyBlock}</div>
          </div>
          <div>
            <StepLabel n={2}>Enter the code shown in the app</StepLabel>
            {codeBlock}
          </div>
        </div>
      </div>
      {message ? <Banner tone={message.type}>{message.text}</Banner> : null}
      {actions}
    </div>
  );
}
