export const VALIDATION_PACKAGE_CORE = [
  'Intended Use / Context of Use document',
  'Data requirements, lineage, and data-quality evidence',
  'Human-in-the-loop / escalation procedure',
  'Change-control record for model, prompt, or configuration updates',
  'User training and operating procedure updates',
];

export const VALIDATION_PACKAGE_BY_RISK: Record<string, string[]> = {
  Low: [
    'Configuration specification',
    'Installation / smoke-test record',
    'Periodic review note',
  ],
  Medium: [
    'User Requirements Specification (URS)',
    'Traceability of requirements to tests',
    'Verification protocol and executed evidence',
    'Periodic review schedule',
  ],
  High: [
    'Validation plan',
    'IQ / OQ / PQ protocols and reports',
    'Independent performance and bias evaluation',
    'Incident, rollback, and monitoring procedure',
    'Periodic review with residual-risk assessment',
  ],
  Critical: [
    'Full validation plan approved by Quality',
    'IQ / OQ / PQ protocols and reports',
    'Independent performance, bias, and safety evaluation',
    'Incident, rollback, and continuous-monitoring procedure',
    'Periodic review with residual-risk assessment',
    'Health Authority / GxP impact assessment if submissions or supply data are touched',
  ],
};

export function recommendedValidationPackages(riskClassification?: string | null): string[] {
  const risk = (riskClassification || '').trim();
  const extra = VALIDATION_PACKAGE_BY_RISK[risk] || VALIDATION_PACKAGE_BY_RISK.Medium;
  return [...VALIDATION_PACKAGE_CORE, ...extra];
}
