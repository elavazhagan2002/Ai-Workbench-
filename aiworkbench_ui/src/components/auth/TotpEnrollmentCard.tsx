import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, KeyRound, Lock, Mail, QrCode, ShieldCheck, Smartphone } from 'lucide-react';
import { api, type TotpSetupResponse } from '../../lib/api';
import type { User } from '../../types';

const CODE_LENGTH = 6;

const PRIMARY_BUTTON_CLASS =
  'inline-flex min-h-[38px] w-full items-center justify-center gap-2 rounded-[11px] bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 px-3.5 py-[0.6rem] text-[12.5px] font-semibold text-white shadow-[0_10px_24px_rgba(14,165,233,0.18)] transition duration-200 hover:brightness-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/18 disabled:cursor-not-allowed disabled:opacity-55 dark:from-cyan-400 dark:via-sky-400 dark:to-blue-500';
const SECONDARY_BUTTON_CLASS =
  'inline-flex min-h-[38px] w-full items-center justify-center gap-2 rounded-[11px] border border-slate-300/80 bg-white px-3.5 py-[0.6rem] text-[12.5px] font-medium text-slate-700 transition duration-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-500/12 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-100 dark:hover:bg-white/[0.08] dark:focus-visible:ring-cyan-300/12';
const INPUT_CLASS =
  'min-h-[38px] w-full rounded-[11px] border border-slate-300/80 bg-white px-3 py-[0.55rem] text-[12.5px] text-slate-950 outline-none transition duration-200 placeholder:text-slate-500 focus:border-cyan-500/60 focus:ring-4 focus:ring-cyan-500/12 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-slate-950/45 dark:text-white dark:placeholder:text-slate-400 dark:focus:border-cyan-300/60 dark:focus:ring-cyan-300/12';

type EnrollmentView = 'suggest' | 'setup' | 'success' | 'manage';

interface TotpEnrollmentCardProps {
  showSkip?: boolean;
  alreadyEnabled?: boolean;
  onFinished: (user: User) => void;
  onSkip?: (user: User) => void;
  onCancel?: () => void;
}

function sanitizeCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, CODE_LENGTH);
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
    const passcode = sanitizeCode(codeOverride ?? code);
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
    const passcode = sanitizeCode(code);
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

  if (view === 'suggest') {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-2xl border border-cyan-500/15 bg-gradient-to-br from-cyan-500/[0.08] via-sky-500/[0.05] to-blue-600/[0.06] px-3.5 py-3.5 dark:border-cyan-200/14">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-[0_10px_24px_rgba(14,165,233,0.22)]">
              <Smartphone className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-slate-950 dark:text-white">Protect the next unknown network</p>
              <p className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-300">
                Add an authenticator app now. On a new office, home, or mobile IP you can choose a 6-digit app code instead of waiting for email.
              </p>
            </div>
          </div>
          <ul className="mt-3 grid gap-1.5 text-[11.5px] font-medium text-slate-600 dark:text-slate-300 sm:grid-cols-2">
            <li className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-300" /> Works offline on your phone</li>
            <li className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-300" /> Email stays as a backup</li>
          </ul>
        </div>
        {message ? <Banner tone={message.type}>{message.text}</Banner> : null}
        <button type="button" onClick={() => void startSetup()} disabled={loading} className={PRIMARY_BUTTON_CLASS}>
          <QrCode className="h-4 w-4" />
          {loading ? 'Preparing...' : 'Set up authenticator'}
        </button>
        {showSkip ? (
          <button type="button" onClick={() => void handleSkip()} disabled={loading} className={SECONDARY_BUTTON_CLASS}>
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
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
          <Check className="h-7 w-7" />
        </div>
        <div>
          <p className="text-[14px] font-semibold text-slate-950 dark:text-white">Authenticator enabled</p>
          <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-300">
            {completedUser ? 'Unknown networks will let you choose app or email.' : 'Continuing into the workbench...'}
          </p>
        </div>
      </div>
    );
  }

  if (view === 'manage') {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2.5 text-[12.5px] text-emerald-900 dark:text-emerald-50">
          <p className="font-semibold">Authenticator app is on</p>
          <p className="mt-1 text-[12px] font-medium leading-5">Unknown networks will offer this app code or email verification.</p>
        </div>
        <p className="text-[12px] font-medium text-slate-600 dark:text-slate-300">Turn it off with your password and a current app code.</p>
        <div>
          <label className="mb-0.5 block text-[11.5px] font-medium text-slate-700 dark:text-slate-200">Password</label>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className={INPUT_CLASS} autoComplete="current-password" />
        </div>
        <div>
          <label className="mb-0.5 block text-[11.5px] font-medium text-slate-700 dark:text-slate-200">Authenticator code</label>
          <input
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(event) => setCode(sanitizeCode(event.target.value))}
            maxLength={CODE_LENGTH}
            className={INPUT_CLASS}
            placeholder="6-digit code"
            autoComplete="one-time-code"
          />
        </div>
        {message ? <Banner tone={message.type}>{message.text}</Banner> : null}
        <button type="button" onClick={() => void handleDisable()} disabled={loading || !password || code.length !== CODE_LENGTH} className={PRIMARY_BUTTON_CLASS}>
          <Lock className="h-4 w-4" />
          {loading ? 'Disabling...' : 'Disable authenticator'}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className={SECONDARY_BUTTON_CLASS}>Close</button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/[0.06] px-3 py-2.5 text-[12.5px] text-cyan-950 dark:border-cyan-200/14 dark:bg-cyan-300/[0.06] dark:text-cyan-50">
        <p className="font-semibold">Scan with your authenticator app</p>
        <p className="mt-1 text-[12px] font-medium leading-5">Google Authenticator, Microsoft Authenticator, or Authy all work.</p>
      </div>

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <div className="flex h-[168px] w-[168px] shrink-0 items-center justify-center rounded-2xl border border-slate-200/90 bg-white p-2 shadow-[0_12px_28px_rgba(15,23,42,0.08)] dark:border-white/10">
          {setup?.qr_data_uri ? (
            <img src={setup.qr_data_uri} alt="Authenticator QR code" className="h-full w-full object-contain" />
          ) : (
            <button type="button" onClick={() => void startSetup()} className="px-3 text-center text-[11px] font-medium text-cyan-700 dark:text-cyan-200">
              {loading ? 'Loading QR...' : 'Tap to load QR'}
            </button>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[11.5px] font-medium leading-5 text-slate-600 dark:text-slate-300">
            Can&apos;t scan? Enter this key manually in the app.
          </p>
          <button
            type="button"
            onClick={() => void copySecret()}
            className="flex w-full items-center justify-between gap-2 rounded-[11px] border border-slate-300/80 bg-white px-3 py-2 text-left dark:border-white/10 dark:bg-white/[0.05]"
          >
            <span className="truncate font-mono text-[11.5px] tracking-[0.08em] text-slate-800 dark:text-slate-100">{setup?.secret || '••••••••'}</span>
            {copied ? <Check className="h-4 w-4 shrink-0 text-emerald-500" /> : <Copy className="h-4 w-4 shrink-0 text-slate-400" />}
          </button>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{copied ? 'Key copied' : 'Tap to copy the setup key'}</p>
        </div>
      </div>

      <div>
        <label className="mb-0.5 block text-[11.5px] font-medium text-slate-700 dark:text-slate-200">Enter the 6-digit app code</label>
        <input
          ref={codeInputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={code}
          onChange={(event) => {
            const next = sanitizeCode(event.target.value);
            setCode(next);
            if (next.length === CODE_LENGTH) {
              window.setTimeout(() => { void handleConfirm(next); }, 0);
            }
          }}
          maxLength={CODE_LENGTH}
          placeholder="000000"
          autoComplete="one-time-code"
          className={`${INPUT_CLASS} font-mono tracking-[0.28em]`}
          disabled={loading || !setup}
        />
      </div>

      {message ? <Banner tone={message.type}>{message.text}</Banner> : null}

      <button type="button" onClick={() => void handleConfirm()} disabled={loading || !setup || code.length !== CODE_LENGTH} className={PRIMARY_BUTTON_CLASS}>
        <KeyRound className="h-4 w-4" />
        {loading ? 'Verifying...' : 'Enable authenticator'}
      </button>
      {showSkip ? (
        <button type="button" onClick={() => void handleSkip()} disabled={loading} className={SECONDARY_BUTTON_CLASS}>
          Skip for now
        </button>
      ) : onCancel ? (
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON_CLASS}>Cancel</button>
      ) : null}
    </div>
  );
}
