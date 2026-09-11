import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { History } from 'lucide-react';

interface AuditEntry {
  audit_id: string;
  audit_date: string;
  type: string;
  action: string;
  user_id?: string;
  user_name?: string;
  details?: Record<string, unknown>;
}

const ACTION_LABELS: Record<string, string> = {
  create: 'Created use case',
  update: 'Updated use case',
  delete: 'Deleted use case',
  move: 'Moved domain',
  status_change: 'Status changed',
  approve: 'Approved',
  reject: 'Rejected',
  analysis_assign: 'Analysis assigned',
  analysis_complete: 'Analysis track completed',
  analysis_send_back: 'Analysis sent back from Review',
  estimate_assign: 'Estimate assigned',
  estimate_save: 'Estimate saved',
  estimate_complete: 'Estimate completed → ROI',
  roi_assign: 'ROI assigned',
  roi_save: 'ROI saved',
  roi_complete: 'ROI completed → AI Assessment',
  assessment_assign: 'AI Assessment assigned',
  assessment_complete: 'AI Assessment assignment completed',
  assessment_checklist_initiate: 'Assessment checklist initiated',
  assessment_checklist_close: 'Assessment checklist closed',
  demo_delink: 'Demo delinked',
};

function summarizeDetails(action: string, details?: Record<string, unknown>): string {
  if (!details) return '';
  const parts: string[] = [];
  if (details.from_status && details.to_status) {
    parts.push(`${details.from_status} → ${details.to_status}`);
  } else if (details.to_status || details.status) {
    parts.push(`Status: ${details.to_status || details.status}`);
  }
  if (details.track) parts.push(`Track: ${details.track}`);
  if (details.technical_owner) parts.push('Technical owner set');
  if (details.business_owner) parts.push('Business owner set');
  if (details.estimate_owner) parts.push('Estimate owner set');
  if (details.roi_owner) parts.push('ROI owner set');
  if (details.assessment_owner) parts.push('Assessment owner set');
  if (details.roi_percent != null) parts.push(`ROI %: ${details.roi_percent}`);
  if (details.rejection_reason) parts.push(`Reason: ${String(details.rejection_reason).slice(0, 120)}`);
  if (details.note) parts.push(`Note: ${String(details.note).slice(0, 120)}`);
  if (details.due_date) parts.push(`Due: ${String(details.due_date).slice(0, 10)}`);
  if (action === 'move' && details.target_domain_id) parts.push('Domain moved');
  return parts.join(' · ');
}

interface UseCaseAuditTrailProps {
  useCaseId: string;
  refreshKey?: string | number;
}

export default function UseCaseAuditTrail({ useCaseId, refreshKey }: UseCaseAuditTrailProps) {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .getUseCaseAuditLogs(useCaseId)
      .then((data) => {
        if (cancelled) return;
        const sorted = [...(data || [])].sort(
          (a, b) => new Date(b.audit_date).getTime() - new Date(a.audit_date).getTime()
        );
        setLogs(sorted);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Failed to load audit trail');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [useCaseId, refreshKey]);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
      <div className="flex items-center gap-2">
        <History className="w-5 h-5 text-slate-500" />
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Audit trail</h3>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Chronological record of actions performed on this use case.
      </p>
      {loading && <p className="text-sm text-slate-500">Loading audit trail…</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!loading && !error && logs.length === 0 && (
        <p className="text-sm text-slate-500 italic">No audit events recorded yet.</p>
      )}
      {!loading && logs.length > 0 && (
        <ul className="space-y-3 max-h-[480px] overflow-y-auto">
          {logs.map((log) => {
            const label = ACTION_LABELS[log.action] || log.action;
            const summary = summarizeDetails(log.action, log.details);
            return (
              <li
                key={log.audit_id}
                className="border-l-2 border-slate-200 dark:border-slate-600 pl-3 py-1"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{label}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {log.audit_date ? new Date(log.audit_date).toLocaleString() : ''}
                  </p>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  {log.user_name || log.user_id || 'System'}
                  {summary ? ` · ${summary}` : ''}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
