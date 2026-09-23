export type PermissionGroupKey = 'workflow' | 'usecase' | 'portal' | 'dashboard' | 'other';

export const PERMISSION_GROUP_ORDER: PermissionGroupKey[] = [
  'workflow',
  'usecase',
  'portal',
  'dashboard',
  'other',
];

export const PERMISSION_GROUP_META: Record<
  PermissionGroupKey,
  { label: string; shortLabel: string; description: string; chipClass: string }
> = {
  workflow: {
    label: 'Workflow state',
    shortLabel: 'Workflow',
    description: 'Move use cases between lifecycle stages',
    chipClass:
      'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 border-violet-200/60 dark:border-violet-800/50',
  },
  usecase: {
    label: 'Use case actions',
    shortLabel: 'Use case',
    description: 'Create, edit, assign, and review use cases',
    chipClass:
      'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 border-sky-200/60 dark:border-sky-800/50',
  },
  portal: {
    label: 'Portal & admin',
    shortLabel: 'Portal',
    description: 'Domains, content, assessment, and admin access',
    chipClass:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800/50',
  },
  dashboard: {
    label: 'Dashboards',
    shortLabel: 'Dashboard',
    description: 'Analytics views by scope',
    chipClass:
      'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/50',
  },
  other: {
    label: 'Other',
    shortLabel: 'Other',
    description: 'Ungrouped permissions',
    chipClass:
      'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300 border-slate-200/60 dark:border-slate-600',
  },
};

const PRIVILEGED = new Set(['settings_access', 'audit_access']);

const LABELS: Record<string, { label: string; description: string }> = {
  workflow_new: { label: 'Move to New', description: 'Transition use cases into New' },
  workflow_analysis: { label: 'Move to Analysis', description: 'Transition use cases into Analysis' },
  workflow_review: { label: 'Move to Review', description: 'Transition use cases into Review' },
  workflow_estimate: { label: 'Move to Estimate', description: 'Transition use cases into Estimate' },
  workflow_roi: { label: 'Move to ROI', description: 'Transition use cases into ROI' },
  workflow_ai_assessment: {
    label: 'Move to AI Assessment',
    description: 'Transition use cases into AI Assessment',
  },
  workflow_approved: { label: 'Move to Approved', description: 'Transition use cases into Approved' },
  workflow_rejected: { label: 'Move to Rejected', description: 'Transition use cases into Rejected' },
  case_create: { label: 'Create use cases', description: 'Create new use case records' },
  case_edit: { label: 'Edit use cases', description: 'Edit existing use case content' },
  case_view: { label: 'View use cases', description: 'Open and read use case records' },
  case_delete: { label: 'Delete use cases', description: 'Permanently remove use cases' },
  case_assign: { label: 'Assign use cases', description: 'Assign owners and contributors' },
  case_approve: { label: 'Approve use cases', description: 'Approve use cases in workflow' },
  case_reject: { label: 'Reject use cases', description: 'Reject use cases in workflow' },
  case_comment: { label: 'Comment on use cases', description: 'Add comments on use cases' },
  case_review: { label: 'Review use cases', description: 'Participate in review steps' },
  audit_access: { label: 'Audit access', description: 'View audit trails and compliance data' },
  settings_access: { label: 'Settings access', description: 'Manage roles, users, and configuration' },
  create_domain: { label: 'Create domains', description: 'Create new governance domains' },
  edit_domain: { label: 'Edit domains', description: 'Update domain details and ownership' },
  delete_domain: { label: 'Delete domains', description: 'Remove domains from the portal' },
  domain_access: { label: 'Domain access', description: 'Open and work within assigned domains' },
  domain_owner: { label: 'Domain ownership', description: 'Act as domain owner for governance' },
  map_demo: { label: 'Map demos', description: 'Attach demos to use cases' },
  view_demo: { label: 'View demos', description: 'Watch mapped demo content' },
  view_live_demo: { label: 'View live demos', description: 'Access live demo experiences' },
  view_document: { label: 'View documents', description: 'Open attached documents' },
  view_infographic: { label: 'View infographics', description: 'Open infographic assets' },
  view_blog: { label: 'View blogs', description: 'Read blog content in the portal' },
  manage_blog: { label: 'Manage blogs', description: 'Create and edit blog content' },
  manage_assessment_checklist: {
    label: 'Manage assessment checklist',
    description: 'Configure AI assessment checklist templates',
  },
  initiate_assessment: {
    label: 'Initiate assessment',
    description: 'Start the AI assessment checklist on a use case',
  },
  contribute_assessment: {
    label: 'Contribute to assessment',
    description: 'Answer and update assessment checklist items',
  },
  dashboard_enterprise: {
    label: 'Enterprise dashboard',
    description: 'View enterprise-wide analytics',
  },
  dashboard_domain: { label: 'Domain dashboard', description: 'View domain-scoped analytics' },
  dashboard_individual: {
    label: 'Individual dashboard',
    description: 'View personal analytics',
  },
};

export function isPrivilegedPermission(name: string): boolean {
  return PRIVILEGED.has(name);
}

export function getPermissionGroupKey(permissionType?: string | null): PermissionGroupKey {
  const key = (permissionType || 'portal') as PermissionGroupKey;
  if (PERMISSION_GROUP_ORDER.includes(key)) return key;
  return 'other';
}

export function getPermissionLabel(name: string): string {
  return LABELS[name]?.label || name.replaceAll('_', ' ');
}

export function getPermissionDescription(name: string): string {
  return LABELS[name]?.description || '';
}

export function humanizePermissionName(name: string): string {
  return getPermissionLabel(name);
}
