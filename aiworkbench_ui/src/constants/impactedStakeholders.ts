export const IMPACTED_STAKEHOLDER_MAX_LENGTH = 100;
export const IMPACTED_STAKEHOLDERS_MAX_COUNT = 25;

export function normalizeImpactedStakeholders(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  for (const item of value) {
    const text = typeof item === 'string' ? item.trim().slice(0, IMPACTED_STAKEHOLDER_MAX_LENGTH) : '';
    if (!text || normalized.includes(text)) continue;
    normalized.push(text);
    if (normalized.length >= IMPACTED_STAKEHOLDERS_MAX_COUNT) break;
  }
  return normalized;
}
