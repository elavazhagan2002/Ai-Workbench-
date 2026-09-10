import type { UseCase } from '../types';

/** Status -> workflow permission required to transition into that status. */
export const STATUS_TO_WORKFLOW_PERMISSION: Record<string, string> = {
  New: 'workflow_new',
  Analysis: 'workflow_analysis',
  Review: 'workflow_review',
  Estimate: 'workflow_estimate',
  ROI: 'workflow_roi',
  'AI Assessment': 'workflow_ai_assessment',
  Approved: 'workflow_approved',
  Rejected: 'workflow_rejected',
};

const LINEAR_STATES: UseCase['status'][] = [
  'New',
  'Analysis',
  'Review',
  'Estimate',
  'ROI',
  'AI Assessment',
];
const TERMINAL_STATES: UseCase['status'][] = ['Approved', 'Rejected'];

/** Allowed next status per current status (non-portal_admin workflow). Reject anytime. */
export const WORKFLOW_NEXT: Record<string, string[]> = {
  New: ['Analysis', 'Rejected'],
  Analysis: ['Review', 'Rejected'],
  Review: ['Estimate', 'Rejected'],
  Estimate: ['ROI', 'Rejected'],
  ROI: ['AI Assessment', 'Rejected'],
  'AI Assessment': ['Approved', 'Rejected'],
  Approved: [],
  Rejected: [],
};

interface UseCaseStateViewProps {
  currentStatus: UseCase['status'];
  /** When set, status boxes are clickable to transition. */
  interactive?: boolean;
  /** Allowed next statuses (already filtered by permissions). */
  allowedNext?: string[];
  /** When true, Approve is allowed. When false, Approve is disabled. */
  allRisksClosed?: boolean;
  /** Callback when user clicks a next status (not used for Rejected). */
  onTransition?: (newStatus: UseCase['status']) => void;
  /** Callback when user clicks Rejected (opens rejection reason modal). */
  onRejectClick?: () => void;
  /** While a transition is in progress. */
  transitioning?: boolean;
}

function StatusBox({
  status,
  isActive,
  isPast,
  clickable,
  disabled,
  title,
  onClick,
  tone = 'default',
}: {
  status: string;
  isActive: boolean;
  isPast: boolean;
  clickable: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  tone?: 'default' | 'reject' | 'approve';
}) {
  const clickableClasses =
    tone === 'reject'
      ? 'bg-red-50/80 dark:bg-red-950/25 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 cursor-pointer border border-red-300 dark:border-red-700'
      : tone === 'approve'
      ? 'bg-emerald-50/80 dark:bg-emerald-950/25 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 cursor-pointer border border-emerald-300 dark:border-emerald-700'
      : 'bg-slate-50 dark:bg-slate-700/50 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600/60 cursor-pointer border border-blue-300 dark:border-blue-500/60';

  const activeClasses =
    status === 'Rejected'
      ? 'bg-red-600 text-white shadow-md ring-2 ring-red-400/30 border border-red-500'
      : status === 'Approved'
      ? 'bg-emerald-600 text-white shadow-md ring-2 ring-emerald-400/30 border border-emerald-500'
      : 'bg-blue-600 text-white shadow-md ring-2 ring-blue-400/35 border border-blue-500';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || (!clickable && !isActive && !isPast)}
      title={title}
      aria-current={isActive ? 'step' : undefined}
      className={`relative px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
        isActive
          ? activeClasses
          : isPast
          ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 border border-green-300 dark:border-green-700'
          : clickable && !disabled
          ? clickableClasses
          : 'bg-slate-100 dark:bg-slate-800/80 text-slate-400 dark:text-slate-500 border border-transparent opacity-70'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      {isActive && (
        <span
          className={`absolute -top-2 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white leading-none shadow ${
            status === 'Rejected'
              ? 'bg-red-500'
              : status === 'Approved'
              ? 'bg-emerald-500'
              : 'bg-blue-500 dark:bg-blue-400'
          }`}
        >
          Current
        </span>
      )}
      {clickable && !disabled && !isActive && tone === 'default' && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-slate-500 dark:bg-slate-400 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white dark:text-slate-900 leading-none">
          Next
        </span>
      )}
      {status}
    </button>
  );
}

export default function UseCaseStateView({
  currentStatus,
  interactive = false,
  allowedNext = [],
  allRisksClosed = true,
  onTransition,
  onRejectClick,
  transitioning = false,
}: UseCaseStateViewProps) {
  const currentIdx = LINEAR_STATES.indexOf(currentStatus as (typeof LINEAR_STATES)[number]);
  const isTerminal = currentStatus === 'Approved' || currentStatus === 'Rejected';
  const canClick = interactive && !transitioning;
  const nextLinear = LINEAR_STATES.find((s) => allowedNext.includes(s));

  const handleClick = (status: string) => {
    if (!canClick || !allowedNext.includes(status)) return;
    if (status === 'Rejected' && onRejectClick) {
      onRejectClick();
      return;
    }
    if (status === 'Approved' && !allRisksClosed) return;
    if (onTransition) onTransition(status as UseCase['status']);
  };

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Use Case Status</p>
        {interactive && !isTerminal && (
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-600 ring-2 ring-blue-400/50" />
              Current
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border border-blue-400 bg-slate-200 dark:bg-slate-600" />
              Next step (click)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
              Done
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pt-2">
        {LINEAR_STATES.map((status, idx) => {
          const isActive = currentStatus === status;
          const isPast = currentIdx > idx;
          const isNext = allowedNext.includes(status);
          const clickable = interactive && !isTerminal && isNext;
          return (
            <div key={status} className="flex items-center flex-shrink-0">
              {idx > 0 && (
                <div
                  className={`w-4 h-0.5 mx-0.5 ${
                    isPast
                      ? 'bg-green-400 dark:bg-green-600'
                      : isActive || (clickable && status === nextLinear)
                      ? 'bg-blue-400 dark:bg-blue-500'
                      : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                />
              )}
              <StatusBox
                status={status}
                isActive={isActive}
                isPast={isPast}
                clickable={clickable}
                title={
                  isActive
                    ? `Current status: ${status}`
                    : clickable
                    ? `Click to move to ${status}`
                    : undefined
                }
                onClick={() => handleClick(status)}
              />
            </div>
          );
        })}
        {/* Connector to Approved | Rejected */}
        <div
          className={`w-4 h-0.5 mx-0.5 ${
            isTerminal ? 'bg-green-400 dark:bg-green-600' : 'bg-slate-300 dark:bg-slate-600'
          }`}
        />
        <div className="flex items-center gap-1">
          {TERMINAL_STATES.map((status) => {
            const isActive = currentStatus === status;
            const isPast = false;
            const isNext = allowedNext.includes(status);
            const approveDisabled = status === 'Approved' && !allRisksClosed;
            const clickable = canClick && !isTerminal && isNext && (status !== 'Approved' || !approveDisabled);
            return (
              <StatusBox
                key={status}
                status={status}
                isActive={isActive}
                isPast={isPast}
                clickable={clickable}
                disabled={approveDisabled}
                tone={status === 'Rejected' ? 'reject' : status === 'Approved' ? 'approve' : 'default'}
                title={
                  approveDisabled && status === 'Approved'
                    ? 'Close all risks before approving'
                    : status === 'Rejected' && clickable
                    ? 'Reject this use case (reason required)'
                    : status === 'Approved' && clickable
                    ? 'Click to approve this use case'
                    : isActive
                    ? `Current status: ${status}`
                    : undefined
                }
                onClick={() => handleClick(status)}
              />
            );
          })}
        </div>
      </div>
      {interactive && !isTerminal && nextLinear && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
          Next action: click <span className="font-medium text-slate-700 dark:text-slate-200">{nextLinear}</span> to continue the workflow.
        </p>
      )}
      {interactive && allowedNext.includes('Approved') && !allRisksClosed && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
          Close all risks before approving.
        </p>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
        Analysis covers Technical and Business tracks (auto-advances to Review when both complete).
        Estimate and ROI completions auto-advance to the next stage. Click <span className="font-medium">Rejected</span> anytime (with permission) to close with a reason.
      </p>
    </div>
  );
}
