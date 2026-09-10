import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Plus, Trash2, TrendingUp, Wallet } from 'lucide-react';
import SelectMenu from './SelectMenu';
import { CURRENCY_OPTIONS, parseMoneyInput, sanitizeMoneyTyping } from '../constants/estimateOptions';
import {
  ROI_SAVING_CATEGORIES,
  computeRoiPercent,
  computeRoiTotals,
  emptyRoiRow,
  normalizeRoiData,
  roiCompletenessError,
  roiFilledValueErrors,
  roiRowErrors,
  roiRowIsComplete,
  rowYearTotal,
  type RoiData,
  type RoiRow,
} from '../constants/roiOptions';

interface YearTotals {
  year1: number;
  year2: number;
  year3: number;
}

interface RoiPanelProps {
  roiData: any;
  defaultCurrency?: string;
  investmentTotal?: number;
  investmentByYear?: YearTotals;
  expectedBenefits?: string;
  canEdit: boolean;
  canComplete: boolean;
  completed?: boolean;
  saving?: boolean;
  completing?: boolean;
  needsAssignment?: boolean;
  roiOwnerId?: string | null;
  roiOwnerLabel?: string;
  roiOwnerEmail?: string | null;
  roiOwnerRole?: string | null;
  isCurrentUserOwner?: boolean;
  dueDate?: string | null;
  assignedByName?: string | null;
  onAssignClick?: () => void;
  onSave: (data: RoiData) => void | Promise<void>;
  onComplete: () => void | Promise<void>;
}

function formatDueDate(raw?: string | null) {
  if (!raw) return '';
  const iso = raw.slice(0, 10);
  const parts = iso.split('-').map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString();
}

function moneyToText(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '';
  return String(value);
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
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
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
            setText(parsed.value == null ? '' : moneyToText(parsed.value));
            onCommit(parsed.value);
          }}
          className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-ink outline-none disabled:cursor-not-allowed"
        />
      </div>
      <p className="mt-1 min-h-4 text-xs text-red-600 dark:text-red-400">{shownError || '\u00a0'}</p>
    </label>
  );
}

export default function RoiPanel({
  roiData,
  defaultCurrency = 'USD',
  investmentTotal = 0,
  investmentByYear = { year1: 0, year2: 0, year3: 0 },
  expectedBenefits,
  canEdit,
  canComplete,
  completed = false,
  saving = false,
  completing = false,
  needsAssignment = false,
  roiOwnerId,
  roiOwnerLabel,
  roiOwnerEmail,
  roiOwnerRole,
  isCurrentUserOwner = false,
  dueDate,
  assignedByName,
  onAssignClick,
  onSave,
  onComplete,
}: RoiPanelProps) {
  const [draft, setDraft] = useState<RoiData>(() =>
    normalizeRoiData(roiData, defaultCurrency, investmentTotal)
  );
  const [showErrors, setShowErrors] = useState(false);
  const [banner, setBanner] = useState('');

  useEffect(() => {
    setDraft(normalizeRoiData(roiData, defaultCurrency, investmentTotal));
  }, [roiData, defaultCurrency, investmentTotal]);

  const totals = useMemo(() => computeRoiTotals(draft.rows), [draft.rows]);
  const investment = investmentTotal > 0 ? investmentTotal : draft.investment_total;
  const roiPercent = useMemo(
    () => computeRoiPercent(totals.total, investment),
    [totals.total, investment]
  );
  const hasAnySavings = draft.rows.some((row) => rowYearTotal(row) > 0);
  const completeCount = draft.rows.filter(roiRowIsComplete).length;

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

  function payload(): RoiData {
    return {
      ...draft,
      totals,
      investment_total: investment,
      roi_percent: roiPercent,
    };
  }

  function updateRow(id: string, patch: Partial<RoiRow>) {
    setDraft((prev) => {
      const rows = prev.rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
      const nextTotals = computeRoiTotals(rows);
      return {
        ...prev,
        rows,
        totals: nextTotals,
        roi_percent: computeRoiPercent(nextTotals.total, investment),
      };
    });
    setBanner('');
  }

  function addRow(category: string | null = null) {
    setDraft((prev) => ({ ...prev, rows: [...prev.rows, emptyRoiRow(category)] }));
    setBanner('');
  }

  function removeRow(id: string) {
    setDraft((prev) => {
      const rows = prev.rows.filter((r) => r.id !== id);
      const nextTotals = computeRoiTotals(rows);
      return {
        ...prev,
        rows,
        totals: nextTotals,
        roi_percent: computeRoiPercent(nextTotals.total, investment),
      };
    });
  }

  async function handleSave() {
    const next = payload();
    const err = roiFilledValueErrors(next);
    if (err) {
      setShowErrors(true);
      setBanner(err);
      return;
    }
    setBanner('');
    await onSave(next);
  }

  async function handleComplete() {
    const next = payload();
    const err = roiCompletenessError(next);
    if (err) {
      setShowErrors(true);
      setBanner(err);
      return;
    }
    setBanner('');
    await onSave(next);
    await onComplete();
  }

  const roiTone =
    roiPercent == null || !hasAnySavings
      ? 'text-ink'
      : roiPercent >= 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-amber-600 dark:text-amber-400';

  return (
    <div className="space-y-4 [overflow-anchor:none]">
      <div className="wb-card-pad space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-600 dark:text-cyan-400">
              ROI survey
            </p>
            <h3 className="font-display mt-1 text-lg font-semibold text-ink">ROI Worksheet</h3>
            <p className="wb-page-subtitle">
              Add savings by category. ROI % is calculated live from total savings versus the 3-year Estimate
              investment.
            </p>
          </div>
          <div className="w-full shrink-0 rounded-2xl border border-line bg-surface-muted/50 p-3 sm:max-w-xs">
            <div className="flex items-center justify-between text-xs font-medium text-ink-muted">
              <span>Savings rows ready</span>
              <span className="tabular-nums text-ink">
                {completeCount}/{draft.rows.length}
              </span>
            </div>
            <label htmlFor="roi-currency" className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Currency
            </label>
            <div className="mt-1">
              <SelectMenu
                id="roi-currency"
                value={draft.currency}
                disabled={!canEdit}
                onChange={(currency) => setDraft((prev) => ({ ...prev, currency }))}
                options={CURRENCY_OPTIONS.map((c) => ({ value: c, label: c }))}
                aria-label="Currency"
              />
            </div>
          </div>
        </div>

        {roiOwnerId && roiOwnerLabel && !needsAssignment && (
          <div
            className={`rounded-xl border px-4 py-3 ${
              isCurrentUserOwner
                ? 'border-emerald-300/80 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20'
                : 'border-line bg-surface-muted/40'
            }`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              {isCurrentUserOwner ? 'You own this ROI worksheet' : 'Assigned ROI owner'}
            </p>
            <p className="mt-1 text-sm font-semibold text-ink">{roiOwnerLabel}</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {roiOwnerEmail || ''}
              {roiOwnerRole ? `${roiOwnerEmail ? ' · ' : ''}${roiOwnerRole}` : ''}
            </p>
            <p className="mt-2 text-xs text-ink-subtle">
              {assignedByName ? `Assigned by ${assignedByName}` : ''}
              {dueDate ? `${assignedByName ? ' · ' : ''}Due ${formatDueDate(dueDate)}` : ''}
              {completed ? ' · Completed' : ''}
            </p>
            <p className="mt-2 text-xs text-ink-muted">
              {isCurrentUserOwner
                ? 'You can add savings rows, save, and complete ROI.'
                : 'Only this person can edit the savings grid. Governors can reassign if needed.'}
            </p>
          </div>
        )}

        {needsAssignment && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/80 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
            <span>
              {onAssignClick
                ? 'Assign an ROI owner before editing the savings grid.'
                : 'Waiting for an ROI owner. Only a portal admin, domain owner, or AI leader can assign ROI.'}
            </span>
            {onAssignClick && (
              <button type="button" onClick={onAssignClick} className="wb-btn-primary min-h-11 bg-amber-600 hover:bg-amber-700">
                Assign ROI
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="wb-stat">
          <p className="wb-stat-label">3-year investment</p>
          <p className="wb-stat-value text-2xl">{formatMoney(investment)}</p>
          <p className="mt-1 text-xs text-ink-subtle">From completed Estimate (Y1–Y3)</p>
        </div>
        <div className="wb-stat">
          <p className="wb-stat-label">3-year total savings</p>
          <p className="wb-stat-value text-2xl">{formatMoney(totals.total)}</p>
          <p className="mt-1 text-xs text-ink-subtle">Sum of all savings rows</p>
        </div>
        <div className="wb-stat">
          <p className="wb-stat-label">ROI %</p>
          <p className={`wb-stat-value text-2xl ${roiTone}`}>
            {roiPercent == null || !hasAnySavings ? '—' : `${roiPercent.toFixed(2)}%`}
          </p>
          <p className="mt-1 text-xs text-ink-subtle">(savings − investment) / investment</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted/60 text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2 font-semibold"> </th>
              <th className="px-3 py-2 font-semibold">Year 1</th>
              <th className="px-3 py-2 font-semibold">Year 2</th>
              <th className="px-3 py-2 font-semibold">Year 3</th>
              <th className="px-3 py-2 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody className="text-ink">
            <tr className="border-t border-line">
              <td className="px-3 py-2 text-ink-muted">Investment (Estimate)</td>
              <td className="px-3 py-2 tabular-nums">{formatMoney(investmentByYear.year1)}</td>
              <td className="px-3 py-2 tabular-nums">{formatMoney(investmentByYear.year2)}</td>
              <td className="px-3 py-2 tabular-nums">{formatMoney(investmentByYear.year3)}</td>
              <td className="px-3 py-2 tabular-nums font-medium">{formatMoney(investment)}</td>
            </tr>
            <tr className="border-t border-line">
              <td className="px-3 py-2 text-ink-muted">Savings (this worksheet)</td>
              <td className="px-3 py-2 tabular-nums">{formatMoney(totals.year1)}</td>
              <td className="px-3 py-2 tabular-nums">{formatMoney(totals.year2)}</td>
              <td className="px-3 py-2 tabular-nums">{formatMoney(totals.year3)}</td>
              <td className="px-3 py-2 tabular-nums font-medium">{formatMoney(totals.total)}</td>
            </tr>
            <tr className="border-t border-line bg-surface-muted/40 font-medium">
              <td className="px-3 py-2">Net (savings − investment)</td>
              <td className="px-3 py-2 tabular-nums">{formatMoney(totals.year1 - investmentByYear.year1)}</td>
              <td className="px-3 py-2 tabular-nums">{formatMoney(totals.year2 - investmentByYear.year2)}</td>
              <td className="px-3 py-2 tabular-nums">{formatMoney(totals.year3 - investmentByYear.year3)}</td>
              <td className="px-3 py-2 tabular-nums">{formatMoney(totals.total - investment)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {expectedBenefits ? (
        <div className="rounded-2xl border border-line bg-surface-muted/40 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Registered expected benefits
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{expectedBenefits}</p>
        </div>
      ) : null}

      {draft.rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-6 text-center">
          <TrendingUp className="mx-auto h-8 w-8 text-cyan-500" />
          <p className="mt-2 text-sm font-medium text-ink">No savings captured yet</p>
          <p className="mt-1 text-xs text-ink-muted">
            Add a category to start. Totals and ROI % update as you type.
          </p>
          {canEdit && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {ROI_SAVING_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => addRow(cat)}
                  className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-muted hover:border-cyan-400/50"
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {draft.rows.map((row, idx) => {
            const done = roiRowIsComplete(row);
            const errors = roiRowErrors(row, showErrors);
            const invalid = Object.keys(roiRowErrors(row, false)).length > 0;
            return (
              <section
                key={row.id}
                className={`rounded-2xl border p-4 sm:p-5 ${
                  done
                    ? 'border-emerald-400/50 bg-emerald-500/5'
                    : invalid || (showErrors && Object.keys(errors).length)
                    ? 'border-red-400/60 bg-red-500/5'
                    : 'border-line bg-surface-elevated'
                }`}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                      Savings {idx + 1} of {draft.rows.length}
                    </p>
                    <h4 className="mt-0.5 text-sm font-semibold text-ink">{row.category || 'Select a category'}</h4>
                  </div>
                  <div className="flex items-center gap-2">
                    {done ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    ) : (
                      <span className="text-xs text-ink-subtle">{formatMoney(rowYearTotal(row))}</span>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        className="rounded-lg p-2 text-ink-subtle hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                        title="Remove row"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Category *</p>
                <div className="mb-1 flex flex-wrap gap-2">
                  {ROI_SAVING_CATEGORIES.map((cat) => {
                    const selected = row.category === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        disabled={!canEdit}
                        onClick={() => updateRow(row.id, { category: cat })}
                        className={`min-h-11 rounded-full border px-3 py-2 text-xs font-medium sm:text-sm ${
                          selected
                            ? 'border-cyan-500 bg-cyan-500/15 text-ink ring-2 ring-cyan-400/40'
                            : 'border-line text-ink-muted hover:border-cyan-400/50'
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
                <p className="mb-3 min-h-4 text-xs text-red-600 dark:text-red-400">{errors.category || '\u00a0'}</p>

                <label className="mb-3 block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                    Benefit description *
                  </span>
                  <textarea
                    value={row.description}
                    disabled={!canEdit}
                    rows={2}
                    maxLength={2000}
                    placeholder="How this saving is realized…"
                    onChange={(e) => updateRow(row.id, { description: e.target.value })}
                    className={`wb-input min-h-[4.5rem] ${
                      errors.description ? 'border-red-400' : ''
                    }`}
                  />
                  <span className="mt-1 flex justify-between text-[11px] text-ink-subtle">
                    <span className="text-red-600 dark:text-red-400">{errors.description || '\u00a0'}</span>
                    <span>{row.description.length}/2000</span>
                  </span>
                </label>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {(['year1', 'year2', 'year3'] as const).map((year, yearIdx) => (
                    <MoneyInput
                      key={year}
                      id={`${row.id}-${year}`}
                      label={`Year ${yearIdx + 1}`}
                      value={row[year]}
                      currency={draft.currency}
                      disabled={!canEdit}
                      error={errors[year] || (year === 'year1' ? errors.years : undefined)}
                      onCommit={(next) => updateRow(row.id, { [year]: next })}
                    />
                  ))}
                </div>
                <p className="text-sm text-ink-muted">
                  This row Y1–Y3: <span className="font-semibold text-ink">{formatMoney(rowYearTotal(row))}</span>
                </p>
              </section>
            );
          })}
        </div>
      )}

      <div className="sticky bottom-3 z-10 rounded-2xl border border-line bg-surface-elevated/95 p-3 shadow-lg backdrop-blur sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" />
            <div>
              <p className="text-xs font-medium text-ink-muted">Live ROI</p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-ink">
                <span>Savings {formatMoney(totals.total)}</span>
                <span>Investment {formatMoney(investment)}</span>
                <span className={roiTone}>
                  ROI {roiPercent == null || !hasAnySavings ? '—' : `${roiPercent.toFixed(2)}%`}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <button type="button" onClick={() => addRow()} className="wb-btn-secondary min-h-11">
                <Plus className="h-4 w-4" />
                Add savings row
              </button>
            )}
            {canEdit && (
              <button type="button" disabled={saving} onClick={handleSave} className="wb-btn-secondary min-h-11">
                {saving ? 'Saving…' : 'Save ROI'}
              </button>
            )}
            {canComplete && (
              <button
                type="button"
                disabled={completing || saving}
                onClick={handleComplete}
                className="wb-btn-primary min-h-11"
              >
                {completing ? 'Completing…' : 'Complete → AI Assessment'}
              </button>
            )}
          </div>
        </div>
        {banner && (
          <p className="mt-3 flex items-start gap-2 text-sm font-medium text-red-600 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {banner}
          </p>
        )}
      </div>
    </div>
  );
}
