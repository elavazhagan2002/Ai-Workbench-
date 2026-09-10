import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { X } from 'lucide-react';
import SelectMenu from './SelectMenu';

interface OwnerOption {
  user_id: string;
  user_name: string;
  user_email: string;
  role_name?: string;
}

interface SimpleAssignModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  ownerLabel: string;
  useCaseTitle: string;
  initialOwner?: string;
  initialDueDate?: string;
  saving?: boolean;
  isReassign?: boolean;
  currentOwnerLabel?: string;
  loadOwners: () => Promise<OwnerOption[]>;
  onClose: () => void;
  onAssign: (payload: { owner: string; due_date: string }) => void;
}

const ROLE_LABELS: Record<string, string> = {
  business_reviewer: 'Business reviewer',
  ai_leader: 'AI leader',
  domain_owner: 'Domain owner',
  portal_admin: 'Portal admin',
  tech_architect: 'Tech architect',
};

function formatRole(role?: string) {
  if (!role) return '';
  return ROLE_LABELS[role] || role.replace(/_/g, ' ');
}

function todayIsoDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function dateInputValue(raw?: string) {
  if (!raw) return '';
  return raw.slice(0, 10);
}

export default function SimpleAssignModal({
  open,
  title,
  subtitle,
  ownerLabel,
  useCaseTitle,
  initialOwner = '',
  initialDueDate = '',
  saving = false,
  isReassign = false,
  currentOwnerLabel,
  loadOwners,
  onClose,
  onAssign,
}: Readonly<SimpleAssignModalProps>) {
  const [owner, setOwner] = useState(initialOwner);
  const [dueDate, setDueDate] = useState(dateInputValue(initialDueDate));
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const minDate = useMemo(() => todayIsoDate(), []);

  useEffect(() => {
    if (!open) return;
    setOwner(initialOwner || '');
    setDueDate(dateInputValue(initialDueDate) || minDate);
    setError('');
    setLoading(true);
    let cancelled = false;
    loadOwners()
      .then((list) => {
        if (!cancelled) setOwners(list || []);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Failed to load owners');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, initialOwner, initialDueDate, loadOwners, minDate]);

  const ownerOptions = useMemo(
    () =>
      owners.map((u) => ({
        value: u.user_id,
        label: u.user_name,
        description: [u.user_email, formatRole(u.role_name)].filter(Boolean).join(' · '),
      })),
    [owners]
  );

  let submitLabel = 'Assign';
  if (saving) submitLabel = 'Saving…';
  else if (isReassign) submitLabel = 'Reassign';

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!owner) {
      setError(`Select ${ownerLabel}.`);
      return;
    }
    if (!owners.some((u) => u.user_id === owner)) {
      setError('Select a valid owner from the list.');
      return;
    }
    if (!dueDate) {
      setError('Select a due date.');
      return;
    }
    if (dueDate < minDate) {
      setError('Due date cannot be in the past.');
      return;
    }
    onAssign({ owner, due_date: dueDate });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-lg max-h-[90vh] flex-col overflow-hidden rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
        <div className="flex shrink-0 items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-sm">{useCaseTitle}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div data-dropdown-boundary className="wb-scroll-slim min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-5">
            {subtitle && <p className="text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>}
            {isReassign && currentOwnerLabel && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
                Currently assigned to <span className="font-semibold text-slate-900 dark:text-white">{currentOwnerLabel}</span>
              </p>
            )}
            {error && (
              <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-2">{error}</div>
            )}
            {loading ? (
              <p className="text-sm text-slate-500">Loading eligible owners…</p>
            ) : (
              <>
                <div>
                  <label htmlFor="assign-owner" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {ownerLabel} *
                  </label>
                  <SelectMenu
                    id="assign-owner"
                    value={owner}
                    onChange={setOwner}
                    required
                    placeholder="Select…"
                    options={ownerOptions}
                    aria-label={ownerLabel}
                  />
                </div>
                <div>
                  <label htmlFor="assign-due-date" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Due date *
                  </label>
                  <input
                    id="assign-due-date"
                    type="date"
                    min={minDate}
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                    required
                  />
                </div>
              </>
            )}
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3 dark:border-slate-700 dark:bg-slate-800">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300">
              Cancel
            </button>
            <button type="submit" disabled={saving || loading || owners.length === 0} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Convenience wrappers used by UseCaseEdit */
export function RoiAssignModal(
  props: Omit<SimpleAssignModalProps, 'title' | 'ownerLabel' | 'loadOwners' | 'subtitle' | 'onAssign'> & {
    domainId?: string;
    onAssign: (payload: { roi_owner: string; due_date: string }) => void;
  }
) {
  const { domainId, onAssign, isReassign, ...rest } = props;
  const loadOwners = useCallback(
    () => api.getEligibleRoiOwners(domainId),
    [domainId]
  );
  const subtitle = isReassign
    ? 'Choose who should own the ROI worksheet going forward. Only that person can edit savings.'
    : 'Select who will complete the ROI savings worksheet. Only that person can edit savings.';
  return (
    <SimpleAssignModal
      {...rest}
      isReassign={isReassign}
      title={isReassign ? 'Reassign ROI' : 'Assign ROI'}
      ownerLabel="ROI owner"
      subtitle={subtitle}
      loadOwners={loadOwners}
      onAssign={({ owner, due_date }) => onAssign({ roi_owner: owner, due_date })}
    />
  );
}

export function AssessmentAssignModal(
  props: Omit<SimpleAssignModalProps, 'title' | 'ownerLabel' | 'loadOwners' | 'subtitle' | 'onAssign'> & {
    onAssign: (payload: { assessment_owner: string; due_date: string }) => void;
  }
) {
  const { onAssign, ...rest } = props;
  const loadOwners = useCallback(() => api.getEligibleAssessmentOwners(), []);
  return (
    <SimpleAssignModal
      {...rest}
      title="Assign AI Assessment"
      ownerLabel="Governance owner"
      subtitle="Assign a governance-team member to complete the Responsible AI assessment."
      loadOwners={loadOwners}
      onAssign={({ owner, due_date }) => onAssign({ assessment_owner: owner, due_date })}
    />
  );
}
