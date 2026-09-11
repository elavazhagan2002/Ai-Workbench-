import { useState, useEffect, useRef } from 'react';
import { api, type UseCaseEnhancementContext } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { UseCase, UseCaseAssessment, UseCaseData, UseCaseRiskReview, UseCaseComment, UseCaseLink, UseCaseDocument } from '../types';
import { ArrowLeft, Save, Plus, Trash2, X, ChevronRight, ArrowRightLeft, Link as LinkIcon, Edit2, HelpCircle } from 'lucide-react';
import AIFieldAssist from '../components/AIFieldAssist';
import { DataRequirementDetails } from '../components/DataRequirementDetails';
import { DataRequirementForm } from '../components/DataRequirementForm';
import ConfirmModal from '../components/ConfirmModal';
import AnalysisAssignModal from '../components/AnalysisAssignModal';
import AnalysisPanels from '../components/AnalysisPanels';
import EstimateAssignModal from '../components/EstimateAssignModal';
import EstimatePanel from '../components/EstimatePanel';
import RoiPanel from '../components/RoiPanel';
import { AssessmentAssignModal, RoiAssignModal } from '../components/SimpleAssignModal';
import UseCaseAssessmentPanel from '../components/UseCaseAssessmentPanel';
import UseCaseAuditTrail from '../components/UseCaseAuditTrail';
import UseCaseDocumentAttachments from '../components/UseCaseDocumentAttachments';
import UseCaseStateView, { ESTIMATE_CLICK_GATE, STATUS_TO_WORKFLOW_PERMISSION, WORKFLOW_NEXT } from '../components/UseCaseStateView';
import StarRating from '../components/StarRating';
import Toast from '../components/Toast';
import SelectMenu from '../components/SelectMenu';
import { logger } from '../utils/logger';
import { domainAccessDeniedMessage, isDomainAccessDeniedMessage } from '../utils/domainAccessMessage';
import { isResourceManagementDocument } from '../utils/useCaseDocuments';
import { USE_CASE_FIELD_HELP } from '../constants/useCaseFieldHelp';
import {
  VENDOR_ASSESSMENT_QUESTIONS,
  computeEstimateInvestment,
  emptyEstimateData,
  isVendorBuild,
  normalizeEstimateData,
  type EstimateData,
} from '../constants/estimateOptions';
import {
  emptyRoiData,
  normalizeRoiData,
  type RoiData,
} from '../constants/roiOptions';
import { recommendedValidationPackages } from '../constants/validationPackageRecommendations';
import {
  AI_CATEGORY_OPTIONS,
  normalizeAiCategoryCode,
  type AiCategoryCode,
} from '../constants/aiCategories';
import {
  EMPTY_DATA_REQUIREMENT_FORM,
  dataRequirementFormToPayload,
  dataRequirementToForm,
} from '../constants/dataRequirements';
import {
  TARGET_AUDIENCE_TYPE_OPTIONS,
  normalizeTargetAudienceTypes,
  type TargetAudienceType,
} from '../constants/targetAudienceTypes';
import {
  IMPACTED_STAKEHOLDER_MAX_LENGTH,
  normalizeImpactedStakeholders,
} from '../constants/impactedStakeholders';
import {
  RISK_LEVEL_OPTIONS,
  getRiskLevelBadgeClass,
  formatRiskLevel,
  type RiskLevel,
} from '../constants/riskLevels';
import {
  INTENDED_USE_LABEL,
  RISK_DECISION_CONSEQUENCE_LABEL,
  RISK_MODEL_INFLUENCE_LABEL,
} from '../constants/useCaseFieldLabels';

interface UseCaseEditProps {
  useCaseId: string;
  onBack: () => void;
  initialSection?: string | null;
  initialAction?: string | null;
  onSectionChange?: (section: string) => void;
  onOpenView?: (tab?: string) => void;
}

type Section = 'basic' | 'references' | 'analysis' | 'tech_analysis' | 'business_analysis' | 'data' | 'risks' | 'comments' | 'estimate' | 'roi' | 'assessment' | 'audit';

const EDIT_SECTIONS: Section[] = [
  'basic',
  'references',
  'analysis',
  'tech_analysis',
  'business_analysis',
  'data',
  'risks',
  'comments',
  'estimate',
  'roi',
  'assessment',
  'audit',
];

function mapClosedEditSectionToViewTab(section?: string | null): string {
  if (section === 'tech_analysis' || section === 'analysis') return 'technical';
  if (section === 'business_analysis') return 'business';
  if (section === 'estimate') return 'estimate';
  if (section === 'roi') return 'roi';
  if (section === 'data') return 'data';
  if (section === 'risks') return 'risks';
  if (section === 'comments') return 'comments';
  if (section === 'assessment') return 'assessment';
  return 'overview';
}

function isEditSection(value: string | null | undefined): value is Section {
  return !!value && EDIT_SECTIONS.includes(value as Section);
}

const DESCRIPTION_MAX_LENGTH = 1500;
const INTENDED_USE_MAX_LENGTH = 1000;
const EXPECTED_BENEFITS_MAX_LENGTH = 1000;
const SOLUTION_DESIGN_MAX_LENGTH = 2500;
const HUMAN_IN_LOOP_STRATEGY_MAX_LENGTH = 500;
const PROTECTED_ATTRIBUTES_MAX_LENGTH = 500;
const BALANCING_STRATEGY_MAX_LENGTH = 1000;
const RISK_DESCRIPTION_MAX_LENGTH = 1500;
const MITIGATION_STRATEGY_MAX_LENGTH = 1500;

function compactString(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildAIContext(
  base: Omit<UseCaseEnhancementContext, 'related_fields'>,
  relatedFields?: Record<string, string | undefined>
): UseCaseEnhancementContext | undefined {
  const context: UseCaseEnhancementContext = {};

  if (base.use_case_name) context.use_case_name = base.use_case_name;
  if (base.title) context.title = base.title;
  if (base.department) context.department = base.department;
  if (base.domain) context.domain = base.domain;

  const filteredRelatedFields = Object.fromEntries(
    Object.entries(relatedFields ?? {}).filter(([, value]) => Boolean(value))
  );

  if (Object.keys(filteredRelatedFields).length > 0) {
    context.related_fields = filteredRelatedFields as Record<string, string>;
  }

  return Object.keys(context).length > 0 ? context : undefined;
}

/** Status is changed via status boxes only (expanded governance workflow). */

/** Must stay aligned with API TECHNICAL_ANALYSIS_FIELDS / BUSINESS_ANALYSIS_FIELDS. */
const TECHNICAL_ANALYSIS_FIELDS = [
  'ai_category',
  'feasibility',
  'tool_complexity',
  'host_system_capability',
  'data_privacy_security',
  'solution_design_overview',
  'deployment_model',
  'reference_links',
] as const;

const BUSINESS_ANALYSIS_FIELDS = [
  'use_case_title',
  'use_case_description',
  'intended_use',
  'expected_benefits',
  'intended_audience',
  'target_audience_type',
  'impacted_stakeholders',
  'human_in_loop_strategy',
  'bias_assessment_performed',
  'protected_attributes',
  'balancing_strategy',
  'frequency_of_task',
  'current_effort',
  'user_group_size',
  'efficiency_impact',
  'quality_compliance_impact',
  'user_urgency',
  'process_impact',
  'operational_compliance_risk',
  'reference_links',
] as const;

type AnalysisTrackProgress = 'unassigned' | 'pending' | 'complete' | 'rejected';

function analysisTrackProgress(ownerId?: string | null, completedDt?: string | null, rejectedDt?: string | null): AnalysisTrackProgress {
  if (completedDt) return 'complete';
  if (rejectedDt) return 'rejected';
  if (ownerId) return 'pending';
  return 'unassigned';
}

const ANALYSIS_PROGRESS_BADGE: Record<AnalysisTrackProgress, { label: string; className: string }> = {
  complete: {
    label: 'Complete',
    className: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  },
  pending: {
    label: 'Pending',
    className: 'border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300',
  },
  rejected: {
    label: 'Rejected',
    className: 'border-red-500/40 bg-red-500/15 text-red-800 dark:text-red-300',
  },
  unassigned: {
    label: 'Unassigned',
    className: 'border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300',
  },
};

function AnalysisTrackStatusCard({
  title,
  ownerLabel,
  ownerId,
  completedDt,
  rejectedDt,
  rejectionNote,
}: {
  title: string;
  ownerLabel: string;
  ownerId?: string | null;
  completedDt?: string | null;
  rejectedDt?: string | null;
  rejectionNote?: string | null;
}) {
  const status = analysisTrackProgress(ownerId, completedDt, rejectedDt);
  const badge = ANALYSIS_PROGRESS_BADGE[status];
  return (
    <div className="rounded-xl border border-line bg-surface-muted/40 px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{title}</p>
        <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge.className}`}>
          {badge.label}
        </span>
      </div>
      <p className="mt-1.5 text-sm font-medium text-ink">{ownerLabel}</p>
      {status === 'complete' && completedDt ? (
        <p className="mt-1 text-xs text-ink-muted">Completed {new Date(completedDt).toLocaleString()}</p>
      ) : null}
      {status === 'pending' ? (
        <p className="mt-1 text-xs text-ink-muted">Waiting for this owner to complete the survey.</p>
      ) : null}
      {status === 'rejected' ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
          Rejected{rejectedDt ? ` ${new Date(rejectedDt).toLocaleString()}` : ''}
          {rejectionNote ? ` · ${rejectionNote}` : ''}
        </p>
      ) : null}
    </div>
  );
}

export default function UseCaseEdit({
  useCaseId,
  onBack,
  initialSection,
  initialAction,
  onSectionChange,
  onOpenView,
}: UseCaseEditProps) {
  const { user, hasPermission } = useAuth();
  const isAdmin = user?.role?.role_name === 'portal_admin';
  const hasCaseEdit = hasPermission('case_edit');
  const canAssignOwners = isAdmin || hasPermission('case_assign');
  const canReviewRisk = hasPermission('case_review');
  const canComment = hasPermission('case_comment');
  const [loading, setLoading] = useState(true);
  const [accessDeniedMessage, setAccessDeniedMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState<Section>('basic');
  const [createdById, setCreatedById] = useState<string | null>(null);
  const userPickedSection = useRef(false);
  const didAutoLand = useRef(false);
  const lastDeepLink = useRef<string | null>(null);
  const consumedAssignAction = useRef<string | null>(null);
  const redirectedClosedRecordToView = useRef(false);

  const [formData, setFormData] = useState({
    use_case_name: '',
    use_case_title: '',
    use_case_description: '',
    intended_use: '',
    expected_benefits: '',
    department: '',
    ai_category: '' as AiCategoryCode | '',
    feasibility: 'Yes' as 'Yes' | 'No' | 'Yes (Difficult)',
    intended_audience: '',
    target_audience_type: [] as TargetAudienceType[],
    impacted_stakeholders: [] as string[],
    tags: [] as string[],
    status: 'New' as UseCase['status'],
    technical_owner: '',
    business_owner: '',
    solution_design_overview: '',
    human_in_loop_strategy: '',
    bias_assessment_performed: false,
    protected_attributes: '',
    balancing_strategy: '',
    rejection_reason: '' as string | null,
    frequency_of_task: '',
    current_effort: '',
    user_group_size: '',
    efficiency_impact: '',
    quality_compliance_impact: '',
    user_urgency: '',
    process_impact: '',
    operational_compliance_risk: '',
    tool_complexity: '',
    host_system_capability: '',
    data_privacy_security: '',
    deployment_model: '',
    reference_links: [] as { url: string; label?: string }[]
  });
  const [analysisMeta, setAnalysisMeta] = useState({
    analysis_assigned_by: '' as string | null,
    analysis_assigned_by_name: '' as string | null,
    analysis_assigned_dt: '' as string | null,
    analysis_due_date: '' as string | null,
    tech_analysis_completed_dt: '' as string | null,
    business_analysis_completed_dt: '' as string | null,
    tech_analysis_rejected_dt: '' as string | null,
    tech_analysis_rejection_note: '' as string | null,
    business_analysis_rejected_dt: '' as string | null,
    business_analysis_rejection_note: '' as string | null,
  });
  const [estimateMeta, setEstimateMeta] = useState({
    estimate_owner: '' as string | null,
    estimate_owner_name: '' as string | null,
    estimate_assigned_by: '' as string | null,
    estimate_assigned_by_name: '' as string | null,
    estimate_assigned_dt: '' as string | null,
    estimate_due_date: '' as string | null,
    estimate_completed_dt: '' as string | null,
    estimate_data: null as EstimateData | null,
  });
  const [roiMeta, setRoiMeta] = useState({
    roi_owner: '' as string | null,
    roi_owner_name: '' as string | null,
    roi_owner_email: '' as string | null,
    roi_owner_role: '' as string | null,
    roi_assigned_by: '' as string | null,
    roi_assigned_by_name: '' as string | null,
    roi_assigned_dt: '' as string | null,
    roi_due_date: '' as string | null,
    roi_completed_dt: '' as string | null,
    roi_data: null as RoiData | null,
  });
  const [assessmentMeta, setAssessmentMeta] = useState({
    assessment_owner: '' as string | null,
    assessment_owner_name: '' as string | null,
    assessment_assigned_by: '' as string | null,
    assessment_assigned_by_name: '' as string | null,
    assessment_assigned_dt: '' as string | null,
    assessment_due_date: '' as string | null,
    assessment_completed_dt: '' as string | null,
  });
  const [assessmentChecklistStatus, setAssessmentChecklistStatus] = useState<'IN_PROGRESS' | 'CLOSED' | null>(null);
  const [assessmentResult, setAssessmentResult] = useState<UseCaseAssessment | null>(null);
  const [defaultCurrency, setDefaultCurrency] = useState('USD');
  const [auditRefreshKey, setAuditRefreshKey] = useState(0);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);
  const [showEstimateAssignModal, setShowEstimateAssignModal] = useState(false);
  const [estimateAssignSaving, setEstimateAssignSaving] = useState(false);
  const [estimateSaving, setEstimateSaving] = useState(false);
  const [estimateCompleting, setEstimateCompleting] = useState(false);
  const [showRoiAssignModal, setShowRoiAssignModal] = useState(false);
  const [roiAssignSaving, setRoiAssignSaving] = useState(false);
  const [roiSaving, setRoiSaving] = useState(false);
  const [roiCompleting, setRoiCompleting] = useState(false);
  const [showAssessmentAssignModal, setShowAssessmentAssignModal] = useState(false);
  const [assessmentAssignSaving, setAssessmentAssignSaving] = useState(false);
  const [assessmentCompleting, setAssessmentCompleting] = useState(false);
  const [rejectTrack, setRejectTrack] = useState<'technical' | 'business' | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectSaving, setRejectSaving] = useState(false);
  const [sendBackTrack, setSendBackTrack] = useState<'technical' | 'business' | null>(null);
  const [sendBackNote, setSendBackNote] = useState('');
  const [sendBackSaving, setSendBackSaving] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [impactedStakeholderInput, setImpactedStakeholderInput] = useState('');
  const [documents, setDocuments] = useState<UseCaseDocument[]>([]);
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkLabel, setNewLinkLabel] = useState('');
  const [architects, setArchitects] = useState<any[]>([]);
  const [reviewers, setReviewers] = useState<any[]>([]);

  const [dataReqs, setDataReqs] = useState<UseCaseData[]>([]);
  const [dataReqForm, setDataReqForm] = useState({ ...EMPTY_DATA_REQUIREMENT_FORM });
  const [editingDataReqId, setEditingDataReqId] = useState<number | null>(null);
  const [showDataForm, setShowDataForm] = useState(false);

  const [riskReviews, setRiskReviews] = useState<UseCaseRiskReview[]>([]);
  const [relatedLoaded, setRelatedLoaded] = useState(false);
  const [newRiskReview, setNewRiskReview] = useState({
    risk_title: '',
    risk_description: '',
    risk_category: '' as 'Operational' | 'Business' | 'Technical' | '',
    risk_likelihood: 'low' as RiskLevel,
    risk_impact: 'low' as RiskLevel,
    assigned_to: '',
    mitigation_strategy: '',
    closure_comment: '',
    status: 'open' as 'open' | 'closed'
  });
  const [showRiskForm, setShowRiskForm] = useState(false);

  const [comments, setComments] = useState<UseCaseComment[]>([]);
  const [newComment, setNewComment] = useState({ comment: '', rating: null as number | null });
  const [editingCommentRating, setEditingCommentRating] = useState<number | null>(null);

  const [domainName, setDomainName] = useState('');
  const [currentDomainId, setCurrentDomainId] = useState<string>('');
  const [domainOwnerId, setDomainOwnerId] = useState<string | null>(null);
  const [documentationQualitySummary, setDocumentationQualitySummary] = useState<any>(null);
  const [createdByName, setCreatedByName] = useState<string | null>(null);
  const [technicalOwnerLabel, setTechnicalOwnerLabel] = useState('');
  const [businessOwnerLabel, setBusinessOwnerLabel] = useState('');
  const [moveModal, setMoveModal] = useState(false);
  const [moveTargetDomainId, setMoveTargetDomainId] = useState('');
  const [moveDomains, setMoveDomains] = useState<any[]>([]);
  const [moveSaving, setMoveSaving] = useState(false);

  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    type: 'data' | 'risk' | 'comment';
    id: string;
  }>({ isOpen: false, type: 'data', id: '' });

  const [showRejectionModal, setShowRejectionModal] = useState(false);
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');
  const [statusChangeSaving, setStatusChangeSaving] = useState(false);

  const [editingRiskReviewId, setEditingRiskReviewId] = useState<number | null>(null);
  const [riskReviewUpdateForm, setRiskReviewUpdateForm] = useState({ mitigation_strategy: '', closure_comment: '', status: 'open' as 'open' | 'closed' });

  useEffect(() => {
    setRelatedLoaded(false);
    setAssessmentChecklistStatus(null);
    setAssessmentResult(null);
    loadUseCase();
    loadRelatedData();
  }, [useCaseId]);

  useEffect(() => {
    if (!currentDomainId) return;
    loadUsersByRole(currentDomainId);
  }, [currentDomainId]);

  useEffect(() => {
    if (moveModal && moveDomains.length === 0) {
      api.getDomains().then((list) => setMoveDomains(list || [])).catch(() => setMoveDomains([]));
    }
  }, [moveModal]);

  async function handleMoveToDomain(e: React.FormEvent) {
    e.preventDefault();
    if (!moveTargetDomainId) return;
    setMoveSaving(true);
    try {
      await api.moveUseCase(useCaseId, moveTargetDomainId);
      setMoveModal(false);
      setMoveTargetDomainId('');
      setCurrentDomainId(moveTargetDomainId);
      const domainData = await api.getDomain(moveTargetDomainId);
      setDomainName(domainData?.domain_name || '');
      setDomainOwnerId((domainData as any)?.owner_id || null);
    } catch (err: any) {
      setError(err?.message || 'Failed to move use case.');
    } finally {
      setMoveSaving(false);
    }
  }

  useEffect(() => {
    userPickedSection.current = false;
    didAutoLand.current = false;
    lastDeepLink.current = null;
    consumedAssignAction.current = null;
  }, [useCaseId]);

  // Apply notification / URL deep-link once per section+action.
  useEffect(() => {
    if (!isEditSection(initialSection)) return;
    const key = `${initialSection}:${initialAction || ''}`;
    if (lastDeepLink.current === key) return;
    lastDeepLink.current = key;
    userPickedSection.current = false;
    setActiveSection(initialSection);
  }, [initialAction, initialSection]);

  // Land on this user's pending work tab when opening without a section.
  useEffect(() => {
    if (isEditSection(initialSection)) return;
    if (loading) return;
    if (userPickedSection.current || didAutoLand.current) return;

    const uid = user?.user_id;
    const status = formData.status;
    let next: Section = 'basic';

    if (status === 'New') {
      next = 'basic';
    } else if (status === 'Analysis') {
      const techPending = !!uid && formData.technical_owner === uid && !analysisMeta.tech_analysis_completed_dt;
      const bizPending = !!uid && formData.business_owner === uid && !analysisMeta.business_analysis_completed_dt;
      if (bizPending && !techPending) next = 'business_analysis';
      else if (techPending) next = 'tech_analysis';
      else if (uid && formData.business_owner === uid) next = 'business_analysis';
      else if (uid && formData.technical_owner === uid) next = 'tech_analysis';
      else next = 'tech_analysis';
    } else if (status === 'Review') {
      const myOpenRisk = !!uid && riskReviews.some((r) => r.assigned_to === uid && r.status !== 'closed');
      if (myOpenRisk) next = 'risks';
      else if (uid && formData.business_owner === uid) next = 'business_analysis';
      else if (uid && formData.technical_owner === uid) next = 'tech_analysis';
      else next = 'basic';
    } else if (status === 'Estimate') {
      next = 'estimate';
    } else if (status === 'ROI') {
      next = 'roi';
    } else if (status === 'AI Assessment') {
      next = 'assessment';
    } else if (status === 'Approved' || status === 'Rejected') {
      next = 'basic';
    }

    setActiveSection(next);
    didAutoLand.current = true;
  }, [
    analysisMeta.business_analysis_completed_dt,
    analysisMeta.tech_analysis_completed_dt,
    formData.business_owner,
    formData.status,
    formData.technical_owner,
    initialSection,
    loading,
    riskReviews,
    user?.user_id,
  ]);

  // Deep-link actions from notifications (reassign / open assign modals)
  useEffect(() => {
    if (!initialAction || loading || !relatedLoaded) return;
    const key = `${useCaseId}:${initialAction}`;
    if (consumedAssignAction.current === key) return;
    consumedAssignAction.current = key;
    if (initialAction === 'assign-analysis') setShowAssignModal(true);
    else if (initialAction === 'assign-estimate') {
      if (formData.status === 'Review' && riskReviews.length === 0) {
        userPickedSection.current = true;
        setActiveSection('risks');
        onSectionChange?.('risks');
        setError(ESTIMATE_CLICK_GATE);
      } else {
        setShowEstimateAssignModal(true);
      }
    } else if (initialAction === 'assign-roi') setShowRoiAssignModal(true);
    else if (initialAction === 'assign-assessment') setShowAssessmentAssignModal(true);
  }, [initialAction, useCaseId, loading, relatedLoaded, formData.status, riskReviews.length, onSectionChange]);

  useEffect(() => {
    redirectedClosedRecordToView.current = false;
  }, [useCaseId]);

  useEffect(() => {
    if (loading || !onOpenView || redirectedClosedRecordToView.current) return;
    if (formData.status !== 'Approved' && formData.status !== 'Rejected') return;
    redirectedClosedRecordToView.current = true;
    onOpenView(mapClosedEditSectionToViewTab(initialSection));
  }, [loading, formData.status, onOpenView, initialSection, useCaseId]);

  async function loadUsersByRole(domainId: string) {
    try {
      const [architectsData, reviewersData, estimateOpts] = await Promise.all([
        api.getEligibleTechnicalOwners(domainId),
        api.getEligibleBusinessOwners(domainId),
        api.getEstimateFieldOptions().catch(() => null),
      ]);
      setArchitects(architectsData || []);
      setReviewers(reviewersData || []);
      if (estimateOpts?.default_currency) setDefaultCurrency(estimateOpts.default_currency);
    } catch (err) {
      logger.error('Error loading users by role', err);
    }
  }

  async function loadUseCase() {
    try {
      const data = await api.getUseCase(useCaseId);
      if (!data) throw new Error('Use case not found');

      setFormData({
        use_case_name: data.use_case_name,
        use_case_title: data.use_case_title || '',
        use_case_description: data.use_case_description || '',
        intended_use: data.intended_use || '',
        expected_benefits: data.expected_benefits || '',
        department: data.department || '',
        ai_category: normalizeAiCategoryCode(data.ai_category),
        feasibility: (data.feasibility as 'Yes' | 'No' | 'Yes (Difficult)') || 'Yes',
        intended_audience: data.intended_audience || '',
        target_audience_type: normalizeTargetAudienceTypes(data.target_audience_type),
        impacted_stakeholders: normalizeImpactedStakeholders(data.impacted_stakeholders),
        tags: data.tags || [],
        status: data.status as UseCase['status'],
        technical_owner: data.technical_owner || '',
        business_owner: data.business_owner || '',
        solution_design_overview: data.solution_design_overview || '',
        human_in_loop_strategy: data.human_in_loop_strategy || '',
        bias_assessment_performed: Boolean(data.bias_assessment_performed),
        protected_attributes: data.protected_attributes || '',
        balancing_strategy: data.balancing_strategy || '',
        rejection_reason: (data as any).rejection_reason ?? null,
        frequency_of_task: (data as any).frequency_of_task || '',
        current_effort: (data as any).current_effort || '',
        user_group_size: (data as any).user_group_size || '',
        efficiency_impact: (data as any).efficiency_impact || '',
        quality_compliance_impact: (data as any).quality_compliance_impact || '',
        user_urgency: (data as any).user_urgency || '',
        process_impact: (data as any).process_impact || '',
        operational_compliance_risk: (data as any).operational_compliance_risk || '',
        tool_complexity: (data as any).tool_complexity || '',
        host_system_capability: (data as any).host_system_capability || '',
        data_privacy_security: (data as any).data_privacy_security || '',
        deployment_model: (data as any).deployment_model || '',
        reference_links: (data.reference_links || []).map((l: UseCaseLink) => ({ url: l.url, label: l.label ?? '' }))
      });
      setAnalysisMeta({
        analysis_assigned_by: (data as any).analysis_assigned_by ?? null,
        analysis_assigned_by_name: (data as any).analysis_assigned_by_name ?? null,
        analysis_assigned_dt: (data as any).analysis_assigned_dt ?? null,
        analysis_due_date: (data as any).analysis_due_date ?? null,
        tech_analysis_completed_dt: (data as any).tech_analysis_completed_dt ?? null,
        business_analysis_completed_dt: (data as any).business_analysis_completed_dt ?? null,
        tech_analysis_rejected_dt: (data as any).tech_analysis_rejected_dt ?? null,
        tech_analysis_rejection_note: (data as any).tech_analysis_rejection_note ?? null,
        business_analysis_rejected_dt: (data as any).business_analysis_rejected_dt ?? null,
        business_analysis_rejection_note: (data as any).business_analysis_rejection_note ?? null,
      });
      const normalizedEstimate = (data as any).estimate_data
        ? normalizeEstimateData((data as any).estimate_data)
        : null;
      setEstimateMeta({
        estimate_owner: (data as any).estimate_owner ?? null,
        estimate_owner_name: (data as any).estimate_owner_name ?? null,
        estimate_assigned_by: (data as any).estimate_assigned_by ?? null,
        estimate_assigned_by_name: (data as any).estimate_assigned_by_name ?? null,
        estimate_assigned_dt: (data as any).estimate_assigned_dt ?? null,
        estimate_due_date: (data as any).estimate_due_date ?? null,
        estimate_completed_dt: (data as any).estimate_completed_dt ?? null,
        estimate_data: normalizedEstimate,
      });
      const inv = computeEstimateInvestment(normalizedEstimate);
      setRoiMeta({
        roi_owner: (data as any).roi_owner ?? null,
        roi_owner_name: (data as any).roi_owner_name ?? null,
        roi_owner_email: (data as any).roi_owner_email ?? null,
        roi_owner_role: (data as any).roi_owner_role ?? null,
        roi_assigned_by: (data as any).roi_assigned_by ?? null,
        roi_assigned_by_name: (data as any).roi_assigned_by_name ?? null,
        roi_assigned_dt: (data as any).roi_assigned_dt ?? null,
        roi_due_date: (data as any).roi_due_date ?? null,
        roi_completed_dt: (data as any).roi_completed_dt ?? null,
        roi_data: (data as any).roi_data
          ? normalizeRoiData(
              (data as any).roi_data,
              normalizedEstimate?.currency || defaultCurrency,
              inv
            )
          : null,
      });
      setAssessmentMeta({
        assessment_owner: (data as any).assessment_owner ?? null,
        assessment_owner_name: (data as any).assessment_owner_name ?? null,
        assessment_assigned_by: (data as any).assessment_assigned_by ?? null,
        assessment_assigned_by_name: (data as any).assessment_assigned_by_name ?? null,
        assessment_assigned_dt: (data as any).assessment_assigned_dt ?? null,
        assessment_due_date: (data as any).assessment_due_date ?? null,
        assessment_completed_dt: (data as any).assessment_completed_dt ?? null,
      });
      setAuditRefreshKey((k) => k + 1);
      setDocuments((data as any).documents || []);

      setCreatedByName((data as any).created_by_name ?? null);
      setCreatedById((data as any).created_by ?? null);
      setTechnicalOwnerLabel(
        data.technical_owner_name
          ? `${data.technical_owner_name}${data.technical_owner_role_name ? ` (${data.technical_owner_role_name})` : ''}`
          : ''
      );
      setBusinessOwnerLabel(
        data.business_owner_name
          ? `${data.business_owner_name}${data.business_owner_email ? ` (${data.business_owner_email})` : ''}`
          : ''
      );
      setCurrentDomainId(data.domain_id || '');
      setDocumentationQualitySummary((data as any).documentation_quality_summary ?? null);
      if (data.domain_id) {
        try {
          const domainData = await api.getDomain(data.domain_id);
          if (domainData?.domain_name) setDomainName(domainData.domain_name);
          setDomainOwnerId((domainData as any)?.owner_id || null);
        } catch {
          setDomainName('');
          setDomainOwnerId(null);
        }
      } else {
        setDomainOwnerId(null);
      }
    } catch (err: any) {
      const message = err?.message || 'Failed to load use case';
      if (isDomainAccessDeniedMessage(message)) {
        setAccessDeniedMessage(domainAccessDeniedMessage(message));
        setError('');
      } else {
        setAccessDeniedMessage('');
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadRelatedData() {
    try {
      const [dataReqsData, riskReviewsData, commentsData] = await Promise.all([
        api.getUseCaseData(useCaseId),
        api.getUseCaseRiskReviews(useCaseId),
        api.getUseCaseComments(useCaseId)
      ]);

      setDataReqs(dataReqsData || []);
      setRiskReviews(riskReviewsData || []);
      setComments(commentsData || []);
    } catch (err) {
      // Error loading related data is not critical
    } finally {
      setRelatedLoaded(true);
    }
  }

  function addReferenceLink() {
    const url = newLinkUrl.trim();
    if (!url) return;
    setFormData((prev) => ({
      ...prev,
      reference_links: [...(prev.reference_links || []), { url, label: newLinkLabel.trim() || undefined }]
    }));
    setNewLinkUrl('');
    setNewLinkLabel('');
  }

  function removeReferenceLink(index: number) {
    setFormData((prev) => ({
      ...prev,
      reference_links: (prev.reference_links || []).filter((_, i) => i !== index)
    }));
  }

  async function saveUseCaseChanges(options: {
    leaveAfterSave?: boolean;
    scrollToAnalysisComplete?: boolean;
  } = {}) {
    const { leaveAfterSave = false, scrollToAnalysisComplete = false } = options;
    setError('');

    if (!user) return false;

    setSaving(true);
    try {
      const techCompleted = !!analysisMeta.tech_analysis_completed_dt;
      const bizCompleted = !!analysisMeta.business_analysis_completed_dt;
      const isTech = formData.technical_owner === user.user_id;
      const isBiz = formData.business_owner === user.user_id;
      const canAssignAnalysisLocal =
        isAdmin ||
        user?.role?.role_name === 'ai_leader' ||
        (!!user?.user_id && domainOwnerId === user.user_id);
      const isAssignerEditor = isAdmin || (hasCaseEdit && canAssignAnalysisLocal);

      // Completed tracks are read-only for assignees — never re-send those fields.
      if (!isAssignerEditor && isTech && techCompleted && !isBiz) {
        if (leaveAfterSave) onBack();
        else if (scrollToAnalysisComplete) scrollToAnalysisCompleteSection();
        return true;
      }
      if (!isAssignerEditor && isBiz && bizCompleted && !isTech) {
        if (leaveAfterSave) onBack();
        else if (scrollToAnalysisComplete) scrollToAnalysisCompleteSection();
        return true;
      }
      if (!isAssignerEditor && isTech && isBiz && techCompleted && bizCompleted) {
        if (leaveAfterSave) onBack();
        else if (scrollToAnalysisComplete) scrollToAnalysisCompleteSection();
        return true;
      }

      const {
        technical_owner: _technicalOwner,
        business_owner: _businessOwner,
        ...editableFormData
      } = formData;

      const payload: Record<string, unknown> = {
        ...editableFormData,
        ai_category: formData.ai_category || null,
        tags: formData.tags,
        reference_links: formData.reference_links?.length
          ? formData.reference_links
              .filter((l) => l.url.trim())
              .map((l) => ({ url: l.url.trim(), label: l.label?.trim() || undefined }))
          : [],
        rejection_reason: formData.rejection_reason || undefined,
        human_in_loop_strategy: formData.human_in_loop_strategy.trim() || undefined,
        protected_attributes: formData.protected_attributes.trim() || undefined,
        balancing_strategy: formData.balancing_strategy.trim() || undefined,
        bias_assessment_performed: formData.bias_assessment_performed,
      };

      // Owner assignment requires case_assign — never send these fields without it.
      if (canAssignOwners) {
        payload.technical_owner = formData.technical_owner || null;
        payload.business_owner = formData.business_owner || null;
      }

      if (techCompleted) {
        for (const key of TECHNICAL_ANALYSIS_FIELDS) {
          delete payload[key];
        }
      }
      if (bizCompleted) {
        for (const key of BUSINESS_ANALYSIS_FIELDS) {
          delete payload[key];
        }
      }

      // Track assignees may only send fields for tracks they still own and can edit.
      if (!isAssignerEditor && (isTech || isBiz)) {
        const allowed = new Set<string>();
        if (isTech && !techCompleted) {
          TECHNICAL_ANALYSIS_FIELDS.forEach((k) => allowed.add(k));
        }
        if (isBiz && !bizCompleted) {
          BUSINESS_ANALYSIS_FIELDS.forEach((k) => allowed.add(k));
        }
        allowed.add('tags');
        for (const key of Object.keys(payload)) {
          if (!allowed.has(key)) delete payload[key];
        }
      }

      if (Object.keys(payload).length === 0) {
        if (leaveAfterSave) onBack();
        else if (scrollToAnalysisComplete) scrollToAnalysisCompleteSection();
        return true;
      }

      await api.updateUseCase(useCaseId, payload);
      await loadUseCase();
      if (leaveAfterSave) {
        onBack();
        return true;
      }
      if (scrollToAnalysisComplete) {
        // Allow React to re-render the analysis header before scrolling.
        window.setTimeout(() => scrollToAnalysisCompleteSection(), 80);
      }
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  function scrollToAnalysisCompleteSection() {
    const el = document.getElementById('analysis-complete-section');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('ring-2', 'ring-emerald-400/70');
    window.setTimeout(() => {
      el.classList.remove('ring-2', 'ring-emerald-400/70');
    }, 1200);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await saveUseCaseChanges({ leaveAfterSave: true });
  }

  async function handleAnalysisTrackSave(e: React.FormEvent) {
    e.preventDefault();
    return saveUseCaseChanges({ leaveAfterSave: false, scrollToAnalysisComplete: true });
  }

  const isInitiatorInNew =
    !!user?.user_id && createdById === user.user_id && formData.status === 'New';
  const isTechOwner = !!user?.user_id && formData.technical_owner === user.user_id;
  const isBizOwner = !!user?.user_id && formData.business_owner === user.user_id;
  const isEstimateOwner = !!user?.user_id && estimateMeta.estimate_owner === user.user_id;
  const isRoiOwner = !!user?.user_id && roiMeta.roi_owner === user.user_id;
  const isAssessmentOwner = !!user?.user_id && assessmentMeta.assessment_owner === user.user_id;
  const contentLocked = ['Review', 'Estimate', 'ROI', 'AI Assessment', 'Approved', 'Rejected'].includes(
    formData.status
  );
  const canAssignAnalysis =
    isAdmin ||
    user?.role?.role_name === 'ai_leader' ||
    (!!user?.user_id && domainOwnerId === user.user_id);
  // Governance roles only — not Analysis track assignees (architect / business reviewer).
  const canGovernWorkflow = canAssignAnalysis;
  const canAssignEstimate = canGovernWorkflow;
  const canAssignRoi = canGovernWorkflow;
  const canAssignAiAssessment = canGovernWorkflow;
  const canSendBackFromReview = formData.status === 'Review' && canGovernWorkflow;
  const canInitiateAssessment = isAdmin || hasPermission('initiate_assessment') || hasPermission('case_assess');
  const canContributeAssessment = isAdmin || hasPermission('contribute_assessment') || canInitiateAssessment;
  const canEditCase =
    isAdmin ||
    (
      !contentLocked &&
      (hasCaseEdit ||
        isInitiatorInNew ||
        (formData.status === 'Analysis' && (isTechOwner || isBizOwner)))
    );
  const canChangeStatus =
    formData.status !== 'Approved' &&
    formData.status !== 'Rejected' &&
    (isAdmin ||
      canGovernWorkflow ||
      hasPermission('case_approve') ||
      hasPermission('case_reject') ||
      // Assignees may still reject with permission, but not drive Review→Estimate.
      (formData.status === 'AI Assessment' && (hasPermission('workflow_approved') || hasPermission('case_approve'))));
  const allowedNextStatuses = ((WORKFLOW_NEXT[formData.status] || []) as string[]).filter((next) => {
    // Auto transitions — not clickable in the stepper
    if (formData.status === 'Analysis' && next === 'Review') return false;
    if (formData.status === 'Estimate' && next === 'ROI') return false;
    if (formData.status === 'ROI' && next === 'AI Assessment') return false;
    if (next === 'Approved' && !assessmentMeta.assessment_completed_dt) return false;
    if (isAdmin) return true;
    // Governance stage transitions — domain owner / ai_leader / admin only
    if (next === 'Analysis' && !canAssignAnalysis) return false;
    if (next === 'Estimate' && !canAssignEstimate) return false;
    if (next === 'ROI' && !canAssignRoi) return false;
    if (next === 'AI Assessment' && !canAssignAiAssessment) return false;
    if (next === 'Review') return false; // auto from Analysis only
    const workflowPerm = STATUS_TO_WORKFLOW_PERMISSION[next];
    if (workflowPerm && !hasPermission(workflowPerm)) return false;
    if (next === 'Approved' && !hasPermission('case_approve')) return false;
    if (next === 'Rejected' && !hasPermission('case_reject')) return false;
    return true;
  });
  const allRisksClosed = riskReviews.length > 0 && riskReviews.every((r) => r.status === 'closed');
  const riskStageEditable = ['Analysis', 'Review', 'Estimate', 'ROI', 'AI Assessment'].includes(
    formData.status
  );
  const missingRequiredRisk =
    (formData.status === 'Analysis' || formData.status === 'Review') && riskReviews.length === 0;
  const lastTechWouldAdvance = !!analysisMeta.business_analysis_completed_dt;
  const lastBizWouldAdvance = !!analysisMeta.tech_analysis_completed_dt;
  const riskGateMessage =
    'Add at least one risk on the Risks tab before completing Analysis. The assigned technical or business owner can add it (domain owner or portal admin can add it as backup). The risk may remain open until Approve.';

  function goToRisksTab(message?: string) {
    userPickedSection.current = true;
    setActiveSection('risks');
    onSectionChange?.('risks');
    if (message) setError(message);
  }

  function tryOpenEstimateAssign() {
    if (formData.status === 'Review' && riskReviews.length === 0) {
      goToRisksTab(ESTIMATE_CLICK_GATE);
      return;
    }
    setShowEstimateAssignModal(true);
  }
  const estimateInvestmentTotal = computeEstimateInvestment(estimateMeta.estimate_data);

  async function handleStatusChange(newStatus: UseCase['status']) {
    if (newStatus === formData.status) return;
    setError('');
    if (newStatus === 'Analysis' && (formData.status === 'New' || formData.status === 'Analysis')) {
      setShowAssignModal(true);
      return;
    }
    if (newStatus === 'Estimate' && (formData.status === 'Review' || formData.status === 'Estimate')) {
      tryOpenEstimateAssign();
      return;
    }
    if (newStatus === 'Rejected') {
      setRejectionReasonInput(formData.rejection_reason || '');
      setShowRejectionModal(true);
      return;
    }
    setStatusChangeSaving(true);
    try {
      await api.updateUseCase(useCaseId, { status: newStatus });
      await loadUseCase();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setStatusChangeSaving(false);
    }
  }

  async function handleAnalysisAssign(payload: {
    technical_owner: string;
    business_owner: string;
    due_date: string;
  }) {
    setAssignSaving(true);
    setError('');
    try {
      await api.assignAnalysis(useCaseId, payload);
      setShowAssignModal(false);
      await loadUseCase();
      await loadRelatedData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAssignSaving(false);
    }
  }

  async function handleEstimateAssign(payload: { estimate_owner: string; due_date: string }) {
    if (formData.status === 'Review' && riskReviews.length === 0) {
      setShowEstimateAssignModal(false);
      goToRisksTab(ESTIMATE_CLICK_GATE);
      return;
    }
    setEstimateAssignSaving(true);
    setError('');
    try {
      await api.assignEstimate(useCaseId, payload);
      setShowEstimateAssignModal(false);
      await loadUseCase();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setEstimateAssignSaving(false);
    }
  }

  async function handleSaveEstimate(data: EstimateData) {
    setEstimateSaving(true);
    setError('');
    try {
      await api.saveEstimate(useCaseId, data as unknown as Record<string, unknown>);
      await loadUseCase();
      setAuditRefreshKey((k) => k + 1);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setEstimateSaving(false);
    }
  }

  async function handleCompleteEstimate() {
    setEstimateCompleting(true);
    setError('');
    try {
      await api.completeEstimate(useCaseId);
      await loadUseCase();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setEstimateCompleting(false);
    }
  }

  async function handleRoiAssign(payload: { roi_owner: string; due_date: string }) {
    if (!canAssignRoi) {
      setError('Only portal_admin, domain owner, or ai_leader can assign ROI.');
      setShowRoiAssignModal(false);
      return;
    }
    setRoiAssignSaving(true);
    setError('');
    try {
      await api.assignRoi(useCaseId, payload);
      setShowRoiAssignModal(false);
      await loadUseCase();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRoiAssignSaving(false);
    }
  }

  async function handleSaveRoi(data: RoiData) {
    setRoiSaving(true);
    setError('');
    try {
      await api.saveRoi(useCaseId, data as unknown as Record<string, unknown>);
      await loadUseCase();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRoiSaving(false);
    }
  }

  async function handleCompleteRoi() {
    setRoiCompleting(true);
    setError('');
    try {
      await api.completeRoi(useCaseId);
      await loadUseCase();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRoiCompleting(false);
    }
  }

  async function handleAssessmentAssign(payload: { assessment_owner: string; due_date: string }) {
    setAssessmentAssignSaving(true);
    setError('');
    try {
      await api.assignAiAssessment(useCaseId, payload);
      setShowAssessmentAssignModal(false);
      await loadUseCase();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAssessmentAssignSaving(false);
    }
  }

  async function handleCompleteAiAssessment() {
    setAssessmentCompleting(true);
    setError('');
    try {
      await api.completeAiAssessment(useCaseId);
      await loadUseCase();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAssessmentCompleting(false);
    }
  }

  async function handleCompleteAnalysis(track: 'technical' | 'business') {
    setError('');
    const wouldAdvance =
      track === 'technical' ? lastTechWouldAdvance : lastBizWouldAdvance;
    if (wouldAdvance && riskReviews.length === 0) {
      goToRisksTab(riskGateMessage);
      return;
    }
    try {
      // Persist survey answers first so API required-field checks see the latest values.
      await saveUseCaseChanges({ leaveAfterSave: false, scrollToAnalysisComplete: false });
      await api.completeAnalysisTrack(useCaseId, track);
      await loadUseCase();
      window.setTimeout(() => {
        const el = document.getElementById('analysis-complete-section');
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleRejectAnalysis() {
    if (!rejectTrack || !rejectNote.trim()) {
      setError('Rejection note is required.');
      return;
    }
    setRejectSaving(true);
    setError('');
    try {
      await api.rejectAnalysisAssignment(useCaseId, rejectTrack, rejectNote.trim());
      setRejectTrack(null);
      setRejectNote('');
      await loadUseCase();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRejectSaving(false);
    }
  }

  async function handleSendBackAnalysis() {
    if (!sendBackTrack || !sendBackNote.trim()) {
      setError('Send-back note is required.');
      return;
    }
    setSendBackSaving(true);
    setError('');
    try {
      await api.sendBackAnalysisTrack(useCaseId, sendBackTrack, sendBackNote.trim());
      setSendBackTrack(null);
      setSendBackNote('');
      await loadUseCase();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSendBackSaving(false);
    }
  }
  async function confirmRejectionReason() {
    const reason = rejectionReasonInput.trim();
    if (!reason) {
      setError('Rejection reason is required');
      return;
    }
    setError('');
    setStatusChangeSaving(true);
    try {
      await api.updateUseCase(useCaseId, { status: 'Rejected', rejection_reason: reason });
      setShowRejectionModal(false);
      setRejectionReasonInput('');
      await loadUseCase();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setStatusChangeSaving(false);
    }
  }

  function addImpactedStakeholder(value?: string) {
    const stakeholder = (value ?? impactedStakeholderInput).trim().slice(0, IMPACTED_STAKEHOLDER_MAX_LENGTH);
    if (!stakeholder || formData.impacted_stakeholders.includes(stakeholder)) {
      return;
    }
    setFormData((prev) => ({
      ...prev,
      impacted_stakeholders: [...prev.impacted_stakeholders, stakeholder],
    }));
    setImpactedStakeholderInput('');
  }

  function closeDataForm() {
    setShowDataForm(false);
    setEditingDataReqId(null);
    setDataReqForm({ ...EMPTY_DATA_REQUIREMENT_FORM });
  }

  function openAddDataForm() {
    setEditingDataReqId(null);
    setDataReqForm({ ...EMPTY_DATA_REQUIREMENT_FORM });
    setShowDataForm(true);
  }

  function openEditDataForm(data: UseCaseData) {
    setEditingDataReqId(data.data_req_id);
    setDataReqForm(dataRequirementToForm(data));
    setShowDataForm(true);
  }

  async function handleSaveDataReq() {
    if (!user || !dataReqForm.data_req.trim()) {
      setError('Data requirement name is required');
      return;
    }

    const payload = dataRequirementFormToPayload(dataReqForm);

    try {
      if (editingDataReqId != null) {
        await api.updateUseCaseData(useCaseId, editingDataReqId, payload);
      } else {
        await api.createUseCaseData(useCaseId, payload);
      }
      closeDataForm();
      loadRelatedData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDeleteDataReq(dataReqId: string) {
    if (!user) return;

    try {
      await api.deleteUseCaseData(useCaseId, parseInt(dataReqId));
      if (editingDataReqId === parseInt(dataReqId, 10)) {
        closeDataForm();
      }
      loadRelatedData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleAddRiskReview() {
    if (!user || !newRiskReview.risk_title.trim()) {
      setError('Risk title is required');
      return;
    }
    if (!newRiskReview.risk_category) {
      setError('Risk category is required');
      return;
    }
    if (!newRiskReview.risk_description?.trim()) {
      setError('Risk description is required');
      return;
    }
    // Mitigation strategy is filled by the assigned reviewer later; optional on create.

    try {
      await api.createUseCaseRiskReview(useCaseId, {
        ...newRiskReview,
        assigned_to: newRiskReview.assigned_to || undefined,
      });
      setNewRiskReview({
        risk_title: '',
        risk_description: '',
        risk_category: '' as 'Operational' | 'Business' | 'Technical' | '',
        risk_likelihood: 'low',
        risk_impact: 'low',
        assigned_to: '',
        mitigation_strategy: '',
        closure_comment: '',
        status: 'open'
      });
      setShowRiskForm(false);
      loadRelatedData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDeleteRiskReview(riskReviewId: string) {
    if (!user) return;

    try {
      await api.deleteUseCaseRiskReview(useCaseId, parseInt(riskReviewId));
      loadRelatedData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function startUpdatingRiskReview(risk: UseCaseRiskReview) {
    setEditingRiskReviewId(risk.risk_review_id);
    setRiskReviewUpdateForm({
      mitigation_strategy: risk.mitigation_strategy || '',
      closure_comment: risk.closure_comment || '',
      status: risk.status || 'open'
    });
  }

  async function handleUpdateRiskReview(riskReviewId: number) {
    if (!user) return;
    try {
      await api.updateUseCaseRiskReview(useCaseId, riskReviewId, {
        mitigation_strategy: riskReviewUpdateForm.mitigation_strategy.trim() || undefined,
        closure_comment: riskReviewUpdateForm.closure_comment.trim() || undefined,
        status: riskReviewUpdateForm.status
      });
      setEditingRiskReviewId(null);
      loadRelatedData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleAddComment(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!user) return;
    if (!newComment.comment.trim() && (newComment.rating == null || newComment.rating < 1)) {
      setError('Add a comment and/or a rating (1–5 stars)');
      return;
    }

    try {
      await api.createUseCaseComment(useCaseId, {
        comment: newComment.comment.trim() || undefined,
        rating: newComment.rating != null && newComment.rating >= 1 && newComment.rating <= 5 ? newComment.rating : undefined,
      });
      setNewComment({ comment: '', rating: null });
      loadRelatedData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleUpdateCommentRating(commentId: number, rating: number) {
    if (!user) return;
    try {
      await api.updateUseCaseComment(useCaseId, commentId, { rating });
      setEditingCommentRating(null);
      loadRelatedData();
    } catch (err: any) {
      setError(err.message);
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
      <div className="wb-page flex items-center justify-center min-h-[50vh]">
        <div className="wb-card-pad max-w-md text-center">
          <h2 className="font-display text-lg font-semibold text-ink">Domain not assigned</h2>
          <p className="mt-2 text-sm text-ink-muted leading-relaxed">{accessDeniedMessage}</p>
          <button type="button" onClick={onBack} className="wb-btn-primary mt-6">
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        </div>
      </div>
    );
  }

  const isTerminalStatus = formData.status === 'Approved' || formData.status === 'Rejected';
  const isReadOnly = isTerminalStatus || !canEditCase;

  const useCaseDisplayName = formData.use_case_title?.trim() || formData.use_case_name || 'Use case';
  const canUseAIFieldAssist = canEditCase && !isReadOnly;

  const sharedAIContextBase = {
    use_case_name: compactString(formData.use_case_name),
    title: compactString(formData.use_case_title),
    department: compactString(formData.department),
    domain: compactString(domainName),
  };

  const descriptionAIContext = buildAIContext(sharedAIContextBase);
  const intendedUseAIContext = buildAIContext(sharedAIContextBase, {
    description: compactString(formData.use_case_description),
  });
  const expectedBenefitsAIContext = buildAIContext(sharedAIContextBase, {
    description: compactString(formData.use_case_description),
    intended_use: compactString(formData.intended_use),
  });
  const solutionDesignAIContext = buildAIContext(sharedAIContextBase, {
    description: compactString(formData.use_case_description),
    intended_use: compactString(formData.intended_use),
    expected_benefits: compactString(formData.expected_benefits),
  });
  const riskDescriptionAIContext = buildAIContext(sharedAIContextBase, {
    risk_title: compactString(newRiskReview.risk_title),
  });
  const mitigationStrategyAIContext = buildAIContext(sharedAIContextBase, {
    risk_title: compactString(newRiskReview.risk_title),
    risk_description: compactString(newRiskReview.risk_description),
  });

  return (
    <div className="wb-page">
      <div>
        <nav className="flex items-center gap-2 text-sm mb-4 flex-wrap" aria-label="Breadcrumb">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <span className="text-ink-subtle">·</span>
          <span className="text-ink-muted">Domains</span>
          <ChevronRight className="w-4 h-4 text-ink-subtle shrink-0" />
          <span className="text-ink font-medium truncate max-w-[12rem] sm:max-w-xs" title={domainName || undefined}>
            {domainName || '…'}
          </span>
          <ChevronRight className="w-4 h-4 text-ink-subtle shrink-0" />
          <span className="text-ink-muted">Use cases</span>
          <ChevronRight className="w-4 h-4 text-ink-subtle shrink-0" />
          <span className="text-ink font-semibold truncate max-w-[12rem] sm:max-w-md" title={useCaseDisplayName}>
            {useCaseDisplayName}
          </span>
        </nav>

        <h1 className="wb-page-title truncate" title={useCaseDisplayName}>
          {useCaseDisplayName}
        </h1>
        <p className="wb-page-subtitle mb-4">
          {formData.status === 'Approved'
            ? 'This use case is approved and read-only. You can review the full workflow but cannot edit it.'
            : formData.status === 'Rejected'
            ? 'This use case is rejected and read-only. You can review the full workflow but cannot edit it.'
            : formData.status === 'ROI' && canAssignRoi && !isRoiOwner
              ? 'Case details are locked. You can assign or reassign the ROI owner. Only the assigned owner can edit the savings worksheet.'
            : formData.status === 'ROI' && isRoiOwner
              ? 'You are the assigned ROI owner. Fill the savings worksheet, then complete ROI.'
            : !canEditCase
              ? (createdById === user?.user_id && formData.status !== 'New'
                ? 'As initiator, you can only edit while the use case is in New status.'
                : 'You have view-only access. You can add comments and ratings if you have permission.')
              : 'Update use case information and details'}
        </p>

        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm font-medium text-ink-muted">
            {isReadOnly ? 'View Use Case' : canEditCase ? 'Edit Use Case' : 'View Use Case'}
          </span>
          <div className="flex items-center gap-2">
            {canEditCase && (
              <button
                type="button"
                onClick={() => { setMoveModal(true); setMoveTargetDomainId(''); setMoveDomains([]); }}
                className="wb-btn-secondary"
              >
                <ArrowRightLeft className="w-4 h-4" />
                Move to domain
              </button>
            )}
            {!isReadOnly && canEditCase && (
              <button
                onClick={(e) => { e.preventDefault(); handleSubmit(e as any); }}
                disabled={saving}
                className="wb-btn-primary"
                title={
                  isTechOwner && analysisMeta.tech_analysis_completed_dt && !isBizOwner && !(hasCaseEdit && canAssignAnalysis) && !isAdmin
                    ? 'Technical analysis is complete — return to use cases'
                    : undefined
                }
              >
                <Save className="w-4 h-4" />
                {saving
                  ? 'Saving...'
                  : isTechOwner &&
                    analysisMeta.tech_analysis_completed_dt &&
                    !isBizOwner &&
                    !(hasCaseEdit && canAssignAnalysis) &&
                    !isAdmin
                  ? 'Done'
                  : 'Save All Changes'}
              </button>
            )}
          </div>
        </div>
      </div>

      {moveModal && (
        <div className="wb-modal-overlay">
          <div className="wb-modal p-6">
            <h3 className="font-display text-lg font-semibold text-ink mb-4">Move use case to another domain</h3>
            <form onSubmit={handleMoveToDomain} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink-muted mb-1">Target domain</label>
                <SelectMenu
                  value={moveTargetDomainId}
                  onChange={setMoveTargetDomainId}
                  required
                  placeholder="Select domain"
                  searchable
                  options={moveDomains
                    .filter((d: any) => d.domain_id !== currentDomainId)
                    .map((d: any) => ({ value: d.domain_id, label: d.domain_name }))}
                  aria-label="Target domain"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setMoveModal(false)} className="wb-btn-secondary">Cancel</button>
                <button type="submit" disabled={moveSaving || !moveTargetDomainId} className="wb-btn-primary">
                  {moveSaving ? 'Moving...' : 'Move'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <Toast message={error} onDismiss={() => setError('')} type="error" autoDismissMs={8000} />

      <div className="wb-card-pad">
        <UseCaseStateView
          currentStatus={formData.status}
          interactive={canChangeStatus}
          allowedNext={allowedNextStatuses}
          allRisksClosed={allRisksClosed}
          hasRisks={riskReviews.length > 0}
          onNeedRisks={() => goToRisksTab(ESTIMATE_CLICK_GATE)}
          onTransition={handleStatusChange}
          onRejectClick={() => {
            setRejectionReasonInput(formData.rejection_reason || '');
            setShowRejectionModal(true);
          }}
          transitioning={statusChangeSaving}
        />
        {formData.status === 'Rejected' && formData.rejection_reason && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">Rejection reason</p>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">{formData.rejection_reason}</p>
          </div>
        )}
        {(formData.status === 'Analysis' || formData.status === 'Review' || formData.status === 'Estimate') && (
          <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-400">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>
                Assigned{analysisMeta.analysis_assigned_by_name ? ` by ${analysisMeta.analysis_assigned_by_name}` : ''}
                {analysisMeta.analysis_assigned_dt ? ` on ${new Date(analysisMeta.analysis_assigned_dt).toLocaleString()}` : ''}
                {analysisMeta.analysis_due_date ? ` · Due ${new Date(analysisMeta.analysis_due_date).toLocaleDateString()}` : ''}
              </p>
              {formData.status === 'Analysis' || formData.status === 'Review' ? (
                <p className="text-xs font-medium text-ink-muted">
                  {`${[analysisMeta.tech_analysis_completed_dt, analysisMeta.business_analysis_completed_dt].filter(Boolean).length}/2 tracks complete`}
                </p>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <AnalysisTrackStatusCard
                title="Technical analysis"
                ownerLabel={formData.technical_owner ? (technicalOwnerLabel || 'Assigned') : 'No technical owner'}
                ownerId={formData.technical_owner}
                completedDt={analysisMeta.tech_analysis_completed_dt}
                rejectedDt={analysisMeta.tech_analysis_rejected_dt}
                rejectionNote={analysisMeta.tech_analysis_rejection_note}
              />
              <AnalysisTrackStatusCard
                title="Business analysis"
                ownerLabel={formData.business_owner ? (businessOwnerLabel || 'Assigned') : 'No business owner'}
                ownerId={formData.business_owner}
                completedDt={analysisMeta.business_analysis_completed_dt}
                rejectedDt={analysisMeta.business_analysis_rejected_dt}
                rejectionNote={analysisMeta.business_analysis_rejection_note}
              />
            </div>
            {formData.status === 'Analysis' && canAssignAnalysis && (!formData.technical_owner || !formData.business_owner) && (
              <button
                type="button"
                onClick={() => setShowAssignModal(true)}
                className="mt-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm"
              >
                {!formData.technical_owner && !formData.business_owner
                  ? 'Reassign Analysis'
                  : !formData.technical_owner
                  ? 'Reassign Technical Owner'
                  : 'Reassign Business Owner'}
              </button>
            )}
            {canSendBackFromReview && (
              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => { setSendBackTrack('technical'); setSendBackNote(''); }}
                  className="px-3 py-1.5 rounded-lg border border-amber-500 text-amber-700 dark:text-amber-300 text-sm"
                >
                  Send back Technical Analysis
                </button>
                <button
                  type="button"
                  onClick={() => { setSendBackTrack('business'); setSendBackNote(''); }}
                  className="px-3 py-1.5 rounded-lg border border-amber-500 text-amber-700 dark:text-amber-300 text-sm"
                >
                  Send back Business Analysis
                </button>
              </div>
            )}
            {formData.status === 'Estimate' && (
              <p>
                Estimate owner: {estimateMeta.estimate_owner_name || (estimateMeta.estimate_owner ? 'Assigned' : 'Unassigned')}
                {estimateMeta.estimate_due_date ? ` · Due ${new Date(estimateMeta.estimate_due_date).toLocaleDateString()}` : ''}
                {estimateMeta.estimate_completed_dt ? ` · Completed ${new Date(estimateMeta.estimate_completed_dt).toLocaleString()}` : ''}
              </p>
            )}
            {formData.status === 'Estimate' && canAssignEstimate && (
              <button
                type="button"
                onClick={tryOpenEstimateAssign}
                className="mt-2 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-sm"
              >
                Reassign Estimate
              </button>
            )}
          </div>
        )}
      </div>

      <AnalysisAssignModal
        open={showAssignModal}
        useCaseTitle={formData.use_case_title || formData.use_case_name}
        domainId={currentDomainId}
        initialTechnicalOwner={formData.technical_owner}
        initialBusinessOwner={formData.business_owner}
        initialDueDate={analysisMeta.analysis_due_date || ''}
        lockTechnicalOwner={formData.status === 'Analysis' && !!formData.technical_owner}
        lockBusinessOwner={formData.status === 'Analysis' && !!formData.business_owner}
        saving={assignSaving}
        onClose={() => setShowAssignModal(false)}
        onAssign={handleAnalysisAssign}
      />

      <EstimateAssignModal
        open={showEstimateAssignModal}
        useCaseTitle={formData.use_case_title || formData.use_case_name}
        domainId={currentDomainId}
        initialEstimateOwner={estimateMeta.estimate_owner || formData.technical_owner || ''}
        initialDueDate={estimateMeta.estimate_due_date || ''}
        saving={estimateAssignSaving}
        onClose={() => setShowEstimateAssignModal(false)}
        onAssign={handleEstimateAssign}
      />

      {canAssignRoi && (
      <RoiAssignModal
        open={showRoiAssignModal}
        useCaseTitle={formData.use_case_title || formData.use_case_name}
        domainId={currentDomainId}
        isReassign={!!roiMeta.roi_owner}
        currentOwnerLabel={
          roiMeta.roi_owner_name
            ? `${roiMeta.roi_owner_name}${roiMeta.roi_owner_email ? ` (${roiMeta.roi_owner_email})` : ''}`
            : undefined
        }
        initialOwner={roiMeta.roi_owner || formData.business_owner || ''}
        initialDueDate={roiMeta.roi_due_date || ''}
        saving={roiAssignSaving}
        onClose={() => setShowRoiAssignModal(false)}
        onAssign={handleRoiAssign}
      />
      )}

      <AssessmentAssignModal
        open={showAssessmentAssignModal}
        useCaseTitle={formData.use_case_title || formData.use_case_name}
        domainId={currentDomainId}
        initialOwner={assessmentMeta.assessment_owner || ''}
        initialDueDate={assessmentMeta.assessment_due_date || ''}
        saving={assessmentAssignSaving}
        onClose={() => setShowAssessmentAssignModal(false)}
        onAssign={handleAssessmentAssign}
      />

      {rejectTrack && (
        <div className="wb-modal-overlay">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 max-w-md w-full shadow-xl space-y-3">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Reject {rejectTrack === 'technical' ? 'Technical' : 'Business'} assignment
            </h3>
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Reason for rejecting this assignment…"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setRejectTrack(null); setRejectNote(''); }} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600">Cancel</button>
              <button type="button" onClick={handleRejectAnalysis} disabled={rejectSaving || !rejectNote.trim()} className="px-4 py-2 rounded-lg bg-red-600 text-white disabled:opacity-50">
                {rejectSaving ? 'Submitting…' : 'Reject assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {sendBackTrack && (
        <div className="wb-modal-overlay">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 max-w-md w-full shadow-xl space-y-3">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Send back {sendBackTrack === 'technical' ? 'Technical' : 'Business'} Analysis
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Clears completion for this track and returns the use case to Analysis for more information.
            </p>
            <textarea
              value={sendBackNote}
              onChange={(e) => setSendBackNote(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="What additional information is needed…"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setSendBackTrack(null); setSendBackNote(''); }} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600">Cancel</button>
              <button type="button" onClick={handleSendBackAnalysis} disabled={sendBackSaving || !sendBackNote.trim()} className="px-4 py-2 rounded-lg bg-amber-600 text-white disabled:opacity-50">
                {sendBackSaving ? 'Sending…' : 'Send back'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRejectionModal && (
        <div className="wb-modal-overlay">
          <div className="wb-modal p-6 max-w-md">
            <h3 className="font-display text-lg font-semibold text-ink mb-2">Reject use case</h3>
            <p className="text-sm text-ink-muted mb-4">
              Provide a rejection reason and confirm. This moves the use case to <span className="font-medium text-ink">Rejected</span> and cannot be undone from the workflow.
            </p>
            <label className="block text-sm font-medium text-ink-muted mb-2">
              Rejection reason *
            </label>
            <textarea
              value={rejectionReasonInput}
              onChange={(e) => setRejectionReasonInput(e.target.value)}
              placeholder="Enter rejection reason..."
              rows={4}
              maxLength={1000}
              className="wb-input resize-y mb-2"
              autoFocus
            />
            <p className="text-xs text-ink-subtle mb-4 tabular-nums">
              {rejectionReasonInput.trim().length}/1000
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setShowRejectionModal(false); setRejectionReasonInput(''); setError(''); }}
                className="wb-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmRejectionReason}
                disabled={statusChangeSaving || !rejectionReasonInput.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {statusChangeSaving ? 'Rejecting...' : 'Confirm rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="border-b border-line mb-2">
        <div className="flex flex-wrap gap-x-1 gap-y-0">
          {(() => {
            const status = formData.status;
            const order: Section[] =
              status === 'New'
                ? ['basic', 'references', 'audit']
                : status === 'Analysis'
                ? ['basic', 'tech_analysis', 'business_analysis', 'data', 'risks', 'references', 'comments', 'audit']
                : status === 'Estimate'
                ? ['estimate', 'basic', 'tech_analysis', 'business_analysis', 'references', 'data', 'risks', 'comments', 'audit']
                : status === 'ROI'
                ? ['roi', 'estimate', 'basic', 'tech_analysis', 'business_analysis', 'references', 'data', 'risks', 'comments', 'audit']
                : status === 'AI Assessment'
                ? ['assessment', 'roi', 'tech_analysis', 'business_analysis', 'risks', 'basic', 'references', 'data', 'comments', 'audit']
                : status === 'Review'
                ? ['basic', 'tech_analysis', 'business_analysis', 'risks', 'references', 'data', 'comments', 'audit']
                : status === 'Approved' || status === 'Rejected'
                ? [
                    'basic',
                    'tech_analysis',
                    'business_analysis',
                    'estimate',
                    'roi',
                    'assessment',
                    'risks',
                    'references',
                    'data',
                    'comments',
                    'audit',
                  ]
                : ['basic', 'references', 'audit'];
            const labels: Record<Section, string> = {
              basic: 'Basic Info',
              references: `References (${(formData.reference_links?.length || 0) + documents.filter(isResourceManagementDocument).length})`,
              analysis: 'Analysis',
              tech_analysis: 'Technical Analysis',
              business_analysis: 'Business Analysis',
              data: `Data Requirements (${dataReqs.length})`,
              risks: `Risks (${riskReviews.length})${missingRequiredRisk ? ' *' : ''}`,
              comments: `Comments (${comments.length})`,
              estimate: 'Estimate',
              roi: 'ROI',
              assessment: 'AI Assessment',
              audit: 'Audit trail',
            };
            const uid = user?.user_id;
            const pendingByTab: Partial<Record<Section, boolean>> = {
              tech_analysis:
                !!uid &&
                formData.status === 'Analysis' &&
                formData.technical_owner === uid &&
                !analysisMeta.tech_analysis_completed_dt,
              business_analysis:
                !!uid &&
                formData.status === 'Analysis' &&
                formData.business_owner === uid &&
                !analysisMeta.business_analysis_completed_dt,
              estimate:
                !!uid &&
                formData.status === 'Estimate' &&
                estimateMeta.estimate_owner === uid &&
                !estimateMeta.estimate_completed_dt,
              roi:
                !!uid &&
                formData.status === 'ROI' &&
                roiMeta.roi_owner === uid &&
                !roiMeta.roi_completed_dt,
              assessment:
                !!uid &&
                formData.status === 'AI Assessment' &&
                assessmentMeta.assessment_owner === uid &&
                !assessmentMeta.assessment_completed_dt,
              risks:
                (formData.status === 'Analysis' &&
                  riskReviews.length === 0 &&
                  (isTechOwner || isBizOwner || canAssignAnalysis)) ||
                (!!uid && riskReviews.some((r) => r.assigned_to === uid && r.status !== 'closed')),
            };
            return order.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  userPickedSection.current = true;
                  setActiveSection(id);
                  onSectionChange?.(id);
                }}
                className={`wb-tab relative ${
                  activeSection === id ? 'wb-tab-active' : 'wb-tab-idle'
                }`}
              >
                <span className="relative pr-2">
                  {labels[id]}
                  {pendingByTab[id] ? (
                    <span
                      className="absolute -right-0.5 top-0 h-1.5 w-1.5 rounded-full bg-red-500"
                      title="Pending work"
                      aria-label="Pending work"
                    />
                  ) : null}
                </span>
              </button>
            ));
          })()}
        </div>
      </div>

      {activeSection === 'basic' && (
        <div className="wb-card-pad">
          <div className="mb-6">
            <h3 className="font-display text-lg font-semibold text-ink">Basic information</h3>
            <p className="text-sm text-ink-muted mt-1">
              Core identity and narrative for this use case — title, description, intended use, and expected benefits.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-ink-muted mb-2">
                  Use Case Name <span className="text-ink-subtle font-normal">(30 chars max)</span> *
                </label>
                <input
                  type="text"
                  value={formData.use_case_name}
                  onChange={(e) => setFormData({ ...formData, use_case_name: e.target.value })}
                  maxLength={30}
                  disabled={isReadOnly}
                  className="wb-input disabled:opacity-70 disabled:cursor-not-allowed"
                  required
                />
                <p className="mt-1 text-xs text-ink-subtle tabular-nums">{formData.use_case_name.length}/30</p>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-ink-muted mb-2">
                  Department <span className="text-ink-subtle font-normal">(30 chars max)</span>
                  <span title={USE_CASE_FIELD_HELP.department} className="inline-flex text-ink-subtle cursor-help">
                    <HelpCircle className="w-3.5 h-3.5" />
                  </span>
                </label>
                <input
                  type="text"
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  maxLength={30}
                  disabled={isReadOnly}
                  className="wb-input disabled:opacity-70 disabled:cursor-not-allowed"
                />
              </div>
            </div>

            {createdByName && (
              <p className="text-sm text-ink-muted rounded-xl bg-surface-muted px-3 py-2">
                Initiated by <span className="font-medium text-ink">{createdByName}</span>
              </p>
            )}
            <div>
                <label className="block text-sm font-medium text-ink-muted mb-2">
                  Use Case Title <span className="text-ink-subtle font-normal">(100 chars max)</span> *
                </label>
                <input
                type="text"
                value={formData.use_case_title}
                onChange={(e) => setFormData({ ...formData, use_case_title: e.target.value })}
                maxLength={100}
                disabled={isReadOnly}
                className="wb-input disabled:opacity-70 disabled:cursor-not-allowed"
                required
              />
              <p className="mt-1 text-xs text-ink-subtle tabular-nums">{formData.use_case_title.length}/100</p>
            </div>

            <AIFieldAssist
              inputId="use-case-description"
              label={`Description (${DESCRIPTION_MAX_LENGTH} chars max)`}
              fieldLabel="Description"
              fieldName="description"
              value={formData.use_case_description}
              maxLength={DESCRIPTION_MAX_LENGTH}
              context={descriptionAIContext}
              onApply={(nextValue) => setFormData({ ...formData, use_case_description: nextValue })}
              canUseAI={canUseAIFieldAssist}
            >
              <textarea
                id="use-case-description"
                value={formData.use_case_description}
                onChange={(e) => setFormData({ ...formData, use_case_description: e.target.value })}
                maxLength={DESCRIPTION_MAX_LENGTH}
                rows={5}
                disabled={isReadOnly}
                className="wb-input disabled:opacity-70 disabled:cursor-not-allowed"
              />
            </AIFieldAssist>

            <AIFieldAssist
              inputId="intended-use"
              label={`${INTENDED_USE_LABEL} (${INTENDED_USE_MAX_LENGTH} chars max)`}
              fieldLabel={INTENDED_USE_LABEL}
              fieldName="intended_use"
              value={formData.intended_use}
              maxLength={INTENDED_USE_MAX_LENGTH}
              context={intendedUseAIContext}
              onApply={(nextValue) => setFormData({ ...formData, intended_use: nextValue })}
              canUseAI={canUseAIFieldAssist}
            >
              <textarea
                id="intended-use"
                value={formData.intended_use}
                onChange={(e) => setFormData({ ...formData, intended_use: e.target.value })}
                maxLength={INTENDED_USE_MAX_LENGTH}
                rows={4}
                disabled={isReadOnly}
                placeholder="Describe how this use case will be used in practice..."
                className="wb-input disabled:opacity-70 disabled:cursor-not-allowed"
              />
            </AIFieldAssist>

            <AIFieldAssist
              inputId="expected-benefits"
              label={`Expected Benefits (${EXPECTED_BENEFITS_MAX_LENGTH} chars max)`}
              fieldLabel="Expected Benefits"
              fieldName="expected_benefits"
              value={formData.expected_benefits}
              maxLength={EXPECTED_BENEFITS_MAX_LENGTH}
              context={expectedBenefitsAIContext}
              onApply={(nextValue) => setFormData({ ...formData, expected_benefits: nextValue })}
              canUseAI={canUseAIFieldAssist}
            >
              <textarea
                id="expected-benefits"
                value={formData.expected_benefits}
                onChange={(e) => setFormData({ ...formData, expected_benefits: e.target.value })}
                maxLength={EXPECTED_BENEFITS_MAX_LENGTH}
                rows={4}
                disabled={isReadOnly}
                className="wb-input disabled:opacity-70 disabled:cursor-not-allowed"
              />
            </AIFieldAssist>

            <div>
              <label className="block text-sm font-medium text-ink-muted mb-2">Tags</label>
              <p className="mb-2 text-xs text-ink-subtle">Keywords that help classify and find this use case.</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={tagInput}
                  disabled={isReadOnly}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const next = tagInput.trim();
                      if (next && !formData.tags.includes(next)) {
                        setFormData({ ...formData, tags: [...formData.tags, next] });
                      }
                      setTagInput('');
                    }
                  }}
                  className="wb-input sm:flex-1 disabled:opacity-70"
                  placeholder="Type a tag and press Enter or Add"
                />
                <button
                  type="button"
                  disabled={isReadOnly || !tagInput.trim()}
                  onClick={() => {
                    const next = tagInput.trim();
                    if (next && !formData.tags.includes(next)) {
                      setFormData({ ...formData, tags: [...formData.tags, next] });
                    }
                    setTagInput('');
                  }}
                  className="wb-btn-secondary shrink-0"
                >
                  Add
                </button>
              </div>
              {formData.tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {formData.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1.5 rounded-full bg-navy-50 px-2.5 py-1 text-xs font-medium text-navy-700 dark:bg-navy-900/40 dark:text-cyan-200"
                    >
                      {tag}
                      {!isReadOnly && (
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, tags: formData.tags.filter((item) => item !== tag) })}
                          className="rounded-full p-0.5 hover:bg-navy-100 dark:hover:bg-navy-800"
                          aria-label={`Remove ${tag}`}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs italic text-ink-subtle">None added yet.</p>
              )}
            </div>

            {/* Status is controlled from the top status selector only (forward-only; Admin can override). */}
          </form>
        </div>
      )}

      {activeSection === 'references' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            <LinkIcon className="w-5 h-5" />
            Reference links & documents
          </h3>

          <div className="space-y-8">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Reference links</label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Add URLs (e.g. Confluence, docs) for this use case.</p>
              <div className="flex flex-wrap gap-2 mb-3">
                <input
                  type="url"
                  value={newLinkUrl}
                  onChange={(e) => setNewLinkUrl(e.target.value)}
                  placeholder="https://..."
                  disabled={isReadOnly}
                  className="flex-1 min-w-[200px] px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-70"
                />
                <input
                  type="text"
                  value={newLinkLabel}
                  onChange={(e) => setNewLinkLabel(e.target.value)}
                  placeholder="Label (optional)"
                  disabled={isReadOnly}
                  className="w-40 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-70"
                />
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={addReferenceLink}
                    disabled={!newLinkUrl.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" /> Add link
                  </button>
                )}
              </div>
              <ul className="space-y-2">
                {(formData.reference_links || []).map((link, idx) => (
                  <li key={idx} className="flex items-center gap-2 flex-wrap">
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline truncate max-w-md">
                      {link.label || link.url}
                    </a>
                    <span className="text-slate-400 text-sm truncate max-w-xs">{link.url}</span>
                    {!isReadOnly && (
                      <button type="button" onClick={() => removeReferenceLink(idx)} className="p-1 text-slate-500 hover:text-red-600 rounded" title="Remove link">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </li>
                ))}
                {(formData.reference_links?.length ?? 0) === 0 && (
                  <li className="text-slate-500 dark:text-slate-400 text-sm italic">No reference links added yet.</li>
                )}
              </ul>
            </div>

            <UseCaseDocumentAttachments
              useCaseId={useCaseId}
              documents={documents}
              onDocumentsChange={setDocuments}
              canUpload={!isReadOnly}
              source="reference"
              filterSource="reference"
              title="Reference documents"
              helpText="Select the document type, then upload or drag and drop files. These documents also appear in Resource management. Technical supporting files belong on the Technical Analysis tab."
            />
          </div>
        </div>
      )}

      {activeSection === 'tech_analysis' && (
        <AnalysisPanels
          track="technical"
          formData={formData as any}
          setFormData={setFormData as any}
          isReadOnly={isReadOnly}
          canEditTrack={
            !analysisMeta.tech_analysis_completed_dt &&
            (isAdmin || isTechOwner || (hasCaseEdit && canAssignAnalysis))
          }
          canComplete={
            !!formData.technical_owner &&
            (isTechOwner || isAdmin) &&
            !analysisMeta.tech_analysis_completed_dt
          }
          completed={!!analysisMeta.tech_analysis_completed_dt}
          canReject={(isTechOwner || isAdmin) && !!formData.technical_owner && !analysisMeta.tech_analysis_completed_dt}
          canUseAI={canUseAIFieldAssist}
          solutionMax={SOLUTION_DESIGN_MAX_LENGTH}
          onComplete={() => handleCompleteAnalysis('technical')}
          completeBlockedReason={missingRequiredRisk && lastTechWouldAdvance ? riskGateMessage : null}
          onNeedRisk={() => goToRisksTab(riskGateMessage)}
          onRejectClick={() => { setRejectTrack('technical'); setRejectNote(''); }}
          onSave={handleAnalysisTrackSave}
          saving={saving}
          sharedAIContext={sharedAIContextBase}
          tagInput={tagInput}
          setTagInput={setTagInput}
          impactedStakeholderInput={impactedStakeholderInput}
          setImpactedStakeholderInput={setImpactedStakeholderInput}
          useCaseId={useCaseId}
          documents={documents}
          onDocumentsChange={setDocuments}
        />
      )}

      {activeSection === 'business_analysis' && (
        <AnalysisPanels
          track="business"
          formData={formData as any}
          setFormData={setFormData as any}
          isReadOnly={isReadOnly}
          canEditTrack={
            !analysisMeta.business_analysis_completed_dt &&
            (isAdmin || isBizOwner || (hasCaseEdit && canAssignAnalysis))
          }
          canComplete={
            !!formData.business_owner &&
            (isBizOwner || isAdmin) &&
            !analysisMeta.business_analysis_completed_dt
          }
          completed={!!analysisMeta.business_analysis_completed_dt}
          canReject={(isBizOwner || isAdmin) && !!formData.business_owner && !analysisMeta.business_analysis_completed_dt}
          canUseAI={canUseAIFieldAssist}
          solutionMax={SOLUTION_DESIGN_MAX_LENGTH}
          onComplete={() => handleCompleteAnalysis('business')}
          completeBlockedReason={missingRequiredRisk && lastBizWouldAdvance ? riskGateMessage : null}
          onNeedRisk={() => goToRisksTab(riskGateMessage)}
          onRejectClick={() => { setRejectTrack('business'); setRejectNote(''); }}
          onSave={handleAnalysisTrackSave}
          saving={saving}
          sharedAIContext={sharedAIContextBase}
          tagInput={tagInput}
          setTagInput={setTagInput}
          impactedStakeholderInput={impactedStakeholderInput}
          setImpactedStakeholderInput={setImpactedStakeholderInput}
        />
      )}

      {false && activeSection === 'analysis' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Analysis</h3>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">AI Category</label>
                <SelectMenu
                  value={formData.ai_category}
                  onChange={(ai_category) => setFormData({ ...formData, ai_category: ai_category as AiCategoryCode })}
                  disabled={isReadOnly}
                  options={AI_CATEGORY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                  aria-label="AI Category"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Feasibility</label>
                <SelectMenu
                  value={formData.feasibility}
                  onChange={(feasibility) => setFormData({ ...formData, feasibility: feasibility as any })}
                  disabled={isReadOnly}
                  options={[
                    { value: 'Yes', label: 'Yes' },
                    { value: 'No', label: 'No' },
                    { value: 'Yes (Difficult)', label: 'Yes (Difficult)' },
                  ]}
                  aria-label="Feasibility"
                />
              </div>
              {/* Status is controlled from the top status selector only. */}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Technical Owner (tech_architect / portal_admin)</label>
                {isReadOnly || !canAssignOwners ? (
                  <p className="px-3 py-2 text-slate-900 dark:text-white">{technicalOwnerLabel || '—'}</p>
                ) : (
                  <SelectMenu
                    value={formData.technical_owner}
                    onChange={(technical_owner) => setFormData({ ...formData, technical_owner })}
                    placeholder="Select Technical Owner"
                    searchable
                    options={architects.map((arch) => ({
                      value: arch.user_id,
                      label: arch.user_name,
                      description: arch.role_name,
                    }))}
                    aria-label="Technical Owner"
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Business Owner (business_reviewer)</label>
                {isReadOnly || !canAssignOwners ? (
                  <p className="px-3 py-2 text-slate-900 dark:text-white">{businessOwnerLabel || '—'}</p>
                ) : (
                  <SelectMenu
                    value={formData.business_owner}
                    onChange={(business_owner) => setFormData({ ...formData, business_owner })}
                    placeholder="Select Business Owner"
                    searchable
                    options={reviewers.map((rev) => ({
                      value: rev.user_id,
                      label: rev.user_name,
                      description: rev.user_email,
                    }))}
                    aria-label="Business Owner"
                  />
                )}
              </div>
            </div>

            <AIFieldAssist
              inputId="solution-design-overview"
              label={`Solution Design Overview (${SOLUTION_DESIGN_MAX_LENGTH} chars max)`}
              fieldLabel="Solution Design Overview"
              fieldName="solution_design_overview"
              value={formData.solution_design_overview}
              maxLength={SOLUTION_DESIGN_MAX_LENGTH}
              context={solutionDesignAIContext}
              onApply={(nextValue) => setFormData({ ...formData, solution_design_overview: nextValue })}
              canUseAI={canUseAIFieldAssist}
            >
              <textarea
                id="solution-design-overview"
                value={formData.solution_design_overview}
                onChange={(e) => setFormData({ ...formData, solution_design_overview: e.target.value })}
                maxLength={SOLUTION_DESIGN_MAX_LENGTH}
                rows={5}
                disabled={isReadOnly}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-70 disabled:cursor-not-allowed"
                placeholder="Describe the solution design overview..."
              />
            </AIFieldAssist>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Intended Audience</label>
                <input
                  type="text"
                  value={formData.intended_audience}
                  onChange={(e) => setFormData({ ...formData, intended_audience: e.target.value })}
                  placeholder="e.g., Data Scientists, Business Analysts"
                  maxLength={200}
                  disabled={isReadOnly}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-70 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Target Audience Type</label>
                <div className="space-y-2 rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-700">
                  {TARGET_AUDIENCE_TYPE_OPTIONS.map((option) => (
                    <label key={option} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={formData.target_audience_type.includes(option)}
                        disabled={isReadOnly}
                        onChange={() => {
                          setFormData((prev) => ({
                            ...prev,
                            target_audience_type: prev.target_audience_type.includes(option)
                              ? prev.target_audience_type.filter((item) => item !== option)
                              : [...prev.target_audience_type, option],
                          }));
                        }}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-70"
                      />
                      {option}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Impacted Stakeholder</label>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={impactedStakeholderInput}
                    disabled={isReadOnly}
                    onChange={(e) => setImpactedStakeholderInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addImpactedStakeholder();
                      }
                    }}
                    maxLength={IMPACTED_STAKEHOLDER_MAX_LENGTH}
                    placeholder="Enter stakeholder and press Enter"
                    className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-70 disabled:cursor-not-allowed"
                  />
                  <button
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => addImpactedStakeholder()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add
                  </button>
                </div>
                {formData.impacted_stakeholders.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {formData.impacted_stakeholders.map((stakeholder) => (
                      <span
                        key={stakeholder}
                        className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                      >
                        {stakeholder}
                        {!isReadOnly && (
                          <button
                            type="button"
                            onClick={() =>
                              setFormData({
                                ...formData,
                                impacted_stakeholders: formData.impacted_stakeholders.filter((item) => item !== stakeholder),
                              })
                            }
                            className="hover:text-blue-900 dark:hover:text-blue-100"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Human-in-loop Strategy ({HUMAN_IN_LOOP_STRATEGY_MAX_LENGTH} chars max)
              </label>
              <textarea
                value={formData.human_in_loop_strategy}
                onChange={(e) => setFormData({ ...formData, human_in_loop_strategy: e.target.value })}
                maxLength={HUMAN_IN_LOOP_STRATEGY_MAX_LENGTH}
                rows={4}
                disabled={isReadOnly}
                placeholder="Describe how humans remain in the loop for oversight, review, or intervention..."
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-70 disabled:cursor-not-allowed"
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900/20 space-y-4">
              <h4 className="text-base font-semibold text-slate-900 dark:text-white">Fairness & Bias Assessment</h4>

              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={formData.bias_assessment_performed}
                  disabled={isReadOnly}
                  onChange={(e) => setFormData({ ...formData, bias_assessment_performed: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-70"
                />
                Bias Assessment Performed
              </label>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Protected Attributes ({PROTECTED_ATTRIBUTES_MAX_LENGTH} chars max)
                </label>
                <textarea
                  value={formData.protected_attributes}
                  onChange={(e) => setFormData({ ...formData, protected_attributes: e.target.value })}
                  maxLength={PROTECTED_ATTRIBUTES_MAX_LENGTH}
                  rows={3}
                  disabled={isReadOnly}
                  placeholder="e.g., age, gender, ethnicity, disability status..."
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-70 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Balancing Strategy ({BALANCING_STRATEGY_MAX_LENGTH} chars max)
                </label>
                <textarea
                  value={formData.balancing_strategy}
                  onChange={(e) => setFormData({ ...formData, balancing_strategy: e.target.value })}
                  maxLength={BALANCING_STRATEGY_MAX_LENGTH}
                  rows={4}
                  disabled={isReadOnly}
                  placeholder="Describe how data or outcomes will be balanced across protected groups..."
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-70 disabled:cursor-not-allowed"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Tags</label>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={tagInput}
                    disabled={isReadOnly}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
                          setFormData({ ...formData, tags: [...formData.tags, tagInput.trim()] });
                          setTagInput('');
                        }
                      }
                    }}
                    placeholder="Enter tag and press Enter"
                    className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-70 disabled:cursor-not-allowed"
                  />
                  <button
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => {
                      if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
                        setFormData({ ...formData, tags: [...formData.tags, tagInput.trim()] });
                        setTagInput('');
                      }
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add
                  </button>
                </div>
                {formData.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {formData.tags.map((tag, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm"
                      >
                        {tag}
                        {!isReadOnly && (
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, tags: formData.tags.filter((t) => t !== tag) })}
                            className="hover:text-blue-900 dark:hover:text-blue-100"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </form>
        </div>
      )}

      {activeSection === 'data' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Data Requirements</h3>
            {!isReadOnly && (
              <button
                onClick={() => (showDataForm && editingDataReqId === null ? closeDataForm() : openAddDataForm())}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                {showDataForm && editingDataReqId === null ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {showDataForm && editingDataReqId === null ? 'Cancel' : 'Add Requirement'}
              </button>
            )}
          </div>

          {!isReadOnly && showDataForm && (
            <DataRequirementForm
              value={dataReqForm}
              onChange={setDataReqForm}
              onSubmit={handleSaveDataReq}
              onCancel={closeDataForm}
              submitLabel={editingDataReqId != null ? 'Save Changes' : 'Add Data Requirement'}
              formId={editingDataReqId != null ? `edit-${editingDataReqId}` : 'new'}
            />
          )}

          <div className="space-y-3">
            {dataReqs.length === 0 ? (
              <p className="text-slate-600 dark:text-slate-400 text-center py-8">No data requirements added yet</p>
            ) : (
              dataReqs.map((data) => (
                <div
                  key={data.data_req_id}
                  className={`flex items-start justify-between p-4 border rounded-lg transition-colors ${
                    editingDataReqId === data.data_req_id
                      ? 'border-blue-400 bg-blue-50/60 dark:border-blue-500 dark:bg-blue-900/20'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <div className="flex-1">
                    <p className="font-medium text-slate-900 dark:text-white mb-2">{data.data_req}</p>
                    <DataRequirementDetails data={data} />
                  </div>
                  {!isReadOnly && (
                    <div className="ml-3 flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => openEditDataForm(data)}
                        className="p-2 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                        title="Edit data requirement"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteModal({ isOpen: true, type: 'data', id: String(data.data_req_id) })}
                        className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        title="Delete data requirement"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeSection === 'risks' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Risks</h3>
            {riskStageEditable && canReviewRisk && (
              <button
                onClick={() => setShowRiskForm(!showRiskForm)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                {showRiskForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {showRiskForm ? 'Cancel' : 'Add Risk'}
              </button>
            )}
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
            {formData.status === 'Analysis' || formData.status === 'Review'
              ? 'At least one risk is required before Analysis can move to Review, and before Review can move to Estimate. The assigned technical owner or business owner should add it; domain owner or portal admin can add it as backup. The risk may stay open until Approve.'
              : 'Risks are created and assigned to a reviewer. The assigned reviewer can update mitigation strategy, closure comment, and status. Risk details (title, description, category) cannot be edited after creation.'}
          </p>
          {missingRequiredRisk && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              {formData.status === 'Review'
                ? 'Add at least one risk to continue. Clicking Estimate is blocked until a risk exists.'
                : 'Add at least one risk to continue. Completing the last Analysis track is blocked until a risk exists.'}
            </div>
          )}

          {riskStageEditable && canReviewRisk && showRiskForm && (
            <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Risk Title (50 chars max) *
                  </label>
                  <input
                    type="text"
                    value={newRiskReview.risk_title}
                    onChange={(e) => setNewRiskReview({ ...newRiskReview, risk_title: e.target.value })}
                    maxLength={50}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                    placeholder="e.g., Data quality issues"
                    required
                  />
                </div>
                <AIFieldAssist
                  inputId="risk-description"
                  label={`Risk Description * (${RISK_DESCRIPTION_MAX_LENGTH} chars max)`}
                  fieldLabel="Risk Description"
                  fieldName="risk_description"
                  value={newRiskReview.risk_description}
                  maxLength={RISK_DESCRIPTION_MAX_LENGTH}
                  context={riskDescriptionAIContext}
                  onApply={(nextValue) => setNewRiskReview({ ...newRiskReview, risk_description: nextValue })}
                  canUseAI={canUseAIFieldAssist}
                >
                  <textarea
                    id="risk-description"
                    value={newRiskReview.risk_description}
                    onChange={(e) => setNewRiskReview({ ...newRiskReview, risk_description: e.target.value })}
                    maxLength={RISK_DESCRIPTION_MAX_LENGTH}
                    rows={4}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                    placeholder="Describe the risk in detail..."
                    required
                  />
                </AIFieldAssist>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Category *
                    </label>
                    <SelectMenu
                      value={newRiskReview.risk_category}
                      onChange={(risk_category) => setNewRiskReview({ ...newRiskReview, risk_category: risk_category as any })}
                      required
                      placeholder="Select Category"
                      options={[
                        { value: 'Operational', label: 'Operational' },
                        { value: 'Business', label: 'Business' },
                        { value: 'Technical', label: 'Technical' },
                      ]}
                      aria-label="Risk category"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Status
                    </label>
                    <SelectMenu
                      value={newRiskReview.status}
                      onChange={(status) => setNewRiskReview({ ...newRiskReview, status: status as any })}
                      options={[
                        { value: 'open', label: 'Open' },
                        { value: 'closed', label: 'Closed' },
                      ]}
                      aria-label="Risk status"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {RISK_MODEL_INFLUENCE_LABEL}
                    </label>
                    <SelectMenu
                      value={newRiskReview.risk_likelihood}
                      onChange={(risk_likelihood) => setNewRiskReview({ ...newRiskReview, risk_likelihood: risk_likelihood as RiskLevel })}
                      options={RISK_LEVEL_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                      aria-label={RISK_MODEL_INFLUENCE_LABEL}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {RISK_DECISION_CONSEQUENCE_LABEL}
                    </label>
                    <SelectMenu
                      value={newRiskReview.risk_impact}
                      onChange={(risk_impact) => setNewRiskReview({ ...newRiskReview, risk_impact: risk_impact as RiskLevel })}
                      options={RISK_LEVEL_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                      aria-label={RISK_DECISION_CONSEQUENCE_LABEL}
                    />
                  </div>
                </div>
                <AIFieldAssist
                  inputId="mitigation-strategy"
                  label={`Mitigation Strategy (optional - assigned reviewer can add later, ${MITIGATION_STRATEGY_MAX_LENGTH} chars max)`}
                  fieldLabel="Mitigation Strategy"
                  fieldName="mitigation_strategy"
                  value={newRiskReview.mitigation_strategy}
                  maxLength={MITIGATION_STRATEGY_MAX_LENGTH}
                  context={mitigationStrategyAIContext}
                  onApply={(nextValue) => setNewRiskReview({ ...newRiskReview, mitigation_strategy: nextValue })}
                  canUseAI={canUseAIFieldAssist}
                >
                  <textarea
                    id="mitigation-strategy"
                    value={newRiskReview.mitigation_strategy}
                    onChange={(e) => setNewRiskReview({ ...newRiskReview, mitigation_strategy: e.target.value })}
                    maxLength={MITIGATION_STRATEGY_MAX_LENGTH}
                    rows={4}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                    placeholder="Describe the mitigation strategy in detail..."
                    required
                  />
                </AIFieldAssist>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Assigned To</label>
                  <SelectMenu
                    value={newRiskReview.assigned_to}
                    onChange={(assigned_to) => setNewRiskReview({ ...newRiskReview, assigned_to })}
                    placeholder="Not assigned"
                    searchable
                    options={reviewers.map((rev) => ({
                      value: rev.user_id,
                      label: rev.user_name,
                      description: rev.user_email,
                    }))}
                    aria-label="Assigned To"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Closure Comment (when closed)</label>
                  <textarea
                    value={newRiskReview.closure_comment}
                    onChange={(e) => setNewRiskReview({ ...newRiskReview, closure_comment: e.target.value })}
                    maxLength={500}
                    rows={2}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                    placeholder="Optional closure comment..."
                  />
                </div>
                <button
                  onClick={handleAddRiskReview}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  Add Risk Review
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {riskReviews.length === 0 ? (
              <p className="text-slate-600 dark:text-slate-400 text-center py-8">
                No risk reviews yet
              </p>
            ) : (
              riskReviews.map((risk) => {
                const canUpdateReview =
                  riskStageEditable &&
                  canReviewRisk &&
                  (risk.assigned_to === user?.user_id || isAdmin) &&
                  (editingRiskReviewId === risk.risk_review_id || !editingRiskReviewId);
                const isEditingThis = editingRiskReviewId === risk.risk_review_id;
                const riskUpdateMitigationAIContext = buildAIContext(sharedAIContextBase, {
                  risk_title: compactString(risk.risk_title),
                  risk_description: compactString(risk.risk_description),
                });
                return (
                <div
                  key={risk.risk_review_id}
                  className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h4 className="font-medium text-slate-900 dark:text-white mb-1">{risk.risk_title}</h4>
                      {risk.risk_description && (
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{risk.risk_description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-3">
                      {canUpdateReview && !isEditingThis && (
                        <button
                          type="button"
                          onClick={() => startUpdatingRiskReview(risk)}
                          className="px-3 py-1.5 text-sm bg-slate-600 hover:bg-slate-700 text-white rounded-lg transition-colors"
                        >
                          Update review
                        </button>
                      )}
                      {riskStageEditable && canReviewRisk && (
                        <button
                          onClick={() => setDeleteModal({ isOpen: true, type: 'risk', id: String(risk.risk_review_id) })}
                          className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {risk.risk_category && (
                      <span className="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded text-slate-700 dark:text-slate-300">
                        {risk.risk_category}
                      </span>
                    )}
                    {risk.assigned_to && (
                      <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 rounded text-blue-700 dark:text-blue-300">
                        Assigned
                      </span>
                    )}
                    <span className={`px-2 py-1 rounded ${getRiskLevelBadgeClass(risk.risk_likelihood)}`}>
                      {RISK_MODEL_INFLUENCE_LABEL}: {formatRiskLevel(risk.risk_likelihood)}
                    </span>
                    <span className={`px-2 py-1 rounded ${getRiskLevelBadgeClass(risk.risk_impact)}`}>
                      {RISK_DECISION_CONSEQUENCE_LABEL}: {formatRiskLevel(risk.risk_impact)}
                    </span>
                    <span className={`px-2 py-1 rounded ${
                      risk.status === 'open' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' :
                      'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                    }`}>
                      {risk.status}
                    </span>
                  </div>
                  {isEditingThis ? (
                    <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600 space-y-3">
                      <AIFieldAssist
                        inputId={`risk-update-mitigation-${risk.risk_review_id}`}
                        label={`Mitigation strategy (${MITIGATION_STRATEGY_MAX_LENGTH} chars max)`}
                        fieldLabel="Mitigation Strategy"
                        fieldName="mitigation_strategy"
                        value={riskReviewUpdateForm.mitigation_strategy}
                        maxLength={MITIGATION_STRATEGY_MAX_LENGTH}
                        context={riskUpdateMitigationAIContext}
                        onApply={(nextValue) => setRiskReviewUpdateForm({ ...riskReviewUpdateForm, mitigation_strategy: nextValue })}
                        canUseAI={canUseAIFieldAssist && canUpdateReview}
                      >
                        <textarea
                          id={`risk-update-mitigation-${risk.risk_review_id}`}
                          value={riskReviewUpdateForm.mitigation_strategy}
                          onChange={(e) => setRiskReviewUpdateForm({ ...riskReviewUpdateForm, mitigation_strategy: e.target.value })}
                          rows={3}
                          maxLength={MITIGATION_STRATEGY_MAX_LENGTH}
                          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                        />
                      </AIFieldAssist>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Closure comment</label>
                        <textarea
                          value={riskReviewUpdateForm.closure_comment}
                          onChange={(e) => setRiskReviewUpdateForm({ ...riskReviewUpdateForm, closure_comment: e.target.value })}
                          rows={2}
                          maxLength={500}
                          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Status</label>
                        <div className="max-w-xs">
                          <SelectMenu
                            value={riskReviewUpdateForm.status}
                            onChange={(status) => setRiskReviewUpdateForm({ ...riskReviewUpdateForm, status: status as 'open' | 'closed' })}
                            options={[
                              { value: 'open', label: 'Open' },
                              { value: 'closed', label: 'Closed' },
                            ]}
                            aria-label="Status"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleUpdateRiskReview(risk.risk_review_id)}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEditingRiskReviewId(null); setError(''); }}
                          className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                  {risk.mitigation_strategy && (
                    <div className="mt-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-sm">
                      <p className="text-slate-600 dark:text-slate-400">
                        <span className="font-medium">Mitigation:</span> {risk.mitigation_strategy}
                      </p>
                    </div>
                  )}
                  {risk.closure_comment && (
                    <div className="mt-2 p-2 bg-slate-50 dark:bg-slate-700/50 rounded text-sm">
                      <p className="text-slate-600 dark:text-slate-400">
                        <span className="font-medium">Closure:</span> {risk.closure_comment}
                      </p>
                    </div>
                  )}
                    </>
                  )}
                </div>
              ); })
            )}
          </div>
        </div>
      )}

      {activeSection === 'estimate' && (
        <EstimatePanel
          estimateData={estimateMeta.estimate_data || emptyEstimateData(defaultCurrency)}
          defaultCurrency={defaultCurrency}
          canEdit={
            formData.status === 'Estimate' &&
            !!estimateMeta.estimate_owner &&
            !estimateMeta.estimate_completed_dt &&
            (isAdmin || isEstimateOwner)
          }
          canComplete={
            formData.status === 'Estimate' &&
            !!estimateMeta.estimate_owner &&
            !estimateMeta.estimate_completed_dt &&
            (isAdmin || isEstimateOwner)
          }
          completed={!!estimateMeta.estimate_completed_dt}
          saving={estimateSaving}
          completing={estimateCompleting}
          estimateOwnerLabel={
            estimateMeta.estimate_owner_name ||
            (estimateMeta.estimate_owner ? 'Assigned' : undefined) ||
            undefined
          }
          dueDate={estimateMeta.estimate_due_date}
          assignedByName={estimateMeta.estimate_assigned_by_name}
          onSave={handleSaveEstimate}
          onComplete={handleCompleteEstimate}
        />
      )}

      {activeSection === 'roi' && (
        <div className="space-y-4">
          {formData.status === 'ROI' && canAssignRoi && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowRoiAssignModal(true)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-sm"
              >
                {roiMeta.roi_owner ? 'Reassign ROI' : 'Assign ROI'}
              </button>
            </div>
          )}
          <RoiPanel
            roiData={roiMeta.roi_data || emptyRoiData(estimateMeta.estimate_data?.currency || defaultCurrency)}
            defaultCurrency={estimateMeta.estimate_data?.currency || defaultCurrency}
            investmentTotal={estimateInvestmentTotal}
            expectedBenefits={formData.expected_benefits || ''}
            canEdit={
              formData.status === 'ROI' &&
              !!roiMeta.roi_owner &&
              !roiMeta.roi_completed_dt &&
              (isAdmin || isRoiOwner)
            }
            canComplete={
              formData.status === 'ROI' &&
              !!roiMeta.roi_owner &&
              !roiMeta.roi_completed_dt &&
              (isAdmin || isRoiOwner)
            }
            completed={!!roiMeta.roi_completed_dt}
            saving={roiSaving}
            completing={roiCompleting}
            needsAssignment={formData.status === 'ROI' && !roiMeta.roi_owner}
            roiOwnerId={roiMeta.roi_owner}
            roiOwnerLabel={roiMeta.roi_owner_name || undefined}
            roiOwnerEmail={roiMeta.roi_owner_email || undefined}
            roiOwnerRole={roiMeta.roi_owner_role || undefined}
            isCurrentUserOwner={isRoiOwner}
            dueDate={roiMeta.roi_due_date}
            assignedByName={roiMeta.roi_assigned_by_name}
            onAssignClick={canAssignRoi ? () => setShowRoiAssignModal(true) : undefined}
            onSave={handleSaveRoi}
            onComplete={handleCompleteRoi}
          />
        </div>
      )}

      {activeSection === 'assessment' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">AI Assessment</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  {formData.status === 'Approved' || formData.status === 'Rejected'
                    ? `This use case is ${formData.status.toLowerCase()}. The AI Assessment checklist is complete and read-only.`
                    : assessmentMeta.assessment_completed_dt
                      ? 'Assessment assignment is complete. Authorized users can Approve or Reject. All risks must be closed before Approve.'
                      : 'Assign a governance owner, run AI pre-fill, validate responses, then close the checklist and complete the assignment. Final Approve/Reject is available after assessment completion (all risks must be closed for Approve).'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  Owner: {assessmentMeta.assessment_owner_name || (assessmentMeta.assessment_owner ? 'Assigned' : 'Unassigned')}
                  {assessmentMeta.assessment_due_date
                    ? ` · Due ${new Date(assessmentMeta.assessment_due_date).toLocaleDateString()}`
                    : ''}
                  {assessmentMeta.assessment_completed_dt
                    ? ` · Completed ${new Date(assessmentMeta.assessment_completed_dt).toLocaleString()}`
                    : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.status === 'AI Assessment' && canAssignAiAssessment && (
                  <button
                    type="button"
                    onClick={() => setShowAssessmentAssignModal(true)}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-sm"
                  >
                    {assessmentMeta.assessment_owner ? 'Reassign' : 'Assign'} governance owner
                  </button>
                )}
                {formData.status === 'AI Assessment' &&
                  !!assessmentMeta.assessment_owner &&
                  !assessmentMeta.assessment_completed_dt &&
                  (isAdmin || isAssessmentOwner) && (
                    <button
                      type="button"
                      disabled={assessmentCompleting || assessmentChecklistStatus !== 'CLOSED'}
                      onClick={handleCompleteAiAssessment}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50"
                      title={
                        assessmentChecklistStatus === 'CLOSED'
                          ? 'Complete the AI Assessment assignment'
                          : 'Close the Responsible AI assessment checklist first'
                      }
                    >
                      {assessmentCompleting ? 'Completing…' : 'Complete assignment'}
                    </button>
                  )}
              </div>
            </div>
            {formData.status === 'AI Assessment' &&
              !!assessmentMeta.assessment_owner &&
              !assessmentMeta.assessment_completed_dt &&
              (isAdmin || isAssessmentOwner) &&
              assessmentChecklistStatus !== 'CLOSED' && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Complete assignment is unavailable until the Responsible AI assessment checklist is closed.
                </p>
              )}
          </div>

          <UseCaseAssessmentPanel
            useCaseId={useCaseId}
            useCase={{
              use_case_id: useCaseId,
              use_case_name: formData.use_case_name,
              use_case_title: formData.use_case_title,
              status: formData.status,
              domain_id: currentDomainId,
              documentation_quality_summary: documentationQualitySummary,
            } as UseCase}
            canInitiateAssessment={
              canInitiateAssessment &&
              formData.status === 'AI Assessment' &&
              !!assessmentMeta.assessment_owner &&
              !assessmentMeta.assessment_completed_dt &&
              (isAdmin || isAssessmentOwner)
            }
            canContributeAssessment={
              canContributeAssessment &&
              formData.status === 'AI Assessment' &&
              !!assessmentMeta.assessment_owner &&
              !assessmentMeta.assessment_completed_dt &&
              (isAdmin || isAssessmentOwner)
            }
            onAssessmentStatusChange={setAssessmentChecklistStatus}
            onAssessmentChange={setAssessmentResult}
          />

          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 space-y-2">
            <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Validation Package Recommendation
            </h4>
            {assessmentChecklistStatus === 'CLOSED' ? (
              <>
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  Based on the closed Responsible AI assessment
                  {assessmentResult?.risk_classification
                    ? ` (${assessmentResult.risk_classification} risk)`
                    : ''}
                  , create these validation deliverables:
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900 dark:text-amber-200">
                  {recommendedValidationPackages(assessmentResult?.risk_classification).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-amber-800 dark:text-amber-300">
                Close the Responsible AI assessment checklist to generate the recommended validation package for this use case.
              </p>
            )}
            {isVendorBuild(estimateMeta.estimate_data) ? (
              <>
                <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200 pt-2">
                  Vendor Assessment Checklist Recommendation
                </h4>
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  Build Cost is Vendor. Review these recommended governance questions; they do not block Estimate
                  or ROI completion.
                </p>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-amber-900 dark:text-amber-200">
                  {VENDOR_ASSESSMENT_QUESTIONS.map((item) => (
                    <li key={item.id}>{item.question}</li>
                  ))}
                </ol>
              </>
            ) : (
              <>
                <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200 pt-2">
                  Vendor Assessment Checklist Recommendation
                </h4>
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  Not required because the Estimate Build Cost type is not Vendor.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {activeSection === 'audit' && (
        <UseCaseAuditTrail useCaseId={useCaseId} refreshKey={auditRefreshKey} />
      )}

      {activeSection === 'comments' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Comments &amp; Rating</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
            {isTerminalStatus
              ? 'Comments and ratings are read-only after the use case is approved or rejected.'
              : canComment
                ? 'Add comments and optional 1–5 star rating. Visible in use case edit and detail.'
                : 'Comments and ratings. You need case_comment permission to add or update.'}
          </p>
          {canComment && !isTerminalStatus && (
            <form onSubmit={handleAddComment} className="mb-6 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Comment (optional)</label>
                  <input
                    type="text"
                    value={newComment.comment}
                    onChange={(e) => setNewComment({ ...newComment, comment: e.target.value })}
                    placeholder="Add a comment..."
                    maxLength={300}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Rating (1–5 stars, optional)</label>
                  <StarRating
                    rating={newComment.rating ?? undefined}
                    interactive
                    onSelect={(v) => setNewComment({ ...newComment, rating: v })}
                    size="lg"
                  />
                </div>
                <button type="submit" disabled={!newComment.comment.trim() && (newComment.rating == null || newComment.rating < 1)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  Add Comment / Rating
                </button>
              </div>
            </form>
          )}
          <div className="space-y-3">
            {comments.length === 0 ? (
              <p className="text-slate-600 dark:text-slate-400 text-center py-8">No comments yet</p>
            ) : (
              comments.map((c) => (
                <div key={c.comment_id} className="flex items-start justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <div className="flex items-center gap-4 flex-1">
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">{c.user_name || 'Unknown'}</p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">{c.comment || '(no text)'}</p>
                      <p className="text-xs text-slate-500 mt-1">{new Date(c.comment_date).toLocaleString()}</p>
                    </div>
                    {user?.user_id === c.comment_by && (canComment && !isTerminalStatus && editingCommentRating === c.comment_id ? (
                      <StarRating rating={c.rating ?? undefined} interactive onSelect={(v) => handleUpdateCommentRating(c.comment_id, v)} size="md" />
                    ) : canComment && !isTerminalStatus ? (
                      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setEditingCommentRating(c.comment_id)} title="Click to set or change your rating">
                        <StarRating rating={c.rating ?? undefined} size="md" />
                        {c.rating != null && <span className="text-sm text-slate-500">({c.rating})</span>}
                      </div>
                    ) : c.rating != null ? (
                      <StarRating rating={c.rating} size="md" />
                    ) : null)}
                    {user?.user_id !== c.comment_by && c.rating != null && <StarRating rating={c.rating} size="md" />}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ ...deleteModal, isOpen: false })}
        onConfirm={() => {
          if (deleteModal.type === 'data') {
            handleDeleteDataReq(deleteModal.id);
          } else if (deleteModal.type === 'risk') {
            handleDeleteRiskReview(deleteModal.id);
          }
        }}
        title={`Delete ${deleteModal.type === 'data' ? 'Data Requirement' : 'Risk Review'}`}
        message={`Are you sure you want to delete this ${deleteModal.type === 'data' ? 'data requirement' : 'risk review'}? This action cannot be undone.`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
