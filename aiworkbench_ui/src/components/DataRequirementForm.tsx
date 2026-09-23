import {
  DATA_CLASSIFICATION_OPTIONS,
  DATA_USAGE_OPTIONS,
  DATASET_TYPE_OPTIONS,
  EMPTY_DATA_REQUIREMENT_FORM,
  type DataRequirementFormState,
} from '../constants/dataRequirements';
import SelectMenu from './SelectMenu';

interface DataRequirementFormProps {
  value: DataRequirementFormState;
  onChange: (next: DataRequirementFormState) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  formId?: string;
}

export function DataRequirementForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  formId = 'data-requirement-form',
}: DataRequirementFormProps) {
  return (
    <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-600 dark:bg-slate-700/50">
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Data Requirement *
          </label>
          <input
            type="text"
            value={value.data_req}
            onChange={(e) => onChange({ ...value, data_req: e.target.value })}
            maxLength={100}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
            placeholder="e.g., Customer transaction data"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Data Source</label>
            <input
              type="text"
              value={value.data_source}
              onChange={(e) => onChange({ ...value, data_source: e.target.value })}
              maxLength={100}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
              placeholder="e.g., CRM Database"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Volume</label>
            <input
              type="text"
              value={value.volume}
              onChange={(e) => onChange({ ...value, volume: e.target.value })}
              maxLength={50}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
              placeholder="e.g., 1M records"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Data Classification</label>
            <SelectMenu
              value={value.data_classification}
              onChange={(data_classification) => onChange({ ...value, data_classification })}
              placeholder="Select classification"
              options={DATA_CLASSIFICATION_OPTIONS.map((option) => ({ value: option, label: option }))}
              aria-label="Data Classification"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Data Owner</label>
            <input
              type="text"
              value={value.data_owner}
              onChange={(e) => onChange({ ...value, data_owner: e.target.value })}
              maxLength={100}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
              placeholder="e.g., Data Governance Team"
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Data Usage</label>
          <div className="space-y-2 rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-700">
            {DATA_USAGE_OPTIONS.map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={value.data_usage.includes(option)}
                  onChange={() => {
                    onChange({
                      ...value,
                      data_usage: value.data_usage.includes(option)
                        ? value.data_usage.filter((item) => item !== option)
                        : [...value.data_usage, option],
                    });
                  }}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                {option}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Dataset Type</label>
          <div className="flex flex-wrap gap-4">
            {DATASET_TYPE_OPTIONS.map((option) => (
              <label key={option} className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="radio"
                  name={`${formId}-dataset-type`}
                  value={option}
                  checked={value.dataset_type === option}
                  onChange={() => onChange({ ...value, dataset_type: option })}
                  className="border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                {option} dataset
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={value.is_pii_phi_involved}
              onChange={(e) => onChange({ ...value, is_pii_phi_involved: e.target.checked })}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Is PII/PHI involved?
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={value.data_lineage_available}
              onChange={(e) => onChange({ ...value, data_lineage_available: e.target.checked })}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Data Lineage available
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={value.data_quality_assessed}
              onChange={(e) => onChange({ ...value, data_quality_assessed: e.target.checked })}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Data Quality assessed
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={value.data_freshness_confirmed}
              onChange={(e) => onChange({ ...value, data_freshness_confirmed: e.target.checked })}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Data Freshness confirmed
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 px-4 py-2 text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
