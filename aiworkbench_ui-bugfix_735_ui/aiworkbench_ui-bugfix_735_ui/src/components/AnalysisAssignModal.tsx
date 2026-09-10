import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { X } from 'lucide-react';
import SelectMenu from './SelectMenu';

interface OwnerOption {
  user_id: string;
  user_name: string;
  user_email: string;
  role_name?: string;
}

interface AnalysisAssignModalProps {
  open: boolean;
  useCaseTitle: string;
  initialTechnicalOwner?: string;
  initialBusinessOwner?: string;
  initialDueDate?: string;
  /** When true, technical owner is already assigned and cannot be changed in this modal. */
  lockTechnicalOwner?: boolean;
  /** When true, business owner is already assigned and cannot be changed in this modal. */
  lockBusinessOwner?: boolean;
  saving?: boolean;
  onClose: () => void;
  onAssign: (payload: {
    technical_owner: string;
    business_owner: string;
    due_date: string;
  }) => void;
}

export default function AnalysisAssignModal({
  open,
  useCaseTitle,
  initialTechnicalOwner = '',
  initialBusinessOwner = '',
  initialDueDate = '',
  lockTechnicalOwner = false,
  lockBusinessOwner = false,
  saving = false,
  onClose,
  onAssign,
}: AnalysisAssignModalProps) {
  const [technicalOwner, setTechnicalOwner] = useState(initialTechnicalOwner);
  const [businessOwner, setBusinessOwner] = useState(initialBusinessOwner);
  const [dueDate, setDueDate] = useState(initialDueDate);
  const [architects, setArchitects] = useState<OwnerOption[]>([]);
  const [reviewers, setReviewers] = useState<OwnerOption[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isPartialReassign = lockTechnicalOwner || lockBusinessOwner;
  const title = isPartialReassign ? 'Reassign Analysis' : 'Assign Analysis';

  useEffect(() => {
    if (!open) return;
    setTechnicalOwner(initialTechnicalOwner || '');
    setBusinessOwner(initialBusinessOwner || '');
    setDueDate(initialDueDate ? initialDueDate.slice(0, 10) : '');
    setError('');
    setLoading(true);
    Promise.all([api.getEligibleTechnicalOwners(), api.getEligibleBusinessOwners()])
      .then(([tech, biz]) => {
        setArchitects(tech || []);
        setReviewers(biz || []);
      })
      .catch((err: any) => setError(err?.message || 'Failed to load owners'))
      .finally(() => setLoading(false));
  }, [open, initialTechnicalOwner, initialBusinessOwner, initialDueDate]);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!technicalOwner) {
      setError('Select a Technical Owner (tech_architect).');
      return;
    }
    if (!businessOwner) {
      setError('Select a Business Owner (business_reviewer).');
      return;
    }
    if (!dueDate) {
      setError('Select a due date.');
      return;
    }
    onAssign({
      technical_owner: technicalOwner,
      business_owner: businessOwner,
      due_date: dueDate,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-sm">{useCaseTitle}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div data-dropdown-boundary className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {isPartialReassign
              ? 'Only the unassigned track needs a new owner. The other track stays as-is.'
              : 'Select Technical Owner, Business Owner, and due date. Assignment emails are sent on Assign.'}
          </p>
          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-2">{error}</div>
          )}
          {loading ? (
            <p className="text-sm text-slate-500">Loading eligible owners…</p>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Technical Owner (tech_architect) *
                  {lockTechnicalOwner && (
                    <span className="ml-2 text-xs font-normal text-slate-500">(already assigned)</span>
                  )}
                </label>
                <SelectMenu
                  value={technicalOwner}
                  onChange={setTechnicalOwner}
                  disabled={lockTechnicalOwner}
                  required
                  placeholder="Select technical owner"
                  searchable
                  options={architects.map((u) => ({
                    value: u.user_id,
                    label: u.user_name,
                    description: u.user_email,
                  }))}
                  aria-label="Technical Owner"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Business Owner (business_reviewer) *
                  {lockBusinessOwner && (
                    <span className="ml-2 text-xs font-normal text-slate-500">(already assigned)</span>
                  )}
                </label>
                <SelectMenu
                  value={businessOwner}
                  onChange={setBusinessOwner}
                  disabled={lockBusinessOwner}
                  required
                  placeholder="Select business owner"
                  searchable
                  options={reviewers.map((u) => ({
                    value: u.user_id,
                    label: u.user_name,
                    description: u.user_email,
                  }))}
                  aria-label="Business Owner"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Due date *</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  required
                />
              </div>
            </>
          )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || loading}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
            >
              {saving ? 'Assigning…' : isPartialReassign ? 'Reassign' : 'Assign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
