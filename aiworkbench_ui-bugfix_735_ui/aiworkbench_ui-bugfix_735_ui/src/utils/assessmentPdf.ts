import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { UseCase, UseCaseAssessment } from '../types';
import {
  applyReportFooters,
  formatBusinessOwnerDisplay,
  formatTechnicalOwnerDisplay,
  getRiskClassificationColor,
  getTableFinalY,
  PDF_CONTENT_BOTTOM_Y,
  PDF_HEADING_COLOR,
  PDF_MARGIN,
  PDF_TABLE_HEAD_COLOR,
  type PdfDoc,
} from './useCasePdf';
import { ASSESSMENT_REPORT_LOGO_URL, fitLogoDimensionsMm, loadReportLogo } from './pdfLogo';

const BODY_FONT_SIZE = 10;
const SECTION_FONT_SIZE = 13;
const TITLE_FONT_SIZE = 20;
const SUBTITLE_FONT_SIZE = 12;

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function ensureSpace(doc: PdfDoc, y: number, needed = 20): number {
  if (y + needed > PDF_CONTENT_BOTTOM_Y) {
    doc.addPage();
    return 28;
  }
  return y;
}

function drawSectionHeading(doc: PdfDoc, title: string, y: number, margin = PDF_MARGIN): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(SECTION_FONT_SIZE);
  doc.setTextColor(...PDF_HEADING_COLOR);
  doc.text(title, margin, y);
  doc.setTextColor(0, 0, 0);
  return y + 8;
}

function drawRiskBadge(doc: PdfDoc, label: string, x: number, y: number): number {
  const text = label || 'Not classified';
  const [r, g, b] = getRiskClassificationColor(label);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(BODY_FONT_SIZE);
  const paddingX = 5;
  const badgeWidth = doc.getTextWidth(text) + paddingX * 2;
  const badgeHeight = 8;
  doc.setFillColor(r, g, b);
  doc.setDrawColor(r, g, b);
  doc.roundedRect(x, y - 5.5, badgeWidth, badgeHeight, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.text(text, x + paddingX, y);
  doc.setTextColor(0, 0, 0);
  return y + 10;
}

function parseFindingsBullets(text?: string | null): string[] {
  const raw = String(text ?? '').trim();
  if (!raw) return ['No summary findings recorded.'];

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•]\s+/, '').trim())
    .filter(Boolean);

  if (lines.length > 1) {
    return lines;
  }

  if (raw.includes(';')) {
    return raw
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return [raw];
}

function drawBulletedFindings(
  doc: PdfDoc,
  items: string[],
  y: number,
  pageWidth: number,
  margin = PDF_MARGIN,
): number {
  const bulletX = margin;
  const textX = margin + 4;
  const textWidth = pageWidth - margin - textX;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(BODY_FONT_SIZE);
  doc.setTextColor(30, 41, 59);

  for (const item of items) {
    y = ensureSpace(doc, y, 12);
    doc.text('•', bulletX, y);
    const lines = doc.splitTextToSize(item, textWidth);
    doc.text(lines, textX, y);
    y += lines.length * 5 + 3;
  }

  doc.setTextColor(0, 0, 0);
  return y;
}

function standardTableOptions(margin = PDF_MARGIN) {
  return {
    theme: 'grid' as const,
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 3,
      textColor: [30, 41, 59] as [number, number, number],
      overflow: 'linebreak' as const,
    },
    headStyles: {
      fillColor: PDF_TABLE_HEAD_COLOR,
      fontSize: 9,
      fontStyle: 'bold' as const,
      textColor: [255, 255, 255] as [number, number, number],
    },
    margin: { left: margin, right: margin },
  };
}

function renderCoverPage(
  doc: PdfDoc,
  useCase: UseCase,
  assessment: UseCaseAssessment,
  logoDataUrl: string | null,
  logoAspectRatio?: number,
): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 14;

  if (logoDataUrl && logoAspectRatio) {
    const { widthMm, heightMm } = fitLogoDimensionsMm(logoAspectRatio, 32, 9);
    doc.addImage(
      logoDataUrl,
      'PNG',
      PDF_MARGIN,
      y,
      widthMm,
      heightMm,
      undefined,
      'MEDIUM',
    );
    y = y + heightMm + 12;
  } else {
    y = 22;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(TITLE_FONT_SIZE);
  doc.setTextColor(...PDF_HEADING_COLOR);
  doc.text('Assessment Report', pageWidth / 2, y, { align: 'center' });
  y += 10;

  doc.setFontSize(SUBTITLE_FONT_SIZE);
  doc.text(assessment.template_name || 'Use Case Assessment', pageWidth / 2, y, { align: 'center' });
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(BODY_FONT_SIZE);
  doc.setTextColor(71, 85, 105);
  doc.text(useCase.use_case_name || '—', pageWidth / 2, y, { align: 'center' });
  if (useCase.use_case_title && useCase.use_case_title !== useCase.use_case_name) {
    y += 6;
    doc.text(useCase.use_case_title, pageWidth / 2, y, { align: 'center' });
  }
  y += 10;

  doc.setDrawColor(226, 232, 240);
  doc.line(PDF_MARGIN, y, pageWidth - PDF_MARGIN, y);
  y += 10;

  y = drawSectionHeading(doc, 'Document Information', y);

  autoTable(doc, {
    startY: y,
    head: [['Field', 'Value']],
    body: [
      ['Use Case Name', useCase.use_case_name || '—'],
      ['Use Case Title', useCase.use_case_title || '—'],
      ['Checklist Template', assessment.template_name || '—'],
      ['Checklist Version', `v${assessment.template_version_number}`],
      ['Assessment Status', assessment.status === 'CLOSED' ? 'Closed' : 'In Progress'],
      ['Assessment Date', formatDate(assessment.closed_dt || assessment.initiated_dt)],
      ['Next Review Date', formatDate(assessment.next_review_date)],
      ['Assessment Owner', assessment.initiated_by?.user_name || '—'],
      ['Technical Owner', formatTechnicalOwnerDisplay(useCase)],
      ['Business Owner', formatBusinessOwnerDisplay(useCase)],
      ['Report Generated', formatDate(new Date().toISOString())],
    ],
    ...standardTableOptions(),
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 52 },
      1: { cellWidth: 'auto' },
    },
  });
}

function renderAssessmentSummary(
  doc: PdfDoc,
  assessment: UseCaseAssessment,
  pageWidth: number,
): number {
  let y = 28;
  y = drawSectionHeading(doc, 'Assessment Summary', y);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(BODY_FONT_SIZE);
  doc.text('Overall Risk Classification', PDF_MARGIN, y);
  y += 7;
  y = drawRiskBadge(doc, assessment.risk_classification || 'Not classified', PDF_MARGIN, y);

  y = ensureSpace(doc, y, 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(BODY_FONT_SIZE);
  doc.text('Total Score', PDF_MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.text(`${assessment.total_score ?? '—'} / ${assessment.max_score ?? '—'}`, PDF_MARGIN + 28, y);
  y += 10;

  y = ensureSpace(doc, y, 20);
  doc.setFont('helvetica', 'bold');
  doc.text('Summary Findings', PDF_MARGIN, y);
  y += 6;
  y = drawBulletedFindings(
    doc,
    parseFindingsBullets(assessment.overall_findings),
    y,
    pageWidth,
  );
  y += 4;

  return y;
}

export async function exportAssessmentPdf(useCase: UseCase, assessment: UseCaseAssessment) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true }) as PdfDoc;
  const pageWidth = doc.internal.pageSize.getWidth();

  const logoAsset = await loadReportLogo(ASSESSMENT_REPORT_LOGO_URL);
  const logoDataUrl = logoAsset?.dataUrl ?? null;
  const logoAspectRatio = logoAsset?.aspectRatio;

  renderCoverPage(doc, useCase, assessment, logoDataUrl, logoAspectRatio);

  doc.addPage();
  let y = renderAssessmentSummary(doc, assessment, pageWidth);

  for (const area of assessment.area_summaries || []) {
    y = ensureSpace(doc, y, 24);
    y = drawSectionHeading(doc, `Area ${area.seq_no}: ${area.title}`, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(BODY_FONT_SIZE);
    doc.text(`Area score: ${area.score} / ${area.max_score}`, PDF_MARGIN, y);
    y += 8;

    const areaQuestions = (assessment.question_scores || []).filter((q) =>
      String(q.sno).startsWith(`${area.seq_no}.`),
    );

    autoTable(doc, {
      startY: y,
      head: [['#', 'Question', 'Answers', 'Score', 'Comment']],
      body: areaQuestions.map((q) => [
        q.sno,
        q.assessment_item,
        (q.selected_answers || []).map((a) => a.label).join(', ') || '—',
        String(q.score),
        q.comment || '—',
      ]),
      ...standardTableOptions(),
      styles: {
        ...standardTableOptions().styles,
        fontSize: 8,
        cellPadding: 2.5,
      },
      columnStyles: {
        0: { cellWidth: 12 },
        1: { cellWidth: 58 },
        2: { cellWidth: 34 },
        3: { cellWidth: 14, halign: 'center' },
        4: { cellWidth: 58 },
      },
    });
    y = getTableFinalY(doc, y) + 8;
  }

  y = ensureSpace(doc, y, 24);
  y = drawSectionHeading(doc, 'Participants', y);
  autoTable(doc, {
    startY: y,
    head: [['Name', 'Role', 'Last Change']],
    body: (assessment.participants || []).map((p) => [
      p.user_name,
      p.role,
      formatDate(p.last_change_dt),
    ]),
    ...standardTableOptions(),
  });

  y = getTableFinalY(doc, y) + 10;
  y = ensureSpace(doc, y, 24);
  y = drawSectionHeading(doc, 'Change History', y);
  autoTable(doc, {
    startY: y,
    head: [['Question', 'Action', 'Changed By', 'Date', 'Answers', 'Comment']],
    body: (assessment.history || []).slice(0, 100).map((h) => [
      h.sno,
      h.change_action,
      h.changed_by?.user_name || '—',
      formatDate(h.changed_dt),
      (h.selected_answers || []).map((a) => a.label).join(', ') || '—',
      h.comment || '—',
    ]),
    ...standardTableOptions(),
    styles: {
      ...standardTableOptions().styles,
      fontSize: 7.5,
      cellPadding: 2,
    },
    columnStyles: {
      0: { cellWidth: 14 },
      1: { cellWidth: 18 },
      2: { cellWidth: 24 },
      3: { cellWidth: 22 },
      4: { cellWidth: 28 },
      5: { cellWidth: 'auto' },
    },
  });

  applyReportFooters(doc, logoDataUrl, PDF_MARGIN, logoAspectRatio);

  const safeName = (useCase.use_case_name || 'use-case').replace(/[^\w\-]+/g, '_');
  doc.save(`${safeName}_assessment_report.pdf`);
}
