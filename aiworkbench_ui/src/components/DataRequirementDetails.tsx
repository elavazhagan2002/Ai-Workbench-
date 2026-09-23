import type { UseCaseData } from '../types';

function GovernanceBadge({ label, active }: { label: string; active?: boolean }) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-medium ${
        active
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
          : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
      }`}
    >
      {label}: {active ? 'Yes' : 'No'}
    </span>
  );
}

export function DataRequirementDetails({ data }: { data: UseCaseData }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-slate-600 dark:text-slate-400">
        {data.data_source && <span>Source: {data.data_source}</span>}
        {data.volume && <span>Volume: {data.volume}</span>}
        {data.data_classification && <span>Classification: {data.data_classification}</span>}
        {data.data_owner && <span>Owner: {data.data_owner}</span>}
        {data.data_usage && data.data_usage.length > 0 && (
          <span>Usage: {data.data_usage.join(', ')}</span>
        )}
        {data.dataset_type && <span>Dataset: {data.dataset_type}</span>}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-slate-600 dark:text-slate-400">
          PII/PHI involved: {data.is_pii_phi_involved ? 'Yes' : 'No'}
        </span>
        <GovernanceBadge label="Data Lineage" active={data.data_lineage_available} />
        <GovernanceBadge label="Data Quality Assessed" active={data.data_quality_assessed} />
        <GovernanceBadge label="Data Freshness Confirmed" active={data.data_freshness_confirmed} />
      </div>
    </div>
  );
}
