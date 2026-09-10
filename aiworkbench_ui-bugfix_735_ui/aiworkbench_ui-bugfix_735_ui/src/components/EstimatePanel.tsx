import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Circle, Wallet } from 'lucide-react';
import SelectMenu from './SelectMenu';
import {
  CURRENCY_OPTIONS,
  ESTIMATE_LINE_KEYS,
  ESTIMATE_LINE_LABELS,
  ESTIMATE_LINE_TYPES,
  MONEY_FIELD_LABELS,
  VENDOR_ASSESSMENT_QUESTIONS,
  computeEstimateTotals,
  estimateCompletenessError,
  estimateFilledValueErrors,
  estimateLineHasInvalidValues,
  estimateLineIsComplete,
  estimateMissingHints,
  estimateProgress,
  firstIncompleteLine,
  isVendorBuild,
  lineFieldErrors,
  lineNavState,
  lineYearTotal,
  normalizeEstimateData,
  parseMoneyInput,
  sanitizeMoneyTyping,
  vendorChecklistProgress,
  type EstimateData,
  type EstimateLineKey,
  type LineNavTone,
  type MoneyField,
} from '../constants/estimateOptions';

const LINE_HINTS: Record<EstimateLineKey, string> = {
  infra: 'Cloud vs on-premise hosting for the solution.',
  build: 'Who will build it — internal team or an external vendor.',
  validation: 'Testing and validation effort (internal or external).',
  support: 'Ongoing support after go-live.',
  llm_token: 'Model/token usage cost by provider.',
  change_management: 'Training, adoption, and process change effort.',
};

interface EstimatePanelProps {
  estimateData: any;
  defaultCurrency?: string;
  canEdit: boolean;
  canComplete: boolean;
  completed?: boolean;
  saving?: boolean;
  completing?: boolean;
  estimateOwnerLabel?: string;
  dueDate?: string | null;
  assignedByName?: string | null;
  onSave: (data: EstimateData) => void | Promise<void>;
  onComplete: () => void | Promise<void>;
}

function moneyToText(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '';
  return String(value);
}

function lineWasTouched(key: EstimateLineKey, touched: Record<string, boolean>): boolean {
  return ['type', 'actual_cost', 'year1', 'year2', 'year3'].some((field) => touched[`${key}:${field}`]);
}

function lineTabClass(tone: LineNavTone, selected: boolean): string {
  const selectedRing = selected ? ' ring-2 ring-cyan-400/50' : '';
  if (tone === 'error') {
    return `border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/40${selectedRing}`;
  }
  if (tone === 'warn') {
    return `border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30${selectedRing}`;
  }
  if (tone === 'ok') {
    return `border-emerald-300/70 bg-emerald-500/5${selectedRing}`;
  }
  if (selected) return `border-cyan-500 bg-cyan-500/10${selectedRing}`;
  return 'border-line bg-surface-elevated hover:border-cyan-400/50';
}

function LineStatusIcon({ tone }: { tone: LineNavTone }) {
  if (tone === 'ok') return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />;
  if (tone === 'error') return <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />;
  if (tone === 'warn') return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />;
  return <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" />;
}

function lineHintClass(tone: LineNavTone): string {
  if (tone === 'error') return 'text-red-600 dark:text-red-400';
  if (tone === 'warn') return 'text-amber-700 dark:text-amber-300';
  return 'text-ink-muted';
}

function mobileChipClass(tone: LineNavTone, selected: boolean): string {
  if (tone === 'error') return 'border-red-400 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-200';
  if (tone === 'warn') return 'border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200';
  if (selected) return 'border-cyan-500 bg-cyan-500/15 text-ink';
  if (tone === 'ok') return 'border-emerald-400/60 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200';
  return 'border-line text-ink-muted';
}

function MoneyInput({
  id,
  label,
  value,
  currency,
  disabled,
  error,
  onCommit,
}: {
  id: string;
  label: string;
  value: number | null;
  currency: string;
  disabled: boolean;
  error?: string;
  onCommit: (next: number | null) => void;
}) {
  const [text, setText] = useState(() => moneyToText(value));
  const [localError, setLocalError] = useState<string | null>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    setText(moneyToText(value));
    setLocalError(null);
    focusedRef.current = false;
  }, [id]);

  useEffect(() => {
    if (!focusedRef.current) setText(moneyToText(value));
  }, [value]);

  const shownError = localError || error;

  return (
    <label htmlFor={id} className="block min-w-0">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {label} *
      </span>
      <div
        className={`flex min-h-11 items-center rounded-xl border bg-surface px-2.5 transition ${
          shownError
            ? 'border-red-400 ring-2 ring-red-400/20'
            : 'border-line focus-within:border-cyan-500 focus-within:ring-2 focus-within:ring-cyan-500/20'
        } ${disabled ? 'opacity-70' : ''}`}
      >
        <span className="shrink-0 pr-1.5 text-xs font-medium text-ink-subtle">{currency}</span>
        <input
          id={id}
          inputMode="decimal"
          type="text"
          autoComplete="off"
          disabled={disabled}
          value={text}
          placeholder="0.00"
          onFocus={() => {
            focusedRef.current = true;
          }}
          onChange={(e) => {
            const next = sanitizeMoneyTyping(e.target.value);
            setText(next);
            const parsed = parseMoneyInput(next);
            setLocalError(parsed.error);
            if (parsed.error || next.endsWith('.')) return;
            onCommit(parsed.value);
          }}
          onBlur={() => {
            focusedRef.current = false;
            const parsed = parseMoneyInput(text);
            setLocalError(parsed.error);
            if (parsed.error) return;
            const normalized = parsed.value == null ? '' : moneyToText(parsed.value);
            setText(normalized);
            onCommit(parsed.value);
          }}
          className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-ink outline-none disabled:cursor-not-allowed"
        />
      </div>
      <p className="mt-1 min-h-4 text-xs text-red-600 dark:text-red-400">{shownError || '\u00a0'}</p>
    </label>
  );
}

export default function EstimatePanel({
  estimateData,
  defaultCurrency = 'USD',
  canEdit,
  canComplete,
  completed = false,
  saving = false,
  completing = false,
  estimateOwnerLabel,
  dueDate,
  assignedByName,
  onSave,
  onComplete,
}: EstimatePanelProps) {
  const [draft, setDraft] = useState<EstimateData>(() =>
    normalizeEstimateData(estimateData, defaultCurrency)
  );
  const [showErrors, setShowErrors] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [banner, setBanner] = useState('');
  const [activeLine, setActiveLine] = useState<EstimateLineKey>('infra');

  useEffect(() => {
    setDraft(normalizeEstimateData(estimateData, defaultCurrency));
  }, [estimateData, defaultCurrency]);

  const totals = useMemo(() => computeEstimateTotals(draft.lines), [draft.lines]);
  const vendorBuild = isVendorBuild(draft);
  const progress = useMemo(() => estimateProgress(draft), [draft]);
  const progressPct = Math.round((progress.done / progress.total) * 100);
  const vendorProgress = vendorChecklistProgress(draft);
  const missingHints = useMemo(() => estimateMissingHints(draft), [draft]);
  const activeIndex = ESTIMATE_LINE_KEYS.indexOf(activeLine);
  const filledErrors = lineFieldErrors(activeLine, draft.lines[activeLine], false);
  const typeError =
    filledErrors.type ||
    ((showErrors || touched[`${activeLine}:type`]) && !draft.lines[activeLine].type ? 'Select a type.' : undefined);

  function markTouched(key: EstimateLineKey, field: string) {
    setTouched((prev) => ({ ...prev, [`${key}:${field}`]: true }));
  }

  function updateLine(key: EstimateLineKey, patch: Partial<EstimateData['lines'][EstimateLineKey]>) {
    setDraft((prev) => {
      const lines = {
        ...prev.lines,
        [key]: { ...prev.lines[key], ...patch },
      };
      return { ...prev, lines, totals: computeEstimateTotals(lines) };
    });
    setBanner('');
  }

  function updateVendorCheck(id: string, value: 'yes' | 'no' | 'na') {
    setDraft((prev) => ({
      ...prev,
      vendor_checklist: { ...prev.vendor_checklist, [id]: value },
    }));
    setBanner('');
  }

  function formatMoney(n: number) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: draft.currency || 'USD',
        maximumFractionDigits: 2,
      }).format(n);
    } catch {
      return `${draft.currency || 'USD'} ${n.toFixed(2)}`;
    }
  }

  function goLine(delta: number) {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    const next = (activeIndex + delta + ESTIMATE_LINE_KEYS.length) % ESTIMATE_LINE_KEYS.length;
    setActiveLine(ESTIMATE_LINE_KEYS[next]);
  }

  async function handleSave() {
    const payload = { ...draft, totals };
    const err = estimateFilledValueErrors(payload);
    if (err) {
      setShowErrors(true);
      setBanner(err);
      const invalid = ESTIMATE_LINE_KEYS.find((key) => estimateLineHasInvalidValues(key, payload.lines[key]));
      if (invalid) setActiveLine(invalid);
      return;
    }
    setBanner('');
    await onSave(payload);
  }

  async function handleComplete() {
    const payload = { ...draft, totals };
    const err = estimateCompletenessError(payload);
    if (err) {
      setShowErrors(true);
      setBanner(err);
      const first = firstIncompleteLine(payload);
      if (first) setActiveLine(first);
      return;
    }
    setBanner('');
    await onSave(payload);
    await onComplete();
  }

  const line = draft.lines[activeLine];
  const lineDone = estimateLineIsComplete(activeLine, line);

  return (
    <div className="space-y-4 [overflow-anchor:none]">
      <div className="wb-card-pad space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-600 dark:text-cyan-400">
              Estimate survey
            </p>
            <h3 className="font-display mt-1 text-lg font-semibold text-ink">Cost Estimate</h3>
            <p className="wb-page-subtitle">
              Work through each cost line. Choose a type, then enter actual cost and Year 1–3. Completing this step
              moves the use case to ROI.
            </p>
            {(estimateOwnerLabel || dueDate || assignedByName || completed) && (
              <p className="mt-2 text-xs text-ink-subtle">
                {estimateOwnerLabel ? `Owner: ${estimateOwnerLabel}` : ''}
                {assignedByName ? ` · Assigned by ${assignedByName}` : ''}
                {dueDate ? ` · Due ${new Date(dueDate).toLocaleDateString()}` : ''}
                {completed ? ' · Completed' : ''}
              </p>
            )}
          </div>
          <div className="w-full shrink-0 rounded-2xl border border-line bg-surface-muted/50 p-3 sm:max-w-xs">
            <div className="flex items-center justify-between text-xs font-medium text-ink-muted">
              <span>Lines complete</span>
              <span className="tabular-nums text-ink">
                {progress.done}/{progress.total}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full rounded-full bg-cyan-500 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {vendorBuild && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                Vendor checklist {vendorProgress.done}/{vendorProgress.total}
              </p>
            )}
            <label htmlFor="estimate-currency" className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Currency *
            </label>
            <div className="mt-1">
              <SelectMenu
                id="estimate-currency"
                value={draft.currency}
                disabled={!canEdit}
                onChange={(currency) => setDraft((prev) => ({ ...prev, currency }))}
                options={CURRENCY_OPTIONS.map((c) => ({ value: c, label: c }))}
                aria-label="Currency"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
        <nav className="hidden lg:block" aria-label="Cost lines">
          <ul className="space-y-2">
            {ESTIMATE_LINE_KEYS.map((key) => {
              const current = draft.lines[key];
              const nav = lineNavState(
                key,
                draft,
                showErrors || lineWasTouched(key, touched) || estimateLineHasInvalidValues(key, current)
              );
              const selected = activeLine === key;
              const yearTotal = lineYearTotal(current);
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => setActiveLine(key)}
                    aria-current={selected ? 'true' : undefined}
                    className={`flex min-h-[4.75rem] w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left ${lineTabClass(nav.tone, selected)}`}
                  >
                    <LineStatusIcon tone={nav.tone} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="block text-sm font-medium text-ink">{ESTIMATE_LINE_LABELS[key]}</span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                          nav.issueCount > 0 ? '' : 'invisible'
                        } ${
                          nav.tone === 'error'
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-200'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200'
                        }`}
                      >
                        {nav.issueCount || 0}
                      </span>
                      </span>
                      <span className={`mt-0.5 block min-h-8 text-xs leading-4 ${lineHintClass(nav.tone)}`}>
                        {nav.hint}
                        {nav.tone === 'ok' && yearTotal > 0 ? ` · ${formatMoney(yearTotal)}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="space-y-3">
          <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
            {ESTIMATE_LINE_KEYS.map((key) => {
              const current = draft.lines[key];
              const nav = lineNavState(
                key,
                draft,
                showErrors || lineWasTouched(key, touched) || estimateLineHasInvalidValues(key, current)
              );
              const selected = activeLine === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveLine(key)}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition ${mobileChipClass(nav.tone, selected)}`}
                >
                  {nav.tone === 'error' && <AlertCircle className="h-3.5 w-3.5" />}
                  {nav.tone === 'warn' && <AlertTriangle className="h-3.5 w-3.5" />}
                  {ESTIMATE_LINE_LABELS[key].replace(' Cost', '')}
                  {nav.issueCount > 0 ? <span className="tabular-nums">({nav.issueCount})</span> : null}
                </button>
              );
            })}
          </div>

          <section
            className={`min-h-[32rem] rounded-2xl border p-4 sm:min-h-[28rem] sm:p-5 ${
              lineDone
                ? 'border-emerald-400/50 bg-emerald-500/5'
                : typeError || Object.keys(filledErrors).length
                ? 'border-red-400/60 bg-red-500/5'
                : 'border-line bg-surface-elevated'
            }`}
          >
            <div className="mb-4 flex min-h-[4.5rem] items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                  Line {activeIndex + 1} of {ESTIMATE_LINE_KEYS.length}
                </p>
                <h4 className="font-display mt-0.5 min-h-7 text-base font-semibold text-ink sm:text-lg">
                  {ESTIMATE_LINE_LABELS[activeLine]}
                </h4>
                <p className="mt-0.5 min-h-10 text-xs text-ink-muted sm:text-sm">{LINE_HINTS[activeLine]}</p>
              </div>
              {lineDone ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
              ) : (
                <Circle className="h-5 w-5 shrink-0 text-ink-subtle" />
              )}
            </div>

            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Type *</p>
            <div
              className="mb-1 flex min-h-11 flex-wrap gap-2"
              role="radiogroup"
              aria-label={`${ESTIMATE_LINE_LABELS[activeLine]} type`}
            >
              {ESTIMATE_LINE_TYPES[activeLine].map((opt) => {
                const selected = line.type === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => {
                      markTouched(activeLine, 'type');
                      updateLine(activeLine, { type: opt });
                    }}
                    className={`min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition ${
                      selected
                        ? 'border-cyan-500 bg-cyan-500/15 text-ink ring-2 ring-cyan-400/40'
                        : 'border-line text-ink-muted hover:border-cyan-400/50'
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            <p className="mb-3 min-h-4 text-xs text-red-600 dark:text-red-400">{typeError || '\u00a0'}</p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(['actual_cost', 'year1', 'year2', 'year3'] as MoneyField[]).map((field) => {
                const fieldKey = `${activeLine}:${field}`;
                const requiredHint =
                  (showErrors || touched[fieldKey]) && line[field] == null ? 'This amount is required.' : undefined;
                return (
                  <MoneyInput
                    key={field}
                    id={`${activeLine}-${field}`}
                    label={MONEY_FIELD_LABELS[field]}
                    value={line[field]}
                    currency={draft.currency}
                    disabled={!canEdit}
                    error={filledErrors[field] || requiredHint}
                    onCommit={(next) => {
                      markTouched(activeLine, field);
                      updateLine(activeLine, { [field]: next });
                    }}
                  />
                );
              })}
            </div>

            <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-ink-muted">
                This line Y1–Y3:{' '}
                <span className="font-semibold text-ink">{formatMoney(lineYearTotal(line))}</span>
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => goLine(-1)}
                  className="wb-btn-secondary min-h-11 flex-1 sm:flex-none"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => goLine(1)}
                  className="wb-btn-secondary min-h-11 flex-1 sm:flex-none"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      {vendorBuild && (
        <div
          className="rounded-2xl border border-amber-300/80 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/20 sm:p-5"
        >
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Vendor assessment checklist
              </h4>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                Build Cost is Vendor. Answer each question before completing the estimate.
              </p>
            </div>
            <span className="text-xs font-medium tabular-nums text-amber-800 dark:text-amber-200">
              {vendorProgress.done}/{vendorProgress.total} answered
            </span>
          </div>
          <ul className="space-y-2">
            {VENDOR_ASSESSMENT_QUESTIONS.map((q, idx) => {
              const value = draft.vendor_checklist[q.id];
              const missing = showErrors && value !== 'yes' && value !== 'no' && value !== 'na';
              return (
                <li
                  key={q.id}
                  className={`rounded-xl border p-3 ${
                    missing
                      ? 'border-red-400 bg-white dark:bg-slate-900/60'
                      : 'border-amber-200/80 bg-white/80 dark:border-amber-800/80 dark:bg-slate-900/40'
                  }`}
                >
                  <p className="text-sm text-slate-800 dark:text-slate-200">
                    {idx + 1}. {q.question}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['yes', 'no', 'na'] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        disabled={!canEdit}
                        onClick={() => updateVendorCheck(q.id, opt)}
                        className={`min-h-11 rounded-full border px-4 py-2 text-sm font-medium ${
                          value === opt
                            ? 'border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100'
                            : 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'
                        } disabled:opacity-60`}
                      >
                        {opt === 'yes' ? 'Yes' : opt === 'no' ? 'No' : 'N/A'}
                      </button>
                    ))}
                  </div>
                  {missing ? (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">Select Yes, No, or N/A.</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="sticky bottom-3 z-10 rounded-2xl border border-line bg-surface-elevated/95 p-3 shadow-lg backdrop-blur sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-ink-muted">Projected investment (Y1–Y3)</p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-ink">
                <span>Y1 {formatMoney(totals.year1)}</span>
                <span>Y2 {formatMoney(totals.year2)}</span>
                <span>Y3 {formatMoney(totals.year3)}</span>
                <span className="text-cyan-600 dark:text-cyan-400">
                  Total {formatMoney(totals.year1 + totals.year2 + totals.year3)}
                </span>
              </div>
            </div>
          </div>
          {(canEdit || canComplete) && (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {canEdit && (
                <button type="button" disabled={saving} onClick={handleSave} className="wb-btn-secondary min-h-11">
                  {saving ? 'Saving…' : 'Save estimate'}
                </button>
              )}
              {canComplete && (
                <button
                  type="button"
                  disabled={completing || saving}
                  onClick={handleComplete}
                  className="wb-btn-primary min-h-11"
                >
                  {completing ? 'Completing…' : 'Complete → ROI'}
                </button>
              )}
            </div>
          )}
        </div>
        {banner && (
          <p className="mt-3 flex items-start gap-2 text-sm font-medium text-red-600 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {banner}
          </p>
        )}
        {showErrors && missingHints.length > 0 && (
          <p className="mt-2 text-xs text-ink-muted">
            Still needed: {missingHints.slice(0, 4).join(' · ')}
            {missingHints.length > 4 ? ` · +${missingHints.length - 4} more` : ''}
          </p>
        )}
      </div>
    </div>
  );
}
