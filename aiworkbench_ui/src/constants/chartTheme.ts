/** Shared chart/theme palette for analytics widgets (navy + cyan brand). */
export const CHART_COLORS = [
  '#18246C',
  '#13C7E8',
  '#0A2D72',
  '#2DD4BF',
  '#3B82F6',
  '#64748B',
  '#0EA5E9',
  '#334155',
];

export const CHART_STATUS_COLORS: Record<string, string> = {
  New: '#64748B',
  Analysis: '#0EA5E9',
  Review: '#18246C',
  Estimate: '#0A2D72',
  ROI: '#13C7E8',
  'AI Assessment': '#2DD4BF',
  Approved: '#059669',
  Rejected: '#DC2626',
  Development: '#475569',
  Testing: '#6366F1',
  Production: '#0F766E',
  Retired: '#94A3B8',
};

export function colorForLabel(label: string, index = 0): string {
  return CHART_STATUS_COLORS[label] || CHART_COLORS[index % CHART_COLORS.length];
}
