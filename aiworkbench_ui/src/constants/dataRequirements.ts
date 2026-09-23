export const DATA_CLASSIFICATION_OPTIONS = [
  'Public',
  'Internal-Use',
  'Confidential',
  'Restricted',
  'Highly-Restricted',
] as const;

export const DATA_USAGE_OPTIONS = ['Training', 'Testing', 'Production'] as const;

export const DATASET_TYPE_OPTIONS = ['Synthetic', 'Real'] as const;

export type DataClassification = (typeof DATA_CLASSIFICATION_OPTIONS)[number];
export type DataUsage = (typeof DATA_USAGE_OPTIONS)[number];
export type DatasetType = (typeof DATASET_TYPE_OPTIONS)[number];

export const EMPTY_DATA_REQUIREMENT_FORM = {
  data_req: '',
  data_source: '',
  volume: '',
  data_classification: '',
  data_owner: '',
  data_usage: [] as DataUsage[],
  is_pii_phi_involved: false,
  dataset_type: '' as '' | DatasetType,
  data_lineage_available: false,
  data_quality_assessed: false,
  data_freshness_confirmed: false,
};

export type DataRequirementFormState = typeof EMPTY_DATA_REQUIREMENT_FORM;

export function dataRequirementToForm(data: {
  data_req?: string | null;
  data_source?: string | null;
  volume?: string | null;
  data_classification?: string | null;
  data_owner?: string | null;
  data_usage?: string[] | null;
  is_pii_phi_involved?: boolean;
  dataset_type?: 'Synthetic' | 'Real' | null;
  data_lineage_available?: boolean;
  data_quality_assessed?: boolean;
  data_freshness_confirmed?: boolean;
}): DataRequirementFormState {
  return {
    data_req: data.data_req || '',
    data_source: data.data_source || '',
    volume: data.volume || '',
    data_classification: data.data_classification || '',
    data_owner: data.data_owner || '',
    data_usage: (data.data_usage || []) as DataUsage[],
    is_pii_phi_involved: Boolean(data.is_pii_phi_involved),
    dataset_type: (data.dataset_type || '') as '' | DatasetType,
    data_lineage_available: Boolean(data.data_lineage_available),
    data_quality_assessed: Boolean(data.data_quality_assessed),
    data_freshness_confirmed: Boolean(data.data_freshness_confirmed),
  };
}

export function dataRequirementFormToPayload(form: DataRequirementFormState) {
  return {
    data_req: form.data_req.trim(),
    data_source: form.data_source.trim() || null,
    volume: form.volume.trim() || null,
    data_classification: form.data_classification || null,
    data_owner: form.data_owner.trim() || null,
    data_usage: form.data_usage.length > 0 ? form.data_usage : null,
    is_pii_phi_involved: form.is_pii_phi_involved,
    dataset_type: form.dataset_type || null,
    data_lineage_available: form.data_lineage_available,
    data_quality_assessed: form.data_quality_assessed,
    data_freshness_confirmed: form.data_freshness_confirmed,
  };
}
