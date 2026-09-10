import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { AuditLog } from '../types';
import { ArrowLeft, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { logger } from '../utils/logger';
import SelectMenu from '../components/SelectMenu';

interface AuditLogProps {
  onBack: () => void;
}

function formatAuditDetails(_type: string, _action: string, details: any): React.ReactNode {
  if (details == null) return <span className="text-slate-500 italic">No details</span>;
  if (typeof details !== 'object') {
    return <span className="text-slate-600 dark:text-slate-400">{String(details)}</span>;
  }

  const entries = Object.entries(details).filter(([k]) => k !== 'password' && k !== 'user_pwd');
  if (entries.length === 0) return <span className="text-slate-500 italic">No change details</span>;

  const label = (key: string) => key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <dl className="space-y-1.5">
      {entries.map(([key, value]) => {
        const displayValue =
          value === null || value === ''
            ? <span className="text-slate-400 italic">(empty)</span>
            : Array.isArray(value)
            ? value.join(', ')
            : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
        return (
          <div key={key} className="flex gap-2 flex-wrap">
            <dt className="font-medium text-slate-700 dark:text-slate-300 shrink-0">{label(key)}:</dt>
            <dd className="text-slate-600 dark:text-slate-400 break-all">{displayValue}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export default function AuditLogPage({ onBack }: AuditLogProps) {
  const { user, loading: authLoading } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage] = useState(10);

  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    // Only load logs if user is confirmed (not just from sessionStorage)
    // Wait for auth to finish loading before making API calls
    if (!authLoading && user) {
      loadLogs();
    } else if (!authLoading && !user) {
      // User not logged in, stop loading
      setLoading(false);
    }
  }, [user, authLoading]);

  useEffect(() => {
    filterLogs();
  }, [logs, searchTerm, typeFilter, dateFrom, dateTo]);

  async function loadLogs() {
    if (!user) {
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      const data = await api.getAuditLogs({ limit: 1000 });
      logger.info(`Audit logs loaded: ${data?.length || 0} records`);
      setLogs(data || []);
    } catch (err: any) {
      // If we get a 401, it means session expired - clear error and let App.tsx handle redirect
      if (err?.message?.includes('401') || err?.message?.includes('Unauthorized') || err?.message?.includes('Session expired')) {
        logger.debug('Session expired while loading audit logs');
        setLogs([]);
      } else {
        logger.error('Error loading audit logs', err);
        setLogs([]); // Set empty array on error
      }
    } finally {
      setLoading(false);
    }
  }

  function filterLogs() {
    let filtered = [...logs];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(log =>
        log.type.toLowerCase().includes(term) ||
        log.action.toLowerCase().includes(term) ||
        (log.details && JSON.stringify(log.details).toLowerCase().includes(term))
      );
    }

    if (typeFilter) {
      filtered = filtered.filter(log => log.type === typeFilter);
    }

    if (dateFrom) {
      filtered = filtered.filter(log =>
        new Date(log.audit_date) >= new Date(dateFrom)
      );
    }

    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter(log =>
        new Date(log.audit_date) <= toDate
      );
    }

    setFilteredLogs(filtered);
    setCurrentPage(1);
  }

  const totalPages = Math.ceil(filteredLogs.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const currentLogs = filteredLogs.slice(startIndex, endIndex);

  const uniqueTypes = Array.from(new Set(logs.map(log => log.type))).sort();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-600 dark:text-slate-400">Loading audit logs...</div>
      </div>
    );
  }

  return (
    <div className="wb-page">
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 mb-3 text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="wb-page-title">Audit Logs</h2>
            <p className="wb-page-subtitle">
              Total records: {filteredLogs.length}
            </p>
          </div>
        </div>
      </div>

      <div className="wb-card-pad">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-[180px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search logs..."
              className="wb-input pl-9"
            />
          </div>
          <div className="w-full min-w-0 sm:w-48">
            <SelectMenu
              value={typeFilter}
              onChange={setTypeFilter}
              variant="filter"
              searchable={false}
              placeholder="All Types"
              options={uniqueTypes.map((type) => ({ value: type, label: type }))}
              aria-label="Filter logs by type"
            />
          </div>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
          />
          {(searchTerm || typeFilter || dateFrom || dateTo) && (
            <button
              onClick={() => {
                setSearchTerm('');
                setTypeFilter('');
                setDateFrom('');
                setDateTo('');
              }}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Date & Time
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Action
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {currentLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-600 dark:text-slate-400">
                    No audit logs found
                  </td>
                </tr>
              ) : (
                currentLogs.map((log) => (
                  <tr key={log.audit_id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-white">
                      {new Date(log.audit_date).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs font-medium">
                        {log.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-white">
                      {log.action}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-white">
                      {log.user_name || (log.user_id ? log.user_id.substring(0, 8) : '-')}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                      {log.details ? (
                        <details className="cursor-pointer">
                          <summary className="hover:text-slate-900 dark:hover:text-white">
                            View details
                          </summary>
                          <div className="mt-2 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg text-xs overflow-x-auto space-y-2">
                            {formatAuditDetails(log.type, log.action, log.details)}
                          </div>
                        </details>
                      ) : (
                        <span>-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <div className="text-sm text-slate-600 dark:text-slate-400">
              Showing {startIndex + 1} to {Math.min(endIndex, filteredLogs.length)} of {filteredLogs.length} entries
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-sm">
                {currentPage} / {totalPages}
              </div>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
