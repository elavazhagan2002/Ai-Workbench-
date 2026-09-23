import type { CSSProperties } from 'react';
import { AlertCircle, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import type {
  UseCase,
  UseCaseDocumentationQualityAnalysis,
  UseCaseDocumentationQualitySummary,
} from '../types';

interface UseCaseDocumentationQualityModalProps {
  isOpen: boolean;
  useCase: Pick<UseCase, 'use_case_id' | 'use_case_name' | 'use_case_title'> | null;
  result: UseCaseDocumentationQualityAnalysis | null;
  summary: UseCaseDocumentationQualitySummary | null;
  loading: boolean;
  error: string;
  requestMode: 'loading_saved' | 'recalculating' | null;
  onClose: () => void;
  onRecalculate: () => void;
}

interface SectionDefinition {
  id: string;
  label: string;
  aliases: string[];
}

interface SectionScoreView {
  id: string;
  label: string;
  score: number | null;
  maxScore: number | null;
  reason: string;
  available: boolean;
}

const SECTION_DEFINITIONS: SectionDefinition[] = [
  { id: 'effective_title', label: 'Effective Title', aliases: ['effective title', 'effective_title', 'title quality', 'title'] },
  {
    id: 'use_case_explanation',
    label: 'Good Use case explanation',
    aliases: ['good use case explanation', 'good_use_case_explanation', 'use case explanation', 'use_case_explanation', 'description'],
  },
  {
    id: 'design_specification',
    label: 'Good Design specification',
    aliases: ['good design specification', 'good_design_specification', 'design specification', 'design_specification', 'solution design', 'solution_design'],
  },
  { id: 'risks_logged', label: 'Risks logged', aliases: ['risks logged', 'risks_logged', 'risks', 'risk log', 'risk_log'] },
  {
    id: 'data_requirements',
    label: 'Data Requirements created',
    aliases: ['data requirements created', 'data_requirements_created', 'data requirements', 'data_requirements'],
  },
  { id: 'references', label: 'References', aliases: ['references', 'reference links', 'reference_links', 'reference'] },
  { id: 'comments', label: 'Comments', aliases: ['comments', 'comment'] },
];

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getSectionIdentifier(entry: Record<string, unknown>, fallbackKey?: string): string {
  const nameCandidateKeys = ['section', 'section_name', 'name', 'label'] as const;

  for (const key of nameCandidateKeys) {
    const candidate = entry[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  return fallbackKey || '';
}

function parseSectionScore(entry: unknown): { score: number | null; maxScore: number | null; reason: string } {
  if (!entry || typeof entry !== 'object') {
    return { score: null, maxScore: null, reason: '' };
  }

  const record = entry as Record<string, unknown>;
  const reasonCandidate = record.reason;

  return {
    score: toFiniteNumber(record.score),
    maxScore: toFiniteNumber(record.max_score),
    reason: typeof reasonCandidate === 'string' ? reasonCandidate.trim() : '',
  };
}

function buildSectionViews(sectionScores: UseCaseDocumentationQualityAnalysis['section_scores']): SectionScoreView[] {
  const scoreMap = new Map<string, { score: number | null; maxScore: number | null; reason: string }>();

  if (Array.isArray(sectionScores)) {
    for (const entry of sectionScores) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const identifier = getSectionIdentifier(record);
      if (!identifier) continue;
      scoreMap.set(normalizeToken(identifier), parseSectionScore(record));
    }
  } else if (sectionScores && typeof sectionScores === 'object') {
    for (const [key, value] of Object.entries(sectionScores)) {
      if (!value || typeof value !== 'object') continue;
      const record = value as Record<string, unknown>;
      const parsedScore = parseSectionScore(record);
      scoreMap.set(normalizeToken(getSectionIdentifier(record, key)), parsedScore);
      scoreMap.set(normalizeToken(key), parsedScore);
    }
  }

  return SECTION_DEFINITIONS.map((definition) => {
    const match = definition.aliases
      .map((alias) => scoreMap.get(normalizeToken(alias)))
      .find((candidate) => candidate != null);

    return {
      id: definition.id,
      label: definition.label,
      score: match?.score ?? null,
      maxScore: match?.maxScore ?? null,
      reason: match?.reason || 'No feedback returned for this section.',
      available: Boolean(match),
    };
  });
}

function getScoreTone(score: number | null) {
  if (score == null) {
    return {
      chip: 'border-slate-300/80 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300',
      ring: 'rgba(148,163,184,0.75)',
      panel: 'border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/40',
      text: 'text-slate-700 dark:text-slate-300',
      descriptor: 'Not scored',
    };
  }

  if (score >= 80) {
    return {
      chip: 'border-emerald-400/35 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200',
      ring: 'rgba(16,185,129,0.85)',
      panel: 'border-emerald-400/25 bg-emerald-500/8 dark:border-emerald-400/20 dark:bg-emerald-400/8',
      text: 'text-emerald-700 dark:text-emerald-200',
      descriptor: 'Strong',
    };
  }

  if (score >= 60) {
    return {
      chip: 'border-amber-400/35 bg-amber-500/10 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200',
      ring: 'rgba(245,158,11,0.85)',
      panel: 'border-amber-400/25 bg-amber-500/8 dark:border-amber-400/20 dark:bg-amber-400/8',
      text: 'text-amber-700 dark:text-amber-200',
      descriptor: 'Moderate',
    };
  }

  return {
    chip: 'border-rose-400/35 bg-rose-500/10 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200',
    ring: 'rgba(244,63,94,0.85)',
    panel: 'border-rose-400/25 bg-rose-500/8 dark:border-rose-400/20 dark:bg-rose-400/8',
    text: 'text-rose-700 dark:text-rose-200',
    descriptor: 'Needs work',
  };
}

function getScoreRingStyle(score: number | null): CSSProperties {
  const tone = getScoreTone(score);
  const safeScore = score == null ? 0 : Math.max(0, Math.min(100, score));
  const degrees = Math.round((safeScore / 100) * 360);

  return {
    background: `conic-gradient(${tone.ring} ${degrees}deg, rgba(148,163,184,0.18) ${degrees}deg 360deg)`,
  };
}

function formatUseCaseLabel(useCase: Pick<UseCase, 'use_case_name' | 'use_case_title'>) {
  return useCase.use_case_title?.trim() || useCase.use_case_name;
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

function renderList(items: string[], emptyMessage: string) {
  if (items.length === 0) {
    return <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">{emptyMessage}</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li
          key={`${item}-${index}`}
          className="break-words rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm leading-6 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function UseCaseDocumentationQualityModal({
  isOpen,
  useCase,
  result,
  summary,
  loading,
  error,
  requestMode,
  onClose,
  onRecalculate,
}: UseCaseDocumentationQualityModalProps) {
  if (!isOpen || !useCase) return null;

  const overallScore = toFiniteNumber(result?.overall_score ?? null);
  const overallTone = getScoreTone(overallScore);
  const sections = buildSectionViews(result?.section_scores ?? {});
  const strengths = result?.strengths ?? [];
  const improvementSuggestions = result?.improvement_suggestions ?? [];
  const useCaseLabel = formatUseCaseLabel(useCase);
  const effectiveSummary = result?.documentation_quality_summary ?? summary;
  const strengthsCount = effectiveSummary?.strengths_count ?? strengths.length;
  const improvementsCount = effectiveSummary?.improvements_count ?? improvementSuggestions.length;
  const statusLabel = effectiveSummary?.status_label || overallTone.descriptor;
  const analyzedAtLabel = formatDocumentationQualityTimestamp(effectiveSummary?.analyzed_at);
  const loadingLabel =
    requestMode === 'loading_saved'
      ? 'Loading the latest saved analysis...'
      : result
        ? 'Refreshing the latest analysis...'
        : 'Analyzing documentation quality...';

  return (
    <div className="wb-app-overlay z-50 flex items-stretch justify-center bg-black/70 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="documentation-quality-title"
        className="relative flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800 sm:h-auto sm:max-h-[min(92dvh,56rem)] sm:rounded-xl sm:border"
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-slate-200 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4 dark:border-slate-700">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 sm:tracking-[0.22em] dark:text-slate-400">
              AI Documentation Quality
            </p>
            <h3
              id="documentation-quality-title"
              className="mt-1 break-words text-lg font-bold leading-snug text-slate-900 sm:text-xl dark:text-white"
            >
              {useCaseLabel}
            </h3>
            {useCase.use_case_title && useCase.use_case_title !== useCase.use_case_name && (
              <p className="mt-1 break-all text-sm text-slate-500 dark:text-slate-400">{useCase.use_case_name}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            aria-label="Close documentation quality modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          <div className="space-y-5 sm:space-y-6">
            {loading && (
              <div className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-800 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-100">
                <div className="flex items-start gap-2 font-medium">
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                  <span>{loadingLabel}</span>
                </div>
                <p className="mt-1 text-blue-700/90 dark:text-blue-100/80">
                  {requestMode === 'loading_saved'
                    ? 'Checking for the latest persisted backend analysis before you decide whether to recalculate.'
                    : 'Reviewing the use case title, explanation, design, risks, data requirements, references, and comments.'}
                </p>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-100">
                <div className="flex items-start gap-2 font-medium">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  Analysis could not be completed
                </div>
                <p className="mt-1 break-words">{error}</p>
                {!result && (
                  <button
                    type="button"
                    onClick={onRecalculate}
                    disabled={loading}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-400/30 px-3 py-2 text-sm text-red-800 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto dark:border-red-400/30 dark:text-red-100 dark:hover:bg-red-400/10"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Retry
                  </button>
                )}
              </div>
            )}

            {!result && !loading && !error && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-5 text-center sm:p-6 dark:border-slate-700 dark:bg-slate-900/40">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                  <Sparkles className="h-5 w-5" />
                </div>
                <h4 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">No saved analysis yet</h4>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                  Start an on-demand review to score this use case and persist strengths plus improvement areas for future page loads.
                </p>
                <button
                  type="button"
                  onClick={onRecalculate}
                  disabled={loading}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Run analysis
                </button>
              </div>
            )}

            {result && (
              <>
                <div className="grid gap-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)] lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-6">
                  <div className={`rounded-xl border p-4 sm:p-6 ${overallTone.panel}`}>
                    <div className="flex flex-row items-center gap-4 text-left sm:flex-col sm:text-center">
                      <div
                        className="relative h-24 w-24 shrink-0 rounded-full p-[8px] sm:h-32 sm:w-32 sm:p-[10px]"
                        style={getScoreRingStyle(overallScore)}
                      >
                        <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-white dark:bg-slate-900">
                          <span className="text-2xl font-bold text-slate-900 sm:text-3xl dark:text-white">
                            {overallScore != null ? Math.round(overallScore) : 'N/A'}
                          </span>
                          <span className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-500 sm:mt-1 sm:text-xs sm:tracking-[0.18em] dark:text-slate-400">
                            / 100
                          </span>
                        </div>
                      </div>
                      <div className="min-w-0 flex-1 sm:flex-none">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${overallTone.chip}`}>
                          {statusLabel}
                        </span>
                        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                          Latest saved documentation quality score.
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Analyzed {analyzedAtLabel}
                        </p>
                        {effectiveSummary?.is_stale && (
                          <p className="mt-2 inline-flex rounded-full border border-amber-300/60 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
                            Saved analysis may be stale
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4 dark:border-slate-700 dark:bg-slate-900/40">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:text-xs sm:tracking-[0.18em] dark:text-slate-400">
                        Strengths
                      </p>
                      <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{strengthsCount}</p>
                      <p className="mt-1 hidden text-sm text-slate-600 sm:block dark:text-slate-400">
                        Positive signals identified in the analysis.
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4 dark:border-slate-700 dark:bg-slate-900/40">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:text-xs sm:tracking-[0.18em] dark:text-slate-400">
                        Improvements
                      </p>
                      <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{improvementsCount}</p>
                      <p className="mt-1 hidden text-sm text-slate-600 sm:block dark:text-slate-400">
                        Actionable suggestions generated for this review.
                      </p>
                    </div>
                    <div className="col-span-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4 dark:border-slate-700 dark:bg-slate-900/40">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:text-xs sm:tracking-[0.18em] dark:text-slate-400">
                        Saved analysis
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                        This view loads the latest saved backend analysis first. Use Recalculate to save a fresh score and update the card summary.
                      </p>
                    </div>
                  </div>
                </div>

                <section>
                  <div className="mb-3">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Section breakdown</h4>
                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                      Section-level scoring and reasons returned by the backend analysis.
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {sections.map((section) => {
                      const ratioScore =
                        section.score != null && section.maxScore != null && section.maxScore > 0
                          ? (section.score / section.maxScore) * 100
                          : null;
                      const sectionTone = getScoreTone(ratioScore);

                      return (
                        <div
                          key={section.id}
                          className={`rounded-xl border p-3 sm:p-4 ${section.available ? sectionTone.panel : 'border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-900/40'}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <h5 className="min-w-0 text-sm font-semibold text-slate-900 dark:text-white">
                              {section.label}
                            </h5>
                            <span
                              className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                                section.available
                                  ? sectionTone.chip
                                  : 'border-slate-300/80 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
                              }`}
                            >
                              {section.score != null && section.maxScore != null
                                ? `${section.score}/${section.maxScore}`
                                : 'N/A'}
                            </span>
                          </div>
                          <p className="mt-2 break-words text-sm leading-6 text-slate-600 dark:text-slate-400">
                            {section.reason}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <div className="grid gap-4 lg:grid-cols-2">
                  <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-900/30">
                    <div className="mb-3 flex items-center gap-2 sm:mb-4">
                      <Sparkles className={`h-4 w-4 shrink-0 ${overallTone.text}`} />
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Strengths</h4>
                    </div>
                    {renderList(strengths, 'No strengths were returned for this analysis.')}
                  </section>

                  <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-900/30">
                    <div className="mb-3 flex items-center gap-2 sm:mb-4">
                      <AlertCircle className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-300" />
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Improvement suggestions</h4>
                    </div>
                    {renderList(improvementSuggestions, 'No improvement suggestions were returned for this analysis.')}
                  </section>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:gap-3 sm:px-6 sm:py-4 dark:border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 sm:w-auto dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Close
          </button>
          {result ? (
            <button
              type="button"
              onClick={onRecalculate}
              disabled={loading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Recalculate
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
