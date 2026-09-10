export const TARGET_AUDIENCE_TYPE_OPTIONS = [
  'Internal users',
  'Customers',
  'Partners',
  'Public',
] as const;

export type TargetAudienceType = (typeof TARGET_AUDIENCE_TYPE_OPTIONS)[number];

export function normalizeTargetAudienceTypes(value: unknown): TargetAudienceType[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is TargetAudienceType =>
    typeof item === 'string' && TARGET_AUDIENCE_TYPE_OPTIONS.includes(item as TargetAudienceType)
  );
}
