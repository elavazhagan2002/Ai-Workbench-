export const ESTIMATE_LINE_KEYS = [
  'infra',
  'build',
  'validation',
  'support',
  'llm_token',
  'change_management',
] as const;

export type EstimateLineKey = (typeof ESTIMATE_LINE_KEYS)[number];

export const ESTIMATE_LINE_LABELS: Record<EstimateLineKey, string> = {
  infra: 'Infra Cost',
  build: 'Build Cost',
  validation: 'Validation/Testing Cost',
  support: 'Support Cost',
  llm_token: 'LLM Token Cost',
  change_management: 'Change Management Cost',
};

export const ESTIMATE_LINE_TYPES: Record<EstimateLineKey, string[]> = {
  infra: ['Cloud', 'On-Premise'],
  build: ['Inhouse', 'Vendor'],
  validation: ['Internal', 'External'],
  support: ['Inhouse', 'Vendor'],
  llm_token: ['Claude', 'Azure', 'Others'],
  change_management: ['High', 'Medium', 'Low'],
};

export const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'INR', 'AED', 'SGD', 'JPY', 'AUD', 'CAD'];

/** Recommended vendor evaluation questions when Build Cost type is Vendor. */
export const VENDOR_ASSESSMENT_QUESTIONS = [
  {
    id: 'vendor_legal_entity',
    question: 'Is the vendor a legally registered entity with a named contracting party and jurisdiction?',
  },
  {
    id: 'vendor_security_certs',
    question: 'Does the vendor hold current security certifications (e.g. ISO 27001, SOC 2) relevant to this use case?',
  },
  {
    id: 'vendor_data_residency',
    question: 'Can the vendor confirm data residency, processing locations, and subprocessors for this solution?',
  },
  {
    id: 'vendor_no_train_on_data',
    question: 'Will customer data and prompts be excluded from model training unless explicitly contracted?',
  },
  {
    id: 'vendor_privacy_dpa',
    question: 'Is a Data Processing Agreement (or equivalent) available covering confidentiality, retention, and deletion?',
  },
  {
    id: 'vendor_access_control',
    question: 'Does the vendor support least-privilege access, SSO/MFA, and audit logs for operator activity?',
  },
  {
    id: 'vendor_model_transparency',
    question: 'Can the vendor describe the model/provider stack, update cadence, and known limitations?',
  },
  {
    id: 'vendor_bias_testing',
    question: 'Has the vendor documented bias, fairness, or safety testing for the intended use?',
  },
  {
    id: 'vendor_sla_support',
    question: 'Are SLA, incident response, and support hours defined for production use?',
  },
  {
    id: 'vendor_ip_exit',
    question: 'Are IP ownership of outputs and an exit plan (data return/deletion) contractually defined?',
  },
] as const;

export interface EstimateLine {
  type: string | null;
  actual_cost: number | null;
  year1: number | null;
  year2: number | null;
  year3: number | null;
}

export interface EstimateData {
  currency: string;
  lines: Record<EstimateLineKey, EstimateLine>;
  totals: { year1: number; year2: number; year3: number };
  vendor_checklist: Record<string, 'yes' | 'no' | 'na'>;
}

export function emptyEstimateLine(): EstimateLine {
  return { type: null, actual_cost: null, year1: null, year2: null, year3: null };
}

export function emptyEstimateData(currency = 'USD'): EstimateData {
  const lines = {} as Record<EstimateLineKey, EstimateLine>;
  for (const key of ESTIMATE_LINE_KEYS) {
    lines[key] = emptyEstimateLine();
  }
  return { currency, lines, totals: { year1: 0, year2: 0, year3: 0 }, vendor_checklist: {} };
}

export function isVendorBuild(data: EstimateData | null | undefined): boolean {
  return (data?.lines?.build?.type || '').toLowerCase() === 'vendor';
}

export function computeEstimateTotals(lines: Record<EstimateLineKey, EstimateLine>) {
  const totals = { year1: 0, year2: 0, year3: 0 };
  for (const key of ESTIMATE_LINE_KEYS) {
    const line = lines[key] || emptyEstimateLine();
    for (const year of ['year1', 'year2', 'year3'] as const) {
      const val = line[year];
      totals[year] += typeof val === 'number' && !Number.isNaN(val) ? val : 0;
    }
  }
  return {
    year1: Math.round(totals.year1 * 100) / 100,
    year2: Math.round(totals.year2 * 100) / 100,
    year3: Math.round(totals.year3 * 100) / 100,
  };
}

export const MAX_ESTIMATE_AMOUNT = 999_999_999_999.99;

export type MoneyField = 'actual_cost' | 'year1' | 'year2' | 'year3';

export const MONEY_FIELD_LABELS: Record<MoneyField, string> = {
  actual_cost: 'Actual cost',
  year1: 'Year 1',
  year2: 'Year 2',
  year3: 'Year 3',
};

export function validateCurrency(currency: string, required = false): string | null {
  const value = (currency || '').trim().toUpperCase();
  if (!value) return required ? 'Select a currency.' : null;
  if (!CURRENCY_OPTIONS.includes(value)) return 'Choose a valid currency.';
  return null;
}

export function sanitizeMoneyTyping(raw: string): string {
  const cleaned = raw.replace(/[,\s]/g, '').replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned.slice(0, 12);
  const whole = cleaned.slice(0, firstDot).slice(0, 12);
  const fraction = cleaned
    .slice(firstDot + 1)
    .replace(/\./g, '')
    .slice(0, 2);
  return `${whole}.${fraction}`;
}

export function parseMoneyInput(raw: string): { value: number | null; error: string | null } {
  const trimmed = raw.trim().replace(/,/g, '');
  if (trimmed === '' || trimmed === '.') return { value: null, error: null };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    if (/^\d+\.$/.test(trimmed)) return { value: null, error: null };
    return { value: null, error: 'Enter a valid amount.' };
  }
  const value = Number(trimmed);
  return { value, error: validateMoneyValue(value, false) };
}

export function validateMoneyValue(value: number | null, required: boolean): string | null {
  if (value == null) return required ? 'This amount is required.' : null;
  if (!Number.isFinite(value)) return 'Enter a valid number.';
  if (value < 0) return 'Amount cannot be negative.';
  if (value > MAX_ESTIMATE_AMOUNT) return 'Amount is too large.';
  const cents = Math.round(value * 100);
  if (Math.abs(value * 100 - cents) > 1e-6) return 'Use at most 2 decimal places.';
  return null;
}

export function lineFieldErrors(
  key: EstimateLineKey,
  line: EstimateLine,
  required: boolean
): Partial<Record<'type' | MoneyField, string>> {
  const errors: Partial<Record<'type' | MoneyField, string>> = {};
  const allowed = ESTIMATE_LINE_TYPES[key];
  if (required && !line.type) errors.type = 'Select a type.';
  else if (line.type && !allowed.includes(line.type)) errors.type = 'Choose a valid type.';
  for (const field of ['actual_cost', 'year1', 'year2', 'year3'] as const) {
    const err = validateMoneyValue(line[field], required);
    if (err) errors[field] = err;
  }
  return errors;
}

export function estimateLineIsComplete(key: EstimateLineKey, line: EstimateLine): boolean {
  return Object.keys(lineFieldErrors(key, line, true)).length === 0;
}

export function estimateLineHasInvalidValues(key: EstimateLineKey, line: EstimateLine): boolean {
  return Object.keys(lineFieldErrors(key, line, false)).length > 0;
}

export function lineYearTotal(line: EstimateLine): number {
  return [line.year1, line.year2, line.year3].reduce(
    (sum, value) => sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0),
    0
  );
}

export type LineNavTone = 'ok' | 'error' | 'warn' | 'idle';

export interface LineNavState {
  tone: LineNavTone;
  hint: string;
  issueCount: number;
}

export function lineNavState(
  key: EstimateLineKey,
  data: EstimateData,
  showWarnings: boolean
): LineNavState {
  const line = data.lines[key] || emptyEstimateLine();
  const invalid = lineFieldErrors(key, line, false);
  const missing = lineFieldErrors(key, line, true);
  const invalidMessages = Object.values(invalid);
  const missingCount = Object.keys(missing).length;

  let extra = 0;
  let extraHint = '';
  if (key === 'build' && isVendorBuild(data)) {
    extra = VENDOR_ASSESSMENT_QUESTIONS.filter((q) => {
      const v = data.vendor_checklist[q.id];
      return v !== 'yes' && v !== 'no' && v !== 'na';
    }).length;
    if (extra) extraHint = `${extra} vendor question${extra === 1 ? '' : 's'} unanswered`;
  }

  if (invalidMessages.length) {
    return {
      tone: 'error',
      hint: extraHint ? `${invalidMessages[0]} · ${extraHint}` : invalidMessages[0],
      issueCount: invalidMessages.length + extra,
    };
  }

  if (missingCount === 0 && extra === 0) {
    return {
      tone: 'ok',
      hint: line.type || 'Complete',
      issueCount: 0,
    };
  }

  const parts: string[] = [];
  if (missing.type) parts.push('Select a type');
  const amountMissing = (['actual_cost', 'year1', 'year2', 'year3'] as const).filter((field) => missing[field]);
  if (amountMissing.length === 4) parts.push('Enter all amounts');
  else if (amountMissing.length === 1) parts.push(`${MONEY_FIELD_LABELS[amountMissing[0]]} required`);
  else if (amountMissing.length > 1) parts.push(`${amountMissing.length} amounts required`);
  if (extraHint) parts.push(extraHint);

  const hint = parts.join(' · ') || 'Incomplete';
  if (showWarnings) {
    return { tone: 'warn', hint, issueCount: missingCount + extra };
  }
  return {
    tone: 'idle',
    hint: line.type || 'Type not selected',
    issueCount: missingCount + extra,
  };
}

export function estimateProgress(data: EstimateData): { done: number; total: number } {
  const done = ESTIMATE_LINE_KEYS.filter((key) => estimateLineIsComplete(key, data.lines[key])).length;
  return { done, total: ESTIMATE_LINE_KEYS.length };
}

export function vendorChecklistProgress(data: EstimateData): { done: number; total: number } {
  const total = VENDOR_ASSESSMENT_QUESTIONS.length;
  const done = VENDOR_ASSESSMENT_QUESTIONS.filter((q) => {
    const v = data.vendor_checklist[q.id];
    return v === 'yes' || v === 'no' || v === 'na';
  }).length;
  return { done, total };
}

export function estimateFilledValueErrors(data: EstimateData): string | null {
  const currencyErr = validateCurrency(data.currency, false);
  if (currencyErr) return currencyErr;
  for (const key of ESTIMATE_LINE_KEYS) {
    const line = data.lines[key] || emptyEstimateLine();
    const errors = lineFieldErrors(key, line, false);
    const first = Object.values(errors)[0];
    if (first) return `${ESTIMATE_LINE_LABELS[key]}: ${first}`;
  }
  if (isVendorBuild(data)) {
    const invalid = VENDOR_ASSESSMENT_QUESTIONS.some((q) => {
      const v = data.vendor_checklist[q.id];
      return v != null && v !== 'yes' && v !== 'no' && v !== 'na';
    });
    if (invalid) return 'Vendor assessment answers must be Yes, No, or N/A.';
  }
  return null;
}

export function estimateCompletenessError(data: EstimateData): string | null {
  const filledErr = estimateFilledValueErrors(data);
  if (filledErr) return filledErr;
  const currencyErr = validateCurrency(data.currency, true);
  if (currencyErr) return currencyErr;
  for (const key of ESTIMATE_LINE_KEYS) {
    const line = data.lines[key] || emptyEstimateLine();
    const errors = lineFieldErrors(key, line, true);
    const first = Object.values(errors)[0];
    if (first) return `${ESTIMATE_LINE_LABELS[key]}: ${first}`;
  }
  if (isVendorBuild(data)) {
    const unanswered = VENDOR_ASSESSMENT_QUESTIONS.some((q) => {
      const v = data.vendor_checklist[q.id];
      return v !== 'yes' && v !== 'no' && v !== 'na';
    });
    if (unanswered) return 'Answer all vendor assessment questions (Yes / No / N/A).';
  }
  return null;
}

export function estimateMissingHints(data: EstimateData): string[] {
  const hints: string[] = [];
  for (const key of ESTIMATE_LINE_KEYS) {
    const line = data.lines[key] || emptyEstimateLine();
    const errors = lineFieldErrors(key, line, true);
    if (errors.type) hints.push(`${ESTIMATE_LINE_LABELS[key]}: type`);
    for (const field of ['actual_cost', 'year1', 'year2', 'year3'] as const) {
      if (errors[field]) hints.push(`${ESTIMATE_LINE_LABELS[key]}: ${MONEY_FIELD_LABELS[field].toLowerCase()}`);
    }
  }
  if (isVendorBuild(data)) {
    const left = VENDOR_ASSESSMENT_QUESTIONS.filter((q) => {
      const v = data.vendor_checklist[q.id];
      return v !== 'yes' && v !== 'no' && v !== 'na';
    }).length;
    if (left) hints.push(`${left} vendor question${left === 1 ? '' : 's'}`);
  }
  return hints;
}

export function firstIncompleteLine(data: EstimateData): EstimateLineKey | null {
  return ESTIMATE_LINE_KEYS.find((key) => !estimateLineIsComplete(key, data.lines[key])) || null;
}

export function normalizeEstimateData(raw: any, defaultCurrency = 'USD'): EstimateData {
  const base = emptyEstimateData(
    CURRENCY_OPTIONS.includes((raw?.currency || defaultCurrency || 'USD').toUpperCase())
      ? (raw?.currency || defaultCurrency).toUpperCase()
      : defaultCurrency
  );
  if (!raw || typeof raw !== 'object') return base;
  const linesIn = raw.lines && typeof raw.lines === 'object' ? raw.lines : {};
  for (const key of ESTIMATE_LINE_KEYS) {
    const src = linesIn[key] && typeof linesIn[key] === 'object' ? linesIn[key] : {};
    const allowed = ESTIMATE_LINE_TYPES[key];
    const lineType = allowed.includes(src.type) ? src.type : null;
    const parseYear = (v: unknown) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    base.lines[key] = {
      type: lineType,
      actual_cost: parseYear(src.actual_cost),
      year1: parseYear(src.year1),
      year2: parseYear(src.year2),
      year3: parseYear(src.year3),
    };
  }
  base.totals = computeEstimateTotals(base.lines);
  const checklist = raw.vendor_checklist && typeof raw.vendor_checklist === 'object' ? raw.vendor_checklist : {};
  const normalizedChecklist: Record<string, 'yes' | 'no' | 'na'> = {};
  for (const q of VENDOR_ASSESSMENT_QUESTIONS) {
    const v = checklist[q.id];
    if (v === true || v === 'yes') normalizedChecklist[q.id] = 'yes';
    else if (v === false || v === 'no') normalizedChecklist[q.id] = 'no';
    else if (v === 'na') normalizedChecklist[q.id] = 'na';
  }
  base.vendor_checklist = normalizedChecklist;
  return base;
}
