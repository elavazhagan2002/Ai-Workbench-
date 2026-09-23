import { useState, useEffect, useCallback, useLayoutEffect, useRef, type CSSProperties, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type {
  UseCase,
  UseCaseAssessment,
  UseCaseComment,
  UseCaseData,
  UseCaseDocumentationQualityAnalysis,
  UseCaseDocumentationQualitySummary,
  UseCaseRiskReview,
  ViewLayout,
} from '../types';
import { Plus, ArrowLeft, LayoutGrid, List, Edit2, Trash2, Eye, ChevronLeft, ChevronRight, X, Search, Download, PlayCircle, Link as LinkIcon, Filter, Loader2, Sparkles, ClipboardCheck, HelpCircle } from 'lucide-react';
import jsPDF from 'jspdf';
import ConfirmModal from '../components/ConfirmModal';
import StarRating from '../components/StarRating';
import DemoVideoPlayer from '../components/DemoVideoPlayer';
import UseCaseResourcesModal from '../components/UseCaseResourcesModal';
import UseCaseDocumentationQualityModal from '../components/UseCaseDocumentationQualityModal';
import SelectMenu from '../components/SelectMenu';
import AIFieldAssist from '../components/AIFieldAssist';
import { USE_CASE_FIELD_HELP } from '../constants/useCaseFieldHelp';
import { logger } from '../utils/logger';
import { domainAccessDeniedMessage, isDomainAccessDeniedMessage } from '../utils/domainAccessMessage';
import { getCompressedLogoDataUrl } from '../utils/pdfLogo';
import sciagenLogoUrl from '../assets/images/sciagen_logo.png';

interface UseCasesProps {
  domainId: string;
  onBack: () => void;
  onViewUseCase: (useCaseId: string, tab?: 'overview' | 'assessment') => void;
  onEditUseCase: (
    useCaseId: string,
    section?: string | null,
    action?: string | null,
    domainId?: string | null,
  ) => void;
  selectedStatus: UseCaseStatusFilter;
  onStatusChange: (status: UseCaseStatusFilter) => void;
}

const STATUS_COLORS: Record<string, string> = {
  'New': 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  'Analysis': 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  'Review': 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
  'Estimate': 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
  'ROI': 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300',
  'AI Assessment': 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
  'Approved': 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  'Rejected': 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  'Development': 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300',
  'Testing': 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
  'Production': 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  'Retired': 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400'
};

type CreateRequiredField = 'use_case_title' | 'department' | 'use_case_description' | 'expected_benefits';
type CreateFieldErrors = Partial<Record<CreateRequiredField, string>>;

const CREATE_REQUIRED_FIELD_ORDER: CreateRequiredField[] = [
  'use_case_title',
  'department',
  'use_case_description',
  'expected_benefits',
];

const CREATE_FIELD_IDS: Record<CreateRequiredField, string> = {
  use_case_title: 'create-title',
  department: 'create-department',
  use_case_description: 'create-description',
  expected_benefits: 'create-expected-benefits',
};

const CREATE_FIELD_LABELS: Record<CreateRequiredField, string> = {
  use_case_title: 'Title',
  department: 'Department',
  use_case_description: 'Description',
  expected_benefits: 'Expected Benefits',
};

const CREATE_FIELD_ERROR_CLASS =
  'border-red-500 ring-2 ring-red-500/30 focus:border-red-500 focus:ring-red-500/40 dark:border-red-400 dark:ring-red-400/30';

function getCreateStep1FieldErrors(data: {
  use_case_title: string;
  department: string;
  use_case_description: string;
  expected_benefits: string;
}): CreateFieldErrors {
  const errors: CreateFieldErrors = {};
  if (!data.use_case_title.trim()) errors.use_case_title = 'Title is required.';
  if (!data.department.trim()) errors.department = 'Department is required.';
  if (!data.use_case_description.trim()) errors.use_case_description = 'Description is required.';
  if (!data.expected_benefits.trim()) errors.expected_benefits = 'Expected Benefits is required.';
  return errors;
}

import { getAiCategoryLabel } from '../constants/aiCategories';
import {
  assessmentDocumentationQualityMessage,
  canShowAssessmentOnUseCase,
  getDocumentationQualityScore,
  isAssessmentDocumentationQualityMet,
  MIN_DOCUMENTATION_QUALITY_FOR_ASSESSMENT,
} from '../constants/assessmentEligibility';
import {
  appendStatusBadge,
  appendUseCaseReportSections,
} from '../utils/useCasePdf';

type UseCaseStatusFilter = 'All' | UseCase['status'];
type DocumentationQualityRequestMode = 'loading_saved' | 'recalculating' | null;

interface DocumentationQualityModalState {
  useCase: UseCase | null;
  result: UseCaseDocumentationQualityAnalysis | null;
  loading: boolean;
  error: string;
  requestMode: DocumentationQualityRequestMode;
}

const USE_CASE_STATUS_OPTIONS: UseCaseStatusFilter[] = [
  'All',
  'New',
  'Analysis',
  'Review',
  'Estimate',
  'ROI',
  'AI Assessment',
  'Approved',
  'Rejected',
];

const EMPTY_CELL = '\u2014';
const DOCUMENTATION_SCORE_TOOLTIP_WIDTH = 256;
const DOCUMENTATION_SCORE_TOOLTIP_GAP = 8;
const DOCUMENTATION_SCORE_TOOLTIP_PADDING = 12;

function displayListValue(value?: string | null) {
  const text = value?.trim();
  return text || EMPTY_CELL;
}

function getDocumentationQualityTone(score?: number | null) {
  if (score == null) {
    return 'border-slate-300/80 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700';
  }

  if (score >= 80) {
    return 'border-emerald-400/35 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200 dark:hover:bg-emerald-400/15';
  }

  if (score >= 60) {
    return 'border-amber-400/35 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200 dark:hover:bg-amber-400/15';
  }

  return 'border-rose-400/35 bg-rose-500/10 text-rose-700 hover:bg-rose-500/15 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200 dark:hover:bg-rose-400/15';
}

function getDocumentationQualityStatusLabel(score: number) {
  if (score >= 80) return 'Strong';
  if (score >= 60) return 'Moderate';
  return 'Needs work';
}

function formatDocumentationQualityTimestamp(timestamp?: string | null) {
  if (!timestamp) return 'Not available';

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }

  return parsed.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildDocumentationQualitySummaryFromAnalysis(
  result: UseCaseDocumentationQualityAnalysis
): UseCaseDocumentationQualitySummary {
  return {
    overall_score: result.overall_score,
    strengths_count: result.strengths.length,
    improvements_count: result.improvement_suggestions.length,
    status_label:
      result.documentation_quality_summary?.status_label?.trim() ||
      getDocumentationQualityStatusLabel(result.overall_score),
    analyzed_at: result.documentation_quality_summary?.analyzed_at ?? new Date().toISOString(),
    is_stale: result.documentation_quality_summary?.is_stale ?? false,
  };
}

interface DocumentationScoreTriggerProps {
  useCase: UseCase;
  summary: UseCaseDocumentationQualitySummary | null;
  isPending: boolean;
  scoreLabel: string;
  onOpen: (useCase: UseCase, event?: MouseEvent<HTMLElement>) => void;
}

function DocumentationScoreTrigger({
  useCase,
  summary,
  isPending,
  scoreLabel,
  onOpen,
}: DocumentationScoreTriggerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);
  const scoreTone = getDocumentationQualityTone(summary?.overall_score);
  const useCaseLabel = useCase.use_case_title || useCase.use_case_name;
  const showTooltip = open && summary != null && !isPending;

  const updateTooltipPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxWidth = Math.min(
      DOCUMENTATION_SCORE_TOOLTIP_WIDTH,
      viewportWidth - DOCUMENTATION_SCORE_TOOLTIP_PADDING * 2,
    );
    const left = Math.min(
      Math.max(rect.right - maxWidth, DOCUMENTATION_SCORE_TOOLTIP_PADDING),
      viewportWidth - maxWidth - DOCUMENTATION_SCORE_TOOLTIP_PADDING,
    );
    const spaceBelow = viewportHeight - rect.bottom - DOCUMENTATION_SCORE_TOOLTIP_PADDING;
    const spaceAbove = rect.top - DOCUMENTATION_SCORE_TOOLTIP_PADDING;
    const placeBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove;

    if (placeBelow) {
      setTooltipStyle({
        position: 'fixed',
        top: rect.bottom + DOCUMENTATION_SCORE_TOOLTIP_GAP,
        left,
        width: maxWidth,
        maxHeight: Math.max(spaceBelow - DOCUMENTATION_SCORE_TOOLTIP_GAP, 120),
        zIndex: 200,
      });
      return;
    }

    setTooltipStyle({
      position: 'fixed',
      bottom: viewportHeight - rect.top + DOCUMENTATION_SCORE_TOOLTIP_GAP,
      left,
      width: maxWidth,
      maxHeight: Math.max(spaceAbove - DOCUMENTATION_SCORE_TOOLTIP_GAP, 120),
      zIndex: 200,
    });
  }, []);

  useLayoutEffect(() => {
    if (!showTooltip) {
      setTooltipStyle(null);
      return;
    }

    updateTooltipPosition();
    window.addEventListener('resize', updateTooltipPosition);
    window.addEventListener('scroll', updateTooltipPosition, true);
    return () => {
      window.removeEventListener('resize', updateTooltipPosition);
      window.removeEventListener('scroll', updateTooltipPosition, true);
    };
  }, [showTooltip, updateTooltipPosition]);

  return (
    <div
      className="relative inline-flex shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          setOpen(false);
          onOpen(useCase, event);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        disabled={isPending}
        className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${scoreTone}`}
        title={summary ? undefined : 'Open AI documentation quality analysis'}
        aria-label={`${summary ? 'Open latest saved' : 'Open'} AI documentation quality analysis for ${useCaseLabel}`}
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {summary?.is_stale && !isPending && (
          <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden="true" />
        )}
        <span>{scoreLabel}</span>
      </button>

      {showTooltip && tooltipStyle && typeof document !== 'undefined' && createPortal(
        <div
          className="pointer-events-none overflow-auto rounded-xl border border-slate-200 bg-white/95 p-3 text-left shadow-xl dark:border-slate-700 dark:bg-slate-900/95"
          role="tooltip"
          style={tooltipStyle}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                AI Documentation Quality
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-white">
                {useCaseLabel}
              </p>
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold ${scoreTone}`}>
              {Math.round(summary.overall_score)}/100
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-slate-800/80">
              <p className="text-slate-500 dark:text-slate-400">Strengths</p>
              <p className="mt-1 font-semibold text-slate-900 dark:text-white">{summary.strengths_count}</p>
            </div>
            <div className="rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-slate-800/80">
              <p className="text-slate-500 dark:text-slate-400">Improvements</p>
              <p className="mt-1 font-semibold text-slate-900 dark:text-white">{summary.improvements_count}</p>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800/70">
            <p className="font-medium text-slate-900 dark:text-white">{summary.status_label}</p>
            <p className="mt-1 text-slate-600 dark:text-slate-300">
              Analyzed {formatDocumentationQualityTimestamp(summary.analyzed_at)}
            </p>
            {summary.is_stale && (
              <p className="mt-1 text-amber-600 dark:text-amber-300">Saved analysis may be stale.</p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export default function UseCases({ domainId, onBack, onViewUseCase, onEditUseCase, selectedStatus, onStatusChange }: UseCasesProps) {
  const { user, hasPermission } = useAuth();
  const isAdmin = user?.role?.role_name === 'portal_admin';
  const canAccessDocumentationQuality = isAdmin || hasPermission('domain_owner');
  const canInitiateAssessment =
    hasPermission('initiate_assessment');
  const canContributeAssessment = hasPermission('contribute_assessment');
  const hasAssessmentParticipation = canInitiateAssessment || canContributeAssessment;
  const canShowAssessment = canShowAssessmentOnUseCase(
    hasPermission('case_view'),
    hasAssessmentParticipation,
  );
  const [useCases, setUseCases] = useState<UseCase[]>([]);
  const [domain, setDomain] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [accessDeniedMessage, setAccessDeniedMessage] = useState('');
  const [layout, setLayout] = useState<ViewLayout>(() => {
    return (localStorage.getItem('useCaseLayout') as ViewLayout) || 'cards';
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(9);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    use_case_title: '',
    department: '',
    use_case_description: '',
    intended_use: '',
    expected_benefits: '',
    tags: [] as string[]
  });
  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<CreateFieldErrors>({});
  const [focusField, setFocusField] = useState<CreateRequiredField | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftQuality, setDraftQuality] = useState<{
    overall_score: number;
    status_label: string;
    fields: Array<{ field_name: string; score: number; feedback: string }>;
    improvement_suggestions: string[];
  } | null>(null);
  const [draftQualityLoading, setDraftQualityLoading] = useState(false);
  const canCreateCase = hasPermission('case_create');
  const canUseCreateAI = canCreateCase || hasPermission('case_edit');
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; useCase: UseCase | null }>({
    isOpen: false,
    useCase: null
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [demoModalUseCase, setDemoModalUseCase] = useState<UseCase | null>(null);
  const [resourceModalUseCase, setResourceModalUseCase] = useState<UseCase | null>(null);
  const [documentationQualityPendingIds, setDocumentationQualityPendingIds] = useState<Record<string, boolean>>({});
  const [documentationQualityModalState, setDocumentationQualityModalState] = useState<DocumentationQualityModalState>({
    useCase: null,
    result: null,
    loading: false,
    error: '',
    requestMode: null,
  });

  const totalSteps = 3;

  const clearFieldError = useCallback((field: CreateRequiredField) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!focusField || !showModal || currentStep !== 1) return;

    const fieldId = CREATE_FIELD_IDS[focusField];
    const timer = window.setTimeout(() => {
      const el = document.getElementById(fieldId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
      }
      setFocusField(null);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [focusField, showModal, currentStep]);

  function hasDemoVideo(useCase: UseCase) {
    return !!useCase.has_demo || !!useCase.demo_video_path;
  }

  function canOpenDemoVideo(useCase: UseCase) {
    return hasPermission('view_demo') && hasDemoVideo(useCase);
  }

  function canOpenResourcesModal() {
    if (isAdmin) {
      return (
        hasPermission('case_view') ||
        hasPermission('case_edit') ||
        hasPermission('view_demo') ||
        hasPermission('map_demo')
      );
    }

    return (
      hasPermission('view_live_demo') ||
      hasPermission('view_document') ||
      hasPermission('view_infographic')
    );
  }

  function handleUseCaseResourceUpdate(useCaseId: string, changes: Partial<UseCase>) {
    setUseCases((prev) =>
      prev.map((useCase) =>
        useCase.use_case_id === useCaseId ? { ...useCase, ...changes } : useCase
      )
    );

    setResourceModalUseCase((prev) =>
      /*  */prev && prev.use_case_id === useCaseId ? { ...prev, ...changes } : prev
    );

    setDemoModalUseCase((prev) =>
      prev && prev.use_case_id === useCaseId ? { ...prev, ...changes } : prev
    );

    setDocumentationQualityModalState((prev) =>
      prev.useCase?.use_case_id === useCaseId
        ? { ...prev, useCase: { ...prev.useCase, ...changes } }
        : prev
    );
  }

  function openDemoVideo(useCase: UseCase, event?: MouseEvent<HTMLElement>) {
    event?.preventDefault();
    event?.stopPropagation();

    if (!canOpenDemoVideo(useCase)) {
      return;
    }

    setDemoModalUseCase(useCase);
  }

  function openResourcesModal(useCase: UseCase, event?: MouseEvent<HTMLElement>) {
    event?.preventDefault();
    event?.stopPropagation();

    if (!canOpenResourcesModal()) {
      return;
    }

    setResourceModalUseCase(useCase);
  }

  function updateDocumentationQualitySummary(
    useCaseId: string,
    summary: UseCaseDocumentationQualitySummary | null,
  ) {
    handleUseCaseResourceUpdate(useCaseId, {
      documentation_quality_summary: summary,
    });
  }

  function getDocumentationScoreLabel(summary?: UseCaseDocumentationQualitySummary | null) {
    if (!summary) return 'AI Score';
    return `${Math.round(summary.overall_score)}/100`;
  }

  function renderDocumentationScoreTrigger(useCase: UseCase) {
    if (!canAccessDocumentationQuality) return null;

    const summary = useCase.documentation_quality_summary ?? null;
    const isPending = documentationQualityPendingIds[useCase.use_case_id] === true;

    return (
      <DocumentationScoreTrigger
        useCase={useCase}
        summary={summary}
        isPending={isPending}
        scoreLabel={isPending ? 'Updating...' : getDocumentationScoreLabel(summary)}
        onOpen={handleDocumentationQualityTrigger}
      />
    );
  }

  function renderAssessmentButton(useCase: UseCase) {
    if (!canShowAssessment) return null;

    const summary = useCase.documentation_quality_summary ?? null;
    const docMet = isAssessmentDocumentationQualityMet(summary);
    const tooltip = docMet
      ? 'Open assessment checklist'
      : assessmentDocumentationQualityMessage(summary)
        || `Requires AI documentation quality score of at least ${MIN_DOCUMENTATION_QUALITY_FOR_ASSESSMENT}%`;

    return (
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onViewUseCase(useCase.use_case_id, 'assessment');
        }}
        className={useCaseActionButtonClass}
        title={tooltip}
        aria-label={`Open assessment for ${useCase.use_case_title || useCase.use_case_name}`}
      >
        <ClipboardCheck className={`h-4 w-4 ${docMet ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`} />
      </button>
    );
  }

  async function loadSavedDocumentationQuality(useCase: UseCase) {
    const useCaseId = useCase.use_case_id;

    setDocumentationQualityModalState({
      useCase,
      result: null,
      loading: true,
      error: '',
      requestMode: 'loading_saved',
    });

    try {
      const result = await api.getSavedUseCaseDocumentationQuality(useCaseId);
      if (result) {
        updateDocumentationQualitySummary(
          useCaseId,
          result.documentation_quality_summary ?? buildDocumentationQualitySummaryFromAnalysis(result),
        );
      }

      setDocumentationQualityModalState((prev) =>
        prev.useCase?.use_case_id === useCaseId
          ? { ...prev, result, loading: false, error: '', requestMode: null }
          : prev
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load documentation quality analysis.';
      setDocumentationQualityModalState((prev) =>
        prev.useCase?.use_case_id === useCaseId
          ? { ...prev, loading: false, error: message, requestMode: null }
          : prev
      );
    }
  }

  async function analyzeDocumentationQuality(useCase: UseCase) {
    const useCaseId = useCase.use_case_id;

    setDocumentationQualityPendingIds((prev) => ({
      ...prev,
      [useCaseId]: true,
    }));
    setDocumentationQualityModalState((prev) =>
      prev.useCase?.use_case_id === useCaseId
        ? { ...prev, loading: true, error: '', requestMode: 'recalculating' }
        : {
            useCase,
            result: null,
            loading: true,
            error: '',
            requestMode: 'recalculating',
          }
    );

    try {
      const result = await api.analyzeUseCaseDocumentationQuality(useCaseId);
      updateDocumentationQualitySummary(
        useCaseId,
        result.documentation_quality_summary ?? buildDocumentationQualitySummaryFromAnalysis(result),
      );
      setDocumentationQualityModalState((prev) =>
        prev.useCase?.use_case_id === useCaseId
          ? { ...prev, result, loading: false, error: '', requestMode: null }
          : prev
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to analyze documentation quality.';
      setDocumentationQualityModalState((prev) =>
        prev.useCase?.use_case_id === useCaseId
          ? { ...prev, loading: false, error: message, requestMode: null }
          : prev
      );
    } finally {
      setDocumentationQualityPendingIds((prev) => ({
        ...prev,
        [useCaseId]: false,
      }));
    }
  }

  function handleDocumentationQualityTrigger(useCase: UseCase, event?: MouseEvent<HTMLElement>) {
    event?.preventDefault();
    event?.stopPropagation();
    void loadSavedDocumentationQuality(useCase);
  }

  function handleCloseDocumentationQualityModal() {
    setDocumentationQualityModalState({
      useCase: null,
      result: null,
      loading: false,
      error: '',
      requestMode: null,
    });
  }

  function handleRecalculateDocumentationQuality() {
    if (!documentationQualityModalState.useCase) return;
    void analyzeDocumentationQuality(documentationQualityModalState.useCase);
  }

  const demoVideoActionClass =
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-green-300/70 bg-[linear-gradient(135deg,rgba(74,222,128,0.18),rgba(34,197,94,0.2))] text-green-700 shadow-[0_0_0_1px_rgba(134,239,172,0.22),0_10px_24px_-14px_rgba(34,197,94,0.8),0_0_22px_rgba(74,222,128,0.22)] transition-all duration-200 hover:-translate-y-px hover:border-green-300/90 hover:text-green-800 hover:shadow-[0_0_0_1px_rgba(134,239,172,0.32),0_14px_30px_-16px_rgba(34,197,94,0.9),0_0_26px_rgba(74,222,128,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-green-400/35 dark:bg-[linear-gradient(135deg,rgba(74,222,128,0.18),rgba(34,197,94,0.18))] dark:text-green-100 dark:shadow-[0_0_0_1px_rgba(74,222,128,0.14),0_12px_28px_-16px_rgba(34,197,94,0.7),0_0_24px_rgba(74,222,128,0.2)] dark:hover:border-green-300/50 dark:hover:text-white dark:hover:shadow-[0_0_0_1px_rgba(134,239,172,0.22),0_16px_32px_-16px_rgba(34,197,94,0.78),0_0_30px_rgba(74,222,128,0.3)] dark:focus-visible:ring-green-300/40 dark:focus-visible:ring-offset-slate-800';
  const useCaseActionButtonClass =
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-blue-400';
  const useCaseDeleteButtonClass =
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-red-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-red-400';

  useEffect(() => {
    loadData();
  }, [domainId]);

  useEffect(() => {
    localStorage.setItem('useCaseLayout', layout);
  }, [layout]);

  useEffect(() => {
    setCurrentPage(1);
  }, [useCases.length]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedStatus]);

  async function loadData() {
    setAccessDeniedMessage('');
    try {
      const [domainData, useCasesData] = await Promise.all([
        api.getDomain(domainId),
        api.getUseCases(domainId)
      ]);

      setDomain(domainData);
      setUseCases(useCasesData || []);
      void api
        .recordUiNavigationEvent({
          action: 'use_cases_opened',
          domain_id: domainId,
          domain_name: domainData?.domain_name,
          domain_short_name: domainData?.domain_short_name,
        })
        .catch(() => {});
    } catch (err: any) {
      logger.error('Error loading data', err);
      const message = err?.message || '';
      if (isDomainAccessDeniedMessage(message)) {
        setAccessDeniedMessage(domainAccessDeniedMessage(message));
        setDomain(null);
        setUseCases([]);
      }
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal() {
    setFormData({
      use_case_title: '',
      department: '',
      use_case_description: '',
      intended_use: '',
      expected_benefits: '',
      tags: []
    });
    setTagInput('');
    setError('');
    setFieldErrors({});
    setFocusField(null);
    setDraftQuality(null);
    setCurrentStep(1);
    setIsSubmitting(false);
    setShowModal(true);
  }

  function validateStep(step: number): boolean {
    if (step !== 1) return true;

    const errors = getCreateStep1FieldErrors(formData);
    setFieldErrors(errors);

    const missingFields = CREATE_REQUIRED_FIELD_ORDER.filter((field) => Boolean(errors[field]));
    if (missingFields.length === 0) {
      setError('');
      return true;
    }

    const labels = missingFields.map((field) => CREATE_FIELD_LABELS[field]);
    setError(
      missingFields.length === 1
        ? `${labels[0]} is required.`
        : `Please fill in the required fields: ${labels.join(', ')}.`
    );
    setFocusField(missingFields[0]);
    return false;
  }

  async function runDraftQualityCheck() {
    if (!validateStep(1)) return;
    setDraftQualityLoading(true);
    setError('');
    setFieldErrors({});
    try {
      const result = await api.draftUseCaseQuality({
        title: formData.use_case_title.trim(),
        department: formData.department.trim(),
        description: formData.use_case_description.trim(),
        expected_benefits: formData.expected_benefits.trim(),
        intended_use: formData.intended_use.trim() || null,
      });
      setDraftQuality(result);
    } catch (err: any) {
      setError(err?.message || 'Unable to analyze entry quality.');
    } finally {
      setDraftQualityLoading(false);
    }
  }

  function handleNext() {
    if (validateStep(currentStep)) {
      setError('');
      setFieldErrors({});
      if (currentStep < totalSteps) {
        setCurrentStep(currentStep + 1);
      }
    }
  }

  function handleBack() {
    setError('');
    setFieldErrors({});
    setFocusField(null);
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  }

  function addTag() {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData({ ...formData, tags: [...formData.tags, tagInput.trim()] });
      setTagInput('');
    }
  }

  function removeTag(tag: string) {
    setFormData({ ...formData, tags: formData.tags.filter(t => t !== tag) });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Only submit if we're on the last step
    if (currentStep === totalSteps) {
      await handleCreateUseCase();
    }
  }

  async function handleCreateUseCase() {
    setError('');

    if (!user) return;

    if (!validateStep(1)) {
      setCurrentStep(1);
      return;
    }

    const title = formData.use_case_title.trim();
    setIsSubmitting(true);
    try {
      await api.createUseCase({
        domain_id: domainId,
        use_case_name: title.slice(0, 30),
        use_case_title: title,
        use_case_description: formData.use_case_description.trim(),
        intended_use: formData.intended_use.trim() || null,
        expected_benefits: formData.expected_benefits.trim(),
        department: formData.department.trim(),
        tags: formData.tags,
        status: 'New'
      });

      setShowModal(false);
      loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteModal.useCase || !user) return;

    try {
      await api.deleteUseCase(deleteModal.useCase.use_case_id);
      loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function exportAllToPDF() {
    if (!domain || useCases.length === 0) return;
    setExportingPdf(true);
    try {
      const exportData = await Promise.all(
        useCases.map(async (uc) => {
          const [fullUseCase, dataReqs, riskReviews, comments, assessmentPayload] = await Promise.all([
            api.getUseCase(uc.use_case_id),
            api.getUseCaseData(uc.use_case_id).catch(() => []),
            api.getUseCaseRiskReviews(uc.use_case_id).catch(() => []),
            api.getUseCaseComments(uc.use_case_id).catch(() => []),
            api.getUseCaseAssessment(uc.use_case_id, { includeParticipants: true }).catch(() => ({ assessment: null })),
          ]);
          return {
            useCase: fullUseCase as UseCase,
            dataReqs: (dataReqs || []) as UseCaseData[],
            riskReviews: (riskReviews || []) as UseCaseRiskReview[],
            comments: (comments || []) as UseCaseComment[],
            assessment: (assessmentPayload as { assessment?: UseCaseAssessment | null })?.assessment ?? null,
          };
        }),
      );

      const doc = new jsPDF({ compress: true });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const marginLeft = 15;
      const marginRight = pageWidth - 15;

      let logoDataUrl: string | null = null;
      try {
        logoDataUrl = await getCompressedLogoDataUrl(sciagenLogoUrl);
      } catch (e) {
        logger.error('Could not load logo for PDF', e);
      }

      const addFooter = (currentDate: string) => {
        const totalPages = doc.getNumberOfPages();
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
      };

      const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

      // Page 1: Domain summary
      let yPos = 24;
      if (domain.domain_short_name) {
        doc.setFillColor(59, 130, 246);
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        const tagText = domain.domain_short_name;
        const tagWidth = doc.getTextWidth(tagText) + 6;
        doc.roundedRect(marginLeft, yPos - 4, tagWidth, 6, 3, 3, 'F');
        doc.text(tagText, marginLeft + 3, yPos);
        doc.setTextColor(0, 0, 0);
        yPos += 12;
      }
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('Domain Summary', marginLeft, yPos);
      yPos += 10;

      doc.setFontSize(14);
      doc.setFont('helvetica', 'normal');
      doc.text(domain.domain_name || 'Domain', marginLeft, yPos);
      yPos += 8;

      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(`Number of use cases: ${useCases.length}`, marginLeft, yPos);
      doc.setFont('helvetica', 'normal');
      yPos += 10;

      if (domain.domain_detail && domain.domain_detail.trim()) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('Domain detail', marginLeft, yPos);
        yPos += 6;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const detailLines = doc.splitTextToSize(domain.domain_detail.trim(), pageWidth - 30);
        doc.text(detailLines, marginLeft, yPos);
        yPos += detailLines.length * 5 + 8;
      }

      doc.setDrawColor(226, 232, 240);
      doc.line(marginLeft, yPos, marginRight, yPos);
      yPos += 10;
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      const summaryLines = doc.splitTextToSize(
        `Report generated on ${currentDate}. The following pages list each use case with workflow stages, analysis, estimate, ROI, assessment, data requirements, risks, and comments.`,
        pageWidth - 30,
      );
      doc.text(summaryLines, marginLeft, yPos);
      doc.setTextColor(0, 0, 0);
      yPos += summaryLines.length * 5 + 16;

      // Use case pages
      for (let i = 0; i < exportData.length; i++) {
        const { useCase: uc, dataReqs, riskReviews, comments, assessment } = exportData[i];
        doc.addPage();
        yPos = 20;

        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(uc.use_case_name, marginLeft, yPos);
        yPos += 8;

        if (uc.use_case_title) {
          doc.setFontSize(11);
          doc.setFont('helvetica', 'normal');
          const titleLines = doc.splitTextToSize(uc.use_case_title, pageWidth - 30);
          doc.text(titleLines, marginLeft, yPos);
          yPos += titleLines.length * 5 + 4;
        }

        yPos = appendStatusBadge(doc, uc.status, yPos, { align: 'left', marginLeft });

        if (uc.average_rating != null) {
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.text(`Average rating: ${uc.average_rating} / 5`, marginLeft, yPos);
          yPos += 8;
        }

        appendUseCaseReportSections(
          doc,
          uc,
          yPos,
          { dataReqs, riskReviews, comments, assessment },
          { includeAudit: false },
        );
      }

      addFooter(currentDate);

      const safeName = (domain.domain_name || 'Domain').replace(/[^a-z0-9]/gi, '_');
      const timestamp = new Date().toISOString().split('T')[0];
      doc.save(`${safeName}_UseCases_${timestamp}.pdf`);
    } catch (err) {
      logger.error('Error exporting PDF', err);
    } finally {
      setExportingPdf(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-600 dark:text-slate-400">Loading use cases...</div>
      </div>
    );
  }

  if (accessDeniedMessage) {
    return (
      <div className="wb-page flex items-center justify-center min-h-[50vh]">
        <div className="wb-card-pad max-w-md text-center">
          <h2 className="font-display text-lg font-semibold text-ink">Domain not assigned</h2>
          <p className="mt-2 text-sm text-ink-muted leading-relaxed">{accessDeniedMessage}</p>
          <button type="button" onClick={onBack} className="wb-btn-primary mt-6">
            <ArrowLeft className="h-4 w-4" />
            Back to domains
          </button>
        </div>
      </div>
    );
  }

  const q = searchQuery.trim().toLowerCase();
  const filteredUseCases = useCases.filter((uc) => {
    const titleMatch = (uc.use_case_name ?? '').toLowerCase().includes(q) ||
      (uc.use_case_title ?? '').toLowerCase().includes(q);
    const contentMatch = (uc.use_case_description ?? '').toLowerCase().includes(q) ||
      (uc.expected_benefits ?? '').toLowerCase().includes(q);
    const tagsMatch = (uc.tags ?? []).some((t) => t.toLowerCase().includes(q));
    const matchesSearch = !q || titleMatch || contentMatch || tagsMatch;
    const matchesStatus = selectedStatus === 'All' || uc.status === selectedStatus;

    return matchesSearch && matchesStatus;
  });

  const totalPages = Math.ceil(filteredUseCases.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentUseCases = filteredUseCases.slice(startIndex, endIndex);

  return (
    <div className="wb-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 text-ink-muted hover:bg-surface-muted rounded-xl transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="wb-page-title">{domain?.domain_name}</h2>
            <p className="wb-page-subtitle">
              {searchQuery.trim() || selectedStatus !== 'All' ? `${filteredUseCases.length} of ${useCases.length} use cases` : `${useCases.length} use cases`}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <div className="relative w-full min-w-[12rem] max-w-xs sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, content, or tags..."
              className="wb-input pl-9 pr-8"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink-subtle hover:text-ink rounded"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="w-[16.5rem] shrink-0">
            <SelectMenu
              value={selectedStatus}
              onChange={(status) => onStatusChange(status as UseCaseStatusFilter)}
              variant="filter"
              searchable={false}
              leadingIcon={<Filter className="w-4 h-4" />}
              options={USE_CASE_STATUS_OPTIONS.map((status) => ({
                value: status,
                label: status === 'All' ? 'All statuses' : status,
              }))}
              aria-label="Filter use cases by status"
            />
          </div>
          <div className="flex gap-1 bg-surface-muted rounded-xl p-1 shrink-0">
            <button
              onClick={() => setLayout('cards')}
              className={`p-2 rounded-lg transition-colors ${
                layout === 'cards'
                  ? 'bg-surface-elevated text-cyan-600 dark:text-cyan-400 shadow-sm'
                  : 'text-ink-muted'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setLayout('grid')}
              className={`p-2 rounded-lg transition-colors ${
                layout === 'grid'
                  ? 'bg-surface-elevated text-cyan-600 dark:text-cyan-400 shadow-sm'
                  : 'text-ink-muted'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={exportAllToPDF}
            disabled={useCases.length === 0 || exportingPdf}
            title={useCases.length === 0 ? 'No use cases to export' : 'Download all use cases as a single PDF'}
            className="wb-btn-secondary disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <Download className="w-4 h-4" />
            {exportingPdf ? 'Exporting…' : 'Download PDF'}
          </button>

          {hasPermission('case_create') && (
            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shrink-0"
            >
              <Plus className="w-4 h-4" />
              New Use Case
            </button>
          )}
        </div>
      </div>

      {!showModal && filteredUseCases.length === 0 && (
        <div className="py-12 text-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <Search className="w-12 h-12 mx-auto text-slate-400 dark:text-slate-500 mb-3" />
          <p className="text-slate-600 dark:text-slate-400">
            {searchQuery.trim() || selectedStatus !== 'All'
              ? 'No use cases match the current search or status filter. Try different keywords or clear the filters.'
              : 'No use cases in this domain yet.'}
          </p>
          {(searchQuery.trim() || selectedStatus !== 'All') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                onStatusChange('All');
              }}
              className="mt-3 text-blue-600 dark:text-blue-400 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {!showModal && filteredUseCases.length > 0 && (layout === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {currentUseCases.map((useCase) => (
            <div
              key={useCase.use_case_id}
              className={`relative flex h-full min-w-0 flex-col rounded-xl border bg-white p-6 transition-all duration-200 dark:bg-slate-800 ${
                canOpenDemoVideo(useCase)
                  ? 'border-green-400 dark:border-green-500 shadow-[0_0_0_1px_rgba(74,222,128,0.22)] hover:border-green-300 dark:hover:border-green-400 hover:shadow-lg'
                  : 'border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-lg'
              }`}
            >
              <div className="mb-4 flex shrink-0 min-w-0 items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="mb-2 line-clamp-2 break-words text-lg font-bold text-slate-900 dark:text-white">
                    {useCase.use_case_name}
                  </h3>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <div className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[useCase.status]}`}>
                      {useCase.status}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-nowrap items-center justify-end gap-1">
                  {renderDocumentationScoreTrigger(useCase)}
                  {renderAssessmentButton(useCase)}
                  {hasPermission('case_view') && (
                    <button
                      onClick={() => onViewUseCase(useCase.use_case_id)}
                      className={useCaseActionButtonClass}
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  )}
                  {canOpenResourcesModal() && (
                    <button
                      type="button"
                      onClick={(event) => openResourcesModal(useCase, event)}
                      className={useCaseActionButtonClass}
                      title="Manage resources"
                      aria-label={`Manage resources for ${useCase.use_case_title || useCase.use_case_name}`}
                    >
                      <LinkIcon className="w-4 h-4" />
                    </button>
                  )}
                  {canOpenDemoVideo(useCase) && (
                    <button
                      type="button"
                      onClick={(event) => openDemoVideo(useCase, event)}
                      className={demoVideoActionClass}
                      title="View demo video"
                      aria-label={`Open demo video for ${useCase.use_case_title || useCase.use_case_name}`}
                    >
                      <PlayCircle className="h-4 w-4 drop-shadow-[0_0_8px_rgba(74,222,128,0.35)]" />
                    </button>
                  )}
                  {(hasPermission('case_edit') || (useCase.created_by === user?.user_id && useCase.status === 'New') || isAdmin) && useCase.status !== 'Approved' && useCase.status !== 'Rejected' && (
                    <button
                      onClick={() => onEditUseCase(useCase.use_case_id)}
                      className={useCaseActionButtonClass}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  )}
                  {(hasPermission('case_delete') || domain?.owner_id === user?.user_id) && (
                    <button
                      onClick={() => setDeleteModal({ isOpen: true, useCase })}
                      className={useCaseDeleteButtonClass}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="mb-2 min-h-[1.25rem]">
                {useCase.use_case_title && (
                  <p className="line-clamp-1 break-words text-sm font-medium text-slate-700 dark:text-slate-300">
                    {useCase.use_case_title}
                  </p>
                )}
              </div>
              <div className="mb-2 min-h-[1rem]">
                {(useCase.created_by_name != null && useCase.created_by_name !== '') && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Initiated by {useCase.created_by_name}
                  </p>
                )}
              </div>
              <p className="mb-4 min-h-[3.75rem] flex-1 text-sm text-slate-600 line-clamp-3 dark:text-slate-400">
                {useCase.use_case_description || 'No description available'}
              </p>

              <div className="mb-3 min-h-[1.25rem]">
                {useCase.average_rating != null && (
                  <div className="flex items-center gap-2">
                    <StarRating rating={useCase.average_rating} size="sm" />
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {useCase.average_rating} avg rating
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-auto flex max-h-[3.5rem] min-h-[1.75rem] flex-wrap gap-2 overflow-hidden">
                {useCase.ai_category && (
                  <span className="max-w-full break-words px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-xs">
                    {getAiCategoryLabel(useCase.ai_category)}
                  </span>
                )}
                {useCase.department && (
                  <span className="max-w-full break-words px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-xs">
                    {useCase.department}
                  </span>
                )}
                {useCase.tags && useCase.tags.length > 0 && useCase.tags.map((tag, index) => (
                  <span key={index} className="max-w-full break-words px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto wb-card">
          <table className="w-full">
            <thead className="bg-surface-muted border-b border-line">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Initiated by</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Category</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Department</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Rating</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {currentUseCases.map((useCase) => (
                <tr key={useCase.use_case_id} className="hover:bg-surface-muted/70">
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-ink">{useCase.use_case_name}</div>
                    <div className="text-sm text-ink-muted">{useCase.use_case_title}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[useCase.status]}`}>
                      {useCase.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                    {displayListValue(useCase.created_by_name)}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-900 dark:text-white">
                    {useCase.ai_category ? getAiCategoryLabel(useCase.ai_category) : EMPTY_CELL}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-900 dark:text-white">
                    {displayListValue(useCase.department)}
                  </td>
                  <td className="px-6 py-4">
                    {useCase.average_rating != null ? (
                      <div className="flex items-center gap-2">
                        <StarRating rating={useCase.average_rating} size="sm" />
                        <span className="text-sm text-slate-600 dark:text-slate-400">{useCase.average_rating}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-slate-400 dark:text-slate-500">{EMPTY_CELL}</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-1">
                      {renderDocumentationScoreTrigger(useCase)}
                      {renderAssessmentButton(useCase)}
                      {hasPermission('case_view') && (
                        <button
                          onClick={() => onViewUseCase(useCase.use_case_id)}
                          className={useCaseActionButtonClass}
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      )}
                      {canOpenResourcesModal() && (
                        <button
                          type="button"
                          onClick={(event) => openResourcesModal(useCase, event)}
                          className={useCaseActionButtonClass}
                          title="Manage resources"
                          aria-label={`Manage resources for ${useCase.use_case_title || useCase.use_case_name}`}
                        >
                          <LinkIcon className="w-4 h-4" />
                        </button>
                      )}
                      {canOpenDemoVideo(useCase) && (
                        <button
                          type="button"
                          onClick={(event) => openDemoVideo(useCase, event)}
                          className={demoVideoActionClass}
                          title="View demo video"
                          aria-label={`Open demo video for ${useCase.use_case_title || useCase.use_case_name}`}
                        >
                          <PlayCircle className="h-4 w-4 drop-shadow-[0_0_8px_rgba(74,222,128,0.35)]" />
                        </button>
                      )}
                      {(hasPermission('case_edit') || (useCase.created_by === user?.user_id && useCase.status === 'New') || isAdmin) && useCase.status !== 'Approved' && useCase.status !== 'Rejected' && (
                        <button
                          onClick={() => onEditUseCase(useCase.use_case_id)}
                          className={useCaseActionButtonClass}
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}
                      {(hasPermission('case_delete') || domain?.owner_id === user?.user_id) && (
                        <button
                          onClick={() => setDeleteModal({ isOpen: true, useCase })}
                          className={useCaseDeleteButtonClass}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {!showModal && totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 px-6 py-4">
          <div className="text-sm text-slate-600 dark:text-slate-400">
            Showing {startIndex + 1} to {Math.min(endIndex, filteredUseCases.length)} of {filteredUseCases.length} use cases
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-slate-700 dark:text-slate-300"
              title="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white">
              Page {currentPage} of {totalPages}
            </div>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-slate-700 dark:text-slate-300"
              title="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {demoModalUseCase && hasPermission('view_demo') && (
        <div className="wb-app-overlay z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="relative bg-black rounded-lg max-w-3xl w-full max-h-[80vh] flex flex-col">
            <button
              type="button"
              onClick={() => setDemoModalUseCase(null)}
              className="absolute top-2 right-2 p-2 text-white hover:text-slate-200"
              aria-label="Close demo video"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="p-3 text-sm text-slate-100">
              {demoModalUseCase.use_case_name}
            </div>
            <div className="flex-1 flex items-center justify-center p-3">
              <DemoVideoPlayer
                sources={[
                  {
                    label: 'Default',
                    url: api.getUseCaseDemoUrl(demoModalUseCase.use_case_id),
                  },
                ]}
                autoPlay
              />
            </div>
          </div>
        </div>
      )}

      {resourceModalUseCase && (
        <UseCaseResourcesModal
          useCase={resourceModalUseCase}
          onClose={() => setResourceModalUseCase(null)}
          isAdmin={isAdmin}
          canViewResources={hasPermission('case_view')}
          canEditResources={hasPermission('case_edit')}
          canViewDemo={hasPermission('view_demo')}
          canViewLiveDemo={hasPermission('view_live_demo')}
          canViewDocument={hasPermission('view_document')}
          canViewInfographic={hasPermission('view_infographic')}
          canMapDemo={hasPermission('map_demo')}
          canDelinkDemo={isAdmin}
          onUseCaseUpdated={handleUseCaseResourceUpdate}
        />
      )}

      <UseCaseDocumentationQualityModal
        isOpen={documentationQualityModalState.useCase != null}
        useCase={documentationQualityModalState.useCase}
        result={documentationQualityModalState.result}
        summary={documentationQualityModalState.useCase?.documentation_quality_summary ?? null}
        loading={documentationQualityModalState.loading}
        error={documentationQualityModalState.error}
        requestMode={documentationQualityModalState.requestMode}
        onClose={handleCloseDocumentationQualityModal}
        onRecalculate={handleRecalculateDocumentationQuality}
      />

      {showModal && (
        <div className="wb-card-pad">
          <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-2 rounded-xl text-ink-muted hover:bg-surface-muted transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h3 className="font-display text-xl font-semibold text-ink">
                  Create New Use Case
                </h3>
                <p className="text-sm text-ink-muted mt-1">
                  Step {currentStep} of {totalSteps}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="wb-btn-secondary"
              >
                Cancel
              </button>
              {currentStep < totalSteps ? (
                <button
                  type="button"
                  onClick={handleNext}
                  className="wb-btn-primary"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCreateUseCase}
                  disabled={isSubmitting}
                  className="wb-btn-primary bg-emerald-600 hover:bg-emerald-700"
                >
                  {isSubmitting ? 'Creating...' : 'Create Use Case'}
                </button>
              )}
            </div>
          </div>

          {/* Step Indicator */}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              {[1, 2, 3].map((step) => (
                <div key={step} className="flex items-center flex-1">
                  <div className="flex flex-col items-center flex-1">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-colors ${
                        step === currentStep
                          ? 'bg-navy-600 text-white ring-4 ring-cyan-500/25'
                          : step < currentStep
                          ? 'bg-emerald-500 text-white'
                          : 'bg-surface-muted text-ink-subtle'
                      }`}
                    >
                      {step < currentStep ? (
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        step
                      )}
                    </div>
                    <p
                      className={`mt-2 text-xs font-medium ${
                        step === currentStep
                          ? 'text-navy-600 dark:text-cyan-400'
                          : step < currentStep
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-ink-subtle'
                      }`}
                    >
                      {step === 1
                        ? 'Basic Info'
                        : step === 2
                        ? 'Tags'
                        : 'Review'}
                    </p>
                  </div>
                  {step < totalSteps && (
                    <div
                      className={`flex-1 h-0.5 mx-2 ${
                        step < currentStep
                          ? 'bg-emerald-500'
                          : 'bg-line'
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Step 1: Basic Information */}
            {currentStep === 1 && (
              <div className="space-y-6">
                <div className="rounded-xl border border-line bg-surface-muted/50 p-4">
                  <h4 className="font-display text-base font-semibold text-ink">
                    Basic Information
                  </h4>
                  <p className="text-sm text-ink-muted mt-1">
                    Title, Department, Description, and Expected Benefits are required. Intended Use (COU) is optional.
                    New use cases start in <span className="font-medium text-ink">New</span> status.
                  </p>
                </div>

                <div>
                  <label htmlFor="create-title" className="flex items-center gap-1.5 text-sm font-medium text-ink-muted mb-2">
                    Title *
                    <span title={USE_CASE_FIELD_HELP.title} className="inline-flex text-ink-subtle cursor-help">
                      <HelpCircle className="w-3.5 h-3.5" />
                    </span>
                  </label>
                  <input
                    id="create-title"
                    type="text"
                    value={formData.use_case_title}
                    onChange={(e) => {
                      setFormData({ ...formData, use_case_title: e.target.value });
                      clearFieldError('use_case_title');
                      setError('');
                    }}
                    maxLength={100}
                    placeholder="Enter a descriptive title for your use case"
                    className={`wb-input ${fieldErrors.use_case_title ? CREATE_FIELD_ERROR_CLASS : ''}`}
                    aria-invalid={Boolean(fieldErrors.use_case_title)}
                    aria-describedby={fieldErrors.use_case_title ? 'create-title-error' : undefined}
                    required
                  />
                  <p className="mt-1 text-xs text-ink-subtle tabular-nums">
                    {formData.use_case_title.length}/100 characters
                  </p>
                  {fieldErrors.use_case_title && (
                    <p id="create-title-error" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                      {fieldErrors.use_case_title}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="create-department" className="flex items-center gap-1.5 text-sm font-medium text-ink-muted mb-2">
                    Department *
                    <span title={USE_CASE_FIELD_HELP.department} className="inline-flex text-ink-subtle cursor-help">
                      <HelpCircle className="w-3.5 h-3.5" />
                    </span>
                  </label>
                  <input
                    id="create-department"
                    type="text"
                    value={formData.department}
                    onChange={(e) => {
                      setFormData({ ...formData, department: e.target.value });
                      clearFieldError('department');
                      setError('');
                    }}
                    maxLength={30}
                    placeholder="e.g., Operations, R&D, Marketing"
                    className={`wb-input ${fieldErrors.department ? CREATE_FIELD_ERROR_CLASS : ''}`}
                    aria-invalid={Boolean(fieldErrors.department)}
                    aria-describedby={fieldErrors.department ? 'create-department-error' : undefined}
                    required
                  />
                  {fieldErrors.department && (
                    <p id="create-department-error" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                      {fieldErrors.department}
                    </p>
                  )}
                </div>

                <AIFieldAssist
                  inputId="create-description"
                  label="Description *"
                  fieldLabel="Description"
                  fieldName="description"
                  value={formData.use_case_description}
                  maxLength={500}
                  canUseAI={canUseCreateAI}
                  context={{
                    title: formData.use_case_title,
                    department: formData.department,
                    domain: domain?.domain_name,
                  }}
                  onApply={(value) => {
                    setFormData({ ...formData, use_case_description: value });
                    clearFieldError('use_case_description');
                    setError('');
                  }}
                >
                  <p className="mb-2 text-xs text-slate-500 dark:text-slate-400 flex items-start gap-1">
                    <HelpCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    {USE_CASE_FIELD_HELP.description}
                  </p>
                  <textarea
                    id="create-description"
                    value={formData.use_case_description}
                    onChange={(e) => {
                      setFormData({ ...formData, use_case_description: e.target.value });
                      clearFieldError('use_case_description');
                      setError('');
                    }}
                    maxLength={500}
                    rows={4}
                    placeholder="Describe what this use case aims to achieve..."
                    className={`wb-input ${fieldErrors.use_case_description ? CREATE_FIELD_ERROR_CLASS : ''}`}
                    aria-invalid={Boolean(fieldErrors.use_case_description)}
                    aria-describedby={fieldErrors.use_case_description ? 'create-description-error' : undefined}
                    required
                  />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {formData.use_case_description.length}/500 characters
                  </p>
                  {fieldErrors.use_case_description && (
                    <p id="create-description-error" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                      {fieldErrors.use_case_description}
                    </p>
                  )}
                </AIFieldAssist>

                <AIFieldAssist
                  inputId="create-intended-use"
                  label="Intended Use (COU) — optional"
                  fieldLabel="Intended Use"
                  fieldName="intended_use"
                  value={formData.intended_use}
                  maxLength={500}
                  canUseAI={canUseCreateAI}
                  context={{
                    title: formData.use_case_title,
                    department: formData.department,
                    related_fields: { description: formData.use_case_description },
                  }}
                  onApply={(value) => setFormData({ ...formData, intended_use: value })}
                >
                  <p className="mb-2 text-xs text-slate-500 dark:text-slate-400 flex items-start gap-1">
                    <HelpCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    {USE_CASE_FIELD_HELP.intended_use}
                  </p>
                  <textarea
                    id="create-intended-use"
                    value={formData.intended_use}
                    onChange={(e) => setFormData({ ...formData, intended_use: e.target.value })}
                    maxLength={500}
                    rows={3}
                    placeholder="Describe how this use case will be used in practice..."
                    className="wb-input"
                  />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {formData.intended_use.length}/500 characters
                  </p>
                </AIFieldAssist>

                <AIFieldAssist
                  inputId="create-expected-benefits"
                  label="Expected Benefits *"
                  fieldLabel="Expected Benefits"
                  fieldName="expected_benefits"
                  value={formData.expected_benefits}
                  maxLength={300}
                  canUseAI={canUseCreateAI}
                  context={{
                    title: formData.use_case_title,
                    department: formData.department,
                    related_fields: { description: formData.use_case_description },
                  }}
                  onApply={(value) => {
                    setFormData({ ...formData, expected_benefits: value });
                    clearFieldError('expected_benefits');
                    setError('');
                  }}
                >
                  <p className="mb-2 text-xs text-slate-500 dark:text-slate-400 flex items-start gap-1">
                    <HelpCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    {USE_CASE_FIELD_HELP.expected_benefits}
                  </p>
                  <textarea
                    id="create-expected-benefits"
                    value={formData.expected_benefits}
                    onChange={(e) => {
                      setFormData({ ...formData, expected_benefits: e.target.value });
                      clearFieldError('expected_benefits');
                      setError('');
                    }}
                    maxLength={300}
                    rows={3}
                    placeholder="What benefits do you expect from this use case?"
                    className={`wb-input ${fieldErrors.expected_benefits ? CREATE_FIELD_ERROR_CLASS : ''}`}
                    aria-invalid={Boolean(fieldErrors.expected_benefits)}
                    aria-describedby={fieldErrors.expected_benefits ? 'create-expected-benefits-error' : undefined}
                    required
                  />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {formData.expected_benefits.length}/300 characters
                  </p>
                  {fieldErrors.expected_benefits && (
                    <p id="create-expected-benefits-error" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                      {fieldErrors.expected_benefits}
                    </p>
                  )}
                </AIFieldAssist>

                <div className="rounded-lg border border-slate-200 dark:border-slate-600 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">AI entry quality</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Check quality of your draft and optionally rewrite fields above.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={runDraftQualityCheck}
                      disabled={draftQualityLoading}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white"
                    >
                      {draftQualityLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      Check quality
                    </button>
                  </div>
                  {draftQuality && (
                    <div className="space-y-2">
                      <p className="text-sm text-slate-700 dark:text-slate-300">
                        Score: <span className="font-semibold">{draftQuality.overall_score}%</span>
                        {' · '}
                        <span>{draftQuality.status_label}</span>
                      </p>
                      <ul className="list-disc pl-5 text-xs text-slate-600 dark:text-slate-400 space-y-1">
                        {draftQuality.improvement_suggestions.map((tip, idx) => (
                          <li key={idx}>{tip}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 2: Tags */}
            {currentStep === 2 && (
              <div className="space-y-6">
                <div>
                  <h4 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                    Tags
                  </h4>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
                    Add tags to help categorize and find your use case. This step is optional.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Add Tags
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                      placeholder="Type a tag and press Enter"
                      className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={addTag}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                      Add
                    </button>
                  </div>
                  {formData.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4">
                      {formData.tags.map((tag, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => removeTag(tag)}
                            className="hover:text-blue-900 dark:hover:text-blue-100"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {formData.tags.length === 0 && (
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 italic">
                      No tags added yet. You can skip this step.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Step 3: Review */}
            {currentStep === 3 && (
              <div className="space-y-6">
                <div>
                  <h4 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                    Review & Confirm
                  </h4>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
                    Please review all your information before creating the use case. Click "Create Use Case" to save.
                  </p>
                </div>

                <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-6 space-y-6">
                  <div className="border-b border-slate-200 dark:border-slate-700 pb-4">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide block mb-2">
                      Title
                    </label>
                    <p className="text-base font-medium text-slate-900 dark:text-white">
                      {formData.use_case_title || <span className="text-slate-400 italic font-normal">Not provided</span>}
                    </p>
                  </div>

                  <div className="border-b border-slate-200 dark:border-slate-700 pb-4">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide block mb-2">
                      Department
                    </label>
                    <p className="text-sm text-slate-900 dark:text-white">
                      {formData.department || <span className="text-slate-400 italic">Not provided</span>}
                    </p>
                  </div>

                  <div className="border-b border-slate-200 dark:border-slate-700 pb-4">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide block mb-2">
                      Description
                    </label>
                    <p className="text-sm text-slate-900 dark:text-white whitespace-pre-wrap">
                      {formData.use_case_description || <span className="text-slate-400 italic">Not provided</span>}
                    </p>
                  </div>

                  <div className="border-b border-slate-200 dark:border-slate-700 pb-4">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide block mb-2">
                      Intended Use (COU)
                    </label>
                    <p className="text-sm text-slate-900 dark:text-white whitespace-pre-wrap">
                      {formData.intended_use || <span className="text-slate-400 italic">Not provided</span>}
                    </p>
                  </div>

                  <div className="border-b border-slate-200 dark:border-slate-700 pb-4">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide block mb-2">
                      Expected Benefits
                    </label>
                    <p className="text-sm text-slate-900 dark:text-white whitespace-pre-wrap">
                      {formData.expected_benefits || <span className="text-slate-400 italic">Not provided</span>}
                    </p>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide block mb-2">
                      Tags
                    </label>
                    {formData.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {formData.tags.map((tag, index) => (
                          <span
                            key={index}
                            className="inline-block px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400 italic">No tags added</p>
                    )}
                  </div>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <strong>Ready to create?</strong> Review the information above and click "Create Use Case" to save your use case.
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm" role="alert">
                {error}
                {Object.keys(fieldErrors).length > 0 && (
                  <ul className="mt-2 list-disc pl-5 space-y-0.5 text-xs">
                    {CREATE_REQUIRED_FIELD_ORDER.filter((field) => fieldErrors[field]).map((field) => (
                      <li key={field}>{fieldErrors[field]}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Back button (step navigation) */}
            {currentStep > 1 && (
              <div className="pt-6 border-t border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={handleBack}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Back
                </button>
              </div>
            )}
          </form>
        </div>
      )}

      {error && (
        <div className="fixed bottom-4 right-4 max-w-md p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg shadow-lg z-50">
          <div className="flex items-center justify-between">
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
            <button onClick={() => setError('')} className="ml-4 text-red-400 hover:text-red-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, useCase: null })}
        onConfirm={handleDelete}
        title="Delete Use Case"
        message={`Are you sure you want to delete "${deleteModal.useCase?.use_case_name}"? This action cannot be undone.`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
