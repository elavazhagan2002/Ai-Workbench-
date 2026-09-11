import { Briefcase, Cpu, Download, TrendingUp, Wallet } from 'lucide-react';
import type { UseCase } from '../types';
import { api } from '../lib/api';
import { isTechnicalAnalysisDocument } from '../utils/useCaseDocuments';
import { getAiCategoryLabel } from '../constants/aiCategories';
import { INTENDED_USE_LABEL } from '../constants/useCaseFieldLabels';
import { BUSINESS_REQUIRED_FIELDS } from '../constants/analysisOptions';
import {
  ESTIMATE_LINE_KEYS,
  ESTIMATE_LINE_LABELS,
  VENDOR_ASSESSMENT_QUESTIONS,
  computeEstimateInvestment,
  computeEstimateTotals,
  isVendorBuild,
  normalizeEstimateData,
} from '../constants/estimateOptions';
import { computeRoiPercent, normalizeRoiData } from '../constants/roiOptions';

function completedSubtitle(
  completed: string | null,
  owner: string | null | undefined,
  fallback: string
): string {
  if (completed && owner) return `Completed ${completed} · ${owner}`;
  if (completed) return `Completed ${completed}`;
  if (owner) return `Owner: ${owner}`;
  return fallback;
}

function yesNo(value: boolean | undefined): string | null {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return null;
}

function formatFeasibility(value: UseCase['feasibility']): string | null {
  if (value === 'Yes') return 'Feasible';
  if (value === 'No') return 'Not feasible';
  if (value === 'Yes (Difficult)') return 'Feasible, with challenges';
  return null;
}

function formatWhen(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString();
}

function formatAmount(currency: string, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function Statement({ label, value }: { label: string; value?: string | null }) {
  const text = (value || '').trim();
  return (
    <div className="border-b border-slate-200 py-5 last:border-b-0 dark:border-slate-700">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      {text ? (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-900 dark:text-slate-100">{text}</p>
      ) : (
        <p className="mt-2 text-sm italic text-slate-400">Not provided</p>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white">
        {(value || '').trim() || <span className="font-normal italic text-slate-400">Not provided</span>}
      </p>
    </div>
  );
}

function ChipList({ label, values }: { label: string; values?: string[] | null }) {
  const items = (values || []).map((item) => item.trim()).filter(Boolean);
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      {items.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={item}
              className="inline-block rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700 dark:bg-slate-700 dark:text-slate-200"
            >
              {item}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-sm italic text-slate-400">Not provided</p>
      )}
    </div>
  );
}

function RecordHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Cpu;
  title: string;
  subtitle?: string | null;
}) {
  return (
    <div className="mb-6 flex items-start gap-3">
      <div className="mt-0.5 rounded-lg bg-slate-100 p-2 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
      </div>
    </div>
  );
}

export function ApprovedTechnicalRecord({ useCase }: { useCase: UseCase }) {
  const completed = formatWhen(useCase.tech_analysis_completed_dt);
  const technicalFiles = (useCase.documents || []).filter(isTechnicalAnalysisDocument);
  return (
    <div>
      <RecordHeader
        icon={Cpu}
        title="Technical analysis record"
        subtitle={completedSubtitle(
          completed,
          useCase.technical_owner_name,
          'Read-only summary of the completed technical track.'
        )}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="AI Category" value={useCase.ai_category ? getAiCategoryLabel(useCase.ai_category) : null} />
        <Fact label="Feasibility" value={formatFeasibility(useCase.feasibility)} />
        <Fact label="Tool Complexity" value={useCase.tool_complexity} />
        <Fact label="Host System Capability" value={useCase.host_system_capability} />
        <Fact label="Data Privacy & Security" value={useCase.data_privacy_security} />
        <Fact label="Deployment Model" value={useCase.deployment_model} />
      </div>
      <div className="mt-4">
        <ChipList label="Tags" values={useCase.tags} />
      </div>
      <Statement label="Solution design overview" value={useCase.solution_design_overview} />
      {technicalFiles.length > 0 ? (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Technical supporting files
          </p>
          <ul className="mt-2 space-y-2">
            {technicalFiles.map((doc) => (
              <li key={doc.document_id} className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-800 dark:text-slate-200">{doc.file_name}</span>
                {doc.document_type ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    {doc.document_type}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={async () => {
                    const { blob, fileName } = await api.downloadUseCaseDocument(
                      useCase.use_case_id,
                      doc.document_id,
                      doc.file_name
                    );
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = fileName;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ApprovedBusinessRecord({ useCase }: { useCase: UseCase }) {
  const completed = formatWhen(useCase.business_analysis_completed_dt);
  return (
    <div>
      <RecordHeader
        icon={Briefcase}
        title="Business analysis record"
        subtitle={completedSubtitle(
          completed,
          useCase.business_owner_name,
          'Read-only summary of the completed business track.'
        )}
      />
      <Statement label="Title" value={useCase.use_case_title} />
      <Statement label="Description" value={useCase.use_case_description} />
      <Statement label={INTENDED_USE_LABEL} value={useCase.intended_use} />
      <Statement label="Expected benefits" value={useCase.expected_benefits} />
      <Statement label="Human oversight strategy" value={useCase.human_in_loop_strategy} />
      <div className="grid grid-cols-1 gap-4 py-5 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Department" value={useCase.department} />
        <Fact label="Intended audience" value={useCase.intended_audience} />
        <Fact
          label="Bias assessment completed"
          value={yesNo(useCase.bias_assessment_performed)}
        />
        <Fact label="Protected attributes" value={useCase.protected_attributes} />
        <Fact label="Fairness approach" value={useCase.balancing_strategy} />
      </div>
      <div className="grid grid-cols-1 gap-4 pb-5 md:grid-cols-2">
        <ChipList label="Audience type" values={useCase.target_audience_type} />
        <ChipList label="Impacted stakeholders" values={useCase.impacted_stakeholders} />
      </div>
      <div className="mt-2 border-t border-slate-200 pt-5 dark:border-slate-700">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Business scoring
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BUSINESS_REQUIRED_FIELDS.map((field) => (
            <Fact
              key={field.key}
              label={field.label}
              value={useCase[field.key] as string | null}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function vendorAnswerLabel(value: 'yes' | 'no' | 'na' | undefined): string {
  if (value === 'yes') return 'Yes';
  if (value === 'no') return 'No';
  if (value === 'na') return 'N/A';
  return 'Not answered';
}

export function ApprovedEstimateRecord({ useCase }: { useCase: UseCase }) {
  const data = normalizeEstimateData(useCase.estimate_data);
  const totals = computeEstimateTotals(data.lines);
  const investment = computeEstimateInvestment(data);
  const completed = formatWhen(useCase.estimate_completed_dt);
  const owner = useCase.estimate_owner_name;

  return (
    <div>
      <RecordHeader
        icon={Wallet}
        title="Estimate record"
        subtitle={[
          completed ? `Completed ${completed}` : null,
          owner ? `Owner: ${owner}` : null,
          `Investment ${formatAmount(data.currency, investment)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <th className="py-2 pr-4 font-semibold">Cost line</th>
              <th className="py-2 pr-4 font-semibold">Type</th>
              <th className="py-2 pr-4 font-semibold">Year 1</th>
              <th className="py-2 pr-4 font-semibold">Year 2</th>
              <th className="py-2 font-semibold">Year 3</th>
            </tr>
          </thead>
          <tbody>
            {ESTIMATE_LINE_KEYS.map((key) => {
              const line = data.lines[key];
              return (
                <tr key={key} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2.5 pr-4 font-medium text-slate-900 dark:text-white">{ESTIMATE_LINE_LABELS[key]}</td>
                  <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">{line?.type || '—'}</td>
                  <td className="py-2.5 pr-4 text-slate-900 dark:text-slate-100">{formatAmount(data.currency, line?.year1)}</td>
                  <td className="py-2.5 pr-4 text-slate-900 dark:text-slate-100">{formatAmount(data.currency, line?.year2)}</td>
                  <td className="py-2.5 text-slate-900 dark:text-slate-100">{formatAmount(data.currency, line?.year3)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="text-sm font-semibold text-slate-900 dark:text-white">
              <td className="py-3 pr-4" colSpan={2}>
                Totals
              </td>
              <td className="py-3 pr-4">{formatAmount(data.currency, totals.year1)}</td>
              <td className="py-3 pr-4">{formatAmount(data.currency, totals.year2)}</td>
              <td className="py-3">{formatAmount(data.currency, totals.year3)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {isVendorBuild(data) ? (
        <div className="mt-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Vendor assessment
          </p>
          <div className="space-y-3">
            {VENDOR_ASSESSMENT_QUESTIONS.map((question) => (
              <div
                key={question.id}
                className="flex flex-col gap-1 border-b border-slate-100 pb-3 last:border-b-0 dark:border-slate-800 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
              >
                <p className="text-sm text-slate-700 dark:text-slate-300">{question.question}</p>
                <p className="shrink-0 text-sm font-medium text-slate-900 dark:text-white">
                  {vendorAnswerLabel(data.vendor_checklist[question.id])}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ApprovedRoiRecord({ useCase }: { useCase: UseCase }) {
  const estimate = normalizeEstimateData(useCase.estimate_data);
  const investment = computeEstimateInvestment(estimate);
  const roi = normalizeRoiData(useCase.roi_data, estimate.currency, investment);
  const roiPercent = computeRoiPercent(roi.totals.total, investment);
  const completed = formatWhen(useCase.roi_completed_dt);
  const owner = useCase.roi_owner_name;

  return (
    <div>
      <RecordHeader
        icon={TrendingUp}
        title="ROI record"
        subtitle={[
          completed ? `Completed ${completed}` : null,
          owner ? `Owner: ${owner}` : null,
          roiPercent == null ? 'ROI N/A' : `ROI ${roiPercent.toFixed(2)}%`,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Fact label="Investment" value={formatAmount(roi.currency, investment)} />
        <Fact label="Total savings" value={formatAmount(roi.currency, roi.totals.total)} />
        <Fact label="ROI" value={roiPercent == null ? 'N/A' : `${roiPercent.toFixed(2)}%`} />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <th className="py-2 pr-4 font-semibold">Category</th>
              <th className="py-2 pr-4 font-semibold">Description</th>
              <th className="py-2 pr-4 font-semibold">Year 1</th>
              <th className="py-2 pr-4 font-semibold">Year 2</th>
              <th className="py-2 font-semibold">Year 3</th>
            </tr>
          </thead>
          <tbody>
            {(roi.rows || []).length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 italic text-slate-400">
                  No ROI rows recorded.
                </td>
              </tr>
            ) : (
              roi.rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2.5 pr-4 font-medium text-slate-900 dark:text-white">{row.category || '—'}</td>
                  <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">{row.description || '—'}</td>
                  <td className="py-2.5 pr-4">{formatAmount(roi.currency, row.year1)}</td>
                  <td className="py-2.5 pr-4">{formatAmount(roi.currency, row.year2)}</td>
                  <td className="py-2.5">{formatAmount(roi.currency, row.year3)}</td>
                </tr>
              ))
            )}
          </tbody>
          {roi.rows.length > 0 ? (
            <tfoot>
              <tr className="text-sm font-semibold text-slate-900 dark:text-white">
                <td className="py-3 pr-4" colSpan={2}>
                  Totals
                </td>
                <td className="py-3 pr-4">{formatAmount(roi.currency, roi.totals.year1)}</td>
                <td className="py-3 pr-4">{formatAmount(roi.currency, roi.totals.year2)}</td>
                <td className="py-3">{formatAmount(roi.currency, roi.totals.year3)}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
