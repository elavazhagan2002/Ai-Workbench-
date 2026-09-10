import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { api } from '../lib/api';
import type { AssessmentChecklistTemplate } from '../types';
import {
  ASSESSMENT_CHECKLIST_STATUSES,
  ASSESSMENT_ITEM_CATEGORIES,
  ASSESSMENT_ITEM_MAX_LENGTH,
  ASSESSMENT_TEMPLATE_NAME_MAX_LENGTH,
  ALLOWED_CHECKLIST_ITEM_MAX_LENGTH,
  QUESTION_BASE_SCORE_TOTAL,
  DEFAULT_PENALTY_FACTOR,
  EMPTY_ANSWER_OPTION,
  EMPTY_TEMPLATE_FORM,
  clampPenaltyFactor,
  computeAssessmentTotalScore,
  countQuestions,
  defaultRiskClassificationRanges,
  filterAreasBySearch,
  formToPayload,
  formToSettingsPayload,
  getStatusBadgeClass,
  getStatusDropdownOptions,
  isQuestionComplete,
  parseQuestionKey,
  questionKey,
  questionToPayload,
  renumberAreas,
  templateToForm,
  validateRiskClassificationRanges,
  validateSingleQuestion,
  validateChecklistImportJson,
  type AssessmentChecklistTemplateForm,
  type ChecklistAnswerOption,
} from '../constants/assessmentChecklist';
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Edit2,
  Eye,
  Plus,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import SelectMenu from './SelectMenu';
import { logger } from '../utils/logger';

type EditorMode = 'list' | 'create' | 'edit' | 'view' | 'clone';

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-white';
const labelClass = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';
const tableHeadClass = 'px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-slate-400';
const readOnlyCellClass = 'px-3 py-2 text-slate-700 dark:text-slate-300';
const scrollPanelClass = 'checklist-scroll max-h-[640px] overflow-y-auto overscroll-contain pr-1';

export default function AssessmentChecklistSettings() {
  const [templates, setTemplates] = useState<AssessmentChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [editorMode, setEditorMode] = useState<EditorMode>('list');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [cloneSourceId, setCloneSourceId] = useState<string | null>(null);
  const [form, setForm] = useState<AssessmentChecklistTemplateForm>({ ...EMPTY_TEMPLATE_FORM });
  const [deleteTarget, setDeleteTarget] = useState<AssessmentChecklistTemplate | null>(null);
  const [deprecateTarget, setDeprecateTarget] = useState<AssessmentChecklistTemplate | null>(null);
  const [activeQuestionKey, setActiveQuestionKey] = useState<string | null>(null);
  const [expandedAreaKeys, setExpandedAreaKeys] = useState<Set<number>>(new Set([0]));
  const [answerDraft, setAnswerDraft] = useState<ChecklistAnswerOption>({ ...EMPTY_ANSWER_OPTION });
  const [searchQuery, setSearchQuery] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importingTemplate, setImportingTemplate] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const hasTemplates = templates.length > 0;
  const isReadOnly = editorMode === 'view';
  const canEdit = editorMode === 'create' || editorMode === 'edit';
  const questionCount = countQuestions(form.areas);
  const assessmentTotalScore = computeAssessmentTotalScore(form.areas);
  const selectedTemplateMeta = useMemo(
    () => templates.find((template) => template.template_id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );
  const isActiveTemplate = Boolean(selectedTemplateMeta?.is_active);

  const visibleAreas = useMemo(
    () => filterAreasBySearch(form.areas, searchQuery),
    [form.areas, searchQuery],
  );

  const activeQuestion = useMemo(() => {
    if (!activeQuestionKey) return null;
    const { areaIndex, itemIndex } = parseQuestionKey(activeQuestionKey);
    const area = form.areas[areaIndex];
    const item = area?.items[itemIndex];
    if (!area || !item) return null;
    return { areaIndex, itemIndex, area, item };
  }, [activeQuestionKey, form.areas]);

  const allQuestions = useMemo(
    () => form.areas.flatMap((area, areaIndex) => area.items.map((item, itemIndex) => ({ areaIndex, itemIndex, item }))),
    [form.areas],
  );

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    if (!successMessage) return;
    const timer = window.setTimeout(() => setSuccessMessage(''), 4000);
    return () => window.clearTimeout(timer);
  }, [successMessage]);

  useEffect(() => {
    if (searchQuery.trim()) {
      setExpandedAreaKeys(new Set(form.areas.map((_, index) => index)));
    }
  }, [searchQuery, form.areas.length]);

  useEffect(() => {
    if ((canEdit || isReadOnly) && !activeQuestionKey && allQuestions.length > 0) {
      const first = allQuestions[0];
      setActiveQuestionKey(questionKey(first.areaIndex, first.itemIndex));
      setExpandedAreaKeys((prev) => new Set([...prev, first.areaIndex]));
    }
  }, [canEdit, isReadOnly, allQuestions, activeQuestionKey]);

  async function loadTemplates() {
    setLoading(true);
    setError('');
    try {
      const data = await api.getAssessmentChecklistTemplates();
      setTemplates((data as AssessmentChecklistTemplate[]) || []);
    } catch (err: any) {
      logger.error('Failed to load assessment checklist templates', err);
      setError(err?.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }

  function applyTemplateData(data: AssessmentChecklistTemplate, preserveQuestionKey?: string | null) {
    const nextForm = templateToForm(data);
    setForm(nextForm);
    if (preserveQuestionKey) {
      const { areaIndex, itemIndex } = parseQuestionKey(preserveQuestionKey);
      if (nextForm.areas[areaIndex]?.items[itemIndex]) {
        setActiveQuestionKey(preserveQuestionKey);
        setExpandedAreaKeys((prev) => new Set([...prev, areaIndex]));
        return;
      }
    }
    const first = nextForm.areas[0]?.items[0];
    if (first) {
      setActiveQuestionKey('0-0');
      setExpandedAreaKeys(new Set([0]));
    }
  }

  async function openTemplate(templateId: string, mode: EditorMode) {
    setError('');
    setSuccessMessage('');
    try {
      const data = await api.getAssessmentChecklistTemplate(templateId);
      setSelectedTemplateId(templateId);
      setEditorMode(mode);
      applyTemplateData(data as AssessmentChecklistTemplate);
      setSearchQuery('');
    } catch (err: any) {
      setError(err?.message || 'Failed to load template');
    }
  }

  function startCreateFromScratch() {
    setSelectedTemplateId(null);
    setCloneSourceId(null);
    setEditorMode('create');
    const areas = renumberAreas(EMPTY_TEMPLATE_FORM.areas);
    setForm({
      ...EMPTY_TEMPLATE_FORM,
      areas,
      risk_classification_ranges: defaultRiskClassificationRanges(computeAssessmentTotalScore(areas)),
    });
    setActiveQuestionKey('0-0');
    setExpandedAreaKeys(new Set([0]));
    setSuccessMessage('');
  }

  function startClone(source: AssessmentChecklistTemplate) {
    setSelectedTemplateId(source.template_id);
    setCloneSourceId(source.template_id);
    setEditorMode('clone');
    setForm({
      name: `${source.name} v${source.version_number + 1}`,
      status: 'DRAFT',
      areas: [],
      risk_classification_ranges: [],
    });
    setActiveQuestionKey(null);
  }

  function backToList() {
    setEditorMode('list');
    setSelectedTemplateId(null);
    setCloneSourceId(null);
    setForm({ ...EMPTY_TEMPLATE_FORM });
    setActiveQuestionKey(null);
    setAnswerDraft({ ...EMPTY_ANSWER_OPTION });
    setSearchQuery('');
    setSuccessMessage('');
  }

  function toggleArea(areaIndex: number) {
    setExpandedAreaKeys((prev) => {
      const next = new Set(prev);
      if (next.has(areaIndex)) next.delete(areaIndex);
      else next.add(areaIndex);
      return next;
    });
  }

  function updateArea(areaIndex: number, patch: Partial<AssessmentChecklistTemplateForm['areas'][number]>) {
    setForm((prev) => {
      const areas = [...prev.areas];
      areas[areaIndex] = { ...areas[areaIndex], ...patch };
      return { ...prev, areas };
    });
  }

  function updateItem(
    areaIndex: number,
    itemIndex: number,
    patch: Partial<AssessmentChecklistTemplateForm['areas'][number]['items'][number]>,
  ) {
    setForm((prev) => {
      const areas = [...prev.areas];
      const items = [...areas[areaIndex].items];
      items[itemIndex] = { ...items[itemIndex], ...patch };
      areas[areaIndex] = { ...areas[areaIndex], items };
      return { ...prev, areas: renumberAreas(areas) };
    });
  }

  function updateRiskRange(level: typeof form.risk_classification_ranges[number]['level'], patch: Partial<{ min_score: number; max_score: number }>) {
    setForm((prev) => ({
      ...prev,
      risk_classification_ranges: prev.risk_classification_ranges.map((row) =>
        row.level === level ? { ...row, ...patch } : row,
      ),
    }));
  }

  function addAnswerOption(areaIndex: number, itemIndex: number) {
    const label = answerDraft.label.trim();
    if (!label) return;
    const item = form.areas[areaIndex].items[itemIndex];
    if (item.allowed_checklist_items.some((answer) => answer.label.toLowerCase() === label.toLowerCase())) return;

    updateItem(areaIndex, itemIndex, {
      allowed_checklist_items: [
        ...item.allowed_checklist_items,
        {
          label: label.slice(0, ALLOWED_CHECKLIST_ITEM_MAX_LENGTH),
          penalty_factor: clampPenaltyFactor(answerDraft.penalty_factor),
        },
      ],
    });
    setAnswerDraft({ ...EMPTY_ANSWER_OPTION });
  }

  function navigateQuestion(direction: -1 | 1) {
    if (!activeQuestionKey) return;
    const currentIndex = allQuestions.findIndex(
      (entry) => questionKey(entry.areaIndex, entry.itemIndex) === activeQuestionKey,
    );
    const next = allQuestions[currentIndex + direction];
    if (next) {
      const key = questionKey(next.areaIndex, next.itemIndex);
      setActiveQuestionKey(key);
      setExpandedAreaKeys((prev) => new Set([...prev, next.areaIndex]));
    }
  }

  async function handleAddArea() {
    if (!selectedTemplateId || !canEdit) return;
    setError('');
    try {
      const data = await api.addAssessmentChecklistArea(selectedTemplateId, { title: 'New Assessment Area' });
      applyTemplateData(data as AssessmentChecklistTemplate, activeQuestionKey);
      const newAreaIndex = (data as AssessmentChecklistTemplate).areas!.length - 1;
      setExpandedAreaKeys((prev) => new Set([...prev, newAreaIndex]));
      setSuccessMessage('Assessment area added.');
    } catch (err: any) {
      setError(err?.message || 'Failed to add assessment area');
    }
  }

  async function handleAddQuestion(areaIndex: number) {
    if (!selectedTemplateId || !canEdit) return;
    const area = form.areas[areaIndex];
    if (!area?.area_id) {
      setError('Save the template first before adding questions.');
      return;
    }
    setError('');
    try {
      const data = await api.addAssessmentChecklistItem(selectedTemplateId, area.area_id, {
        sno: `${area.seq_no}.${area.items.length + 1}`,
        assessment_item: 'New assessment question',
        category: 'Governance',
        allowed_checklist_items: [{ label: 'Yes', penalty_factor: DEFAULT_PENALTY_FACTOR }],
      });
      applyTemplateData(data as AssessmentChecklistTemplate);
      const updatedAreaIndex = areaIndex;
      const newItemIndex = (data as AssessmentChecklistTemplate).areas![updatedAreaIndex].items.length - 1;
      const key = questionKey(updatedAreaIndex, newItemIndex);
      setActiveQuestionKey(key);
      setExpandedAreaKeys((prev) => new Set([...prev, updatedAreaIndex]));
      setSuccessMessage('Question added.');
    } catch (err: any) {
      setError(err?.message || 'Failed to add question');
    }
  }

  async function handleSaveQuestion() {
    if (!activeQuestion || !canEdit) return;
    setError('');
    setSuccessMessage('');
    const validationError = validateSingleQuestion(activeQuestion.item);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (editorMode === 'create' && !selectedTemplateId) {
      setError('Save the template first, then save individual questions.');
      return;
    }

    if (!selectedTemplateId) return;

    setSavingQuestion(true);
    try {
      let data: AssessmentChecklistTemplate;
      const payload = questionToPayload(activeQuestion.item);
      if (activeQuestion.item.item_id) {
        data = (await api.updateAssessmentChecklistItem(
          selectedTemplateId,
          activeQuestion.item.item_id,
          payload,
        )) as AssessmentChecklistTemplate;
      } else if (activeQuestion.area.area_id) {
        data = (await api.addAssessmentChecklistItem(
          selectedTemplateId,
          activeQuestion.area.area_id,
          payload,
        )) as AssessmentChecklistTemplate;
      } else {
        setError('Save the template first before saving this question.');
        return;
      }
      applyTemplateData(data, activeQuestionKey);
      setSuccessMessage(`Question ${activeQuestion.item.sno} saved.`);
    } catch (err: any) {
      setError(err?.message || 'Failed to save question');
    } finally {
      setSavingQuestion(false);
    }
  }

  async function activateCurrentTemplate() {
    if (!selectedTemplateId || !canEdit) return;
    setError('');
    setSuccessMessage('');
    setSavingTemplate(true);
    try {
      const { status, ...metadata } = formToSettingsPayload(form);
      await api.updateAssessmentChecklistTemplateSettings(selectedTemplateId, metadata);
      const data = (await api.activateAssessmentChecklistTemplate(selectedTemplateId)) as AssessmentChecklistTemplate;
      applyTemplateData(data, activeQuestionKey);
      setEditorMode('view');
      setSuccessMessage('Template activated and marked as effective.');
      await loadTemplates();
    } catch (err: any) {
      setError(err?.message || 'Failed to activate template');
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleSaveTemplate() {
    setError('');
    setSuccessMessage('');
    if (!form.name.trim()) {
      setError('Template name is required');
      return;
    }

    const riskError = validateRiskClassificationRanges(form.risk_classification_ranges, assessmentTotalScore);
    if (riskError && editorMode !== 'clone') {
      setError(riskError);
      return;
    }

    setSavingTemplate(true);
    try {
      if (editorMode === 'create') {
        if (hasTemplates) {
          setError('Use clone to create a new version from an existing template');
          return;
        }
        const data = (await api.createAssessmentChecklistTemplate(formToPayload(form))) as AssessmentChecklistTemplate;
        setSelectedTemplateId(data.template_id);
        setEditorMode('edit');
        applyTemplateData(data, activeQuestionKey);
        setSuccessMessage('Template created. You can now save questions individually.');
      } else if (editorMode === 'clone') {
        if (!cloneSourceId) {
          setError('Select a source template to clone');
          return;
        }
        await api.cloneAssessmentChecklistTemplate(cloneSourceId, { name: form.name.trim() });
        await loadTemplates();
        backToList();
      } else if (editorMode === 'edit' && selectedTemplateId) {
        if (form.status === 'EFFECTIVE') {
          const { status, ...metadata } = formToSettingsPayload(form);
          await api.updateAssessmentChecklistTemplateSettings(selectedTemplateId, metadata);
          const data = (await api.activateAssessmentChecklistTemplate(selectedTemplateId)) as AssessmentChecklistTemplate;
          applyTemplateData(data, activeQuestionKey);
          setEditorMode('view');
          setSuccessMessage('Template activated and marked as effective.');
        } else {
          const data = (await api.updateAssessmentChecklistTemplateSettings(
            selectedTemplateId,
            formToSettingsPayload(form),
          )) as AssessmentChecklistTemplate;
          applyTemplateData(data, activeQuestionKey);
          if (form.status === 'DEPRECATED') {
            setEditorMode('view');
            setSuccessMessage('Template marked as deprecated.');
          } else {
            setSuccessMessage('Template settings saved.');
          }
        }
      }
      await loadTemplates();
    } catch (err: any) {
      setError(err?.message || 'Failed to save template');
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleActivate(templateId: string) {
    setError('');
    try {
      await api.activateAssessmentChecklistTemplate(templateId);
      await loadTemplates();
    } catch (err: any) {
      setError(err?.message || 'Failed to activate template');
    }
  }

  async function confirmDeprecate() {
    if (!deprecateTarget) return;
    setError('');
    setSuccessMessage('');
    try {
      const data = (await api.deprecateAssessmentChecklistTemplate(deprecateTarget.template_id)) as AssessmentChecklistTemplate;
      setDeprecateTarget(null);
      await loadTemplates();
      if (selectedTemplateId === data.template_id) {
        applyTemplateData(data, activeQuestionKey);
        setEditorMode('view');
      }
      setSuccessMessage('Template deprecated.');
    } catch (err: any) {
      setError(err?.message || 'Failed to deprecate template');
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setError('');
    try {
      await api.deleteAssessmentChecklistTemplate(deleteTarget.template_id);
      setDeleteTarget(null);
      await loadTemplates();
      if (selectedTemplateId === deleteTarget.template_id) backToList();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete template');
    }
  }

  async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    setError('');
    setSuccessMessage('');
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) {
      setImportFile(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith('.json')) {
      setImportFile(null);
      setError('Please select a .json file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setImportFile(null);
      setError('File exceeds maximum size (5 MB)');
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const validationError = validateChecklistImportJson(parsed);
      if (validationError) {
        setImportFile(null);
        setError(validationError);
        return;
      }
      setImportFile(file);
    } catch {
      setImportFile(null);
      setError('Invalid JSON file. Check syntax and try again.');
    }
  }

  async function handleImportTemplate() {
    if (!importFile) {
      setError('Select a JSON file to import');
      return;
    }
    setError('');
    setSuccessMessage('');
    setImportingTemplate(true);
    try {
      const data = (await api.importAssessmentChecklistTemplate(importFile)) as AssessmentChecklistTemplate;
      setImportFile(null);
      await loadTemplates();
      setSuccessMessage(
        `Imported "${data.name}" as version v${data.version_number} (DRAFT). Review and activate when ready.`,
      );
      if (data.template_id) {
        await openTemplate(data.template_id, 'edit');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to import assessment checklist');
    } finally {
      setImportingTemplate(false);
    }
  }

  if (loading) {
    return <div className="text-slate-600 dark:text-slate-400">Loading assessment checklist templates...</div>;
  }

  return (
    <>
      <style>{`
        .checklist-scroll { scrollbar-width: thin; scrollbar-color: #94a3b8 #f1f5f9; }
        .checklist-scroll::-webkit-scrollbar { width: 10px; }
        .checklist-scroll::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 9999px; margin: 4px 0; }
        .checklist-scroll::-webkit-scrollbar-thumb { background: #94a3b8; border-radius: 9999px; border: 2px solid #f1f5f9; }
        .checklist-scroll::-webkit-scrollbar-thumb:hover { background: #64748b; }
        .dark .checklist-scroll { scrollbar-color: #64748b #1e293b; }
        .dark .checklist-scroll::-webkit-scrollbar-track { background: #1e293b; }
        .dark .checklist-scroll::-webkit-scrollbar-thumb { background: #64748b; border-color: #1e293b; }
      `}</style>

      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">AI Assessment Checklist</h3>
            <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
              Each question contributes up to 1 point. Multi-select questions use the average score of selected answers. Assessment total = sum of question scores. Configure penalty factors per answer option.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editorMode !== 'list' && editorMode !== 'clone' && isActiveTemplate && (
              <button
                type="button"
                onClick={() => selectedTemplateMeta && setDeprecateTarget(selectedTemplateMeta)}
                className="inline-flex items-center gap-2 rounded-lg border border-rose-300 px-4 py-2 text-sm text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-900/20"
              >
                <Archive className="h-4 w-4" />
                Deprecate
              </button>
            )}
            {editorMode !== 'list' && canEdit && form.status === 'IN REVIEW' && selectedTemplateId && (
              <button
                type="button"
                disabled={savingTemplate}
                onClick={activateCurrentTemplate}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {savingTemplate ? 'Activating...' : 'Activate'}
              </button>
            )}
            {editorMode !== 'list' && canEdit && (
              <button
                type="button"
                disabled={savingTemplate}
                onClick={handleSaveTemplate}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {savingTemplate ? 'Saving...' : editorMode === 'create' ? 'Create Template' : 'Save Template'}
              </button>
            )}
            {editorMode === 'list' ? (
              <>
                {!hasTemplates && (
                  <button type="button" onClick={startCreateFromScratch} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
                    <Plus className="h-4 w-4" />
                    Create First Template
                  </button>
                )}
                {hasTemplates && (
                  <button type="button" onClick={() => startClone(templates[0])} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                    <Copy className="h-4 w-4" />
                    Clone Latest Template
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => importInputRef.current?.click()}
                  disabled={importingTemplate}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <Upload className="h-4 w-4" />
                  Choose JSON File
                </button>
                {importFile && (
                  <button
                    type="button"
                    onClick={handleImportTemplate}
                    disabled={importingTemplate}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Upload className="h-4 w-4" />
                    {importingTemplate ? 'Importing...' : 'Import Template'}
                  </button>
                )}
              </>
            ) : (
              <button type="button" onClick={backToList} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                Back to List
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}
        {successMessage && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
            {successMessage}
          </div>
        )}

        {editorMode === 'list' && (
          <>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleImportFileChange}
            />
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/30">
              <p className="text-sm font-medium text-slate-900 dark:text-white">Import from JSON</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Upload a checklist JSON file with <code className="text-xs">name</code>,{' '}
                <code className="text-xs">areas</code>, questions, answer options, and optional{' '}
                <code className="text-xs">risk_classification_ranges</code>. The import is validated fully
                before creating a new DRAFT template — nothing is saved if validation fails.
              </p>
              {importFile && (
                <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                  Selected file: <span className="font-medium">{importFile.name}</span>
                </p>
              )}
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-800/60">
                <tr>
                  {['Version', 'Name', 'Questions', 'Total Score', 'Status', 'Created', 'Actions'].map((heading) => (
                    <th key={heading} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-700 dark:bg-slate-900/20">
                {templates.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                      No assessment checklist templates yet.
                    </td>
                  </tr>
                ) : (
                  templates.map((template) => (
                    <tr key={template.template_id}>
                      <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-white">v{template.version_number}</td>
                      <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">{template.name}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{template.question_count ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{template.assessment_total_score ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(template.status, template.is_active)}`}>
                          {template.is_active ? 'ACTIVE' : template.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">
                        {template.created_dt ? new Date(template.created_dt).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => openTemplate(template.template_id, 'view')} title="View"><Eye className="h-4 w-4 text-slate-600 hover:text-blue-600 dark:text-slate-400" /></button>
                          {!template.is_active && ['DRAFT', 'IN REVIEW'].includes(template.status) && (
                            <button type="button" onClick={() => openTemplate(template.template_id, 'edit')} title="Edit"><Edit2 className="h-4 w-4 text-slate-600 hover:text-blue-600 dark:text-slate-400" /></button>
                          )}
                          <button type="button" onClick={() => startClone(template)} title="Clone"><Copy className="h-4 w-4 text-slate-600 hover:text-blue-600 dark:text-slate-400" /></button>
                          {template.is_active && (
                            <button type="button" onClick={() => setDeprecateTarget(template)} title="Deprecate active template"><Archive className="h-4 w-4 text-slate-600 hover:text-rose-600 dark:text-slate-400" /></button>
                          )}
                          {!template.is_active && template.status === 'IN REVIEW' && (
                            <button type="button" onClick={() => handleActivate(template.template_id)} title="Activate (mark effective)"><CheckCircle2 className="h-4 w-4 text-slate-600 hover:text-emerald-600 dark:text-slate-400" /></button>
                          )}
                          {!template.is_active && ['DRAFT', 'IN REVIEW'].includes(template.status) && (
                            <button type="button" onClick={() => setDeleteTarget(template)} title="Delete"><Trash2 className="h-4 w-4 text-slate-600 hover:text-red-600 dark:text-slate-400" /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          </>
        )}

        {editorMode !== 'list' && editorMode !== 'clone' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <label className={labelClass}>Template Name</label>
                  <input type="text" value={form.name} disabled={isReadOnly} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={ASSESSMENT_TEMPLATE_NAME_MAX_LENGTH} className={inputClass} />
                </div>
                {(editorMode === 'edit' || editorMode === 'view') && (
                  <div>
                    <label className={labelClass}>Status</label>
                    <SelectMenu
                      value={form.status}
                      disabled={isReadOnly}
                      onChange={(status) => setForm({ ...form, status: status as typeof form.status })}
                      options={getStatusDropdownOptions(form.status, canEdit).map((status) => ({
                        value: status,
                        label: status,
                      }))}
                      aria-label="Template status"
                    />
                    {canEdit && form.status !== 'DRAFT' && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Set to Effective and save, or use Activate to publish. Set to Deprecated to retire without activating.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-900/40">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Questions</p>
                  <p className="text-lg font-semibold text-slate-900 dark:text-white">{questionCount}</p>
                </div>
                <div className="rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-900/40">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Assessment Total Score</p>
                  <p className="text-lg font-semibold text-slate-900 dark:text-white">{assessmentTotalScore}</p>
                  <p className="text-xs text-slate-500">{questionCount} × {QUESTION_BASE_SCORE_TOTAL}</p>
                </div>
                <div className="rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-900/40">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Complete Questions</p>
                  <p className="text-lg font-semibold text-slate-900 dark:text-white">
                    {form.areas.reduce((count, area) => count + area.items.filter((item) => isQuestionComplete(item)).length, 0)} / {questionCount}
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <h4 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Risk Classification Ranges</h4>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-600">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-900/40">
                      <tr>
                        <th className={tableHeadClass}>Level</th>
                        <th className={tableHeadClass}>Min Score</th>
                        <th className={tableHeadClass}>Max Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-600 dark:bg-slate-800/40">
                      {form.risk_classification_ranges.map((row) => (
                        <tr key={row.level}>
                          <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{row.level}</td>
                          <td className={readOnlyCellClass}>
                            {canEdit ? (
                              <input type="number" min={0} max={assessmentTotalScore} step={0.0001} value={row.min_score} onChange={(e) => updateRiskRange(row.level, { min_score: Number(e.target.value) })} className={inputClass} />
                            ) : row.min_score}
                          </td>
                          <td className={readOnlyCellClass}>
                            {canEdit ? (
                              <input type="number" min={0} max={assessmentTotalScore} step={0.0001} value={row.max_score} onChange={(e) => updateRiskRange(row.level, { max_score: Number(e.target.value) })} className={inputClass} />
                            ) : row.max_score}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
              <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                <div className="border-b border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Assessment Areas</h4>
                    {canEdit && selectedTemplateId && (
                      <button type="button" onClick={handleAddArea} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200">
                        <Plus className="h-3 w-3" />
                        Add Area
                      </button>
                    )}
                  </div>
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search areas or questions..."
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                  />
                </div>

                <div className={scrollPanelClass}>
                  {visibleAreas.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">No matching areas or questions.</p>
                  ) : (
                    visibleAreas.map((area) => {
                      const areaIndex = form.areas.findIndex((candidate) =>
                        candidate.area_id ? candidate.area_id === area.area_id : candidate.seq_no === area.seq_no,
                      );
                      if (areaIndex < 0) return null;
                      const isExpanded = expandedAreaKeys.has(areaIndex);
                      return (
                        <div key={`area-${area.area_id ?? area.seq_no}`} className="border-b border-slate-100 dark:border-slate-700">
                          <button
                            type="button"
                            onClick={() => toggleArea(areaIndex)}
                            className="flex w-full items-start gap-2 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-900/30"
                          >
                            {isExpanded ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />}
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Area {area.seq_no}</p>
                              {canEdit ? (
                                <input
                                  type="text"
                                  value={form.areas[areaIndex].title}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => updateArea(areaIndex, { title: e.target.value })}
                                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                                />
                              ) : (
                                <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{area.title}</p>
                              )}
                              <p className="mt-1 text-xs text-slate-500">{area.items.length} question{area.items.length === 1 ? '' : 's'}</p>
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="pb-2">
                              {area.items.map((item, itemIndex) => {
                                const key = questionKey(areaIndex, itemIndex);
                                const isActive = activeQuestionKey === key;
                                const complete = isQuestionComplete(item);
                                return (
                                  <button
                                    key={key}
                                    type="button"
                                    onClick={() => setActiveQuestionKey(key)}
                                    className={`ml-6 mr-2 flex w-[calc(100%-1.5rem)] items-start justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                                      isActive ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-900/20'
                                    }`}
                                  >
                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">{item.sno}</p>
                                      <p className="line-clamp-2 text-sm text-slate-800 dark:text-slate-200">{item.assessment_item || 'Untitled question'}</p>
                                    </div>
                                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${complete ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                                      {complete ? 'Ready' : 'Draft'}
                                    </span>
                                  </button>
                                );
                              })}
                              {canEdit && selectedTemplateId && (
                                <button
                                  type="button"
                                  onClick={() => handleAddQuestion(areaIndex)}
                                  className="ml-6 mt-1 inline-flex items-center gap-1 px-3 py-1.5 text-xs text-blue-600 hover:text-blue-700"
                                >
                                  <Plus className="h-3 w-3" />
                                  Add Question
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                {!activeQuestion ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">Select a question from an assessment area to {canEdit ? 'edit' : 'view'} it.</p>
                ) : (
                  <>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">Question {activeQuestion.item.sno}</p>
                        <p className="text-xs text-slate-500">{activeQuestion.area.title}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => navigateQuestion(-1)} className="rounded-lg border border-slate-300 p-2 dark:border-slate-600"><ChevronLeft className="h-4 w-4" /></button>
                        <button type="button" onClick={() => navigateQuestion(1)} className="rounded-lg border border-slate-300 p-2 dark:border-slate-600"><ChevronRight className="h-4 w-4" /></button>
                        {canEdit && (
                          <button
                            type="button"
                            disabled={savingQuestion}
                            onClick={handleSaveQuestion}
                            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <Save className="h-4 w-4" />
                            {savingQuestion ? 'Saving...' : 'Save Question'}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className={labelClass}>Question Text</label>
                        {canEdit ? (
                          <textarea value={activeQuestion.item.assessment_item} onChange={(e) => updateItem(activeQuestion.areaIndex, activeQuestion.itemIndex, { assessment_item: e.target.value })} maxLength={ASSESSMENT_ITEM_MAX_LENGTH} rows={3} className={inputClass} />
                        ) : (
                          <p className="text-sm text-slate-700 dark:text-slate-300">{activeQuestion.item.assessment_item}</p>
                        )}
                      </div>

                      <div>
                        <label className={labelClass}>Category</label>
                        {canEdit ? (
                          <SelectMenu
                            value={activeQuestion.item.category}
                            onChange={(category) => updateItem(activeQuestion.areaIndex, activeQuestion.itemIndex, { category: category as typeof activeQuestion.item.category })}
                            placeholder="Select category"
                            options={ASSESSMENT_ITEM_CATEGORIES.map((category) => ({ value: category, label: category }))}
                            aria-label="Category"
                          />
                        ) : (
                          <p className="text-sm text-slate-700 dark:text-slate-300">{activeQuestion.item.category}</p>
                        )}
                      </div>

                      <div>
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Answer Options</label>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                            Question score: {QUESTION_BASE_SCORE_TOTAL}
                          </span>
                        </div>

                        {activeQuestion.item.allowed_checklist_items.length > 0 ? (
                          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-600">
                            <table className="min-w-full text-sm">
                              <thead className="bg-slate-50 dark:bg-slate-900/40">
                                <tr>
                                  <th className={tableHeadClass}>Answer</th>
                                  <th className={`w-32 ${tableHeadClass}`}>Penalty Factor</th>
                                  {canEdit && <th className="w-12 px-3 py-2" />}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-600 dark:bg-slate-800/40">
                                {activeQuestion.item.allowed_checklist_items.map((answer, answerIndex) => (
                                  <tr key={`${activeQuestion.item.sno}-${answerIndex}`}>
                                    <td className={readOnlyCellClass}>
                                      {canEdit ? (
                                        <input type="text" value={answer.label} onChange={(e) => {
                                          const answers = [...activeQuestion.item.allowed_checklist_items];
                                          answers[answerIndex] = { ...answers[answerIndex], label: e.target.value };
                                          updateItem(activeQuestion.areaIndex, activeQuestion.itemIndex, { allowed_checklist_items: answers });
                                        }} className={inputClass} />
                                      ) : answer.label}
                                    </td>
                                    <td className={readOnlyCellClass}>
                                      {canEdit ? (
                                        <input type="number" min={0} step={0.0001} value={answer.penalty_factor} onChange={(e) => {
                                          const answers = [...activeQuestion.item.allowed_checklist_items];
                                          answers[answerIndex] = { ...answers[answerIndex], penalty_factor: clampPenaltyFactor(Number(e.target.value)) };
                                          updateItem(activeQuestion.areaIndex, activeQuestion.itemIndex, { allowed_checklist_items: answers });
                                        }} className={inputClass} />
                                      ) : answer.penalty_factor}
                                    </td>
                                    {canEdit && (
                                      <td className="px-3 py-2">
                                        <button type="button" onClick={() => {
                                          updateItem(activeQuestion.areaIndex, activeQuestion.itemIndex, {
                                            allowed_checklist_items: activeQuestion.item.allowed_checklist_items.filter((_, index) => index !== answerIndex),
                                          });
                                        }} className="text-red-600 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-600">No answers yet.</p>
                        )}

                        {canEdit && (
                          <div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-900/30">
                            <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">Add answer option</p>
                            <div className="grid gap-2 md:grid-cols-[1fr_120px_auto]">
                              <input type="text" value={answerDraft.label} onChange={(e) => setAnswerDraft({ ...answerDraft, label: e.target.value })} placeholder="Answer text" className={inputClass} />
                              <input type="number" min={0} step={0.0001} value={answerDraft.penalty_factor} onChange={(e) => setAnswerDraft({ ...answerDraft, penalty_factor: clampPenaltyFactor(Number(e.target.value)) })} placeholder="Penalty" className={inputClass} />
                              <button type="button" onClick={() => addAnswerOption(activeQuestion.areaIndex, activeQuestion.itemIndex)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700">Add</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {editorMode === 'clone' && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
            <label className={labelClass}>New Version Name</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${inputClass} max-w-xl`} />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={backToList} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300">Cancel</button>
              <button type="button" disabled={savingTemplate} onClick={handleSaveTemplate} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
                {savingTemplate ? 'Creating...' : 'Create Cloned Version'}
              </button>
            </div>
          </div>
        )}

        <ConfirmModal isOpen={!!deleteTarget} title="Delete Template" message={`Delete template "${deleteTarget?.name || ''}"? This action cannot be undone.`} confirmText="Delete" onConfirm={confirmDelete} onClose={() => setDeleteTarget(null)} />
        <ConfirmModal
          isOpen={!!deprecateTarget}
          title="Deprecate Template"
          message={`Deprecate "${deprecateTarget?.name || ''}"? It will no longer be the active checklist.`}
          confirmText="Deprecate"
          onConfirm={confirmDeprecate}
          onClose={() => setDeprecateTarget(null)}
        />
      </div>
    </>
  );
}
