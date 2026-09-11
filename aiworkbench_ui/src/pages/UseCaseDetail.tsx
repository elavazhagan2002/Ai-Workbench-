import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { UseCase, UseCaseData, UseCaseRiskReview, UseCaseComment, AuditLog, UseCaseAssessment } from '../types';
import { ArrowLeft, MessageSquare, AlertTriangle, FileCheck, Database, Download, X, ArrowRightLeft, Link as LinkIcon, Paperclip, PlayCircle, ClipboardCheck, Cpu, Briefcase, Wallet, TrendingUp } from 'lucide-react';
import jsPDF from 'jspdf';
import { logger } from '../utils/logger';
import { getCompressedLogoDataUrl } from '../utils/pdfLogo';
import UseCaseStateView from '../components/UseCaseStateView';
import UseCaseAssessmentPanel from '../components/UseCaseAssessmentPanel';
import {
  ApprovedBusinessRecord,
  ApprovedEstimateRecord,
  ApprovedRoiRecord,
  ApprovedTechnicalRecord,
} from '../components/UseCaseApprovedRecordView';
import { INTENDED_USE_LABEL, RISK_DECISION_CONSEQUENCE_LABEL, RISK_MODEL_INFLUENCE_LABEL } from '../constants/useCaseFieldLabels';
import { getAiCategoryLabel } from '../constants/aiCategories';
import { formatRiskLevel } from '../constants/riskLevels';
import {
  appendStatusBadge,
  appendUseCaseReportSections,
} from '../utils/useCasePdf';
import { DataRequirementDetails } from '../components/DataRequirementDetails';
import StarRating from '../components/StarRating';
import DemoVideoPlayer from '../components/DemoVideoPlayer';
import SelectMenu from '../components/SelectMenu';
import { isTechnicalAnalysisDocument } from '../utils/useCaseDocuments';
import { domainAccessDeniedMessage, isDomainAccessDeniedMessage } from '../utils/domainAccessMessage';
import sciagenLogoUrl from '../assets/images/sciagen_logo.png';

interface UseCaseDetailProps {
  useCaseId: string;
  onBack: () => void;
  initialTab?: Tab;
}

type Tab = 'overview' | 'technical' | 'business' | 'estimate' | 'roi' | 'data' | 'risks' | 'comments' | 'assessment';

const CLOSED_RECORD_TABS = new Set<Tab>(['technical', 'business', 'estimate', 'roi']);

function isClosedUseCaseStatus(status?: UseCase['status'] | null): boolean {
  return status === 'Approved' || status === 'Rejected';
}

function formatFeasibility(value: UseCase['feasibility']): string | null {
  if (value === 'Yes') return 'Feasible';
  if (value === 'No') return 'Not feasible';
  if (value === 'Yes (Difficult)') return 'Feasible, with challenges';
  return null;
}

function formatRoleName(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function UseCaseDetail({ useCaseId, onBack, initialTab = 'overview' }: UseCaseDetailProps) {
  const { user, hasPermission } = useAuth();
  const [useCase, setUseCase] = useState<UseCase | null>(null);
  const [domain, setDomain] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [accessDeniedMessage, setAccessDeniedMessage] = useState('');

  const [dataReqs, setDataReqs] = useState<UseCaseData[]>([]);
  const [riskReviews, setRiskReviews] = useState<UseCaseRiskReview[]>([]);
  const [comments, setComments] = useState<UseCaseComment[]>([]);
  const [auditLogs, setAuditLogs] = useState<(AuditLog & { user_name?: string })[]>([]);

  const [newComment, setNewComment] = useState({ text: '', rating: null as number | null } as { text: string; rating: number | null });
  const [error, setError] = useState('');
  const [moveModal, setMoveModal] = useState(false);
  const [moveTargetDomainId, setMoveTargetDomainId] = useState('');
  const [moveDomains, setMoveDomains] = useState<any[]>([]);
  const [moveSaving, setMoveSaving] = useState(false);
  const [demoFile, setDemoFile] = useState<File | null>(null);
  const [demoUploading, setDemoUploading] = useState(false);

  const hasDemoVideo = !!useCase?.has_demo || !!useCase?.demo_video_path;
  const canViewDemoVideo = hasPermission('view_demo') && hasDemoVideo;
  const canManageDemoVideo = hasPermission('map_demo');
  const referenceDocuments = (useCase?.documents || []).filter((doc) => !isTechnicalAnalysisDocument(doc));
  const canInitiateAssessment =
    hasPermission('initiate_assessment') || hasPermission('case_assess');
  const canContributeAssessment = hasPermission('contribute_assessment');
  const hasAssessmentParticipation = canInitiateAssessment || canContributeAssessment;
  const canShowAssessment = hasPermission('case_view') || hasAssessmentParticipation;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const data = await api.getUseCase(useCaseId);
        if (cancelled) return;
        setUseCase(data);
        if (data?.domain_id) {
          try {
            const domainData = await api.getDomain(data.domain_id);
            if (!cancelled) setDomain(domainData);
          } catch {
            // Domain load error is not critical
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          logger.error('Error loading use case', err);
          const message = err?.message || '';
          if (isDomainAccessDeniedMessage(message)) {
            setAccessDeniedMessage(domainAccessDeniedMessage(message));
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    async function loadRelated() {
      try {
        const [dataReqsData, riskReviewsData, commentsData] = await Promise.all([
          api.getUseCaseData(useCaseId),
          api.getUseCaseRiskReviews(useCaseId),
          api.getUseCaseComments(useCaseId),
        ]);
        if (cancelled) return;
        setDataReqs(dataReqsData || []);
        setRiskReviews(riskReviewsData || []);
        setComments(commentsData || []);
      } catch (err) {
        if (!cancelled) logger.error('Error loading related data', err);
      }
    }

    void load();
    void loadRelated();

    return () => {
      cancelled = true;
    };
  }, [useCaseId]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [useCaseId, initialTab]);

  useEffect(() => {
    if (!useCase) return;
    if (!isClosedUseCaseStatus(useCase.status) && CLOSED_RECORD_TABS.has(activeTab)) {
      setActiveTab('overview');
    }
  }, [useCase, activeTab]);

  useEffect(() => {
    if (moveModal && moveDomains.length === 0) {
      api.getDomains().then((list) => setMoveDomains(list || [])).catch(() => setMoveDomains([]));
    }
  }, [moveModal]);

  async function handleMoveToDomain(e: React.FormEvent) {
    e.preventDefault();
    if (!moveTargetDomainId || !useCase) return;
    setMoveSaving(true);
    try {
      await api.moveUseCase(useCaseId, moveTargetDomainId);
      setMoveModal(false);
      setMoveTargetDomainId('');
      await loadUseCase();
      if (useCase.domain_id !== moveTargetDomainId) {
        try {
          const domainData = await api.getDomain(moveTargetDomainId);
          setDomain(domainData);
        } catch (_) {}
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to move use case.');
    } finally {
      setMoveSaving(false);
    }
  }

  async function loadUseCase() {
    try {
      const data = await api.getUseCase(useCaseId);
      setUseCase(data);
      if (data?.domain_id) {
        try {
          const domainData = await api.getDomain(data.domain_id);
          setDomain(domainData);
        } catch {
          // Domain load error is not critical
        }
      }
    } catch (err) {
      logger.error('Error loading use case', err);
    }
  }

  async function loadRelatedData() {
    try {
      const [dataReqsData, riskReviewsData, commentsData] = await Promise.all([
        api.getUseCaseData(useCaseId),
        api.getUseCaseRiskReviews(useCaseId),
        api.getUseCaseComments(useCaseId),
      ]);
      setDataReqs(dataReqsData || []);
      setRiskReviews(riskReviewsData || []);
      setComments(commentsData || []);
    } catch (err) {
      logger.error('Error loading related data', err);
    }
  }

  async function loadAuditLogsForExport() {
    if (auditLogs.length > 0) {
      return auditLogs;
    }
    try {
      const auditData = await api.getUseCaseAuditLogs(useCaseId);
      const sorted = (auditData || []).sort(
        (a: AuditLog, b: AuditLog) => new Date(b.audit_date).getTime() - new Date(a.audit_date).getTime(),
      );
      setAuditLogs(sorted);
      return sorted;
    } catch (err) {
      logger.error('Error loading use case audit logs', err);
      return [];
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!newComment.text.trim() && (newComment.rating == null || newComment.rating < 1)) return;

    try {
      await api.createUseCaseComment(useCaseId, {
        comment: newComment.text.trim() || undefined,
        rating: newComment.rating != null && newComment.rating >= 1 && newComment.rating <= 5 ? newComment.rating : undefined,
      });
      setNewComment({ text: '', rating: null });
      loadRelatedData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function exportToPDF() {
    if (!useCase) return;

    try {
      const [exportAuditLogs, assessmentPayload] = await Promise.all([
        loadAuditLogsForExport(),
        api.getUseCaseAssessment(useCaseId, { includeParticipants: true }).catch(() => ({ assessment: null })),
      ]);
      const assessment = (assessmentPayload as { assessment?: UseCaseAssessment | null })?.assessment ?? null;

      const doc = new jsPDF({ compress: true });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const marginLeft = 15;
      let yPos = 20;

      let logoDataUrl: string | null = null;
      try {
        logoDataUrl = await getCompressedLogoDataUrl(sciagenLogoUrl);
      } catch (e) {
        logger.error('Could not load logo for PDF', e);
      }

      if (domain?.domain_short_name) {
        doc.setFillColor(59, 130, 246);
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        const tagText = domain.domain_short_name;
        const tagWidth = doc.getTextWidth(tagText) + 6;
        doc.roundedRect(marginLeft, yPos - 4, tagWidth, 6, 3, 3, 'F');
        doc.text(tagText, marginLeft + 3, yPos);
        doc.setTextColor(0, 0, 0);
        yPos += 8;
      }

      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text('Use Case Report', pageWidth / 2, yPos, { align: 'center' });

      yPos += 15;
      doc.setFontSize(16);
      doc.text(useCase.use_case_name, pageWidth / 2, yPos, { align: 'center' });

      yPos += 10;
      if (useCase.use_case_title) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        const titleLines = doc.splitTextToSize(useCase.use_case_title, pageWidth - 30);
        doc.text(titleLines, pageWidth / 2, yPos, { align: 'center' });
        yPos += titleLines.length * 5 + 4;
      }

      yPos = appendStatusBadge(doc, useCase.status, yPos, { align: 'center', marginLeft });

      if (useCase.average_rating != null) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`Average Rating: ${useCase.average_rating} / 5`, pageWidth / 2, yPos, { align: 'center' });
        yPos += 6;
      }

      doc.setDrawColor(226, 232, 240);
      doc.line(15, yPos, pageWidth - 15, yPos);
      yPos += 8;

      appendUseCaseReportSections(
        doc,
        useCase,
        yPos,
        {
          dataReqs,
          riskReviews,
          comments,
          assessment,
          auditLogs: exportAuditLogs,
        },
        { includeAudit: true, startAuditOnNewPage: true },
      );

      const totalPages = doc.getNumberOfPages();
      const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      const footerY = pageHeight - 10;
      const logoFooterWidth = 24;
      const logoFooterHeight = 8;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.text(currentDate, marginLeft, footerY);
        if (logoDataUrl) {
          doc.addImage(logoDataUrl, 'JPEG', pageWidth / 2 - logoFooterWidth / 2, footerY - logoFooterHeight, logoFooterWidth, logoFooterHeight, undefined, 'MEDIUM');
        }
        doc.text(`${p} / ${totalPages}`, pageWidth - marginLeft, footerY, { align: 'right' });
      }
      doc.setTextColor(0, 0, 0);

      const timestamp = new Date().toISOString().split('T')[0];
      const fileName = `${useCase.use_case_name.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.pdf`;
      doc.save(fileName);
    } catch (err: any) {
      logger.error('Error exporting PDF', err);
      setError(err?.message || 'Failed to export PDF.');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-600 dark:text-slate-400">Loading...</div>
      </div>
    );
  }

  if (accessDeniedMessage) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div className="max-w-md text-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Domain not assigned</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{accessDeniedMessage}</p>
          <button
            type="button"
            onClick={onBack}
            className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        </div>
      </div>
    );
  }

  if (!useCase) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-600 dark:text-slate-400">Loading...</div>
      </div>
    );
  }

  const isClosedRecord = isClosedUseCaseStatus(useCase.status);

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Use Cases
          </button>

          <div className="flex items-center gap-2">
            {hasPermission('case_edit') && (
              <button
                type="button"
                onClick={() => { setMoveModal(true); setMoveTargetDomainId(''); setMoveDomains([]); }}
                className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                <ArrowRightLeft className="w-4 h-4" />
                Move to domain
              </button>
            )}
            <button
              onClick={exportToPDF}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              Export PDF
            </button>
          </div>
        </div>

        {moveModal && (
          <div className="wb-app-overlay z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full border border-slate-200 dark:border-slate-700 p-6">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Move use case to another domain</h3>
              <form onSubmit={handleMoveToDomain} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Target domain</label>
                  <SelectMenu
                    value={moveTargetDomainId}
                    onChange={setMoveTargetDomainId}
                    required
                    placeholder="Select domain"
                    searchable
                    options={moveDomains
                      .filter((d: any) => d.domain_id !== useCase?.domain_id)
                      .map((d: any) => ({ value: d.domain_id, label: d.domain_name }))}
                    aria-label="Target domain"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setMoveModal(false)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
                  <button type="submit" disabled={moveSaving || !moveTargetDomainId} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
                    {moveSaving ? 'Moving...' : 'Move'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-center justify-between">
              <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
              <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                {useCase.use_case_name}
              </h1>
              {useCase.use_case_title && (
                <p className="text-lg text-slate-600 dark:text-slate-400 mb-2">
                  {useCase.use_case_title}
                </p>
              )}
              {useCase.average_rating != null && (
                <div className="flex items-center gap-2 mt-2">
                  <StarRating rating={useCase.average_rating} size="md" />
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    {useCase.average_rating} avg rating
                  </span>
                </div>
              )}
            </div>
            <span className={`px-4 py-2 rounded-full text-sm font-medium ${
              useCase.status === 'Production' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
              useCase.status === 'Approved' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
              'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
            }`}>
              {useCase.status}
            </span>
          </div>

          <UseCaseStateView currentStatus={useCase.status} />

          {useCase.status === 'Rejected' && useCase.rejection_reason && (
            <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">Rejection reason</p>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">{useCase.rejection_reason}</p>
            </div>
          )}

          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            <div className="pb-4">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Description</p>
              <p className="text-slate-900 dark:text-white whitespace-pre-wrap break-words">
                {useCase.use_case_description || <span className="text-slate-400 italic">Not provided</span>}
              </p>
            </div>

            <div className="py-4">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">{INTENDED_USE_LABEL}</p>
              <p className="text-slate-900 dark:text-white whitespace-pre-wrap break-words">
                {useCase.intended_use || <span className="text-slate-400 italic">Not provided</span>}
              </p>
            </div>

            <div className="py-4">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Solution Design Overview</p>
              <p className="text-slate-900 dark:text-white whitespace-pre-wrap break-words">
                {useCase.solution_design_overview || <span className="text-slate-400 italic">Not provided</span>}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4 py-4">
              <div className="min-w-0">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">AI Category</p>
                <p className="font-medium text-slate-900 dark:text-white break-words">
                  {useCase.ai_category ? getAiCategoryLabel(useCase.ai_category) : <span className="text-slate-400 italic font-normal">Not provided</span>}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Department</p>
                <p className="font-medium text-slate-900 dark:text-white break-words">
                  {useCase.department || <span className="text-slate-400 italic font-normal">Not provided</span>}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Feasibility</p>
                <p className="font-medium text-slate-900 dark:text-white break-words">
                  {formatFeasibility(useCase.feasibility) || <span className="text-slate-400 italic font-normal">Not provided</span>}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Deployment Model</p>
                <p className="font-medium text-slate-900 dark:text-white break-words">
                  {useCase.deployment_model || <span className="text-slate-400 italic font-normal">Not provided</span>}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Intended Audience</p>
                <p className="font-medium text-slate-900 dark:text-white break-words">
                  {useCase.intended_audience || <span className="text-slate-400 italic font-normal">Not provided</span>}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 py-4">
              <div className="min-w-0">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">Audience Type</p>
                {useCase.target_audience_type && useCase.target_audience_type.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {useCase.target_audience_type.map((type) => (
                      <span
                        key={type}
                        className="inline-block rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                      >
                        {type}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-400 italic">Not provided</p>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">Impacted Stakeholders</p>
                {useCase.impacted_stakeholders && useCase.impacted_stakeholders.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {useCase.impacted_stakeholders.map((stakeholder) => (
                      <span
                        key={stakeholder}
                        className="inline-block rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                      >
                        {stakeholder}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-400 italic">Not provided</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4 py-4">
              <div className="min-w-0">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Initiated By</p>
                <p className="font-medium text-slate-900 dark:text-white break-words">
                  {useCase.created_by_name || <span className="text-slate-400 italic font-normal">Not provided</span>}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Technical Owner</p>
                <p className="font-medium text-slate-900 dark:text-white break-words">
                  {useCase.technical_owner_name || <span className="text-slate-400 italic font-normal">Not assigned</span>}
                </p>
                {useCase.technical_owner_role_name && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    {formatRoleName(useCase.technical_owner_role_name)}
                  </p>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Business Owner</p>
                <p className="font-medium text-slate-900 dark:text-white break-words">
                  {useCase.business_owner_name || <span className="text-slate-400 italic font-normal">Not assigned</span>}
                </p>
                {useCase.business_owner_email && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 break-all">
                    {useCase.business_owner_email}
                  </p>
                )}
              </div>
            </div>

            <div className="py-4">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Expected Benefits</p>
              <p className="text-slate-900 dark:text-white whitespace-pre-wrap break-words">
                {useCase.expected_benefits || <span className="text-slate-400 italic">Not provided</span>}
              </p>
            </div>

            <div className="py-4">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Human Oversight Strategy</p>
              <p className="text-slate-900 dark:text-white whitespace-pre-wrap break-words">
                {useCase.human_in_loop_strategy || <span className="text-slate-400 italic">Not provided</span>}
              </p>
            </div>

            <div className="py-4">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Fairness &amp; Bias Assessment</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Bias Assessment Completed</p>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {useCase.bias_assessment_performed == null && (
                      <span className="text-slate-400 italic font-normal">Not provided</span>
                    )}
                    {useCase.bias_assessment_performed === true && 'Yes'}
                    {useCase.bias_assessment_performed === false && 'No'}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Protected Attributes Considered</p>
                  <p className="text-slate-900 dark:text-white whitespace-pre-wrap break-words">
                    {useCase.protected_attributes || <span className="text-slate-400 italic">Not provided</span>}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Fairness Approach</p>
                  <p className="text-slate-900 dark:text-white whitespace-pre-wrap break-words">
                    {useCase.balancing_strategy || <span className="text-slate-400 italic">Not provided</span>}
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-4">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">Tags</p>
              {useCase.tags && useCase.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {useCase.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-block px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-slate-400 italic">Not provided</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="border-b border-slate-200 dark:border-slate-700 mb-6">
        <div className="flex gap-6 overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview', icon: FileCheck },
            ...(isClosedRecord
              ? [
                  { id: 'technical' as const, label: 'Technical', icon: Cpu },
                  { id: 'business' as const, label: 'Business', icon: Briefcase },
                  { id: 'estimate' as const, label: 'Estimate', icon: Wallet },
                  { id: 'roi' as const, label: 'ROI', icon: TrendingUp },
                ]
              : []),
            { id: 'data', label: `Data (${dataReqs.length})`, icon: Database },
            { id: 'risks', label: `Risks (${riskReviews.length})`, icon: AlertTriangle },
            { id: 'comments', label: `Comments (${comments.length})`, icon: MessageSquare },
            ...(canShowAssessment ? [{ id: 'assessment' as const, label: 'Assessment', icon: ClipboardCheck }] : []),
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-3 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        {activeTab === 'overview' && (
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Use Case Overview</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Database className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    <p className="font-medium text-blue-900 dark:text-blue-100">Data Requirements</p>
                  </div>
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{dataReqs.length}</p>
                </div>

                <div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                    <p className="font-medium text-orange-900 dark:text-orange-100">Open Risks</p>
                  </div>
                    <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                    {riskReviews.filter(r => r.status === 'open').length}
                  </p>
                </div>

                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <MessageSquare className="w-5 h-5 text-green-600 dark:text-green-400" />
                    <p className="font-medium text-green-900 dark:text-green-100">Comments</p>
                  </div>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {comments.length}
                  </p>
                </div>
              </div>

              {(useCase.reference_links?.length ?? 0) > 0 ||
              referenceDocuments.length > 0 ||
              canViewDemoVideo ||
              canManageDemoVideo ? (
                <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-700 space-y-4">
                  {useCase.reference_links && useCase.reference_links.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
                        <LinkIcon className="w-4 h-4" /> Reference links
                      </h4>
                      <ul className="space-y-1">
                        {useCase.reference_links.map((link) => (
                          <li key={link.link_id}>
                            <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
                              {link.label || link.url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {referenceDocuments.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
                        <Paperclip className="w-4 h-4" /> Reference documents
                      </h4>
                      <ul className="space-y-1">
                        {referenceDocuments.map((doc) => (
                          <li key={doc.document_id} className="flex items-center gap-2 flex-wrap">
                            <span className="text-slate-700 dark:text-slate-300">{doc.file_name}</span>
                            {doc.document_type ? (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                {doc.document_type}
                              </span>
                            ) : null}
                            <button
                              type="button"
                              onClick={async () => {
                                const { blob, fileName } = await api.downloadUseCaseDocument(useCaseId, doc.document_id, doc.file_name);
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = fileName;
                                a.click();
                                URL.revokeObjectURL(url);
                              }}
                              className="text-blue-600 dark:text-blue-400 hover:underline text-sm flex items-center gap-1"
                            >
                              <Download className="w-3 h-3" /> Download
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {canViewDemoVideo && (
                    <div>
                      <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
                        <PlayCircle className="w-4 h-4" /> Demo video
                      </h4>
                      <DemoVideoPlayer
                        sources={[
                          {
                            label: 'Default',
                            url: api.getUseCaseDemoUrl(useCaseId),
                          },
                        ]}
                      />
                    </div>
                  )}
                  {canManageDemoVideo && (
                    <div>
                      <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Manage demo video
                      </h4>
                      <div className="flex items-center gap-3">
                        <input
                          type="file"
                          accept="video/mp4"
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            setDemoFile(file);
                          }}
                          className="text-sm text-slate-700 dark:text-slate-300"
                        />
                        <button
                          type="button"
                          disabled={!demoFile || demoUploading}
                          onClick={async () => {
                            if (!demoFile) return;
                            setError('');
                            setDemoUploading(true);
                            try {
                              await api.uploadUseCaseDemo(useCaseId, demoFile);
                              // Reload use case to refresh has_demo flag
                              await loadUseCase();
                            } catch (err: any) {
                              setError(err?.message || 'Failed to upload demo video.');
                            } finally {
                              setDemoUploading(false);
                            }}
                          }
                          className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {demoUploading ? 'Uploading…' : useCase.has_demo ? 'Replace demo' : 'Upload demo'}
                        </button>
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Only .mp4 files are supported. This video will be available to users with the <code>view_demo</code> permission.
                      </p>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )}

        {activeTab === 'data' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Data Requirements</h3>
            </div>
            {dataReqs.length === 0 ? (
              <p className="text-slate-600 dark:text-slate-400">No data requirements defined yet.</p>
            ) : (
              <div className="space-y-4">
                {dataReqs.map((data) => (
                  <div key={data.data_req_id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                    <p className="font-medium text-slate-900 dark:text-white mb-2">{data.data_req}</p>
                    <DataRequirementDetails data={data} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'risks' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Risk Reviews</h3>
            </div>
            {riskReviews.length === 0 ? (
              <p className="text-slate-600 dark:text-slate-400">No risk reviews yet.</p>
            ) : (
              <div className="space-y-4">
                {riskReviews.map((risk) => (
                  <div key={risk.risk_review_id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="font-medium text-slate-900 dark:text-white">{risk.risk_title}</h4>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{risk.risk_description}</p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        risk.status === 'open' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' :
                        risk.status === 'closed' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                        'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                      }`}>
                        {risk.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3 text-sm">
                      {risk.risk_category && (
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Category: </span>
                          <span className="text-slate-900 dark:text-white">{risk.risk_category}</span>
                        </div>
                      )}
                      {risk.risk_likelihood && (
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">{RISK_MODEL_INFLUENCE_LABEL}: </span>
                          <span className="text-slate-900 dark:text-white">{formatRiskLevel(risk.risk_likelihood)}</span>
                        </div>
                      )}
                      {risk.risk_impact && (
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">{RISK_DECISION_CONSEQUENCE_LABEL}: </span>
                          <span className="text-slate-900 dark:text-white">{formatRiskLevel(risk.risk_impact)}</span>
                        </div>
                      )}
                    </div>
                    {risk.mitigation_strategy && (
                      <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-700/50 rounded text-sm">
                        <p className="text-slate-600 dark:text-slate-400 mb-1">Mitigation Strategy:</p>
                        <p className="text-slate-900 dark:text-white">{risk.mitigation_strategy}</p>
                      </div>
                    )}
                    {risk.closure_comment && (
                      <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded text-sm">
                        <p className="text-slate-600 dark:text-slate-400 mb-1">Closure Comment:</p>
                        <p className="text-slate-900 dark:text-white">{risk.closure_comment}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'comments' && (
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Comments</h3>

            {hasPermission('case_comment') && (
              <form onSubmit={handleAddComment} className="mb-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <input
                    type="text"
                    value={newComment.text}
                    onChange={(e) => setNewComment({ ...newComment, text: e.target.value })}
                    placeholder="Add a comment..."
                    maxLength={300}
                    className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-600 dark:text-slate-400">Rating (optional):</span>
                    <StarRating
                      rating={newComment.rating ?? undefined}
                      interactive
                      onSelect={(v) => setNewComment({ ...newComment, rating: v })}
                      size="md"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!newComment.text.trim() && (newComment.rating == null || newComment.rating < 1)}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Post
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-4">
              {comments.length === 0 ? (
                <p className="text-slate-600 dark:text-slate-400">No comments yet.</p>
              ) : (
                comments.map((comment) => (
                  <div key={comment.comment_id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <p className="font-medium text-slate-900 dark:text-white">
                          {comment.user_name || 'Unknown User'}
                        </p>
                        {comment.rating != null && (
                          <StarRating rating={comment.rating} size="sm" />
                        )}
                      </div>
                      <span className="text-sm text-slate-500 dark:text-slate-400">
                        {new Date(comment.comment_date).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">{comment.comment}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'technical' && <ApprovedTechnicalRecord useCase={useCase} />}
        {activeTab === 'business' && <ApprovedBusinessRecord useCase={useCase} />}
        {activeTab === 'estimate' && <ApprovedEstimateRecord useCase={useCase} />}
        {activeTab === 'roi' && <ApprovedRoiRecord useCase={useCase} />}

        {activeTab === 'assessment' && useCase && (
          <UseCaseAssessmentPanel
            useCaseId={useCaseId}
            useCase={useCase}
            canInitiateAssessment={canInitiateAssessment && !isClosedRecord}
            canContributeAssessment={canContributeAssessment && !isClosedRecord}
          />
        )}
      </div>
    </div>
  );
}
