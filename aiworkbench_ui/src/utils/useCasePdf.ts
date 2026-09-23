import type { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BUSINESS_REQUIRED_FIELDS } from '../constants/analysisOptions';
import { getAiCategoryLabel } from '../constants/aiCategories';
import {
  ESTIMATE_LINE_KEYS,
  ESTIMATE_LINE_LABELS,
  computeEstimateInvestment,
  computeEstimateTotals,
  normalizeEstimateData,
} from '../constants/estimateOptions';
import { formatRiskLevel } from '../constants/riskLevels';
import { computeRoiPercent, normalizeRoiData } from '../constants/roiOptions';
import {
  INTENDED_USE_LABEL,
  RISK_DECISION_CONSEQUENCE_LABEL,
  RISK_MODEL_INFLUENCE_LABEL,
} from '../constants/useCaseFieldLabels';
import type {
  UseCase,
  UseCaseAssessment,
  UseCaseComment,
  UseCaseData,
  UseCaseRiskReview,
} from '../types';
import { isTechnicalAnalysisDocument } from './useCaseDocuments';

type PdfDoc = jsPDF & { lastAutoTable?: { finalY: number } };

export type { PdfDoc };

export const PDF_MARGIN = 15;
export const PDF_CONTENT_BOTTOM_Y = 272;
export const PDF_FOOTER_Y = 287;
export const PDF_TABLE_HEAD_COLOR: [number, number, number] = [51, 65, 85];
export const PDF_HEADING_COLOR: [number, number, number] = [30, 41, 59];

const DEFAULT_MARGIN = PDF_MARGIN;
const NOT_PROVIDED = 'Not provided';
const TABLE_HEAD = { fillColor: PDF_TABLE_HEAD_COLOR, fontSize: 9, fontStyle: 'bold' as const };

const WORKFLOW_LINEAR: UseCase['status'][] = [
  'New',
  'Analysis',
  'Review',
  'Estimate',
  'ROI',
  'AI Assessment',
];
const WORKFLOW_STAGES: UseCase['status'][] = [...WORKFLOW_LINEAR, 'Approved', 'Rejected'];

export const USE_CASE_STATUS_PDF_COLORS: Record<string, [number, number, number]> = {
  New: [37, 99, 235],
  Analysis: [202, 138, 4],
  Review: [234, 88, 12],
  Estimate: [79, 70, 229],
  ROI: [13, 148, 136],
  'AI Assessment': [124, 58, 237],
  Approved: [22, 163, 74],
  Rejected: [220, 38, 38],
  Development: [8, 145, 178],
  Testing: [147, 51, 234],
  Production: [5, 150, 105],
  Retired: [100, 116, 139],
};

export type UseCasePdfAuditLog = {
  audit_date: string;
  type?: string | null;
  action?: string | null;
  user_name?: string | null;
  details?: unknown;
};

export type UseCasePdfRelated = {
  dataReqs?: UseCaseData[];
  riskReviews?: UseCaseRiskReview[];
  comments?: UseCaseComment[];
  assessment?: UseCaseAssessment | null;
  auditLogs?: UseCasePdfAuditLog[];
};

export function getTableFinalY(doc: PdfDoc, fallback: number): number {
  return doc.lastAutoTable?.finalY ?? fallback;
}

export function maybeAddPage(doc: PdfDoc, yPos: number, threshold = PDF_CONTENT_BOTTOM_Y - 12): number {
  if (yPos > threshold) {
    doc.addPage();
    return 20;
  }
  return yPos;
}

export function getUseCaseStatusPdfColor(status?: string | null): [number, number, number] {
  return USE_CASE_STATUS_PDF_COLORS[status || ''] || [100, 116, 139];
}

function pageWidthOf(doc: PdfDoc): number {
  return doc.internal.pageSize.getWidth();
}

function displayText(value?: string | null): string {
  const text = String(value ?? '').trim();
  return text || NOT_PROVIDED;
}

function displayList(values?: string[] | null): string {
  const items = (values || []).map((item) => item.trim()).filter(Boolean);
  return items.length ? items.join(', ') : NOT_PROVIDED;
}

function yesNo(value?: boolean | null): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return NOT_PROVIDED;
}

function formatFeasibility(value: UseCase['feasibility']): string {
  if (value === 'Yes') return 'Feasible';
  if (value === 'No') return 'Not feasible';
  if (value === 'Yes (Difficult)') return 'Feasible, with challenges';
  return NOT_PROVIDED;
}

function formatRoleName(value?: string | null): string {
  if (!value) return '';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatWhen(value?: string | null): string {
  if (!value) return NOT_PROVIDED;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return NOT_PROVIDED;
  return parsed.toLocaleString();
}

function formatDateOnly(value?: string | null): string {
  if (!value) return NOT_PROVIDED;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return NOT_PROVIDED;
  return parsed.toLocaleDateString();
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

function humanizeToken(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDetailValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function formatAuditDetails(details: unknown): string {
  if (details == null || details === '') return '—';
  if (typeof details === 'string') return details;
  if (typeof details === 'object') {
    const parts = Object.entries(details as Record<string, unknown>)
      .map(([key, value]) => {
        const formatted = formatDetailValue(value);
        return formatted ? `${key}: ${formatted}` : key;
      });
    return parts.join(', ') || '—';
  }
  return formatDetailValue(details) || '—';
}

export function formatTechnicalOwnerDisplay(useCase: UseCase): string {
  if (useCase.technical_owner_name) {
    const role = useCase.technical_owner_role_name
      ? ` (${formatRoleName(useCase.technical_owner_role_name)})`
      : '';
    const email = useCase.technical_owner_email ? ` — ${useCase.technical_owner_email}` : '';
    return `${useCase.technical_owner_name}${role}${email}`;
  }
  return '—';
}

export function formatBusinessOwnerDisplay(useCase: UseCase): string {
  if (useCase.business_owner_name) {
    const email = useCase.business_owner_email ? ` (${useCase.business_owner_email})` : '';
    return `${useCase.business_owner_name}${email}`;
  }
  return '—';
}

function writeLines(
  doc: PdfDoc,
  lines: string[],
  yPos: number,
  x: number,
  lineHeight = 5,
): number {
  for (const line of lines) {
    yPos = maybeAddPage(doc, yPos);
    doc.text(line, x, yPos);
    yPos += lineHeight;
  }
  return yPos;
}

export function appendSectionHeading(
  doc: PdfDoc,
  title: string,
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  yPos = maybeAddPage(doc, yPos, PDF_CONTENT_BOTTOM_Y - 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...PDF_HEADING_COLOR);
  doc.text(title, marginLeft, yPos);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  return yPos + 8;
}

export function appendEmptyNote(
  doc: PdfDoc,
  text: string,
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  yPos = maybeAddPage(doc, yPos);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(text, marginLeft, yPos);
  doc.setTextColor(0, 0, 0);
  return yPos + 8;
}

export function appendTextSection(
  doc: PdfDoc,
  title: string,
  text: string,
  yPos: number,
  pageWidth: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  yPos = maybeAddPage(doc, yPos, PDF_CONTENT_BOTTOM_Y - 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text(`${title}:`, marginLeft, yPos);
  yPos += 6;
  const body = String(text ?? '').trim() || NOT_PROVIDED;
  doc.setFont('helvetica', body === NOT_PROVIDED ? 'italic' : 'normal');
  if (body === NOT_PROVIDED) doc.setTextColor(100, 116, 139);
  const lines = doc.splitTextToSize(body, pageWidth - marginLeft * 2);
  yPos = writeLines(doc, lines, yPos, marginLeft);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  return yPos + 4;
}

export function buildUseCaseInfoRows(useCase: UseCase): [string, string][] {
  const technicalOwner = formatTechnicalOwnerDisplay(useCase);
  const businessOwner = formatBusinessOwnerDisplay(useCase);
  return [
    ['AI Category', useCase.ai_category ? getAiCategoryLabel(useCase.ai_category) : NOT_PROVIDED],
    ['Department', displayText(useCase.department)],
    ['Feasibility', formatFeasibility(useCase.feasibility)],
    ['Intended Audience', displayText(useCase.intended_audience)],
    ['Audience Type', displayList(useCase.target_audience_type)],
    ['Impacted Stakeholders', displayList(useCase.impacted_stakeholders)],
    ['Initiated By', displayText(useCase.created_by_name)],
    ['Technical Owner', technicalOwner === '—' ? 'Not assigned' : technicalOwner],
    ['Business Owner', businessOwner === '—' ? 'Not assigned' : businessOwner],
    ['Tags', displayList(useCase.tags)],
    ['Bias Assessment Completed', yesNo(useCase.bias_assessment_performed)],
    ['Protected Attributes Considered', displayText(useCase.protected_attributes)],
    ['Fairness Approach', displayText(useCase.balancing_strategy)],
    ['Demo Video', yesNo(!!useCase.has_demo || !!useCase.demo_video_path)],
    ['Created', formatWhen(useCase.created_dt)],
    ['Last Modified', formatWhen(useCase.modified_dt)],
  ];
}

export function appendInfoTable(
  doc: PdfDoc,
  rows: [string, string][],
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  if (rows.length === 0) return yPos;

  autoTable(doc, {
    startY: yPos,
    head: [['Field', 'Value']],
    body: rows,
    theme: 'grid',
    headStyles: TABLE_HEAD,
    styles: { fontSize: 9, cellPadding: 3, overflow: 'linebreak' },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 58 } },
    margin: { left: marginLeft, right: marginLeft, bottom: 16 },
  });

  return getTableFinalY(doc, yPos) + 10;
}

function rejectedStageState(
  stage: UseCase['status'],
  useCase: UseCase,
  assessment?: UseCaseAssessment | null,
): string {
  const completedByStage: Partial<Record<UseCase['status'], boolean>> = {
    New: true,
    Analysis: Boolean(useCase.tech_analysis_completed_dt || useCase.business_analysis_completed_dt),
    Review: Boolean(useCase.estimate_completed_dt || useCase.roi_completed_dt || useCase.assessment_completed_dt || assessment),
    Estimate: Boolean(useCase.estimate_completed_dt),
    ROI: Boolean(useCase.roi_completed_dt),
    'AI Assessment': Boolean(useCase.assessment_completed_dt) || assessment?.status === 'CLOSED',
  };
  return completedByStage[stage] ? 'Completed' : '—';
}

function workflowStageState(
  stage: UseCase['status'],
  useCase: UseCase,
  assessment?: UseCaseAssessment | null,
): string {
  const current = useCase.status;
  if (stage === current) return 'Current';
  if (current === 'Approved') return WORKFLOW_LINEAR.includes(stage) ? 'Completed' : '—';
  if (current === 'Rejected') return rejectedStageState(stage, useCase, assessment);

  const currentIdx = WORKFLOW_LINEAR.indexOf(current);
  const stageIdx = WORKFLOW_LINEAR.indexOf(stage);
  if (stageIdx >= 0 && currentIdx >= 0) {
    return stageIdx < currentIdx ? 'Completed' : 'Upcoming';
  }
  if (stage === 'Approved') return 'Upcoming';
  if (stage === 'Rejected') return 'Available';
  return '—';
}

export function appendWorkflowSection(
  doc: PdfDoc,
  useCase: UseCase,
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
  assessment?: UseCaseAssessment | null,
): number {
  yPos = appendSectionHeading(doc, 'Workflow', yPos, marginLeft);
  const rows = WORKFLOW_STAGES.map((stage) => [stage, workflowStageState(stage, useCase, assessment)]);
  autoTable(doc, {
    startY: yPos,
    head: [['Stage', 'State']],
    body: rows,
    theme: 'grid',
    headStyles: TABLE_HEAD,
    styles: { fontSize: 9, cellPadding: 2.5 },
    columnStyles: { 0: { cellWidth: 50, fontStyle: 'bold' }, 1: { cellWidth: 40 } },
    margin: { left: marginLeft, right: marginLeft, bottom: 16 },
  });
  yPos = getTableFinalY(doc, yPos) + 8;

  if (useCase.status === 'Rejected') {
    yPos = appendTextSection(
      doc,
      'Rejection reason',
      useCase.rejection_reason || '',
      yPos,
      pageWidthOf(doc),
      marginLeft,
    );
  }

  return yPos;
}

export function appendAnalysisAssignmentSection(
  doc: PdfDoc,
  useCase: UseCase,
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  yPos = appendSectionHeading(doc, 'Analysis Assignment', yPos, marginLeft);
  return appendInfoTable(
    doc,
    [
      ['Assigned By', displayText(useCase.analysis_assigned_by_name)],
      ['Assigned Date', formatWhen(useCase.analysis_assigned_dt)],
      ['Analysis Due Date', formatDateOnly(useCase.analysis_due_date)],
      ['Technical Analysis Completed', formatWhen(useCase.tech_analysis_completed_dt)],
      ['Business Analysis Completed', formatWhen(useCase.business_analysis_completed_dt)],
    ],
    yPos,
    marginLeft,
  );
}

export function appendTechnicalAnalysisSection(
  doc: PdfDoc,
  useCase: UseCase,
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  yPos = appendSectionHeading(doc, 'Technical Analysis', yPos, marginLeft);
  yPos = appendInfoTable(
    doc,
    [
      ['Owner', useCase.technical_owner_name || 'Not assigned'],
      ['AI Category', useCase.ai_category ? getAiCategoryLabel(useCase.ai_category) : NOT_PROVIDED],
      ['Feasibility', formatFeasibility(useCase.feasibility)],
      ['Tool Complexity', displayText(useCase.tool_complexity)],
      ['Host System Capability', displayText(useCase.host_system_capability)],
      ['Data Privacy & Security', displayText(useCase.data_privacy_security)],
      ['Deployment Model', displayText(useCase.deployment_model)],
      ['Completed', formatWhen(useCase.tech_analysis_completed_dt)],
    ],
    yPos,
    marginLeft,
  );
  if (useCase.tech_analysis_rejection_note || useCase.tech_analysis_rejected_dt) {
    yPos = appendInfoTable(
      doc,
      [
        ['Sent Back Date', formatWhen(useCase.tech_analysis_rejected_dt)],
        ['Sent Back Note', displayText(useCase.tech_analysis_rejection_note)],
      ],
      yPos,
      marginLeft,
    );
  }
  const technicalFiles = (useCase.documents || []).filter(isTechnicalAnalysisDocument);
  if (technicalFiles.length > 0) {
    autoTable(doc, {
      startY: yPos,
      head: [['Technical supporting file', 'Type', 'Uploaded']],
      body: technicalFiles.map((document) => [
        document.file_name || '—',
        document.document_type || '—',
        formatWhen(document.uploaded_dt),
      ]),
      theme: 'grid',
      headStyles: TABLE_HEAD,
      styles: { fontSize: 8, cellPadding: 2.5 },
      margin: { left: marginLeft, right: marginLeft, bottom: 16 },
    });
    yPos = getTableFinalY(doc, yPos) + 8;
  }
  return yPos;
}

export function appendBusinessAnalysisSection(
  doc: PdfDoc,
  useCase: UseCase,
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  yPos = appendSectionHeading(doc, 'Business Analysis', yPos, marginLeft);
  const scoringRows: [string, string][] = [
    ['Owner', useCase.business_owner_name || 'Not assigned'],
    ...BUSINESS_REQUIRED_FIELDS.map((field) => [field.label, displayText(useCase[field.key] as string | null)] as [string, string]),
    ['Completed', formatWhen(useCase.business_analysis_completed_dt)],
  ];
  yPos = appendInfoTable(doc, scoringRows, yPos, marginLeft);
  if (useCase.business_analysis_rejection_note || useCase.business_analysis_rejected_dt) {
    yPos = appendInfoTable(
      doc,
      [
        ['Sent Back Date', formatWhen(useCase.business_analysis_rejected_dt)],
        ['Sent Back Note', displayText(useCase.business_analysis_rejection_note)],
      ],
      yPos,
      marginLeft,
    );
  }
  return yPos;
}

export function appendEstimateSection(
  doc: PdfDoc,
  useCase: UseCase,
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  const data = normalizeEstimateData(useCase.estimate_data);
  const totals = computeEstimateTotals(data.lines);
  const investment = computeEstimateInvestment(data);
  const hasAmounts = ESTIMATE_LINE_KEYS.some((key) => {
    const line = data.lines[key];
    return [line?.year1, line?.year2, line?.year3].some((value) => value != null && Number.isFinite(value));
  });

  yPos = appendSectionHeading(doc, 'Estimate', yPos, marginLeft);
  yPos = appendInfoTable(
    doc,
    [
      ['Owner', displayText(useCase.estimate_owner_name)],
      ['Assigned By', displayText(useCase.estimate_assigned_by_name)],
      ['Assigned Date', formatWhen(useCase.estimate_assigned_dt)],
      ['Due Date', formatDateOnly(useCase.estimate_due_date)],
      ['Completed', formatWhen(useCase.estimate_completed_dt)],
      ['Currency', data.currency || NOT_PROVIDED],
      ['Total Investment (Year 1–3)', hasAmounts ? formatAmount(data.currency, investment) : '—'],
    ],
    yPos,
    marginLeft,
  );

  autoTable(doc, {
    startY: yPos,
    head: [['Cost Line', 'Type', 'Year 1', 'Year 2', 'Year 3']],
    body: [
      ...ESTIMATE_LINE_KEYS.map((key) => {
        const line = data.lines[key];
        return [
          ESTIMATE_LINE_LABELS[key],
          line?.type || '—',
          formatAmount(data.currency, line?.year1),
          formatAmount(data.currency, line?.year2),
          formatAmount(data.currency, line?.year3),
        ];
      }),
      [
        'Totals',
        '',
        hasAmounts ? formatAmount(data.currency, totals.year1) : '—',
        hasAmounts ? formatAmount(data.currency, totals.year2) : '—',
        hasAmounts ? formatAmount(data.currency, totals.year3) : '—',
      ],
    ],
    theme: 'grid',
    headStyles: TABLE_HEAD,
    styles: { fontSize: 8, cellPadding: 2.5 },
    columnStyles: {
      0: { cellWidth: 48, fontStyle: 'bold' },
      1: { cellWidth: 28 },
    },
    margin: { left: marginLeft, right: marginLeft, bottom: 16 },
  });
  yPos = getTableFinalY(doc, yPos) + 10;

  return yPos;
}

export function appendRoiSection(
  doc: PdfDoc,
  useCase: UseCase,
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  const estimate = normalizeEstimateData(useCase.estimate_data);
  const investment = computeEstimateInvestment(estimate);
  const roi = normalizeRoiData(useCase.roi_data, estimate.currency, investment);
  const roiPercent = computeRoiPercent(roi.totals.total, investment);
  const hasRows = (roi.rows || []).length > 0;

  yPos = appendSectionHeading(doc, 'ROI', yPos, marginLeft);
  yPos = appendInfoTable(
    doc,
    [
      ['Owner', displayText(useCase.roi_owner_name)],
      ['Assigned By', displayText(useCase.roi_assigned_by_name)],
      ['Assigned Date', formatWhen(useCase.roi_assigned_dt)],
      ['Due Date', formatDateOnly(useCase.roi_due_date)],
      ['Completed', formatWhen(useCase.roi_completed_dt)],
      ['Investment', investment > 0 ? formatAmount(roi.currency, investment) : '—'],
      ['Total Savings', hasRows ? formatAmount(roi.currency, roi.totals.total) : '—'],
      ['ROI', roiPercent == null ? 'N/A' : `${roiPercent.toFixed(2)}%`],
    ],
    yPos,
    marginLeft,
  );

  if (!hasRows) {
    return appendEmptyNote(doc, 'No ROI rows recorded.', yPos, marginLeft);
  }

  autoTable(doc, {
    startY: yPos,
    head: [['Category', 'Description', 'Year 1', 'Year 2', 'Year 3']],
    body: [
      ...roi.rows.map((row) => [
        row.category || '—',
        row.description || '—',
        formatAmount(roi.currency, row.year1),
        formatAmount(roi.currency, row.year2),
        formatAmount(roi.currency, row.year3),
      ]),
      [
        'Totals',
        '',
        formatAmount(roi.currency, roi.totals.year1),
        formatAmount(roi.currency, roi.totals.year2),
        formatAmount(roi.currency, roi.totals.year3),
      ],
    ],
    theme: 'grid',
    headStyles: TABLE_HEAD,
    styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: 'auto' },
    },
    margin: { left: marginLeft, right: marginLeft, bottom: 16 },
  });
  return getTableFinalY(doc, yPos) + 10;
}

export function appendAssessmentSection(
  doc: PdfDoc,
  useCase: UseCase,
  assessment: UseCaseAssessment | null | undefined,
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  yPos = appendSectionHeading(doc, 'AI Assessment', yPos, marginLeft);
  yPos = appendInfoTable(
    doc,
    [
      ['Owner', displayText(useCase.assessment_owner_name)],
      ['Assigned By', displayText(useCase.assessment_assigned_by_name)],
      ['Assigned Date', formatWhen(useCase.assessment_assigned_dt)],
      ['Due Date', formatDateOnly(useCase.assessment_due_date)],
      ['Workflow Completed', formatWhen(useCase.assessment_completed_dt)],
    ],
    yPos,
    marginLeft,
  );
  if (!assessment) {
    return appendEmptyNote(doc, 'No assessment checklist has been initiated.', yPos, marginLeft);
  }

  yPos = appendInfoTable(
    doc,
    [
      ['Template', displayText(assessment.template_name)],
      ['Template Version', assessment.template_version_number != null ? `v${assessment.template_version_number}` : NOT_PROVIDED],
      ['Status', assessment.status === 'CLOSED' ? 'Closed' : 'In Progress'],
      ['Initiated By', displayText(assessment.initiated_by?.user_name)],
      ['Initiated', formatWhen(assessment.initiated_dt)],
      ['Closed By', displayText(assessment.closed_by?.user_name)],
      ['Closed', formatWhen(assessment.closed_dt)],
      ['Next Review Date', formatDateOnly(assessment.next_review_date)],
      ['Total Score', `${assessment.total_score ?? '—'} / ${assessment.max_score ?? '—'}`],
      ['Risk Classification', displayText(assessment.risk_classification)],
    ],
    yPos,
    marginLeft,
  );

  yPos = appendTextSection(
    doc,
    'Summary Findings',
    assessment.overall_findings || '',
    yPos,
    pageWidthOf(doc),
    marginLeft,
  );

  if (assessment.area_summaries?.length) {
    autoTable(doc, {
      startY: yPos,
      head: [['Area', 'Questions', 'Score']],
      body: assessment.area_summaries.map((area) => [
        `${area.seq_no}. ${area.title}`,
        String(area.question_count ?? '—'),
        `${area.score} / ${area.max_score}`,
      ]),
      theme: 'grid',
      headStyles: TABLE_HEAD,
      styles: { fontSize: 8, cellPadding: 2.5 },
      margin: { left: marginLeft, right: marginLeft, bottom: 16 },
    });
    yPos = getTableFinalY(doc, yPos) + 8;
  }

  return appendEmptyNote(
    doc,
    'Question-level answers are available from the Assessment Report export.',
    yPos,
    marginLeft,
  );
}

export function appendReferencesSection(
  doc: PdfDoc,
  useCase: UseCase,
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  const links = useCase.reference_links || [];
  const documents = (useCase.documents || []).filter((document) => !isTechnicalAnalysisDocument(document));
  yPos = appendSectionHeading(doc, 'References', yPos, marginLeft);

  if (links.length === 0 && documents.length === 0) {
    return appendEmptyNote(doc, 'No reference links or documents recorded.', yPos, marginLeft);
  }

  if (links.length > 0) {
    autoTable(doc, {
      startY: yPos,
      head: [['Link Label', 'URL']],
      body: links.map((link) => [link.label || '—', link.url || '—']),
      theme: 'grid',
      headStyles: TABLE_HEAD,
      styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak' },
      margin: { left: marginLeft, right: marginLeft, bottom: 16 },
    });
    yPos = getTableFinalY(doc, yPos) + 8;
  }

  if (documents.length > 0) {
    autoTable(doc, {
      startY: yPos,
      head: [['Document', 'Type', 'Uploaded']],
      body: documents.map((document) => [
        document.file_name || '—',
        document.document_type || '—',
        formatWhen(document.uploaded_dt),
      ]),
      theme: 'grid',
      headStyles: TABLE_HEAD,
      styles: { fontSize: 8, cellPadding: 2.5 },
      margin: { left: marginLeft, right: marginLeft, bottom: 16 },
    });
    yPos = getTableFinalY(doc, yPos) + 8;
  }

  return yPos;
}

export function appendDocumentationQualitySection(
  doc: PdfDoc,
  useCase: UseCase,
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  const summary = useCase.documentation_quality_summary;
  yPos = appendSectionHeading(doc, 'Documentation Quality', yPos, marginLeft);
  if (!summary) {
    return appendEmptyNote(doc, 'No documentation quality analysis recorded.', yPos, marginLeft);
  }
  return appendInfoTable(
    doc,
    [
      ['Overall Score', String(summary.overall_score ?? '—')],
      ['Status', displayText(summary.status_label)],
      ['Strengths', summary.strengths_count != null ? String(summary.strengths_count) : '—'],
      ['Improvements', summary.improvements_count != null ? String(summary.improvements_count) : '—'],
      ['Analyzed', formatWhen(summary.analyzed_at)],
      ['Stale', yesNo(summary.is_stale)],
    ],
    yPos,
    marginLeft,
  );
}

export function appendDataRequirementsTable(
  doc: PdfDoc,
  dataReqs: UseCaseData[],
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  yPos = appendSectionHeading(doc, 'Data Requirements', yPos, marginLeft);
  if (dataReqs.length === 0) {
    return appendEmptyNote(doc, 'No data requirements recorded.', yPos, marginLeft);
  }

  const dataRows = dataReqs.map((data) => [
    data.data_req || '—',
    data.data_source || '—',
    data.volume || '—',
    data.data_classification || '—',
    data.data_owner || '—',
    data.data_usage?.length ? data.data_usage.join(', ') : '—',
    yesNo(data.is_pii_phi_involved),
    data.dataset_type || '—',
    yesNo(data.data_lineage_available),
    yesNo(data.data_quality_assessed),
    yesNo(data.data_freshness_confirmed),
  ]);

  autoTable(doc, {
    startY: yPos,
    head: [[
      'Requirement',
      'Source',
      'Volume',
      'Classification',
      'Owner',
      'Usage',
      'PII/PHI',
      'Dataset',
      'Lineage',
      'Quality',
      'Freshness',
    ]],
    body: dataRows,
    theme: 'grid',
    headStyles: { ...TABLE_HEAD, fontSize: 7 },
    styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
    margin: { left: marginLeft, right: marginLeft, bottom: 16 },
  });

  return getTableFinalY(doc, yPos) + 10;
}

export function appendRisksTable(
  doc: PdfDoc,
  riskReviews: UseCaseRiskReview[],
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  yPos = appendSectionHeading(doc, 'Risks', yPos, marginLeft);
  if (riskReviews.length === 0) {
    return appendEmptyNote(doc, 'No risks recorded.', yPos, marginLeft);
  }

  autoTable(doc, {
    startY: yPos,
    head: [[
      'Title',
      'Category',
      RISK_MODEL_INFLUENCE_LABEL,
      RISK_DECISION_CONSEQUENCE_LABEL,
      'Status',
      'Assigned',
      'Description',
      'Mitigation Strategy',
      'Closure Comment',
    ]],
    body: riskReviews.map((risk) => [
      risk.risk_title || '—',
      risk.risk_category || '—',
      formatRiskLevel(risk.risk_likelihood),
      formatRiskLevel(risk.risk_impact),
      risk.status || '—',
      risk.assigned_to_name || (risk.assigned_to ? 'Assigned' : 'Unassigned'),
      risk.risk_description || '—',
      risk.mitigation_strategy || '—',
      risk.closure_comment || '—',
    ]),
    theme: 'grid',
    headStyles: { ...TABLE_HEAD, fontSize: 7 },
    styles: { fontSize: 6.5, cellPadding: 1.8, overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 18 },
      2: { cellWidth: 18 },
      3: { cellWidth: 20 },
      4: { cellWidth: 14 },
      5: { cellWidth: 18 },
    },
    margin: { left: marginLeft, right: marginLeft, bottom: 16 },
  });

  return getTableFinalY(doc, yPos) + 10;
}

export function appendCommentsTable(
  doc: PdfDoc,
  comments: UseCaseComment[],
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  yPos = appendSectionHeading(doc, 'Comments', yPos, marginLeft);
  if (comments.length === 0) {
    return appendEmptyNote(doc, 'No comments recorded.', yPos, marginLeft);
  }

  autoTable(doc, {
    startY: yPos,
    head: [['User', 'Date', 'Rating', 'Comment']],
    body: comments.map((comment) => [
      comment.user_name || 'Unknown User',
      new Date(comment.comment_date).toLocaleDateString(),
      comment.rating != null ? `${comment.rating} / 5` : '—',
      comment.comment || '—',
    ]),
    theme: 'grid',
    headStyles: TABLE_HEAD,
    styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 28 },
      2: { cellWidth: 18 },
    },
    margin: { left: marginLeft, right: marginLeft, bottom: 16 },
  });

  return getTableFinalY(doc, yPos) + 10;
}

export function appendAuditHistorySection(
  doc: PdfDoc,
  auditLogs: UseCasePdfAuditLog[],
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
  options?: { startOnNewPage?: boolean },
): number {
  if (options?.startOnNewPage !== false) {
    doc.addPage();
    yPos = 20;
  }
  yPos = appendSectionHeading(doc, 'Audit History', yPos, marginLeft);
  if (!auditLogs.length) {
    return appendEmptyNote(doc, 'No audit history available for this use case.', yPos, marginLeft);
  }

  autoTable(doc, {
    startY: yPos,
    head: [['Date/Time', 'User', 'Action', 'Details']],
    body: auditLogs.map((log) => [
      new Date(log.audit_date).toLocaleString(),
      log.user_name || 'Unknown User',
      `${humanizeToken(log.action || '')} ${humanizeToken(log.type || '')}`.trim(),
      formatAuditDetails(log.details),
    ]),
    theme: 'grid',
    headStyles: TABLE_HEAD,
    styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: 32 },
      2: { cellWidth: 40 },
    },
    margin: { left: marginLeft, right: marginLeft, bottom: 16 },
  });

  return getTableFinalY(doc, yPos) + 10;
}

export function appendStatusBadge(
  doc: PdfDoc,
  status: string,
  yPos: number,
  options?: { align?: 'center' | 'left'; marginLeft?: number },
): number {
  const align = options?.align || 'left';
  const marginLeft = options?.marginLeft ?? DEFAULT_MARGIN;
  const color = getUseCaseStatusPdfColor(status);
  const label = `Status: ${status}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  const width = doc.getTextWidth(label) + 8;
  const x = align === 'center' ? pageWidthOf(doc) / 2 - width / 2 : marginLeft;
  doc.setFillColor(color[0], color[1], color[2]);
  doc.setTextColor(255, 255, 255);
  doc.roundedRect(x, yPos, width, 6, 3, 3, 'F');
  doc.text(label, x + width / 2, yPos + 4, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  return yPos + 10;
}

export function appendUseCaseReportSections(
  doc: PdfDoc,
  useCase: UseCase,
  yPos: number,
  related: UseCasePdfRelated = {},
  options?: { includeAudit?: boolean; startAuditOnNewPage?: boolean },
): number {
  const pageWidth = pageWidthOf(doc);
  const marginLeft = DEFAULT_MARGIN;
  const dataReqs = related.dataReqs || [];
  const riskReviews = related.riskReviews || [];
  const comments = related.comments || [];
  const assessment = related.assessment ?? null;

  yPos = appendWorkflowSection(doc, useCase, yPos, marginLeft, assessment);

  yPos = appendSectionHeading(doc, 'Overview', yPos, marginLeft);
  yPos = appendTextSection(doc, 'Description', useCase.use_case_description || '', yPos, pageWidth, marginLeft);
  yPos = appendTextSection(doc, INTENDED_USE_LABEL, useCase.intended_use || '', yPos, pageWidth, marginLeft);
  yPos = appendTextSection(doc, 'Solution Design Overview', useCase.solution_design_overview || '', yPos, pageWidth, marginLeft);
  yPos = appendTextSection(doc, 'Expected Benefits', useCase.expected_benefits || '', yPos, pageWidth, marginLeft);
  yPos = appendTextSection(doc, 'Human Oversight Strategy', useCase.human_in_loop_strategy || '', yPos, pageWidth, marginLeft);
  yPos = appendInfoTable(doc, buildUseCaseInfoRows(useCase), yPos, marginLeft);

  yPos = appendReferencesSection(doc, useCase, yPos, marginLeft);
  yPos = appendDocumentationQualitySection(doc, useCase, yPos, marginLeft);
  yPos = appendAnalysisAssignmentSection(doc, useCase, yPos, marginLeft);
  yPos = appendTechnicalAnalysisSection(doc, useCase, yPos, marginLeft);
  yPos = appendBusinessAnalysisSection(doc, useCase, yPos, marginLeft);
  yPos = appendEstimateSection(doc, useCase, yPos, marginLeft);
  yPos = appendRoiSection(doc, useCase, yPos, marginLeft);
  yPos = appendDataRequirementsTable(doc, dataReqs, yPos, marginLeft);
  yPos = appendRisksTable(doc, riskReviews, yPos, marginLeft);
  yPos = appendCommentsTable(doc, comments, yPos, marginLeft);
  yPos = appendAssessmentSection(doc, useCase, assessment, yPos, marginLeft);

  if (options?.includeAudit) {
    yPos = appendAuditHistorySection(
      doc,
      related.auditLogs || [],
      yPos,
      marginLeft,
      { startOnNewPage: options.startAuditOnNewPage !== false },
    );
  }

  return yPos;
}

export function getRiskClassificationColor(level?: string | null): [number, number, number] {
  const normalized = (level || '').trim().toLowerCase();
  if (normalized === 'critical') return [220, 38, 38];
  if (normalized === 'high') return [234, 88, 12];
  if (normalized === 'medium') return [202, 138, 4];
  if (normalized === 'low') return [22, 163, 74];
  return [100, 116, 139];
}

export function applyReportFooters(
  doc: PdfDoc,
  logoDataUrl: string | null,
  marginLeft = PDF_MARGIN,
  logoAspectRatio?: number,
): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const footerY = PDF_FOOTER_Y;
  const generatedOn = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const totalPages = doc.getNumberOfPages();

  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(226, 232, 240);
    doc.line(marginLeft, footerY - 5, pageWidth - marginLeft, footerY - 5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated ${generatedOn}`, marginLeft, footerY);
    if (logoDataUrl && logoAspectRatio) {
      const maxWidthMm = 14;
      const maxHeightMm = 5;
      let logoWidth = maxWidthMm;
      let logoHeight = logoWidth / logoAspectRatio;
      if (logoHeight > maxHeightMm) {
        logoHeight = maxHeightMm;
        logoWidth = logoHeight * logoAspectRatio;
      }
      const logoX = pageWidth / 2 - logoWidth / 2;
      const logoY = footerY - 1.5 - logoHeight;
      doc.addImage(
        logoDataUrl,
        'PNG',
        logoX,
        logoY,
        logoWidth,
        logoHeight,
        undefined,
        'MEDIUM',
      );
    }
    doc.text(`Page ${page} of ${totalPages}`, pageWidth - marginLeft, footerY, { align: 'right' });
  }

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
}
