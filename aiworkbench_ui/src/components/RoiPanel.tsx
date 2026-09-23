import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Plus, Trash2, Wallet } from 'lucide-react';
import SelectMenu from './SelectMenu';
import { parseMoneyInput, sanitizeMoneyTyping } from '../constants/estimateOptions';
import {
  ROI_SAVING_CATEGORIES,
  computeRoiPercent,
  computeRoiTotals,
  emptyRoiRow,
  normalizeRoiData,
  roiCompletenessError,
  roiFilledValueErrors,
  roiRowErrors,
  type RoiData,
  type RoiRow,
} from '../constants/roiOptions';

interface RoiPanelProps {
  roiData: any;
  defaultCurrency?: string;
  investmentTotal?: number;
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

export default function RoiPanel({
  roiData,
  defaultCurrency = 'USD',
  investmentTotal = 0,
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
  const investment = investmentTotal;
  const roiPercent = useMemo(
    () => computeRoiPercent(totals.total, investment),
    [totals.total, investment]
  );
  const completionError = roiCompletenessError({
    ...draft,
    totals,
    investment_total: investment,
    roi_percent: roiPercent,
  });

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

  function addRow() {
    setDraft((prev) => ({ ...prev, rows: [...prev.rows, emptyRoiRow()] }));
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
    roiPercent == null
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
              Capture savings by category for Year 1–3. ROI % compares total savings to the 3-year Estimate
              investment (Year 1 + Year 2 + Year 3).
            </p>
          </div>
          <div className="w-full shrink-0 rounded-2xl border border-line bg-surface-muted/50 p-3 sm:max-w-xs">
            <div className="flex items-center justify-between text-xs font-medium text-ink-muted">
              <span>Savings rows</span>
              <span className="tabular-nums text-ink">{draft.rows.length}</span>
            </div>
            <p className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Currency
            </p>
            <div className="mt-1 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-medium text-ink">
              {draft.currency}
            </div>
            <p className="mt-1 text-xs text-ink-subtle">Locked to the completed Estimate currency.</p>
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
          <p className="wb-stat-label">3-year investment (from Estimate)</p>
          <p className="wb-stat-value text-2xl">{formatMoney(investment)}</p>
          <p className="mt-1 text-xs text-ink-subtle">Year 1 + Year 2 + Year 3 from Estimate</p>
        </div>
        <div className="wb-stat">
          <p className="wb-stat-label">3-year total savings</p>
          <p className="wb-stat-value text-2xl">{formatMoney(totals.total)}</p>
          <p className="mt-1 text-xs text-ink-subtle">Sum of all savings rows</p>
        </div>
        <div className="wb-stat">
          <p className="wb-stat-label">ROI %</p>
          <p className={`wb-stat-value text-2xl ${roiTone}`}>
            {roiPercent == null ? 'N/A' : `${roiPercent.toFixed(2)}%`}
          </p>
          <p className="mt-1 text-xs text-ink-subtle">
            {roiPercent == null ? 'Not applicable when investment is zero' : '(savings − investment) / investment'}
          </p>
        </div>
      </div>

      {expectedBenefits ? (
        <div className="rounded-2xl border border-line bg-surface-muted/40 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Registered expected benefits
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{expectedBenefits}</p>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface-elevated">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted/60 text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2.5 font-semibold">Saving category *</th>
              <th className="px-3 py-2.5 font-semibold">Benefit description *</th>
              <th className="px-3 py-2.5 font-semibold">Year 1</th>
              <th className="px-3 py-2.5 font-semibold">Year 2</th>
              <th className="px-3 py-2.5 font-semibold">Year 3</th>
              {canEdit && <th className="px-3 py-2.5 font-semibold w-12" />}
            </tr>
          </thead>
          <tbody>
            {draft.rows.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="px-3 py-8 text-center text-ink-muted italic">
                  No savings rows yet. Add a row to start. Totals and ROI % update as you type.
                </td>
              </tr>
            )}
            {draft.rows.map((row, idx) => {
              const errors = roiRowErrors(row, showErrors);
              return (
                <tr key={row.id} className="border-t border-line align-top">
                  <td className="px-3 py-3 min-w-[12rem]">
                    <SelectMenu
                      id={`${row.id}-category`}
                      value={row.category || ''}
                      disabled={!canEdit}
                      size="sm"
                      error={!!errors.category}
                      placeholder="Select…"
                      onChange={(category) => updateRow(row.id, { category: category || null })}
                      options={ROI_SAVING_CATEGORIES.map((c) => ({ value: c, label: c }))}
                      aria-label={`Row ${idx + 1} saving category`}
                    />
                    <p className="mt-1 min-h-4 text-[11px] text-red-600 dark:text-red-400">
                      {errors.category || '\u00a0'}
                    </p>
                  </td>
                  <td className="px-3 py-3 min-w-[14rem]">
                    <textarea
                      value={row.description}
                      disabled={!canEdit}
                      rows={2}
                      maxLength={2000}
                      placeholder="How this saving is realized…"
                      onChange={(e) => updateRow(row.id, { description: e.target.value })}
                      className={`wb-input min-h-[4.5rem] ${errors.description ? 'border-red-400' : ''}`}
                    />
                    <span className="mt-1 flex justify-between text-[11px] text-ink-subtle">
                      <span className="text-red-600 dark:text-red-400">{errors.description || '\u00a0'}</span>
                      <span>{row.description.length}/2000</span>
                    </span>
                  </td>
                  {(['year1', 'year2', 'year3'] as const).map((year, yearIdx) => (
                    <td key={year} className="px-3 py-3">
                      <TableMoneyInput
                        id={`${row.id}-${year}`}
                        label={`Row ${idx + 1} Year ${yearIdx + 1}`}
                        value={row[year]}
                        currency={draft.currency}
                        disabled={!canEdit}
                        error={errors[year] || (year === 'year1' ? errors.years : undefined)}
                        onCommit={(next) => updateRow(row.id, { [year]: next })}
                      />
                    </td>
                  ))}
                  {canEdit && (
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        className="rounded-lg p-2 text-ink-subtle hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                        title="Remove row"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
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
              {canEdit && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="sticky bottom-3 z-10 rounded-2xl border border-line bg-surface-elevated/95 p-3 shadow-lg backdrop-blur sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" />
            <div>
              <p className="text-xs font-medium text-ink-muted">Live ROI</p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-ink">
                <span>Savings {formatMoney(totals.total)}</span>
                <span>Investment {formatMoney(investment)}</span>
                <span className={roiTone}>ROI {roiPercent == null ? 'N/A' : `${roiPercent.toFixed(2)}%`}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <button type="button" onClick={addRow} className="wb-btn-secondary min-h-11">
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
                disabled={completing || saving || !!completionError}
                onClick={handleComplete}
                className="wb-btn-primary min-h-11"
                title={completionError || 'Complete ROI and move to AI Assessment'}
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
        {canComplete && completionError && !banner && (
          <p className="mt-3 flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Complete unavailable: {completionError}
          </p>
        )}
      </div>
    </div>
  );
}
