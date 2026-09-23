import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Wallet } from 'lucide-react';
import SelectMenu from './SelectMenu';
import {
  CURRENCY_OPTIONS,
  ESTIMATE_LINE_KEYS,
  ESTIMATE_LINE_LABELS,
  ESTIMATE_LINE_TYPES,
  MONEY_FIELD_LABELS,
  computeEstimateInvestment,
  computeEstimateTotals,
  estimateCompletenessError,
  estimateFilledValueErrors,
  estimateMissingHints,
  estimateProgress,
  lineFieldErrors,
  normalizeEstimateData,
  parseMoneyInput,
  sanitizeMoneyTyping,
  type EstimateData,
  type EstimateLineKey,
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
  return value.toFixed(2);
}

function TableMoneyInput({
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
    <div className="min-w-[7.5rem]">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div
        className={`flex min-h-11 items-center rounded-xl border bg-surface px-2 transition ${
          shownError
            ? 'border-red-400 ring-2 ring-red-400/20'
            : 'border-line focus-within:border-cyan-500 focus-within:ring-2 focus-within:ring-cyan-500/20'
        } ${disabled ? 'opacity-70' : ''}`}
      >
        <span className="shrink-0 pr-1 text-[10px] font-medium text-ink-subtle">{currency}</span>
        <input
          id={id}
          inputMode="decimal"
          type="text"
          autoComplete="off"
          disabled={disabled}
          value={text}
          placeholder=""
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
            setText(parsed.value == null ? '' : moneyToText(parsed.value));
            onCommit(parsed.value);
          }}
          className="min-w-0 flex-1 bg-transparent py-2 text-sm tabular-nums text-ink outline-none disabled:cursor-not-allowed"
        />
      </div>
      <p className="mt-1 min-h-4 text-[11px] text-red-600 dark:text-red-400">{shownError || '\u00a0'}</p>
    </div>
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

  useEffect(() => {
    setDraft(normalizeEstimateData(estimateData, defaultCurrency));
  }, [estimateData, defaultCurrency]);

  const totals = useMemo(() => computeEstimateTotals(draft.lines), [draft.lines]);
  const roiInvestment = useMemo(() => computeEstimateInvestment(draft), [draft]);
  const progress = useMemo(() => estimateProgress(draft), [draft]);
  const progressPct = Math.round((progress.done / progress.total) * 100);
  const missingHints = useMemo(() => estimateMissingHints(draft), [draft]);
  const completionError = useMemo(
    () => estimateCompletenessError({ ...draft, totals }),
    [draft, totals]
  );

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

  async function handleSave() {
    const payload = { ...draft, totals };
    const err = estimateFilledValueErrors(payload);
    if (err) {
      setShowErrors(true);
      setBanner(err);
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
      return;
    }
    setBanner('');
    await onSave(payload);
    await onComplete();
  }

  const moneyFields: MoneyField[] = ['year1', 'year2', 'year3'];

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
              Enter type and Year 1–3 for each cost line. Completing this step moves the use case to ROI.
            </p>
            <p className="mt-2 text-xs text-ink-subtle">
              ROI investment is Year 1 + Year 2 + Year 3. ROI % = (savings − investment) / investment. Zero
              investment shows N/A.
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

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface-elevated">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted/60 text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2.5 font-semibold">Cost line</th>
              <th className="px-3 py-2.5 font-semibold">Type *</th>
              <th className="px-3 py-2.5 font-semibold">Year 1 *</th>
              <th className="px-3 py-2.5 font-semibold">Year 2 *</th>
              <th className="px-3 py-2.5 font-semibold">Year 3 *</th>
            </tr>
          </thead>
          <tbody>
            {ESTIMATE_LINE_KEYS.map((key) => {
              const line = draft.lines[key];
              const filled = lineFieldErrors(key, line, false);
              const required = lineFieldErrors(key, line, true);
              const showLineErrors = showErrors || Object.keys(touched).some((t) => t.startsWith(`${key}:`));
              const typeError =
                filled.type ||
                ((showErrors || touched[`${key}:type`]) && !line.type ? 'Select a type.' : undefined);
              return (
                <tr key={key} className="border-t border-line align-top">
                  <td className="px-3 py-3">
                    <p className="font-medium text-ink whitespace-nowrap">{ESTIMATE_LINE_LABELS[key]}</p>
                    <p className="mt-0.5 max-w-[14rem] text-xs text-ink-muted">{LINE_HINTS[key]}</p>
                    {showLineErrors && required.type && !typeError ? (
                      <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{required.type}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 min-w-[9.5rem]">
                    <SelectMenu
                      id={`${key}-type`}
                      value={line.type || ''}
                      disabled={!canEdit}
                      size="sm"
                      error={!!typeError}
                      placeholder="Select…"
                      onChange={(type) => {
                        markTouched(key, 'type');
                        updateLine(key, { type: type || null });
                      }}
                      options={ESTIMATE_LINE_TYPES[key].map((t) => ({ value: t, label: t }))}
                      aria-label={`${ESTIMATE_LINE_LABELS[key]} type`}
                    />
                    <p className="mt-1 min-h-4 text-[11px] text-red-600 dark:text-red-400">{typeError || '\u00a0'}</p>
                  </td>
                  {moneyFields.map((field) => {
                    const fieldKey = `${key}:${field}`;
                    const requiredHint =
                      (showErrors || touched[fieldKey]) && line[field] == null
                        ? `${ESTIMATE_LINE_LABELS[key]} ${MONEY_FIELD_LABELS[field]} is required.`
                        : undefined;
                    return (
                      <td key={field} className="px-3 py-3">
                        <TableMoneyInput
                          id={`${key}-${field}`}
                          label={`${ESTIMATE_LINE_LABELS[key]} ${MONEY_FIELD_LABELS[field]}`}
                          value={line[field]}
                          currency={draft.currency}
                          disabled={!canEdit}
                          error={filled[field] || requiredHint}
                          onCommit={(next) => {
                            markTouched(key, field);
                            updateLine(key, { [field]: next });
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-surface-muted/40 font-semibold text-ink">
              <td className="px-3 py-3" colSpan={2}>
                Totals
              </td>
              <td className="px-3 py-3 tabular-nums">{formatMoney(totals.year1)}</td>
              <td className="px-3 py-3 tabular-nums">{formatMoney(totals.year2)}</td>
              <td className="px-3 py-3 tabular-nums">{formatMoney(totals.year3)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="sticky bottom-3 z-10 rounded-2xl border border-line bg-surface-elevated/95 p-3 shadow-lg backdrop-blur sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-ink-muted">Estimate totals</p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-ink">
                <span>Y1 {formatMoney(totals.year1)}</span>
                <span>Y2 {formatMoney(totals.year2)}</span>
                <span>Y3 {formatMoney(totals.year3)}</span>
                <span className="text-cyan-600 dark:text-cyan-400">
                  Investment {formatMoney(roiInvestment)}
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
                  disabled={completing || saving || !!completionError}
                  onClick={handleComplete}
                  className="wb-btn-primary min-h-11"
                  title={completionError || 'Complete Estimate and move to ROI'}
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
        {canComplete && completionError && !banner && (
          <p className="mt-3 flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Complete unavailable: {completionError}
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
