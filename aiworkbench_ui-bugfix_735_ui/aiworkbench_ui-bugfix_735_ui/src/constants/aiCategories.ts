export const AI_CATEGORY_OPTIONS = [
  { value: 'P', label: 'Predictive AI' },
  { value: 'G', label: 'Generative AI' },
  { value: 'A', label: 'Autonomous AI' },
  { value: 'S', label: 'Decision-Support' },
] as const;

export type AiCategoryCode = (typeof AI_CATEGORY_OPTIONS)[number]['value'];

export const DEFAULT_AI_CATEGORY: AiCategoryCode = 'P';

const LEGACY_AI_CATEGORY_LABELS: Record<string, string> = {
  C: 'Predictive AI',
  D: 'Autonomous AI',
  H: 'Decision-Support',
};

export const AI_CATEGORY_LABELS: Record<string, string> = {
  ...Object.fromEntries(AI_CATEGORY_OPTIONS.map(({ value, label }) => [value, label])),
  ...LEGACY_AI_CATEGORY_LABELS,
  G: 'Generative AI',
};

export function getAiCategoryLabel(code: string | null | undefined): string {
  if (!code) return 'N/A';
  return AI_CATEGORY_LABELS[code] ?? code;
}

const LEGACY_AI_CATEGORY_CODES: Record<string, AiCategoryCode> = {
  C: 'P',
  D: 'A',
  G: 'G',
  H: 'S',
};

export function normalizeAiCategoryCode(code: string | null | undefined): AiCategoryCode {
  if (!code) return DEFAULT_AI_CATEGORY;
  if (code === 'P' || code === 'G' || code === 'A' || code === 'S') {
    return code;
  }
  return LEGACY_AI_CATEGORY_CODES[code] ?? DEFAULT_AI_CATEGORY;
}
