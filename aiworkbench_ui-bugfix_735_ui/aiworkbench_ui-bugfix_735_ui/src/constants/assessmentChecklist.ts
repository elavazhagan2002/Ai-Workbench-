export const ASSESSMENT_CHECKLIST_STATUSES = ['DRAFT', 'IN REVIEW', 'EFFECTIVE', 'DEPRECATED'] as const;

export const ASSESSMENT_ITEM_CATEGORIES = [
  'Business',
  'Governance',
  'Legal & Compliance',
  'Technical',
  'Security & Data Privacy',
  'Operations',
] as const;

export const RISK_CLASSIFICATION_LEVELS = ['Critical', 'High', 'Medium', 'Low'] as const;

export type AssessmentChecklistStatus = (typeof ASSESSMENT_CHECKLIST_STATUSES)[number];
export type AssessmentItemCategory = (typeof ASSESSMENT_ITEM_CATEGORIES)[number];
export type RiskClassificationLevel = (typeof RISK_CLASSIFICATION_LEVELS)[number];

export const ASSESSMENT_ITEM_MAX_LENGTH = 500;
export const ASSESSMENT_TEMPLATE_NAME_MAX_LENGTH = 200;
export const QUESTION_BASE_SCORE_TOTAL = 1;
export const ALLOWED_CHECKLIST_ITEM_MAX_LENGTH = 200;
export const DEFAULT_PENALTY_FACTOR = 1;

export interface ChecklistAnswerOption {
  label: string;
  penalty_factor: number;
}

export interface AssessmentChecklistItemForm {
  item_id?: number;
  sno: string;
  assessment_item: string;
  category: AssessmentItemCategory | '';
  allowed_checklist_items: ChecklistAnswerOption[];
}

export interface AssessmentChecklistAreaForm {
  area_id?: number;
  seq_no: number;
  title: string;
  items: AssessmentChecklistItemForm[];
}

export interface RiskClassificationRange {
  level: RiskClassificationLevel;
  min_score: number;
  max_score: number;
}

export interface AssessmentChecklistTemplateForm {
  name: string;
  status: AssessmentChecklistStatus;
  areas: AssessmentChecklistAreaForm[];
  risk_classification_ranges: RiskClassificationRange[];
}

export const EMPTY_ANSWER_OPTION: ChecklistAnswerOption = {
  label: '',
  penalty_factor: DEFAULT_PENALTY_FACTOR,
};

export const EMPTY_CHECKLIST_ITEM: AssessmentChecklistItemForm = {
  sno: '',
  assessment_item: '',
  category: '',
  allowed_checklist_items: [],
};

export const EMPTY_CHECKLIST_AREA: AssessmentChecklistAreaForm = {
  seq_no: 1,
  title: '',
  items: [{ ...EMPTY_CHECKLIST_ITEM, sno: '1.1' }],
};

export const EMPTY_TEMPLATE_FORM: AssessmentChecklistTemplateForm = {
  name: '',
  status: 'DRAFT',
  areas: [{ ...EMPTY_CHECKLIST_AREA }],
  risk_classification_ranges: [],
};

export function clampPenaltyFactor(value: number): number {
  const parsed = Number.isFinite(value) ? value : DEFAULT_PENALTY_FACTOR;
  return Math.round(Math.max(0, parsed) * 10000) / 10000;
}

export function normalizeAnswerOptions(values: unknown, fallbackPenalty = DEFAULT_PENALTY_FACTOR): ChecklistAnswerOption[] {
  if (!Array.isArray(values)) return [];
  const parsed: ChecklistAnswerOption[] = [];
  const seen = new Set<string>();

  for (const raw of values) {
    let label = '';
    let penalty = fallbackPenalty;

    if (typeof raw === 'string') {
      label = raw.trim();
    } else if (raw && typeof raw === 'object') {
      const record = raw as Record<string, unknown>;
      label = String(record.label ?? record.text ?? '').trim();
      penalty = clampPenaltyFactor(Number(record.penalty_factor ?? fallbackPenalty));
    }

    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push({
      label: label.slice(0, ALLOWED_CHECKLIST_ITEM_MAX_LENGTH),
      penalty_factor: penalty,
    });
  }

  return parsed;
}

export function renumberAreas(areas: AssessmentChecklistAreaForm[]): AssessmentChecklistAreaForm[] {
  return areas.map((area, areaIndex) => {
    const seqNo = areaIndex + 1;
    return {
      ...area,
      seq_no: seqNo,
      items: area.items.map((item, itemIndex) => ({
        ...item,
        sno: `${seqNo}.${itemIndex + 1}`,
      })),
    };
  });
}

export function countQuestions(areas: AssessmentChecklistAreaForm[]): number {
  return areas.reduce((sum, area) => sum + area.items.length, 0);
}

export function computeAssessmentTotalScore(areas: AssessmentChecklistAreaForm[]): number {
  return countQuestions(areas) * QUESTION_BASE_SCORE_TOTAL;
}

export function isQuestionComplete(item: AssessmentChecklistItemForm): boolean {
  if (item.allowed_checklist_items.length === 0) return false;
  return item.allowed_checklist_items.every((answer) => answer.label.trim().length > 0);
}

export function defaultRiskClassificationRanges(assessmentTotalScore: number): RiskClassificationRange[] {
  if (assessmentTotalScore <= 0) {
    return RISK_CLASSIFICATION_LEVELS.map((level) => ({ level, min_score: 0, max_score: 0 }));
  }
  const quarter = Math.round(assessmentTotalScore / 4);
  const half = Math.round(assessmentTotalScore / 2);
  const threeQuarter = Math.round(assessmentTotalScore * 0.75);
  const step = 0.0001;
  return [
    { level: 'Critical', min_score: 0, max_score: quarter },
    { level: 'High', min_score: Math.round((quarter + step) * 10000) / 10000, max_score: half },
    { level: 'Medium', min_score: Math.round((half + step) * 10000) / 10000, max_score: threeQuarter },
    { level: 'Low', min_score: Math.round((threeQuarter + step) * 10000) / 10000, max_score: assessmentTotalScore },
  ];
}

export function templateToForm(template: {
  name: string;
  status: AssessmentChecklistStatus;
  areas?: AssessmentChecklistAreaForm[];
  risk_classification_ranges?: RiskClassificationRange[];
  question_count?: number;
  assessment_total_score?: number;
}): AssessmentChecklistTemplateForm {
  const areas = renumberAreas(
    (template.areas || []).map((area) => ({
      area_id: area.area_id,
      seq_no: area.seq_no,
      title: area.title,
      items: (area.items || []).map((item) => ({
        item_id: item.item_id,
        sno: item.sno,
        assessment_item: item.assessment_item,
        category: item.category,
        allowed_checklist_items: normalizeAnswerOptions(item.allowed_checklist_items),
      })),
    })),
  );
  const assessmentTotal = template.assessment_total_score ?? computeAssessmentTotalScore(areas);
  return {
    name: template.name,
    status: template.status,
    areas,
    risk_classification_ranges:
      template.risk_classification_ranges && template.risk_classification_ranges.length > 0
        ? template.risk_classification_ranges.map((row) => ({
            level: row.level,
            min_score: Number(row.min_score),
            max_score: Number(row.max_score),
          }))
        : defaultRiskClassificationRanges(assessmentTotal),
  };
}

export function formToPayload(form: AssessmentChecklistTemplateForm) {
  const areas = renumberAreas(form.areas);
  return {
    name: form.name.trim(),
    status: form.status,
    areas: areas.map((area) => ({
      seq_no: area.seq_no,
      title: area.title.trim(),
      items: area.items.map((item) => ({
        sno: item.sno,
        assessment_item: item.assessment_item.trim(),
        category: item.category,
        allowed_checklist_items: item.allowed_checklist_items.map((answer) => ({
          label: answer.label.trim(),
          penalty_factor: clampPenaltyFactor(answer.penalty_factor),
        })),
      })),
    })),
    risk_classification_ranges: form.risk_classification_ranges.map((row) => ({
      level: row.level,
      min_score: Math.round(row.min_score * 100) / 100,
      max_score: Math.round(row.max_score * 100) / 100,
    })),
  };
}

export function validateTemplateQuestionScores(areas: AssessmentChecklistAreaForm[]): string | null {
  for (const area of areas) {
    for (const item of area.items) {
      if (!item.assessment_item.trim()) {
        return `Question ${item.sno} text is required`;
      }
      if (!item.category) {
        return `Question ${item.sno} category is required`;
      }
      if (item.allowed_checklist_items.length === 0) {
        return `Question ${item.sno} requires at least one answer option`;
      }
      for (const answer of item.allowed_checklist_items) {
        if (!answer.label.trim()) {
          return `Question ${item.sno} has an answer option without text`;
        }
      }
    }
  }
  return null;
}

export function validateRiskClassificationRanges(
  ranges: RiskClassificationRange[],
  assessmentTotalScore: number,
): string | null {
  if (assessmentTotalScore <= 0) return null;
  let previousMax = -0.01;
  for (const row of ranges) {
    if (row.min_score < 0 || row.max_score < 0) {
      return `${row.level} range cannot contain negative scores`;
    }
    if (row.min_score > row.max_score) {
      return `${row.level} minimum score cannot exceed maximum score`;
    }
    if (row.max_score > assessmentTotalScore) {
      return `${row.level} maximum score exceeds assessment total (${assessmentTotalScore})`;
    }
    if (row.min_score < previousMax) {
      return 'Risk classification ranges cannot overlap';
    }
    previousMax = row.max_score;
  }
  return null;
}

export function getStatusDropdownOptions(
  currentStatus: AssessmentChecklistStatus,
  editable: boolean,
): AssessmentChecklistStatus[] {
  if (!editable) {
    return [currentStatus];
  }
  if (currentStatus === 'DRAFT') {
    return ['DRAFT', 'IN REVIEW'];
  }
  return ['DRAFT', 'IN REVIEW', 'EFFECTIVE', 'DEPRECATED'];
}

export function getStatusBadgeClass(status: AssessmentChecklistStatus, isActive: boolean): string {
  if (isActive) {
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300';
  }
  switch (status) {
    case 'DRAFT':
      return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
    case 'IN REVIEW':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
    case 'EFFECTIVE':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
    case 'DEPRECATED':
      return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
  }
}

export function flattenQuestions(areas: AssessmentChecklistAreaForm[]) {
  return areas.flatMap((area, areaIndex) =>
    area.items.map((item, itemIndex) => ({
      areaIndex,
      itemIndex,
      areaTitle: area.title,
      item,
    })),
  );
}

export function questionKey(areaIndex: number, itemIndex: number) {
  return `${areaIndex}-${itemIndex}`;
}

export function parseQuestionKey(key: string) {
  const [areaIndex, itemIndex] = key.split('-').map(Number);
  return { areaIndex, itemIndex };
}

export function questionToPayload(item: AssessmentChecklistItemForm) {
  return {
    sno: item.sno,
    assessment_item: item.assessment_item.trim(),
    category: item.category,
    allowed_checklist_items: item.allowed_checklist_items.map((answer) => ({
      label: answer.label.trim(),
      penalty_factor: clampPenaltyFactor(answer.penalty_factor),
    })),
  };
}

export function validateSingleQuestion(item: AssessmentChecklistItemForm): string | null {
  if (!item.assessment_item.trim()) {
    return 'Question text is required';
  }
  if (!item.category) {
    return 'Question category is required';
  }
  if (item.allowed_checklist_items.length === 0) {
    return 'At least one answer option is required';
  }
  for (const answer of item.allowed_checklist_items) {
    if (!answer.label.trim()) {
      return 'Each answer option must have text';
    }
  }
  return null;
}

export function formToSettingsPayload(form: AssessmentChecklistTemplateForm) {
  return {
    name: form.name.trim(),
    status: form.status,
    area_titles: form.areas
      .filter((area) => area.area_id)
      .map((area) => ({ area_id: area.area_id as number, title: area.title.trim() })),
    risk_classification_ranges: form.risk_classification_ranges.map((row) => ({
      level: row.level,
      min_score: Math.round(row.min_score * 10000) / 10000,
      max_score: Math.round(row.max_score * 10000) / 10000,
    })),
  };
}

export function filterAreasBySearch(areas: AssessmentChecklistAreaForm[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return areas;
  return areas
    .map((area) => ({
      ...area,
      items: area.items.filter(
        (item) =>
          item.sno.toLowerCase().includes(normalized) ||
          item.assessment_item.toLowerCase().includes(normalized) ||
          item.category.toLowerCase().includes(normalized) ||
          area.title.toLowerCase().includes(normalized),
      ),
    }))
    .filter((area) => area.title.toLowerCase().includes(normalized) || area.items.length > 0);
}

export function validateChecklistImportJson(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') {
    return 'Import file must be a JSON object';
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.name !== 'string' || !record.name.trim()) {
    return 'Template name is required';
  }
  if (!Array.isArray(record.areas) || record.areas.length === 0) {
    return 'At least one assessment area is required';
  }
  for (const area of record.areas) {
    if (!area || typeof area !== 'object') {
      return 'Each area must be an object';
    }
    const areaRecord = area as Record<string, unknown>;
    if (areaRecord.seq_no == null || Number.isNaN(Number(areaRecord.seq_no))) {
      return 'Each area must have a numeric seq_no';
    }
    if (typeof areaRecord.title !== 'string' || !areaRecord.title.trim()) {
      return 'Each area must have a title';
    }
    if (!Array.isArray(areaRecord.items) || areaRecord.items.length === 0) {
      return `Area "${String(areaRecord.title)}" must include at least one question`;
    }
    for (const item of areaRecord.items) {
      if (!item || typeof item !== 'object') {
        return 'Each question must be an object';
      }
      const itemRecord = item as Record<string, unknown>;
      const sno = typeof itemRecord.sno === 'string' ? itemRecord.sno.trim() : '';
      if (!sno) {
        return 'Each question must have an sno';
      }
      if (typeof itemRecord.assessment_item !== 'string' || !itemRecord.assessment_item.trim()) {
        return `Question ${sno} requires assessment_item text`;
      }
      if (typeof itemRecord.category !== 'string' || !itemRecord.category.trim()) {
        return `Question ${sno} requires a category`;
      }
      if (
        !Array.isArray(itemRecord.allowed_checklist_items)
        || itemRecord.allowed_checklist_items.length === 0
      ) {
        return `Question ${sno} requires at least one answer option`;
      }
    }
  }
  return null;
}
