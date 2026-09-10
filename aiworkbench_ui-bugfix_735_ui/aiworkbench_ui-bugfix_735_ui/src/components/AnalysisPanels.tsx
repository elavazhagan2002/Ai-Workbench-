import AIFieldAssist from './AIFieldAssist';
import {
  BUSINESS_REQUIRED_FIELDS,
  CURRENT_EFFORT_OPTIONS,
  DATA_PRIVACY_SECURITY_OPTIONS,
  EFFICIENCY_IMPACT_OPTIONS,
  FREQUENCY_OF_TASK_OPTIONS,
  HOST_SYSTEM_CAPABILITY_OPTIONS,
  OPERATIONAL_COMPLIANCE_RISK_OPTIONS,
  PROCESS_IMPACT_OPTIONS,
  QUALITY_COMPLIANCE_IMPACT_OPTIONS,
  TECHNICAL_REQUIRED_FIELDS,
  TOOL_COMPLEXITY_OPTIONS,
  USER_GROUP_SIZE_OPTIONS,
  USER_URGENCY_OPTIONS,
} from '../constants/analysisOptions';
import { AI_CATEGORY_OPTIONS } from '../constants/aiCategories';
import {
  TARGET_AUDIENCE_TYPE_OPTIONS,
  type TargetAudienceType,
} from '../constants/targetAudienceTypes';
import { useEffect, useMemo, useState } from 'react';
import { Check, Pencil } from 'lucide-react';

type FormShape = {
  use_case_title: string;
  use_case_description: string;
  intended_use: string;
  expected_benefits: string;
  ai_category: string;
  feasibility: string;
  intended_audience: string;
  target_audience_type: TargetAudienceType[];
  impacted_stakeholders: string[];
  solution_design_overview: string;
  human_in_loop_strategy: string;
  bias_assessment_performed: boolean;
  protected_attributes: string;
  balancing_strategy: string;
  frequency_of_task: string;
  current_effort: string;
  user_group_size: string;
  efficiency_impact: string;
  quality_compliance_impact: string;
  user_urgency: string;
  process_impact: string;
  operational_compliance_risk: string;
  tool_complexity: string;
  host_system_capability: string;
  data_privacy_security: string;
  tags: string[];
};

interface AnalysisPanelsProps {
  track: 'technical' | 'business';
  formData: FormShape;
  setFormData: (updater: FormShape | ((prev: FormShape) => FormShape)) => void;
  isReadOnly: boolean;
  canEditTrack: boolean;
  canComplete: boolean;
  completed: boolean;
  canReject: boolean;
  canUseAI: boolean;
  solutionMax: number;
  onComplete: () => void;
  onRejectClick: () => void;
  onSave: (e: React.FormEvent) => void | boolean | Promise<void | boolean>;
  sharedAIContext: Record<string, unknown>;
  tagInput: string;
  setTagInput: (v: string) => void;
  impactedStakeholderInput: string;
  setImpactedStakeholderInput: (v: string) => void;
}

function SurveyQuestion({
  number,
  title,
  help,
  required,
  invalid,
  fieldKey,
  children,
}: {
  number: number;
  title: string;
  help?: string;
  required?: boolean;
  invalid?: boolean;
  fieldKey?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={fieldKey ? `analysis-field-${fieldKey}` : undefined}
      className={`rounded-2xl border p-5 lg:p-6 ${
        invalid
          ? 'border-red-400 bg-red-50/40 dark:border-red-500/70 dark:bg-red-950/20'
          : 'border-line bg-surface-elevated'
      }`}
    >
      <div className="flex gap-4">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white tabular-nums ${
            invalid ? 'bg-red-600' : 'bg-navy-600'
          }`}
          aria-hidden
        >
          {number}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h4 className="font-display text-sm font-semibold text-ink">
              {title}
              {required ? <span className="ml-1 text-red-500">*</span> : null}
            </h4>
            {help ? <p className="mt-1 text-xs leading-relaxed text-ink-muted">{help}</p> : null}
            {invalid ? (
              <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">This field is required.</p>
            ) : null}
          </div>
          <div className="pt-0.5">{children}</div>
        </div>
      </div>
    </section>
  );
}

function choiceClass(selected: boolean, locked: boolean) {
  return [
    'relative flex items-start gap-3 rounded-xl border px-3.5 py-3 text-sm transition',
    selected
      ? 'border-cyan-500 bg-cyan-500/15 text-ink ring-2 ring-cyan-400/50 shadow-[0_0_0_1px_rgba(34,211,238,0.35)] font-semibold'
      : 'border-line bg-surface-muted/40 text-ink-muted',
    locked
      ? 'pointer-events-none cursor-default'
      : 'cursor-pointer hover:border-cyan-400/50 hover:bg-surface-muted',
  ].join(' ');
}

function RadioOptionGroup({
  name,
  value,
  options,
  disabled,
  onChange,
  columns = 1,
}: {
  name: string;
  value: string;
  options: readonly string[];
  disabled: boolean;
  onChange: (v: string) => void;
  columns?: 1 | 2;
}) {
  return (
    <div
      className={`grid gap-2 ${columns === 2 ? 'sm:grid-cols-2' : 'grid-cols-1'}`}
      role="radiogroup"
      aria-label={name}
    >
      {options.map((opt) => {
        const selected = value === opt;
        return (
          <label
            key={opt}
            className={choiceClass(selected, disabled)}
          >
            <input
              type="radio"
              name={name}
              value={opt}
              disabled={disabled}
              checked={selected}
              onChange={() => onChange(opt)}
              className="sr-only"
            />
            <span
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                selected
                  ? 'border-cyan-500 bg-cyan-500 text-white'
                  : 'border-slate-400 dark:border-slate-500 bg-transparent'
              }`}
              aria-hidden
            >
              {selected ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
            </span>
            <span className="leading-snug">{opt}</span>
            {selected ? (
              <span className="absolute right-2 top-2 rounded-full bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
                Selected
              </span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}

function ChipInput({
  value,
  disabled,
  placeholder,
  chips,
  onChange,
  onAdd,
  onRemove,
}: {
  value: string;
  disabled: boolean;
  placeholder: string;
  chips: string[];
  onChange: (v: string) => void;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const next = value.trim();
              if (next) onAdd(next);
            }
          }}
          className="wb-input sm:flex-1"
          placeholder={placeholder}
        />
        <button
          type="button"
          disabled={disabled || !value.trim()}
          onClick={() => {
            const next = value.trim();
            if (next) onAdd(next);
          }}
          className="wb-btn-secondary shrink-0"
        >
          Add
        </button>
      </div>
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <span
              key={chip}
              className="inline-flex items-center gap-1.5 rounded-full bg-navy-50 px-2.5 py-1 text-xs font-medium text-navy-700 dark:bg-navy-900/40 dark:text-cyan-200"
            >
              {chip}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onRemove(chip)}
                  className="rounded-full p-0.5 hover:bg-navy-100 dark:hover:bg-navy-800"
                  aria-label={`Remove ${chip}`}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs italic text-ink-subtle">None added yet.</p>
      )}
    </div>
  );
}

export default function AnalysisPanels({
  track,
  formData,
  setFormData,
  isReadOnly,
  canEditTrack,
  canComplete,
  completed,
  canReject,
  canUseAI,
  solutionMax,
  onComplete,
  onRejectClick,
  onSave,
  sharedAIContext,
  tagInput,
  setTagInput,
  impactedStakeholderInput,
  setImpactedStakeholderInput,
}: AnalysisPanelsProps) {
  const canOpenEditor = canEditTrack && !completed && !isReadOnly;
  const [isEditing, setIsEditing] = useState(canOpenEditor);
  const locked = completed || isReadOnly || !canEditTrack || !isEditing;
  const disabled = locked;
  const trackLabel = track === 'technical' ? 'Technical' : 'Business';
  const [showValidation, setShowValidation] = useState(false);

  useEffect(() => {
    if (completed || isReadOnly || !canEditTrack) {
      setIsEditing(false);
    }
  }, [completed, isReadOnly, canEditTrack]);

  const missingRequired = useMemo(() => {
    const required = track === 'technical' ? TECHNICAL_REQUIRED_FIELDS : BUSINESS_REQUIRED_FIELDS;
    const missing: { key: string; label: string }[] = [];
    for (const field of required) {
      const raw = (formData as Record<string, unknown>)[field.key];
      const blank =
        raw == null ||
        (typeof raw === 'string' && !raw.trim()) ||
        (Array.isArray(raw) && raw.length === 0);
      if (blank) missing.push({ key: field.key, label: field.label });
    }
    return missing;
  }, [formData, track]);

  const missingKeys = useMemo(() => new Set(missingRequired.map((m) => m.key)), [missingRequired]);

  let surveyHint = 'Answer each required question (*) below, then save. Complete only when all required fields are filled.';
  if (completed) {
    surveyHint = 'This track is marked completed. Answers are locked for every role.';
  } else if (locked && canOpenEditor) {
    surveyHint = 'Saved answers are view-only. Click Edit to make changes.';
  } else if (locked) {
    surveyHint = 'View-only for your role on this track.';
  }

  function handleCompleteClick() {
    if (missingRequired.length > 0) {
      setShowValidation(true);
      const first = missingRequired[0];
      const el = document.getElementById(`analysis-field-${first.key}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setShowValidation(false);
    onComplete();
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = await onSave(e);
    if (result !== false) {
      setIsEditing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div
        id="analysis-complete-section"
        className="wb-card-pad flex flex-wrap items-start justify-between gap-3 scroll-mt-24 transition-shadow duration-300"
      >
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-600 dark:text-cyan-400">
            Analysis survey
          </p>
          <h3 className="font-display mt-1 text-lg font-semibold text-ink">
            {trackLabel} Analysis
          </h3>
          <p className="wb-page-subtitle">{surveyHint}</p>
          {showValidation && missingRequired.length > 0 && (
            <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
              Fill required fields before completing: {missingRequired.map((m) => m.label).join(', ')}.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canOpenEditor && locked && (
            <button type="button" onClick={() => setIsEditing(true)} className="wb-btn-secondary">
              <Pencil className="h-4 w-4" />
              Edit {trackLabel} Analysis
            </button>
          )}
          {canReject && !completed && (
            <button type="button" onClick={onRejectClick} className="wb-btn-secondary border-red-300 text-red-700 dark:border-red-800 dark:text-red-300">
              Reject assignment
            </button>
          )}
          {canComplete && !completed && (
            <button
              type="button"
              onClick={handleCompleteClick}
              className="wb-btn-primary bg-emerald-600 hover:bg-emerald-700"
              title={
                missingRequired.length > 0
                  ? `Required: ${missingRequired.map((m) => m.label).join(', ')}`
                  : undefined
              }
            >
              Analysis completed
            </button>
          )}
        </div>
      </div>

      <form
        onSubmit={handleFormSubmit}
        className={`space-y-4 ${locked ? 'pointer-events-none select-none' : ''}`}
      >
        {track === 'technical' ? (
          <>
            <SurveyQuestion
              number={1}
              title="AI Category"
              help="Select the primary AI capability category for this use case."
              required
              fieldKey="ai_category"
              invalid={showValidation && missingKeys.has('ai_category')}
            >
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="AI Category">
                {AI_CATEGORY_OPTIONS.map((opt) => {
                  const selected = formData.ai_category === opt.value;
                  return (
                    <label
                      key={opt.value}
                      className={choiceClass(selected, disabled)}
                    >
                      <input
                        type="radio"
                        name="ai_category"
                        value={opt.value}
                        disabled={disabled}
                        checked={selected}
                        onChange={() => setFormData({ ...formData, ai_category: opt.value })}
                        className="sr-only"
                      />
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                          selected
                            ? 'border-cyan-500 bg-cyan-500 text-white'
                            : 'border-slate-400 dark:border-slate-500 bg-transparent'
                        }`}
                        aria-hidden
                      >
                        {selected ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                      </span>
                      <span className="leading-snug">{opt.label}</span>
                      {selected ? (
                        <span className="absolute right-2 top-2 rounded-full bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
                          Selected
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </SurveyQuestion>

            <SurveyQuestion
              number={2}
              title="Tool Complexity"
              help="How difficult is the AI integration / prompt engineering to build and maintain?"
              required
              fieldKey="tool_complexity"
              invalid={showValidation && missingKeys.has('tool_complexity')}
            >
              <RadioOptionGroup
                name="tool_complexity"
                value={formData.tool_complexity}
                options={TOOL_COMPLEXITY_OPTIONS}
                disabled={disabled}
                onChange={(v) => setFormData({ ...formData, tool_complexity: v })}
              />
            </SurveyQuestion>

            <SurveyQuestion
              number={3}
              title="Host System Capability"
              help="How natively supported is this AI capability on the host system roadmap?"
              required
              fieldKey="host_system_capability"
              invalid={showValidation && missingKeys.has('host_system_capability')}
            >
              <RadioOptionGroup
                name="host_system_capability"
                value={formData.host_system_capability}
                options={HOST_SYSTEM_CAPABILITY_OPTIONS}
                disabled={disabled}
                onChange={(v) => setFormData({ ...formData, host_system_capability: v })}
              />
            </SurveyQuestion>

            <SurveyQuestion
              number={4}
              title="Technical Feasibility (auto-calculated)"
              help="Derived from Tool Complexity + Host System Capability."
            >
              <input
                value={formData.feasibility || '—'}
                readOnly
                className="wb-input bg-surface-muted cursor-default"
              />
            </SurveyQuestion>

            <SurveyQuestion
              number={5}
              title="Data Privacy & Security"
              help="Consider 3rd-party AI exposure, vault access bypass, and data inference risk."
              required
              fieldKey="data_privacy_security"
              invalid={showValidation && missingKeys.has('data_privacy_security')}
            >
              <RadioOptionGroup
                name="data_privacy_security"
                value={formData.data_privacy_security}
                options={DATA_PRIVACY_SECURITY_OPTIONS}
                disabled={disabled}
                columns={2}
                onChange={(v) => setFormData({ ...formData, data_privacy_security: v })}
              />
            </SurveyQuestion>

            <SurveyQuestion
              number={6}
              title={`Solution Design Overview (${solutionMax} chars max)`}
              help="Describe the proposed technical approach, architecture, and key integration points."
            >
              <AIFieldAssist
                inputId="tech-solution-design"
                label=""
                fieldLabel="Solution Design"
                fieldName="solution_design_overview"
                value={formData.solution_design_overview}
                maxLength={solutionMax}
                canUseAI={canUseAI && !disabled}
                context={sharedAIContext as any}
                onApply={(v) => setFormData({ ...formData, solution_design_overview: v })}
              >
                <textarea
                  id="tech-solution-design"
                  value={formData.solution_design_overview}
                  disabled={disabled}
                  maxLength={solutionMax}
                  rows={5}
                  onChange={(e) => setFormData({ ...formData, solution_design_overview: e.target.value })}
                  className="wb-input resize-y"
                  placeholder="Outline components, data flows, and key design decisions…"
                />
              </AIFieldAssist>
              <p className="mt-1 text-xs tabular-nums text-ink-subtle">
                {formData.solution_design_overview.length}/{solutionMax}
              </p>
            </SurveyQuestion>

            <SurveyQuestion
              number={7}
              title="Tags"
              help="Add keywords that help classify and find this use case."
            >
              <ChipInput
                value={tagInput}
                disabled={disabled}
                placeholder="Type a tag and press Enter or Add"
                chips={formData.tags}
                onChange={setTagInput}
                onAdd={(t) => {
                  if (!formData.tags.includes(t)) {
                    setFormData({ ...formData, tags: [...formData.tags, t] });
                  }
                  setTagInput('');
                }}
                onRemove={(tag) =>
                  setFormData({ ...formData, tags: formData.tags.filter((x) => x !== tag) })
                }
              />
            </SurveyQuestion>
          </>
        ) : (
          <>
            <SurveyQuestion number={1} title="Intended Audience" help="Who primarily uses or benefits from this use case?">
              <input
                value={formData.intended_audience}
                disabled={disabled}
                maxLength={200}
                onChange={(e) => setFormData({ ...formData, intended_audience: e.target.value })}
                className="wb-input"
                placeholder="e.g. Claims operations team"
              />
            </SurveyQuestion>

            <SurveyQuestion
              number={2}
              title="Target Audience Type"
              help="Select all that apply."
            >
              <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Target audience type">
                {TARGET_AUDIENCE_TYPE_OPTIONS.map((opt) => {
                  const checked = formData.target_audience_type.includes(opt);
                  return (
                    <label
                      key={opt}
                      className={choiceClass(checked, disabled)}
                    >
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...formData.target_audience_type, opt]
                            : formData.target_audience_type.filter((t) => t !== opt);
                          setFormData({ ...formData, target_audience_type: next });
                        }}
                        className="h-4 w-4 rounded border-line text-cyan-600 focus:ring-cyan-500"
                      />
                      {opt}
                    </label>
                  );
                })}
              </div>
            </SurveyQuestion>

            <SurveyQuestion number={3} title="Impacted Stakeholders" help="Teams or roles affected by this use case.">
              <ChipInput
                value={impactedStakeholderInput}
                disabled={disabled}
                placeholder="Add stakeholder and press Enter or Add"
                chips={formData.impacted_stakeholders}
                onChange={setImpactedStakeholderInput}
                onAdd={(t) => {
                  if (!formData.impacted_stakeholders.includes(t)) {
                    setFormData({
                      ...formData,
                      impacted_stakeholders: [...formData.impacted_stakeholders, t],
                    });
                  }
                  setImpactedStakeholderInput('');
                }}
                onRemove={(s) =>
                  setFormData({
                    ...formData,
                    impacted_stakeholders: formData.impacted_stakeholders.filter((x) => x !== s),
                  })
                }
              />
            </SurveyQuestion>

            <SurveyQuestion
              number={4}
              title="Human-in-the-loop Strategy"
              help="How will humans review, override, or supervise the AI outputs?"
            >
              <textarea
                value={formData.human_in_loop_strategy}
                disabled={disabled}
                maxLength={500}
                rows={3}
                onChange={(e) => setFormData({ ...formData, human_in_loop_strategy: e.target.value })}
                className="wb-input resize-y"
                placeholder="Describe review checkpoints and escalation paths…"
              />
            </SurveyQuestion>

            <SurveyQuestion
              number={5}
              title="Fairness & Bias Assessment"
              help="Indicate whether assessment was performed and capture protected attributes / balancing strategy."
            >
              <div className="space-y-4">
                <label
                  className={choiceClass(formData.bias_assessment_performed, disabled)}
                >
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={formData.bias_assessment_performed}
                    onChange={(e) => setFormData({ ...formData, bias_assessment_performed: e.target.checked })}
                    className="h-4 w-4 rounded border-line text-cyan-600 focus:ring-cyan-500"
                  />
                  Fairness &amp; bias assessment performed
                </label>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                      Protected attributes
                    </label>
                    <input
                      value={formData.protected_attributes}
                      disabled={disabled}
                      maxLength={500}
                      onChange={(e) => setFormData({ ...formData, protected_attributes: e.target.value })}
                      className="wb-input"
                      placeholder="e.g. age, gender, geography"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                      Balancing strategy
                    </label>
                    <textarea
                      value={formData.balancing_strategy}
                      disabled={disabled}
                      maxLength={1000}
                      rows={3}
                      onChange={(e) => setFormData({ ...formData, balancing_strategy: e.target.value })}
                      className="wb-input resize-y"
                      placeholder="How bias will be monitored or mitigated…"
                    />
                  </div>
                </div>
              </div>
            </SurveyQuestion>

            <SurveyQuestion
              number={6}
              title="Frequency of Task"
              help="How frequently is this process carried out?"
              required
              fieldKey="frequency_of_task"
              invalid={showValidation && missingKeys.has('frequency_of_task')}
            >
              <RadioOptionGroup
                name="frequency_of_task"
                value={formData.frequency_of_task}
                options={FREQUENCY_OF_TASK_OPTIONS}
                disabled={disabled}
                columns={2}
                onChange={(v) => setFormData({ ...formData, frequency_of_task: v })}
              />
            </SurveyQuestion>

            <SurveyQuestion
              number={7}
              title="Current Effort"
              help="How long does it currently take?"
              required
              fieldKey="current_effort"
              invalid={showValidation && missingKeys.has('current_effort')}
            >
              <RadioOptionGroup
                name="current_effort"
                value={formData.current_effort}
                options={CURRENT_EFFORT_OPTIONS}
                disabled={disabled}
                columns={2}
                onChange={(v) => setFormData({ ...formData, current_effort: v })}
              />
            </SurveyQuestion>

            <SurveyQuestion
              number={8}
              title="User Group Size"
              help="How large is the user group?"
              required
              fieldKey="user_group_size"
              invalid={showValidation && missingKeys.has('user_group_size')}
            >
              <RadioOptionGroup
                name="user_group_size"
                value={formData.user_group_size}
                options={USER_GROUP_SIZE_OPTIONS}
                disabled={disabled}
                columns={2}
                onChange={(v) => setFormData({ ...formData, user_group_size: v })}
              />
            </SurveyQuestion>

            <SurveyQuestion
              number={9}
              title="Efficiency Impact"
              help="% of process expected to be automated."
              required
              fieldKey="efficiency_impact"
              invalid={showValidation && missingKeys.has('efficiency_impact')}
            >
              <RadioOptionGroup
                name="efficiency_impact"
                value={formData.efficiency_impact}
                options={EFFICIENCY_IMPACT_OPTIONS}
                disabled={disabled}
                columns={2}
                onChange={(v) => setFormData({ ...formData, efficiency_impact: v })}
              />
            </SurveyQuestion>

            <SurveyQuestion
              number={10}
              title="Quality / Compliance Impact"
              required
              fieldKey="quality_compliance_impact"
              invalid={showValidation && missingKeys.has('quality_compliance_impact')}
            >
              <RadioOptionGroup
                name="quality_compliance_impact"
                value={formData.quality_compliance_impact}
                options={QUALITY_COMPLIANCE_IMPACT_OPTIONS}
                disabled={disabled}
                onChange={(v) => setFormData({ ...formData, quality_compliance_impact: v })}
              />
            </SurveyQuestion>

            <SurveyQuestion
              number={11}
              title="User Urgency"
              required
              fieldKey="user_urgency"
              invalid={showValidation && missingKeys.has('user_urgency')}
            >
              <RadioOptionGroup
                name="user_urgency"
                value={formData.user_urgency}
                options={USER_URGENCY_OPTIONS}
                disabled={disabled}
                onChange={(v) => setFormData({ ...formData, user_urgency: v })}
              />
            </SurveyQuestion>

            <SurveyQuestion
              number={12}
              title="Process Impact / Org Alignment"
              required
              fieldKey="process_impact"
              invalid={showValidation && missingKeys.has('process_impact')}
            >
              <RadioOptionGroup
                name="process_impact"
                value={formData.process_impact}
                options={PROCESS_IMPACT_OPTIONS}
                disabled={disabled}
                onChange={(v) => setFormData({ ...formData, process_impact: v })}
              />
            </SurveyQuestion>

            <SurveyQuestion
              number={13}
              title="Operational & Compliance Risk"
              required
              fieldKey="operational_compliance_risk"
              invalid={showValidation && missingKeys.has('operational_compliance_risk')}
            >
              <RadioOptionGroup
                name="operational_compliance_risk"
                value={formData.operational_compliance_risk}
                options={OPERATIONAL_COMPLIANCE_RISK_OPTIONS}
                disabled={disabled}
                columns={2}
                onChange={(v) => setFormData({ ...formData, operational_compliance_risk: v })}
              />
            </SurveyQuestion>
          </>
        )}

        {!disabled && (
          <div className="flex justify-end pt-2">
            <button type="submit" className="wb-btn-primary">
              Save {trackLabel} Analysis
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
