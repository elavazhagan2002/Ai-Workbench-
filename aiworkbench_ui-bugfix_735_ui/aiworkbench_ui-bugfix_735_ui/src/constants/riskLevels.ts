export const RISK_LEVEL_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
] as const;

export type RiskLevel = (typeof RISK_LEVEL_OPTIONS)[number]['value'];

export function getRiskLevelBadgeClass(level?: string | null): string {
  switch (level) {
    case 'critical':
      return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300';
    case 'high':
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
    case 'medium':
      return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300';
    case 'low':
      return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300';
    default:
      return 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300';
  }
}

export function formatRiskLevel(level?: string | null): string {
  if (!level) return '-';
  return level.charAt(0).toUpperCase() + level.slice(1);
}
