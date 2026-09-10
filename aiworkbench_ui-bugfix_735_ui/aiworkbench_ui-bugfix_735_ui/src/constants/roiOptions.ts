import { CURRENCY_OPTIONS, validateMoneyValue } from './estimateOptions';

export const ROI_SAVING_CATEGORIES = [
  'Labor / FTE Savings',
  'Productivity Benefits',
  'Avoided Cost',
  'Error Reduction',
  'Revenue Benefit',
  'Other',
] as const;

export type RoiSavingCategory = (typeof ROI_SAVING_CATEGORIES)[number];

export interface RoiRow {
  id: string;
  category: string | null;
  description: string;
  year1: number | null;
  year2: number | null;
  year3: number | null;
}

export interface RoiData {
  currency: string;
  rows: RoiRow[];
  totals: { year1: number; year2: number; year3: number; total: number };
  investment_total: number;
  roi_percent: number | null;
}

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `roi-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyRoiRow(category: string | null = null): RoiRow {
  return { id: newId(), category, description: '', year1: null, year2: null, year3: null };
}

export function emptyRoiData(currency = 'USD'): RoiData {
  return {
    currency,
    rows: [],
    totals: { year1: 0, year2: 0, year3: 0, total: 0 },
    investment_total: 0,
    roi_percent: null,
  };
}

export function computeRoiTotals(rows: RoiRow[]) {
  const totals = { year1: 0, year2: 0, year3: 0 };
  for (const row of rows) {
    for (const year of ['year1', 'year2', 'year3'] as const) {
      const v = row[year];
      totals[year] += typeof v === 'number' && !Number.isNaN(v) ? v : 0;
    }
  }
  const total = totals.year1 + totals.year2 + totals.year3;
  return {
    year1: Math.round(totals.year1 * 100) / 100,
    year2: Math.round(totals.year2 * 100) / 100,
    year3: Math.round(totals.year3 * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

export function computeRoiPercent(totalSavings: number, investmentTotal: number): number | null {
  if (!investmentTotal || investmentTotal <= 0) return null;
  return Math.round(((totalSavings - investmentTotal) / investmentTotal) * 10000) / 100;
}

export function rowYearTotal(row: RoiRow): number {
  let sum = 0;
  for (const value of [row.year1, row.year2, row.year3]) {
    if (typeof value === 'number' && Number.isFinite(value)) sum += value;
  }
  return sum;
}

export function roiRowErrors(
  row: RoiRow,
  required: boolean
): Partial<Record<'category' | 'description' | 'year1' | 'year2' | 'year3' | 'years', string>> {
  const errors: Partial<Record<'category' | 'description' | 'year1' | 'year2' | 'year3' | 'years', string>> = {};
  if (row.category && !ROI_SAVING_CATEGORIES.includes(row.category as RoiSavingCategory)) {
    errors.category = 'Choose a valid category.';
  } else if (required && !row.category) {
    errors.category = 'Select a category.';
  }
  if (required && !row.description.trim()) {
    errors.description = 'Describe the benefit.';
  }
  for (const year of ['year1', 'year2', 'year3'] as const) {
    const err = validateMoneyValue(row[year], false);
    if (err) errors[year] = err;
  }
  const hasYear = [row.year1, row.year2, row.year3].some((v) => v != null);
  if (required && !hasYear) errors.years = 'Enter at least one year of savings.';
  return errors;
}

export function roiRowIsComplete(row: RoiRow): boolean {
  return Object.keys(roiRowErrors(row, true)).length === 0;
}

export function roiFilledValueErrors(data: RoiData): string | null {
  for (let i = 0; i < data.rows.length; i += 1) {
    const errors = roiRowErrors(data.rows[i], false);
    const first = Object.values(errors)[0];
    if (first) return `Row ${i + 1}: ${first}`;
  }
  return null;
}

export function roiCompletenessError(data: RoiData): string | null {
  const filled = roiFilledValueErrors(data);
  if (filled) return filled;
  if (!data.rows.length) return 'Add at least one savings row before completing ROI.';
  for (let i = 0; i < data.rows.length; i += 1) {
    const errors = roiRowErrors(data.rows[i], true);
    const first = Object.values(errors)[0];
    if (first) return `Row ${i + 1}: ${first}`;
  }
  return null;
}

export function normalizeRoiData(raw: any, defaultCurrency = 'USD', investmentTotal = 0): RoiData {
  const base = emptyRoiData(defaultCurrency);
  if (!raw || typeof raw !== 'object') {
    base.investment_total = investmentTotal;
    base.roi_percent = computeRoiPercent(0, investmentTotal);
    return base;
  }
  const currencyRaw = String(raw.currency || defaultCurrency || 'USD').toUpperCase();
  base.currency = CURRENCY_OPTIONS.includes(currencyRaw) ? currencyRaw : defaultCurrency;
  const rowsIn = Array.isArray(raw.rows) ? raw.rows : [];
  base.rows = rowsIn.map((src: any) => {
    const parseYear = (v: unknown) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      id: String(src?.id || newId()),
      category: ROI_SAVING_CATEGORIES.includes(src?.category) ? src.category : null,
      description: String(src?.description || ''),
      year1: parseYear(src?.year1),
      year2: parseYear(src?.year2),
      year3: parseYear(src?.year3),
    };
  });
  base.totals = computeRoiTotals(base.rows);
  const inv =
    investmentTotal > 0
      ? investmentTotal
      : Number(raw.investment_total) || 0;
  base.investment_total = Math.round(inv * 100) / 100;
  base.roi_percent = computeRoiPercent(base.totals.total, base.investment_total);
  return base;
}
