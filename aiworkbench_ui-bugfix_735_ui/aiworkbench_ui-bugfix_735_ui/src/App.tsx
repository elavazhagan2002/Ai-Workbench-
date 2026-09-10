import { useEffect, useLayoutEffect, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Login from './pages/Login';
import Header from './components/Header';
import Domains from './pages/Domains';
import UseCases from './pages/UseCases';
import UseCaseDetail from './pages/UseCaseDetail';
import UseCaseEdit from './pages/UseCaseEdit';
import AuditLog from './pages/AuditLog';
import Settings from './pages/Settings';
import Blogs from './pages/Blogs';
import Dashboard from './pages/Dashboard';
import { api } from './lib/api';
import type { UseCase } from './types';
import { UserCheck, UserX, X } from 'lucide-react';

type Page = 'domains' | 'usecases' | 'usecase-detail' | 'usecase-edit' | 'audit' | 'settings' | 'blogs' | 'dashboard';
type ShellMode = 'auth' | 'app';

const HASH_PREFIX = '#/';
const ROOT_LAYOUT_RESET_PROPERTIES = [
  'overflow',
  'overflow-x',
  'overflow-y',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'min-height',
  'max-width',
  'padding-right',
  'margin-right',
  'transform',
  'transform-origin',
  'scale',
  'zoom',
  'font-size',
] as const;

function getShellTargets(): HTMLElement[] {
  if (typeof document === 'undefined') return [];

  const targets: HTMLElement[] = [document.documentElement, document.body];
  const root = document.getElementById('root');

  if (root) {
    targets.push(root);
  }

  return targets;
}

function syncShellMode(mode: ShellMode) {
  if (typeof document === 'undefined') return;

  getShellTargets().forEach((target) => {
    target.setAttribute('data-shell', mode);
    ROOT_LAYOUT_RESET_PROPERTIES.forEach((property) => {
      target.style.removeProperty(property);
    });
  });

  if (mode === 'auth') {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }

    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }
}

function resetAuthRoute() {
  if (typeof window === 'undefined') return;

  const nextUrl = `${window.location.pathname}${window.location.search}${HASH_PREFIX}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (currentUrl !== nextUrl) {
    window.history.replaceState(null, '', nextUrl);
  }
}

function ShellModeController({ mode }: { mode: ShellMode }) {
  useLayoutEffect(() => {
    syncShellMode(mode);

    return () => {
      getShellTargets().forEach((target) => {
        target.removeAttribute('data-shell');
      });
    };
  }, [mode]);

  return null;
}

function parseHash(): { page: Page; domainId: string | null; useCaseId: string | null } {
  const hash = window.location.hash.slice(1);
  if (!hash || hash === '/') return { page: 'dashboard', domainId: null, useCaseId: null };
  const parts = hash.replace(/^\/+|\/+$/g, '').split('/');
  if (parts[0] === 'audit') return { page: 'audit', domainId: null, useCaseId: null };
  if (parts[0] === 'settings') return { page: 'settings', domainId: null, useCaseId: null };
  if (parts[0] === 'blogs') return { page: 'blogs', domainId: null, useCaseId: null };
  if (parts[0] === 'dashboard') return { page: 'dashboard', domainId: null, useCaseId: null };
  if (parts[0] === 'domains') return { page: 'domains', domainId: null, useCaseId: null };
  if (parts[0] === 'd' && parts[1]) {
    const domainId = parts[1];
    if (parts[2] === 'u' && parts[3]) {
      const useCaseId = parts[3];
      if (parts[4] === 'edit') return { page: 'usecase-edit', domainId, useCaseId };
      return { page: 'usecase-detail', domainId, useCaseId };
    }
    return { page: 'usecases', domainId, useCaseId: null };
  }
  if (parts[0] === 'u' && parts[1]) {
    const useCaseId = parts[1];
    if (parts[2] === 'edit') return { page: 'usecase-edit', domainId: null, useCaseId };
    return { page: 'usecase-detail', domainId: null, useCaseId };
  }
  return { page: 'dashboard', domainId: null, useCaseId: null };
}

function buildHash(page: Page, domainId: string | null, useCaseId: string | null): string {
  if (page === 'dashboard') return HASH_PREFIX;
  if (page === 'domains') return `${HASH_PREFIX}domains`;
  if (page === 'audit') return `${HASH_PREFIX}audit`;
  if (page === 'settings') return `${HASH_PREFIX}settings`;
  if (page === 'blogs') return `${HASH_PREFIX}blogs`;
  if (page === 'usecases' && domainId) return `${HASH_PREFIX}d/${domainId}`;
  if (page === 'usecase-detail' && useCaseId) {
    if (domainId) return `${HASH_PREFIX}d/${domainId}/u/${useCaseId}`;
    return `${HASH_PREFIX}u/${useCaseId}`;
  }
  if (page === 'usecase-edit' && useCaseId) {
    if (domainId) return `${HASH_PREFIX}d/${domainId}/u/${useCaseId}/edit`;
    return `${HASH_PREFIX}u/${useCaseId}/edit`;
  }
  return HASH_PREFIX;
}

interface PendingUser {
  user_id: string;
  user_name: string;
  user_email: string;
  organization?: string | null;
  organization_type?: string | null;
  role_name?: string | null;
  interested_domain_id?: string | null;
  interested_domain_name?: string | null;
  registration_status?: string | null;
}

type UseCaseStatusFilter = 'All' | UseCase['status'];

function AppContent() {
  const initialRoute = parseHash();
  const { user, loading, hasPermission } = useAuth();
  const [currentPage, setCurrentPage] = useState<Page>(initialRoute.page);
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(initialRoute.domainId);
  const [selectedUseCaseId, setSelectedUseCaseId] = useState<string | null>(initialRoute.useCaseId);
  const [selectedUseCaseDetailTab, setSelectedUseCaseDetailTab] = useState<'overview' | 'assessment'>('overview');
  const [selectedUseCaseStatus, setSelectedUseCaseStatus] = useState<UseCaseStatusFilter>('All');
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [showPendingModal, setShowPendingModal] = useState(true);
  const [selectedPendingIds, setSelectedPendingIds] = useState<Set<string>>(new Set());
  const [approvingPending, setApprovingPending] = useState(false);

  const canManageSettings = hasPermission('settings_access');

  useEffect(() => {
    if (loading || user) return;

    setCurrentPage('dashboard');
    setSelectedDomainId(null);
    setSelectedUseCaseId(null);
    setSelectedUseCaseStatus('All');
    setPendingUsers([]);
    setShowPendingModal(true);
    setSelectedPendingIds(new Set());
    setApprovingPending(false);
    resetAuthRoute();
  }, [loading, user]);

  // Restore state from the URL hash once auth has finished resolving.
  useEffect(() => {
    if (loading) return;

    const { page, domainId, useCaseId } = parseHash();
    if (!user) {
      return;
    }
    setCurrentPage(page);
    setSelectedDomainId(domainId);
    setSelectedUseCaseId(useCaseId);
  }, [loading, user]);

  // Sync state to URL hash when user navigates (so URL reflects current view)
  useEffect(() => {
    if (loading || !user) return;

    const newHash = buildHash(currentPage, selectedDomainId, selectedUseCaseId);
    if (window.location.hash !== newHash) {
      const isInitial = !window.location.hash || window.location.hash === '#' || window.location.hash === '#/';
      const useReplace = isInitial && newHash === HASH_PREFIX;
      window.history[useReplace ? 'replaceState' : 'pushState'](null, '', newHash);
    }
  }, [loading, user, currentPage, selectedDomainId, selectedUseCaseId]);

  // Browser back/forward: restore state from hash
  useEffect(() => {
    const syncFromHash = () => {
      if (loading) return;

      const { page, domainId, useCaseId } = parseHash();
      if (!user) return;

      setCurrentPage(page);
      setSelectedDomainId(domainId);
      setSelectedUseCaseId(useCaseId);
    };
    window.addEventListener('popstate', syncFromHash);
    window.addEventListener('hashchange', syncFromHash);
    return () => {
      window.removeEventListener('popstate', syncFromHash);
      window.removeEventListener('hashchange', syncFromHash);
    };
  }, [loading, user]);

  useEffect(() => {
    if (!user || !canManageSettings) return;
    api.getPendingUsers()
      .then((list) => setPendingUsers((list || []) as PendingUser[]))
      .catch(() => setPendingUsers([]));
  }, [user, canManageSettings]);

  async function handleApprovePending(userIds: string[]) {
    if (userIds.length === 0) return;
    setApprovingPending(true);
    try {
      await api.approveUsers(userIds);
      const list = await api.getPendingUsers();
      setPendingUsers((list || []) as PendingUser[]);
      setSelectedPendingIds(new Set());
      if (!(list?.length)) setShowPendingModal(false);
    } finally {
      setApprovingPending(false);
    }
  }

  async function handleRejectPending(userIds: string[]) {
    if (userIds.length === 0) return;
    setApprovingPending(true);
    try {
      await api.rejectUsers(userIds);
      const list = await api.getPendingUsers();
      setPendingUsers((list || []) as PendingUser[]);
      setSelectedPendingIds(new Set());
      if (!(list?.length)) setShowPendingModal(false);
    } finally {
      setApprovingPending(false);
    }
  }

  function toggleSelectAllPending() {
    if (selectedPendingIds.size === pendingUsers.length) {
      setSelectedPendingIds(new Set());
    } else {
      setSelectedPendingIds(new Set(pendingUsers.map((u) => u.user_id)));
    }
  }

  function handleSelectDomain(domainId: string, statusFilter: UseCaseStatusFilter) {
    setSelectedUseCaseId(null);
    setSelectedUseCaseDetailTab('overview');
    setSelectedDomainId(domainId);
    setSelectedUseCaseStatus(statusFilter);
    setCurrentPage('usecases');
  }

  function handleViewUseCase(useCaseId: string, tab: 'overview' | 'assessment' = 'overview') {
    setSelectedUseCaseId(useCaseId);
    setSelectedUseCaseDetailTab(tab);
    setCurrentPage('usecase-detail');
  }

  function handleEditUseCase(useCaseId: string) {
    setSelectedUseCaseId(useCaseId);
    setCurrentPage('usecase-edit');
  }

  function handleBackToDomains() {
    setSelectedDomainId(null);
    setSelectedUseCaseId(null);
    setSelectedUseCaseDetailTab('overview');
    setCurrentPage('domains');
  }

  function handleGoHome() {
    setSelectedDomainId(null);
    setSelectedUseCaseId(null);
    setSelectedUseCaseDetailTab('overview');
    const canDashboard =
      hasPermission('dashboard_enterprise') ||
      hasPermission('dashboard_domain') ||
      hasPermission('dashboard_individual') ||
      user?.role?.role_name === 'portal_admin';
    setCurrentPage(canDashboard ? 'dashboard' : 'domains');
  }

  function handleBackToUseCases() {
    setSelectedUseCaseId(null);
    setSelectedUseCaseDetailTab('overview');
    if (selectedDomainId) setCurrentPage('usecases');
    else handleBackToDomains();
  }

  function handleNavigate(page: 'domains' | 'audit' | 'settings' | 'blogs' | 'dashboard') {
    if (page === 'domains') {
      handleBackToDomains();
    } else if (page === 'dashboard') {
      handleGoHome();
    } else {
      setCurrentPage(page);
    }
  }

  // If landed on dashboard without permission, fall back to Domains
  useEffect(() => {
    if (loading || !user || currentPage !== 'dashboard') return;
    const canDashboard =
      hasPermission('dashboard_enterprise') ||
      hasPermission('dashboard_domain') ||
      hasPermission('dashboard_individual') ||
      user?.role?.role_name === 'portal_admin';
    if (!canDashboard) setCurrentPage('domains');
  }, [loading, user, currentPage, hasPermission]);

  if (loading) {
    return (
      <>
        <ShellModeController mode="auth" />
        <div className="wb-shell flex items-center justify-center">
          <div className="text-ink-muted font-medium tracking-tight">Loading workbench…</div>
        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <ShellModeController mode="auth" />
        <Login />
      </>
    );
  }

  return (
    <>
      <ShellModeController mode="app" />
      <div className="wb-shell">
        {showPendingModal && pendingUsers.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-4xl w-full max-h-[85vh] flex flex-col border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UserCheck className="w-6 h-6 text-blue-600" />
                New registrations pending approval
              </h2>
              <button
                type="button"
                onClick={() => setShowPendingModal(false)}
                className="p-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-auto flex-1 p-4">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="pb-2 pr-2">
                      <input
                        type="checkbox"
                        checked={pendingUsers.length > 0 && selectedPendingIds.size === pendingUsers.length}
                        onChange={toggleSelectAllPending}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                    </th>
                    <th className="pb-2 font-semibold text-slate-700 dark:text-slate-300">Name</th>
                    <th className="pb-2 font-semibold text-slate-700 dark:text-slate-300">Email</th>
                    <th className="pb-2 font-semibold text-slate-700 dark:text-slate-300">Organization</th>
                    <th className="pb-2 font-semibold text-slate-700 dark:text-slate-300">Org type</th>
                    <th className="pb-2 font-semibold text-slate-700 dark:text-slate-300">Interested domain</th>
                    <th className="pb-2 font-semibold text-slate-700 dark:text-slate-300">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingUsers.map((u) => (
                    <tr key={u.user_id} className="border-b border-slate-100 dark:border-slate-700/50">
                      <td className="py-2 pr-2">
                        <input
                          type="checkbox"
                          checked={selectedPendingIds.has(u.user_id)}
                          onChange={() => {
                            setSelectedPendingIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(u.user_id)) next.delete(u.user_id);
                              else next.add(u.user_id);
                              return next;
                            });
                          }}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="py-2 text-slate-900 dark:text-white">{u.user_name}</td>
                      <td className="py-2 text-slate-600 dark:text-slate-400">{u.user_email}</td>
                      <td className="py-2 text-slate-600 dark:text-slate-400">{u.organization || '—'}</td>
                      <td className="py-2 text-slate-600 dark:text-slate-400">{u.organization_type || '—'}</td>
                      <td className="py-2 text-slate-600 dark:text-slate-400">{u.interested_domain_name || u.interested_domain_id || '—'}</td>
                      <td className="py-2 text-slate-600 dark:text-slate-400">{u.role_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-4 p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 rounded-b-xl">
              <button
                type="button"
                onClick={() => setShowPendingModal(false)}
                className="px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Close
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={approvingPending || selectedPendingIds.size === 0}
                  onClick={() => handleRejectPending(Array.from(selectedPendingIds))}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <UserX className="w-4 h-4" />
                  Reject selected ({selectedPendingIds.size})
                </button>
                <button
                  type="button"
                  disabled={approvingPending || selectedPendingIds.size === 0}
                  onClick={() => handleApprovePending(Array.from(selectedPendingIds))}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <UserCheck className="w-4 h-4" />
                  Approve selected ({selectedPendingIds.size})
                </button>
                <button
                  type="button"
                  disabled={approvingPending}
                  onClick={() => handleApprovePending(pendingUsers.map((u) => u.user_id))}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Approve all ({pendingUsers.length})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

        <Header onNavigate={handleNavigate} currentPage={currentPage} />

      <main className="flex-1 w-full min-h-0">
        {currentPage === 'domains' && (
          <Domains
            onSelectDomain={handleSelectDomain}
            selectedStatus={selectedUseCaseStatus}
            onStatusChange={setSelectedUseCaseStatus}
          />
        )}

        {currentPage === 'usecases' && selectedDomainId && (
          <UseCases
            domainId={selectedDomainId}
            onBack={handleBackToDomains}
            onViewUseCase={handleViewUseCase}
            onEditUseCase={handleEditUseCase}
            selectedStatus={selectedUseCaseStatus}
            onStatusChange={setSelectedUseCaseStatus}
          />
        )}

        {currentPage === 'usecase-detail' && selectedUseCaseId && (
          <UseCaseDetail
            useCaseId={selectedUseCaseId}
            onBack={handleBackToUseCases}
            initialTab={selectedUseCaseDetailTab === 'assessment' ? 'assessment' : 'overview'}
          />
        )}

        {currentPage === 'usecase-edit' && selectedUseCaseId && (
          <UseCaseEdit
            useCaseId={selectedUseCaseId}
            onBack={handleBackToUseCases}
          />
        )}

        {currentPage === 'audit' && (
          hasPermission('audit_access') ? (
            <AuditLog onBack={handleBackToDomains} />
          ) : (
            <div className="p-8 text-center">
              <p className="text-slate-600 dark:text-slate-400">You do not have permission to access audit logs.</p>
              <button type="button" onClick={handleBackToDomains} className="mt-4 text-blue-600 dark:text-blue-400 hover:underline">Back to Domains</button>
            </div>
          )
        )}

        {currentPage === 'dashboard' && (
          (hasPermission('dashboard_enterprise') ||
            hasPermission('dashboard_domain') ||
            hasPermission('dashboard_individual') ||
            user?.role?.role_name === 'portal_admin') ? (
            <Dashboard onBack={handleBackToDomains} />
          ) : (
            <div className="p-8 text-center">
              <p className="text-slate-600 dark:text-slate-400">You do not have permission to access dashboards.</p>
              <button type="button" onClick={handleBackToDomains} className="mt-4 text-blue-600 dark:text-blue-400 hover:underline">Back to Domains</button>
            </div>
          )
        )}

        {currentPage === 'settings' && (
          hasPermission('settings_access') ? (
            <Settings onBack={handleBackToDomains} />
          ) : (
            <div className="p-8 text-center">
              <p className="text-slate-600 dark:text-slate-400">You do not have permission to access settings.</p>
              <button type="button" onClick={handleBackToDomains} className="mt-4 text-blue-600 dark:text-blue-400 hover:underline">Back to Domains</button>
            </div>
          )
        )}

        {currentPage === 'blogs' && <Blogs onBack={handleBackToDomains} />}
      </main>
      </div>
    </>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
