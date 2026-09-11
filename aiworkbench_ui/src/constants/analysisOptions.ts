/** Analysis scoring option lists (mirror backend analysis_options). */

export const FREQUENCY_OF_TASK_OPTIONS = ['Hourly', 'Daily', 'Weekly', 'Monthly', 'Yearly'] as const;

export const CURRENT_EFFORT_OPTIONS = ['<1 hour', '1-5 Days', '5-20 Days', '20+ Days'] as const;

export const USER_GROUP_SIZE_OPTIONS = ['500+', '151-500', '51-150', '11-50', '1-10'] as const;

export const EFFICIENCY_IMPACT_OPTIONS = ['>50%', '~20-50%', '<20%'] as const;

export const QUALITY_COMPLIANCE_IMPACT_OPTIONS = [
  'Major reduction',
  'Moderate Improvement',
  'Low/no impact',
] as const;

export const USER_URGENCY_OPTIONS = ['Critical (high adoption)', 'Regular', 'Infrequent'] as const;

export const PROCESS_IMPACT_OPTIONS = [
  'High alignment - low SOP disruption',
  'Moderate alignment',
  'Low alignment - major process overhaul',
] as const;

export const OPERATIONAL_COMPLIANCE_RISK_OPTIONS = ['Low Risk', 'Medium Risk', 'High Risk'] as const;

export const TOOL_COMPLEXITY_OPTIONS = [
  'simple standard api / out of the box',
  'Moderate custom logic',
  'Complex multi-system integration',
] as const;

export const HOST_SYSTEM_CAPABILITY_OPTIONS = [
  'Fully supported natively',
  'On host system roadmap',
  'Partial / requires customization',
  'Not supported / not on roadmap',
] as const;

export const DATA_PRIVACY_SECURITY_OPTIONS = ['Low', 'Medium', 'High'] as const;

export const DEPLOYMENT_MODEL_OPTIONS = ['Cloud', 'On-Premise', 'Hybrid'] as const;

/** Mandatory Technical Analysis fields (must be filled before Complete). */
export const TECHNICAL_REQUIRED_FIELDS = [
  { key: 'ai_category', label: 'AI Category' },
  { key: 'tool_complexity', label: 'Tool Complexity' },
  { key: 'host_system_capability', label: 'Host System Capability' },
  { key: 'data_privacy_security', label: 'Data Privacy & Security' },
  { key: 'solution_design_overview', label: 'Solution Design Overview' },
  { key: 'deployment_model', label: 'Deployment Model' },
] as const;

/** Mandatory Business Analysis fields (must be filled before Complete). */
export const BUSINESS_REQUIRED_FIELDS = [
  { key: 'frequency_of_task', label: 'Frequency of Task' },
  { key: 'current_effort', label: 'Current Effort' },
  { key: 'user_group_size', label: 'User Group Size' },
  { key: 'efficiency_impact', label: 'Efficiency Impact' },
  { key: 'quality_compliance_impact', label: 'Quality / Compliance Impact' },
  { key: 'user_urgency', label: 'User Urgency' },
  { key: 'process_impact', label: 'Process Impact / Org Alignment' },
  { key: 'operational_compliance_risk', label: 'Operational & Compliance Risk' },
] as const;
