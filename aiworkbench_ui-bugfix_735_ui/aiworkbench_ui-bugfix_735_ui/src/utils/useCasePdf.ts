import type { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  INTENDED_USE_LABEL,
  RISK_DECISION_CONSEQUENCE_LABEL,
  RISK_MODEL_INFLUENCE_LABEL,
} from '../constants/useCaseFieldLabels';
import { getAiCategoryLabel } from '../constants/aiCategories';
import { formatRiskLevel } from '../constants/riskLevels';
import type { UseCase, UseCaseComment, UseCaseData, UseCaseRiskReview } from '../types';

type PdfDoc = jsPDF & { lastAutoTable?: { finalY: number } };

export type { PdfDoc };

export const PDF_MARGIN = 15;
export const PDF_CONTENT_BOTTOM_Y = 272;
export const PDF_FOOTER_Y = 287;
export const PDF_TABLE_HEAD_COLOR: [number, number, number] = [51, 65, 85];
export const PDF_HEADING_COLOR: [number, number, number] = [30, 41, 59];

const DEFAULT_MARGIN = PDF_MARGIN;

export function getTableFinalY(doc: PdfDoc, fallback: number): number {
  return doc.lastAutoTable?.finalY ?? fallback;
}

export function maybeAddPage(doc: PdfDoc, yPos: number, threshold = 240): number {
  if (yPos > threshold) {
    doc.addPage();
    return 20;
  }
  return yPos;
}

export function appendTextSection(
  doc: PdfDoc,
  title: string,
  text: string,
  yPos: number,
  pageWidth: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  doc.setFont('helvetica', 'bold');
  doc.text(`${title}:`, marginLeft, yPos);
  yPos += 6;
  const body = String(text ?? '').trim();
  if (!body) {
    return yPos + 2;
  }
  doc.setFont('helvetica', 'normal');
  const lines = doc.splitTextToSize(body, pageWidth - marginLeft * 2);
  if (lines.length > 0) {
    doc.text(lines, marginLeft, yPos);
    return yPos + lines.length * 5 + 4;
  }
  return yPos + 2;
}

export function buildUseCaseInfoRows(useCase: UseCase): [string, string][] {
  const rows: [string, string][] = [];

  if (useCase.ai_category) {
    rows.push(['AI Category', getAiCategoryLabel(useCase.ai_category)]);
  }
  if (useCase.department) rows.push(['Department', useCase.department]);
  if (useCase.feasibility) rows.push(['Feasibility', useCase.feasibility]);
  if (useCase.intended_use) rows.push([INTENDED_USE_LABEL, useCase.intended_use]);
  if (useCase.intended_audience) rows.push(['Intended Audience', useCase.intended_audience]);
  if (useCase.target_audience_type?.length) {
    rows.push(['Target Audience Type', useCase.target_audience_type.join(', ')]);
  }
  if (useCase.impacted_stakeholders?.length) {
    rows.push(['Impacted Stakeholders', useCase.impacted_stakeholders.join(', ')]);
  }
  if (useCase.expected_benefits) rows.push(['Expected Benefits', useCase.expected_benefits]);
  if (useCase.created_by_name) rows.push(['Initiated By', useCase.created_by_name]);
  rows.push([
    'Technical Owner',
    useCase.technical_owner_name
      ? `${useCase.technical_owner_name}${useCase.technical_owner_role_name ? ` (${useCase.technical_owner_role_name})` : ''}${useCase.technical_owner_email ? ` - ${useCase.technical_owner_email}` : ''}`
      : '—',
  ]);
  rows.push([
    'Business Owner',
    useCase.business_owner_name
      ? `${useCase.business_owner_name}${useCase.business_owner_email ? ` (${useCase.business_owner_email})` : ''}`
      : '—',
  ]);
  if (useCase.tags?.length) rows.push(['Tags', useCase.tags.join(', ')]);
  if (useCase.human_in_loop_strategy) {
    rows.push(['Human-in-loop Strategy', useCase.human_in_loop_strategy]);
  }
  if (
    useCase.bias_assessment_performed ||
    useCase.protected_attributes ||
    useCase.balancing_strategy
  ) {
    rows.push(['Bias Assessment Performed', useCase.bias_assessment_performed ? 'Yes' : 'No']);
  }
  if (useCase.protected_attributes) {
    rows.push(['Protected Attributes', useCase.protected_attributes]);
  }
  if (useCase.balancing_strategy) {
    rows.push(['Balancing Strategy', useCase.balancing_strategy]);
  }

  return rows;
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
    headStyles: { fillColor: [71, 85, 105], fontSize: 10, fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } },
    margin: { left: marginLeft, right: marginLeft },
  });

  return getTableFinalY(doc, yPos) + 10;
}

export function appendDataRequirementsTable(
  doc: PdfDoc,
  dataReqs: UseCaseData[],
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  if (dataReqs.length === 0) return yPos;

  yPos = maybeAddPage(doc, yPos);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Data Requirements', marginLeft, yPos);
  yPos += 6;

  const dataRows = dataReqs.map((data) => [
    data.data_req || '-',
    data.data_source || '-',
    data.volume || '-',
    data.data_classification || '-',
    data.data_owner || '-',
    data.data_usage?.length ? data.data_usage.join(', ') : '-',
    data.is_pii_phi_involved ? 'Yes' : 'No',
    data.dataset_type || '-',
    data.data_lineage_available ? 'Yes' : 'No',
    data.data_quality_assessed ? 'Yes' : 'No',
    data.data_freshness_confirmed ? 'Yes' : 'No',
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
    headStyles: { fillColor: [71, 85, 105], fontSize: 8, fontStyle: 'bold' },
    styles: { fontSize: 7, cellPadding: 2 },
    margin: { left: marginLeft, right: marginLeft },
  });

  return getTableFinalY(doc, yPos) + 10;
}

export function appendRisksTable(
  doc: PdfDoc,
  riskReviews: UseCaseRiskReview[],
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  if (riskReviews.length === 0) return yPos;

  yPos = maybeAddPage(doc, yPos);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Risks', marginLeft, yPos);
  yPos += 6;

  const riskRows = riskReviews.map((risk) => [
    risk.risk_title || '-',
    risk.risk_category || '-',
    formatRiskLevel(risk.risk_likelihood),
    formatRiskLevel(risk.risk_impact),
    risk.status || '-',
    risk.risk_description || '-',
    risk.mitigation_strategy || '-',
  ]);

  autoTable(doc, {
    startY: yPos,
    head: [['Title', 'Category', RISK_MODEL_INFLUENCE_LABEL, RISK_DECISION_CONSEQUENCE_LABEL, 'Status', 'Description', 'Mitigation Strategy']],
    body: riskRows,
    theme: 'grid',
    headStyles: { fillColor: [71, 85, 105], fontSize: 8, fontStyle: 'bold' },
    styles: { fontSize: 7, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 25 },
      2: { cellWidth: 20 },
      3: { cellWidth: 20 },
      4: { cellWidth: 20 },
      5: { cellWidth: 'auto' },
      6: { cellWidth: 'auto' },
    },
    margin: { left: marginLeft, right: marginLeft },
  });

  return getTableFinalY(doc, yPos) + 10;
}

export function appendCommentsTable(
  doc: PdfDoc,
  comments: UseCaseComment[],
  yPos: number,
  marginLeft = DEFAULT_MARGIN,
): number {
  if (comments.length === 0) return yPos;

  yPos = maybeAddPage(doc, yPos, 250);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Comments', marginLeft, yPos);
  yPos += 6;

  const commentRows = comments.map((comment) => [
    comment.user_name || 'Unknown User',
    new Date(comment.comment_date).toLocaleDateString(),
    comment.rating != null ? `${comment.rating} / 5` : '—',
    comment.comment || '—',
  ]);

  autoTable(doc, {
    startY: yPos,
    head: [['User', 'Date', 'Rating', 'Comment']],
    body: commentRows,
    theme: 'grid',
    headStyles: { fillColor: [71, 85, 105], fontSize: 9, fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 2.5 },
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 28 },
      2: { cellWidth: 18 },
      3: { cellWidth: 'auto' },
    },
    margin: { left: marginLeft, right: marginLeft },
  });

  return getTableFinalY(doc, yPos) + 10;
}

export function getRiskClassificationColor(level?: string | null): [number, number, number] {
  const normalized = (level || '').trim().toLowerCase();
  if (normalized === 'critical') return [220, 38, 38];
  if (normalized === 'high') return [234, 88, 12];
  if (normalized === 'medium') return [202, 138, 4];
  if (normalized === 'low') return [22, 163, 74];
  return [100, 116, 139];
}

export function formatTechnicalOwnerDisplay(useCase: UseCase): string {
  if (useCase.technical_owner_name) {
    const role = useCase.technical_owner_role_name ? ` (${useCase.technical_owner_role_name})` : '';
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
