import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Download,
  History,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  Save,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import type { UseCase, UseCaseAssessment } from '../types';
import ConfirmModal from './ConfirmModal';
import { logger } from '../utils/logger';
import { toUserFacingAiErrorMessage } from '../utils/aiUserMessage';
import { exportAssessmentPdf } from '../utils/assessmentPdf';
import {
  getCachedAssessment,
  invalidateAssessmentCache,
  mergeAssessmentHistory,
  setCachedAssessment,
} from '../utils/assessmentCache';
import {
  assessmentDocumentationQualityMessage,
  isAssessmentDocumentationQualityMet,
  MIN_DOCUMENTATION_QUALITY_FOR_ASSESSMENT,
} from '../constants/assessmentEligibility';

interface Props {
  useCaseId: string;
  useCase: UseCase;
  canInitiateAssessment: boolean;
  canContributeAssessment: boolean;
  /** When true, block checklist start until a governance owner is assigned. */
  needsAssessmentOwnerAssignment?: boolean;
  canAssignAssessmentOwner?: boolean;
  onAssignAssessmentOwner?: () => void;
  onAssessmentStatusChange?: (status: UseCaseAssessment['status'] | null) => void;
  onAssessmentChange?: (assessment: UseCaseAssessment | null) => void;
}

type LocalAnswer = {
  selectedLabels: string[];
  comment: string;
};

const secondaryButtonClass =
  'inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600';

export default function UseCaseAssessmentPanel({
  useCaseId,
  useCase,
  canInitiateAssessment,
  canContributeAssessment,
  needsAssessmentOwnerAssignment = false,
  canAssignAssessmentOwner = false,
  onAssignAssessmentOwner,
  onAssessmentStatusChange,
  onAssessmentChange,
}: Props) {
  const [assessment, setAssessment] = useState<UseCaseAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [aiPrefilling, setAiPrefilling] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [expandedAreas, setExpandedAreas] = useState<Set<number>>(new Set([0]));
  const [localAnswers, setLocalAnswers] = useState<Record<number, LocalAnswer>>({});
  const [savingItemId, setSavingItemId] = useState<number | null>(null);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeFindings, setCloseFindings] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const syncLocalFromAssessment = useCallback((data: UseCaseAssessment) => {
    const next: Record<number, LocalAnswer> = {};
    Object.values(data.responses || {}).forEach((response) => {
      next[response.template_item_id] = {
        selectedLabels: (response.selected_answers || []).map((a) => a.label),
        comment: response.comment || '',
      };
    });
    setLocalAnswers(next);
    if (data.overall_findings) setCloseFindings(data.overall_findings);
  }, []);

  const applyAssessment = useCallback(
    (row: UseCaseAssessment | null) => {
      setAssessment(row);
      setCachedAssessment(useCaseId, row);
      if (row) syncLocalFromAssessment(row);
      onAssessmentStatusChange?.(row?.status || null);
      onAssessmentChange?.(row);
    },
    [onAssessmentChange, onAssessmentStatusChange, useCaseId, syncLocalFromAssessment],
  );

  const loadAssessment = useCallback(async (options?: { force?: boolean }) => {
    if (!options?.force) {
      const cached = getCachedAssessment(useCaseId);
      if (cached !== undefined) {
        applyAssessment(cached);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    setError('');
    try {
      const data = await api.getUseCaseAssessment(useCaseId);
      const row = (data as { assessment: UseCaseAssessment | null }).assessment;
      applyAssessment(row);
    } catch (err: any) {
      logger.error('Failed to load use case assessment', err);
      setError(err?.message || 'Failed to load assessment');
    } finally {
      setLoading(false);
    }
  }, [useCaseId, applyAssessment]);

  useEffect(() => {
    void loadAssessment();
  }, [loadAssessment]);

  useEffect(() => {
    setHistoryLoaded(false);
    setShowHistory(false);
  }, [useCaseId]);

  useEffect(() => {
    if (!showHistory || !assessment || historyLoaded) return;

    let cancelled = false;
    async function loadHistory() {
      setHistoryLoading(true);
      try {
        const data = await api.getUseCaseAssessmentHistory(useCaseId);
        if (cancelled) return;
        const history = (data as { history?: UseCaseAssessment['history'] }).history || [];
        const participants = (data as { participants?: UseCaseAssessment['participants'] }).participants;
        const merged = mergeAssessmentHistory(useCaseId, history, participants);
        if (merged) {
          setAssessment(merged);
        } else {
          setAssessment((prev) =>
            prev
              ? {
                  ...prev,
                  history,
                  participants: participants ?? prev.participants,
                }
              : prev,
          );
        }
        setHistoryLoaded(true);
      } catch (err) {
        if (!cancelled) logger.error('Failed to load assessment history', err);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [showHistory, assessment, useCaseId, historyLoaded]);

  const areas = useMemo(
    () => assessment?.template_snapshot?.areas || [],
    [assessment],
  );

  const isClosed = assessment?.status === 'CLOSED';
  const isInProgress = assessment?.status === 'IN_PROGRESS';
  const canUpdateInProgress = canInitiateAssessment || canContributeAssessment;
  const docQualityMet = isAssessmentDocumentationQualityMet(useCase.documentation_quality_summary);
  const docQualityMessage = assessmentDocumentationQualityMessage(useCase.documentation_quality_summary);

  async function handleStart(forceNew = false) {
    if (!canInitiateAssessment || needsAssessmentOwnerAssignment) return;
    setBusy(true);
    setError('');
    try {
      const data = await api.initiateUseCaseAssessment(useCaseId, { force_new: forceNew });
      const row = (data as { assessment: UseCaseAssessment }).assessment;
      invalidateAssessmentCache(useCaseId);
      applyAssessment(row);
      setSuccess(forceNew ? 'New assessment started.' : 'Assessment ready.');
      setShowNewModal(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to start assessment');
    } finally {
      setBusy(false);
    }
  }

  async function handleAiPrefill() {
    if (!canUpdateInProgress || !isInProgress || aiPrefilling) return;
    setAiPrefilling(true);
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const data = await api.aiPrefillUseCaseAssessment(useCaseId);
      const row = (data as { assessment: UseCaseAssessment }).assessment;
      const prefill = (data as { prefill?: { prefilled_count?: number; skipped_count?: number } }).prefill;
      invalidateAssessmentCache(useCaseId);
      applyAssessment(row);
      const filled = prefill?.prefilled_count ?? 0;
      const skipped = prefill?.skipped_count ?? 0;
      setSuccess(
        skipped > 0
          ? `AI pre-fill complete. ${filled} question(s) updated; ${skipped} left for manual review due to missing documentation.`
          : `AI pre-fill complete. ${filled} question(s) updated from use case documentation.`,
      );
    } catch (err: unknown) {
      setError(toUserFacingAiErrorMessage(err, 'AI prefill failed'));
    } finally {
      setAiPrefilling(false);
      setBusy(false);
    }
  }

  async function saveQuestion(
    templateItemId: number,
    areaId: number,
    sno: string,
    answer: LocalAnswer,
  ) {
    if (!canUpdateInProgress || !isInProgress) return;
    setSavingItemId(templateItemId);
    setError('');
    try {
      const data = await api.saveUseCaseAssessmentResponse(useCaseId, templateItemId, {
        template_item_id: templateItemId,
        area_id: areaId,
        sno,
        selected_labels: answer.selectedLabels,
        comment: answer.comment,
      });
      const row = (data as { assessment: UseCaseAssessment }).assessment;
      invalidateAssessmentCache(useCaseId);
      applyAssessment(row);
    } catch (err: any) {
      setError(err?.message || 'Failed to save response');
    } finally {
      setSavingItemId(null);
    }
  }

  function updateLocalAnswer(templateItemId: number, patch: Partial<LocalAnswer>) {
    setLocalAnswers((prev) => ({
      ...prev,
      [templateItemId]: {
        selectedLabels: prev[templateItemId]?.selectedLabels || [],
        comment: prev[templateItemId]?.comment || '',
        ...patch,
      },
    }));
  }

  function toggleAnswerLabel(templateItemId: number, label: string) {
    const current = localAnswers[templateItemId]?.selectedLabels || [];
    const exists = current.includes(label);
    updateLocalAnswer(templateItemId, {
      selectedLabels: exists ? current.filter((l) => l !== label) : [...current, label],
    });
  }

  async function handleCloseAssessment() {
    if (!canUpdateInProgress || !isInProgress) return;
    setBusy(true);
    setError('');
    try {
      const data = await api.closeUseCaseAssessment(useCaseId, {
        confirm: true,
        overall_findings: closeFindings,
      });
      const row = (data as { assessment: UseCaseAssessment }).assessment;
      invalidateAssessmentCache(useCaseId);
      applyAssessment(row);
      setShowCloseModal(false);
      setSuccess('Assessment closed. Scores and risk classification computed.');
    } catch (err: any) {
      setError(err?.message || 'Failed to close assessment');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelAssessment() {
    if (!canUpdateInProgress || !isInProgress) return;
    setBusy(true);
    setError('');
    try {
      await api.cancelUseCaseAssessment(useCaseId);
      invalidateAssessmentCache(useCaseId);
      setAssessment(null);
      setLocalAnswers({});
      setCloseFindings('');
      setShowHistory(false);
      setHistoryLoaded(false);
      setSuccess('Assessment cancelled. You can start a new assessment when ready.');
    } catch (err: any) {
      setError(err?.message || 'Failed to cancel assessment');
    } finally {
      setBusy(false);
    }
  }

  async function handleExportPdf() {
    if (!assessment || !isClosed) return;
    await exportAssessmentPdf(useCase, assessment);
  }

  if (loading && !assessment) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading assessment...
      </div>
    );
  }

  if (!assessment) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center dark:border-slate-600 dark:bg-slate-900/30">
        <ClipboardCheck className="mx-auto h-10 w-10 text-blue-600" />
        <h3 className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">Assessment Checklist</h3>
        <p className="mx-auto mt-2 max-w-lg text-sm text-slate-600 dark:text-slate-400">
          Run a Responsible AI assessment against the active effective checklist template. One assessment per use case.
          Documentation quality score must be at least {MIN_DOCUMENTATION_QUALITY_FOR_ASSESSMENT}% before starting.
        </p>
        {docQualityMessage && (
          <p className="mx-auto mt-3 max-w-lg rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            {docQualityMessage}
          </p>
        )}
        {needsAssessmentOwnerAssignment ? (
          <div className="mx-auto mt-4 max-w-lg space-y-3">
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              Assign a governance owner before starting the assessment checklist. After ROI completes, the use case
              moves to AI Assessment automatically — assignment of the governance owner is a separate step.
            </p>
            {canAssignAssessmentOwner && onAssignAssessmentOwner ? (
              <button
                type="button"
                onClick={onAssignAssessmentOwner}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                Assign governance owner
              </button>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Ask a portal admin, domain owner, or AI leader to assign a governance owner first.
              </p>
            )}
          </div>
        ) : canInitiateAssessment ? (
          <button
            type="button"
            disabled={busy || !docQualityMet}
            onClick={() => handleStart(false)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {busy ? 'Starting...' : 'Start Assessment'}
          </button>
        ) : !canContributeAssessment ? (
          <p className="mt-4 text-sm text-amber-700 dark:text-amber-300">You do not have permission to initiate assessments.</p>
        ) : (
          <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
            No assessment is in progress. A user with initiate permission must start the assessment before you can contribute.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">{assessment.template_name}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Version v{assessment.template_version_number} · Status:{' '}
            <span className="font-medium text-slate-900 dark:text-white">
              {assessment.status === 'CLOSED' ? 'Closed' : 'In Progress'}
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Initiated by {assessment.initiated_by?.user_name || '—'} on{' '}
            {assessment.initiated_dt ? new Date(assessment.initiated_dt).toLocaleString() : '—'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isInProgress && canUpdateInProgress && (
            <>
              <button
                type="button"
                disabled={busy || aiPrefilling}
                onClick={handleAiPrefill}
                className={`${secondaryButtonClass} ${aiPrefilling ? 'border-blue-400 dark:border-blue-500' : ''}`}
              >
                  {aiPrefilling ? (
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
                  ) : (
                    <Bot className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  )}
                  {aiPrefilling ? 'AI Pre-fill in progress...' : 'AI Pre-fill'}
                </button>
              {canInitiateAssessment && (
                <button
                  type="button"
                  disabled={busy || aiPrefilling}
                  onClick={() => setShowCancelModal(true)}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-700 dark:bg-slate-800 dark:text-red-300 dark:hover:bg-red-950/30"
                >
                  <X className="h-4 w-4" />
                  Cancel Assessment
                </button>
              )}
              {canInitiateAssessment && (
                <button
                  type="button"
                  disabled={busy || aiPrefilling}
                  onClick={() => setShowCloseModal(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Lock className="h-4 w-4" />
                  Close Assessment
                </button>
              )}
            </>
          )}
          {isClosed && (
            <>
              <button
                type="button"
                onClick={handleExportPdf}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
              >
                <Download className="h-4 w-4" />
                Assessment Report (PDF)
              </button>
              {canInitiateAssessment && (
                <button
                  type="button"
                  onClick={() => setShowNewModal(true)}
                  disabled={!docQualityMet || busy}
                  title={docQualityMet ? undefined : docQualityMessage || undefined}
                  className={secondaryButtonClass}
                >
                  <RefreshCw className="h-4 w-4" />
                  New Assessment
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className={`${secondaryButtonClass} ${showHistory ? 'border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/30' : ''}`}
          >
            <History className="h-4 w-4" />
            History
          </button>
        </div>
      </div>

      {aiPrefilling && (
        <div
          className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-900/20"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
          <div>
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">AI is analyzing use case documentation</p>
            <p className="mt-1 text-sm text-blue-800 dark:text-blue-200">
              Reviewing fields, data requirements, risks, and comments to pre-fill supported checklist answers. This may take a minute.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
          {success}
        </div>
      )}

      {isClosed && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-900/40">
            <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Total Score</p>
            <p className="text-xl font-semibold text-slate-900 dark:text-white">
              {assessment.total_score} / {assessment.max_score}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-900/40">
            <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Risk Classification</p>
            <p className="text-xl font-semibold text-slate-900 dark:text-white">{assessment.risk_classification || '—'}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-900/40">
            <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Next Review</p>
            <p className="text-xl font-semibold text-slate-900 dark:text-white">
              {assessment.next_review_date ? new Date(assessment.next_review_date).toLocaleDateString() : '—'}
            </p>
          </div>
        </div>
      )}

      {isClosed && assessment.overall_findings && (
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Summary Findings</h4>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{assessment.overall_findings}</p>
        </div>
      )}

      {showHistory && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-900/30">
          {historyLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading assessment history...
            </div>
          ) : (
            <>
          <h4 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Participants</h4>
          <div className="mb-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-600">
                  <th className="px-2 py-1 text-left font-medium text-slate-500 dark:text-slate-400">Name</th>
                  <th className="px-2 py-1 text-left font-medium text-slate-500 dark:text-slate-400">Role</th>
                  <th className="px-2 py-1 text-left font-medium text-slate-500 dark:text-slate-400">Last Change</th>
                </tr>
              </thead>
              <tbody>
                {(assessment.participants || []).map((p) => (
                  <tr key={p.user_id} className="border-b border-slate-100 dark:border-slate-700">
                    <td className="px-2 py-1 text-slate-700 dark:text-slate-300">{p.user_name}</td>
                    <td className="px-2 py-1 text-slate-700 dark:text-slate-300">{p.role}</td>
                    <td className="px-2 py-1 text-slate-700 dark:text-slate-300">
                      {p.last_change_dt ? new Date(p.last_change_dt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Change History</h4>
          <div className="max-h-64 overflow-y-auto text-xs">
            {(assessment.history || []).map((h) => (
              <div key={h.history_id} className="border-b border-slate-100 py-2 dark:border-slate-700">
                <p className="text-slate-700 dark:text-slate-300">
                  <span className="font-medium text-slate-900 dark:text-white">{h.sno}</span> · {h.change_action} by{' '}
                  {h.changed_by?.user_name || '—'} · {h.changed_dt ? new Date(h.changed_dt).toLocaleString() : '—'}
                </p>
                <p className="text-slate-600 dark:text-slate-400">
                  {(h.selected_answers || []).map((a) => a.label).join(', ') || 'No answers'}
                  {h.comment ? ` — ${h.comment}` : ''}
                </p>
              </div>
            ))}
          </div>
            </>
          )}
        </div>
      )}

      {areas.map((area, areaIndex) => {
        const isExpanded = expandedAreas.has(areaIndex);
        const areaSummary = assessment.area_summaries?.find((a) => a.area_id === area.area_id);
        const formDisabled = aiPrefilling || busy;
        return (
          <div key={area.area_id ?? area.seq_no} className="rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() =>
                setExpandedAreas((prev) => {
                  const next = new Set(prev);
                  if (next.has(areaIndex)) next.delete(areaIndex);
                  else next.add(areaIndex);
                  return next;
                })
              }
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-900/30"
            >
              <div className="flex items-center gap-2">
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <span className="font-semibold text-slate-900 dark:text-white">
                  Area {area.seq_no}: {area.title}
                </span>
              </div>
              {areaSummary && (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Score {areaSummary.score} / {areaSummary.max_score}
                </span>
              )}
            </button>
            {isExpanded && (
              <div className="space-y-4 border-t border-slate-200 p-4 dark:border-slate-700">
                {area.items.map((item) => {
                  const itemId = item.item_id as number;
                  const local = localAnswers[itemId] || { selectedLabels: [], comment: '' };
                  const closedScore = assessment.question_scores?.find((q) => q.template_item_id === itemId);
                  const responseMeta = assessment.responses?.[String(itemId)] || assessment.responses?.[itemId as unknown as string];
                  return (
                    <div key={itemId} className="rounded-lg bg-slate-50 p-4 dark:bg-slate-900/30">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-blue-600">{item.sno}</p>
                          <p className="text-sm font-medium text-slate-900 dark:text-white">{item.assessment_item}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{item.category}</p>
                        </div>
                        {isClosed && closedScore && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                            Score: {closedScore.score}
                          </span>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {(item.allowed_checklist_items || []).map((option) => {
                          const selected = local.selectedLabels.includes(option.label);
                          const readOnly = isClosed || !canUpdateInProgress || formDisabled;
                          return (
                            <button
                              key={option.label}
                              type="button"
                              disabled={readOnly}
                              onClick={() => !readOnly && toggleAnswerLabel(itemId, option.label)}
                              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                selected
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-white text-slate-700 ring-1 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600'
                              } ${readOnly ? 'cursor-default opacity-90' : 'hover:ring-blue-400'}`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>

                      <div className="mt-3">
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Comment</label>
                        {isClosed || !canUpdateInProgress || formDisabled ? (
                          <p className="text-sm text-slate-700 dark:text-slate-300">{local.comment || responseMeta?.comment || '—'}</p>
                        ) : (
                          <textarea
                            value={local.comment}
                            onChange={(e) => updateLocalAnswer(itemId, { comment: e.target.value })}
                            rows={2}
                            disabled={formDisabled}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                            placeholder="Rationale, justification, or notes..."
                          />
                        )}
                      </div>

                      {responseMeta?.last_modified_by && (
                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          Last updated by {responseMeta.last_modified_by.user_name}
                          {responseMeta.last_modified_dt ? ` on ${new Date(responseMeta.last_modified_dt).toLocaleString()}` : ''}
                        </p>
                      )}

                      {isInProgress && canUpdateInProgress && (
                        <button
                          type="button"
                          disabled={savingItemId === itemId || formDisabled}
                          onClick={() => saveQuestion(itemId, area.area_id as number, item.sno, local)}
                          className="mt-3 inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <Save className="h-3 w-3" />
                          {savingItemId === itemId ? 'Saving...' : 'Save Response'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <ConfirmModal
        isOpen={showCancelModal}
        title="Cancel Assessment"
        message="This will permanently delete the in-progress assessment and all saved responses for this use case. You can start a new assessment later. Continue?"
        confirmText={busy ? 'Cancelling...' : 'Cancel Assessment'}
        onConfirm={handleCancelAssessment}
        onClose={() => !busy && setShowCancelModal(false)}
      />

      <ConfirmModal
        isOpen={showCloseModal}
        title="Close Assessment"
        message="Closing will lock responses, compute question/area/overall scores, and assign risk classification. Continue?"
        confirmText={busy ? 'Closing...' : 'Close Assessment'}
        onConfirm={handleCloseAssessment}
        onClose={() => !busy && setShowCloseModal(false)}
      />

      <ConfirmModal
        isOpen={showNewModal}
        title="Start New Assessment"
        message="This replaces the closed assessment with a fresh in-progress assessment using the current active checklist. Continue?"
        confirmText={busy ? 'Starting...' : 'Start New'}
        onConfirm={() => handleStart(true)}
        onClose={() => !busy && setShowNewModal(false)}
      />
    </div>
  );
}
