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

interface EstimateAssignModalProps {
  open: boolean;
  useCaseTitle: string;
  domainId?: string;
  /** Defaults to prior technical analyst */
  initialEstimateOwner?: string;
  initialDueDate?: string;
  saving?: boolean;
  onClose: () => void;
  onAssign: (payload: { estimate_owner: string; due_date: string }) => void;
}

export default function EstimateAssignModal({
  open,
  useCaseTitle,
  domainId,
  initialEstimateOwner = '',
  initialDueDate = '',
  saving = false,
  onClose,
  onAssign,
}: EstimateAssignModalProps) {
  const [estimateOwner, setEstimateOwner] = useState(initialEstimateOwner);
  const [dueDate, setDueDate] = useState(initialDueDate);
  const [architects, setArchitects] = useState<OwnerOption[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEstimateOwner(initialEstimateOwner || '');
    setDueDate(initialDueDate ? initialDueDate.slice(0, 10) : '');
    setError('');
    setLoading(true);
    api
      .getEligibleTechnicalOwners(domainId)
      .then((tech) => setArchitects(tech || []))
      .catch((err: any) => setError(err?.message || 'Failed to load owners'))
      .finally(() => setLoading(false));
  }, [open, domainId, initialEstimateOwner, initialDueDate]);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!estimateOwner) {
      setError('Select an Estimate owner (tech_architect).');
      return;
    }
    if (!architects.some((u) => u.user_id === estimateOwner)) {
      setError('Select an estimate owner who has access to this domain.');
      return;
    }
    if (!dueDate) {
      setError('Select a due date.');
      return;
    }
    onAssign({ estimate_owner: estimateOwner, due_date: dueDate });
  }

  return (
    <div className="wb-modal-overlay">
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Assign Estimate</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-sm">{useCaseTitle}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div data-dropdown-boundary className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Defaults to the technical analyst who performed Analysis. Only tech_architect users with access to this domain are listed.
            Base and analysis information become locked in Estimate.
          </p>
          {!loading && architects.length === 0 && (
            <div className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2">
              No tech_architect users have access to this domain. Grant domain access first, then assign.
            </div>
          )}
          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-2">{error}</div>
          )}
          {loading ? (
            <p className="text-sm text-slate-500">Loading eligible owners…</p>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Estimate owner (tech_architect) *
                </label>
                <SelectMenu
                  value={estimateOwner}
                  onChange={setEstimateOwner}
                  required
                  placeholder="Select estimate owner"
                  searchable
                  options={architects.map((u) => ({
                    value: u.user_id,
                    label: u.user_name,
                    description: u.user_email,
                  }))}
                  aria-label="Estimate owner"
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
              disabled={saving || loading || architects.length === 0}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
            >
              {saving ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
