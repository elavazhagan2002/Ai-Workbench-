import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Building2, ClipboardList, LayoutDashboard, UserRound } from 'lucide-react';
import {
  DonutChartCard,
  HorizontalBarChartCard,
  StatTile,
  VerticalBarChartCard,
  type CountRow,
} from '../components/DashboardCharts';
import SelectMenu from '../components/SelectMenu';

type DashboardLevel = 'enterprise' | 'domain' | 'individual';

interface EnterpriseData {
  level: string;
  domain_count: number;
  total_use_cases: number;
  by_domain: CountRow[];
  by_status: CountRow[];
  by_owner: CountRow[];
  by_quality: CountRow[];
  by_roi: CountRow[];
}

interface DomainData {
  level: string;
  available_domains: { domain_id: string; domain_name: string; domain_short_name?: string }[];
  total_use_cases: number;
  by_status: CountRow[];
  by_owner: CountRow[];
  by_quality: CountRow[];
  by_roi: CountRow[];
}

interface IndividualData {
  level: string;
  pending_task_count: number;
  initiated_count: number;
  assigned_count: number;
  pending_tasks: {
    use_case_id: string;
    domain_id?: string;
    title: string;
    status: string;
    task: string;
    section?: string;
    due_date?: string | null;
  }[];
  initiated_by_status: CountRow[];
  assigned_by_status: CountRow[];
  initiated_and_assigned_by_status: CountRow[];
  initiated_use_cases: {
    use_case_id: string;
    title: string;
    status: string;
    domain_id?: string;
    created_dt?: string | null;
  }[];
}

interface DashboardProps {
  onBack?: () => void;
  onOpenUseCase?: (
    useCaseId: string,
    section?: string | null,
    action?: string | null,
    domainId?: string | null,
  ) => void;
}

export default function Dashboard(_props: DashboardProps) {
  const { onOpenUseCase } = _props;
  const { user, hasPermission } = useAuth();
  const isAdmin = user?.role?.role_name === 'portal_admin';
  const levels = useMemo(() => {
    const list: DashboardLevel[] = [];
    if (isAdmin || hasPermission('dashboard_enterprise')) list.push('enterprise');
    if (isAdmin || hasPermission('dashboard_domain')) list.push('domain');
    if (isAdmin || hasPermission('dashboard_individual')) list.push('individual');
    return list;
  }, [hasPermission, isAdmin]);

  const [level, setLevel] = useState<DashboardLevel | null>(null);
  const [domainId, setDomainId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [enterprise, setEnterprise] = useState<EnterpriseData | null>(null);
  const [domainData, setDomainData] = useState<DomainData | null>(null);
  const [individual, setIndividual] = useState<IndividualData | null>(null);

  useEffect(() => {
    if (levels.length && !level) setLevel(levels[0]);
  }, [levels, level]);

  useEffect(() => {
    if (!level) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    const load = async () => {
      try {
        if (level === 'enterprise') {
          const data = await api.getEnterpriseDashboard();
          if (!cancelled) setEnterprise(data);
        } else if (level === 'domain') {
          const data = await api.getDomainDashboard(domainId || undefined);
          if (!cancelled) {
            setDomainData(data);
            if (!domainId && data.available_domains?.length === 1) {
              setDomainId(data.available_domains[0].domain_id);
            }
          }
        } else {
          const data = await api.getIndividualDashboard();
          if (!cancelled) setIndividual(data);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [level, domainId]);

  if (levels.length === 0) {
    return (
      <div className="wb-page">
        <p className="text-ink-muted">You do not have permission to view any dashboards.</p>
      </div>
    );
  }

  return (
    <div className="wb-page select-none">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-600 dark:text-cyan-400">
            Analytics
          </p>
          <h2 className="wb-page-title flex items-center gap-2 mt-1">
            <LayoutDashboard className="w-6 h-6 text-navy-600 dark:text-cyan-400" />
            Governance Dashboards
          </h2>
          <p className="wb-page-subtitle">
            Real-time portfolio, domain, and personal workload insights.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-line">
        {levels.map((id) => {
          const meta =
            id === 'enterprise'
              ? { label: 'Enterprise', icon: Building2 }
              : id === 'domain'
              ? { label: 'Domain', icon: Building2 }
              : { label: 'Individual', icon: UserRound };
          const Icon = meta.icon;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setLevel(id)}
              className={`wb-tab ${level === id ? 'wb-tab-active' : 'wb-tab-idle'}`}
            >
              <Icon className="w-4 h-4" />
              {meta.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {loading && (
        <div className="wb-card-pad text-sm text-ink-muted animate-pulse">Loading analytics…</div>
      )}

      {!loading && level === 'enterprise' && enterprise && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatTile label="Domains" value={enterprise.domain_count} />
            <StatTile label="Total use cases" value={enterprise.total_use_cases} />
            <StatTile
              label="In progress"
              value={enterprise.by_status
                .filter((r) => !['Approved', 'Rejected', 'Retired'].includes(r.label))
                .reduce((s, r) => s + r.count, 0)}
            />
            <StatTile
              label="Approved"
              value={enterprise.by_status.find((r) => r.label === 'Approved')?.count || 0}
            />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <VerticalBarChartCard
              title="Use cases by status"
              subtitle="Workflow distribution across the portfolio"
              rows={enterprise.by_status}
            />
            <DonutChartCard
              title="Use cases by ROI band"
              subtitle="Based on completed ROI worksheets"
              rows={enterprise.by_roi}
            />
            <DonutChartCard
              title="Documentation quality"
              subtitle="Latest quality score buckets"
              rows={enterprise.by_quality}
            />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <HorizontalBarChartCard
              title="Use cases by domain"
              subtitle="Top domains by volume"
              rows={enterprise.by_domain}
            />
            <HorizontalBarChartCard
              title="Use cases by owner"
              subtitle="Primary technical / business / stage owners"
              rows={enterprise.by_owner}
            />
          </div>
        </div>
      )}

      {!loading && level === 'domain' && domainData && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-end">
            <div className="wb-card-pad lg:col-span-2">
              <label className="wb-stat-label mb-2 block">Domain filter</label>
              <SelectMenu
                value={domainId}
                onChange={setDomainId}
                placeholder="All accessible domains"
                searchable
                options={(domainData.available_domains || []).map((d) => ({
                  value: d.domain_id,
                  label: d.domain_name,
                }))}
                aria-label="Domain filter"
              />
            </div>
            <StatTile label="Use cases" value={domainData.total_use_cases} />
            <StatTile
              label="Approved"
              value={domainData.by_status.find((r) => r.label === 'Approved')?.count || 0}
            />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <VerticalBarChartCard title="Use cases by status" rows={domainData.by_status} />
            <DonutChartCard title="Use cases by ROI" rows={domainData.by_roi} />
            <DonutChartCard title="Documentation quality" rows={domainData.by_quality} />
          </div>
          <HorizontalBarChartCard title="Use cases by owner" rows={domainData.by_owner} />
        </div>
      )}

      {!loading && level === 'individual' && individual && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatTile label="Pending tasks" value={individual.pending_task_count} />
            <StatTile label="Initiated use cases" value={individual.initiated_count} />
            <StatTile label="Assigned use cases" value={individual.assigned_count} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="wb-card-pad xl:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <ClipboardList className="w-4 h-4 text-cyan-600" />
                <h3 className="font-display text-sm font-semibold text-ink">Pending tasks</h3>
              </div>
              {individual.pending_tasks.length === 0 ? (
                <p className="text-sm text-ink-subtle italic">No open assignments.</p>
              ) : (
                <ul className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                  {individual.pending_tasks.map((t, idx) => (
                    <li key={`${t.use_case_id}-${t.task}-${idx}`}>
                      <button
                        type="button"
                        className={`w-full text-left rounded-xl border border-line bg-surface-muted/60 p-3 ${
                          onOpenUseCase ? 'cursor-pointer hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-colors' : ''
                        }`}
                        onClick={() => onOpenUseCase?.(t.use_case_id, t.section || null, null, t.domain_id || null)}
                        disabled={!onOpenUseCase}
                      >
                        <p className="text-sm font-medium text-ink">{t.task}</p>
                        <p className="text-xs text-ink-muted mt-1">
                          {t.title} · {t.status}
                        </p>
                        {t.due_date && (
                          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                            Due {new Date(t.due_date).toLocaleDateString()}
                          </p>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <VerticalBarChartCard
              title="Initiated by status"
              rows={individual.initiated_by_status}
            />
            <VerticalBarChartCard
              title="Assigned by status"
              rows={individual.assigned_by_status}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <DonutChartCard
              title="Initiated & assigned mix"
              rows={individual.initiated_and_assigned_by_status}
            />
            <div className="wb-card-pad">
              <h3 className="font-display text-sm font-semibold text-ink mb-4">Initiated use cases</h3>
              {individual.initiated_use_cases.length === 0 ? (
                <p className="text-sm text-ink-subtle italic">You have not initiated any use cases.</p>
              ) : (
                <ul className="divide-y divide-line max-h-[320px] overflow-y-auto">
                  {individual.initiated_use_cases.map((uc) => (
                    <li key={uc.use_case_id} className="py-3 flex flex-wrap justify-between gap-2 text-sm">
                      <span className="text-ink font-medium">{uc.title}</span>
                      <span className="text-xs rounded-full bg-navy-50 dark:bg-navy-900/40 text-navy-700 dark:text-cyan-300 px-2.5 py-1">
                        {uc.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
