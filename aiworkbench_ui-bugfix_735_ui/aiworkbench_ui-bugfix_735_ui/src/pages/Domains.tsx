import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Domain, UseCase } from '../types';
import { Plus, Edit2, Trash2, FileText, ArrowLeft, Users, UserPlus, Search, X, Filter } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import Toast from '../components/Toast';
import SelectMenu from '../components/SelectMenu';
import { logger } from '../utils/logger';

interface DomainsProps {
  onSelectDomain: (domainId: string, statusFilter: UseCaseStatusFilter) => void;
  selectedStatus: UseCaseStatusFilter;
  onStatusChange: (status: UseCaseStatusFilter) => void;
}

type UseCaseStatusFilter = 'All' | UseCase['status'];

type DomainAccessUser = {
  user_id: string;
  user_name: string;
  user_email: string;
};

type AccessPanelPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  connectorLeft: number;
  placement: 'top' | 'bottom';
};

const USE_CASE_STATUS_OPTIONS: UseCaseStatusFilter[] = [
  'All',
  'New',
  'Analysis',
  'Review',
  'Estimate',
  'ROI',
  'AI Assessment',
  'Approved',
  'Rejected',
];

const ACCESS_PANEL_GAP = 8;
const ACCESS_PANEL_VIEWPORT_PADDING = 16;
const ACCESS_PANEL_CONNECTOR_HALF_WIDTH = 20;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getScrollParents(element: HTMLElement | null): Array<HTMLElement | Window> {
  const parents = new Set<HTMLElement | Window>([window]);
  let current = element?.parentElement ?? null;

  while (current && current !== document.body) {
    const { overflowX, overflowY } = window.getComputedStyle(current);
    if (/(auto|scroll|overlay)/.test(`${overflowX} ${overflowY}`)) {
      parents.add(current);
    }
    current = current.parentElement;
  }

  return Array.from(parents);
}

export default function Domains({ onSelectDomain, selectedStatus, onStatusChange }: DomainsProps) {
  const { user, hasPermission, loading: authLoading } = useAuth();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [useCaseCounts, setUseCaseCounts] = useState<Record<string, number>>({});
  const [useCaseStatusesByDomain, setUseCaseStatusesByDomain] = useState<Record<string, UseCase['status'][]>>({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingDomain, setEditingDomain] = useState<Domain | null>(null);
  const [formData, setFormData] = useState({
    domain_short_name: '',
    domain_name: '',
    domain_detail: '',
    owner_id: '' as string
  });
  const [error, setError] = useState('');
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; domain: Domain | null }>({
    isOpen: false,
    domain: null
  });
  const [eligibleOwners, setEligibleOwners] = useState<{ user_id: string; user_name: string; user_email: string }[]>([]);
  const [eligibleAccessUsers, setEligibleAccessUsers] = useState<DomainAccessUser[]>([]);
  const [domainAccessList, setDomainAccessList] = useState<DomainAccessUser[]>([]);
  const [assignUserId, setAssignUserId] = useState('');
  const [accessLoading, setAccessLoading] = useState(false);
  const [activeDomainId, setActiveDomainId] = useState<string | null>(null);
  const activeDomainIdRef = useRef<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const domainCardRefs = useRef(new Map<string, HTMLDivElement>());
  const accessTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const activeAccessCardRef = useRef<HTMLDivElement | null>(null);
  const activeAccessTriggerRef = useRef<HTMLButtonElement | null>(null);
  const accessPanelRef = useRef<HTMLDivElement | null>(null);
  const accessPanelFrameRef = useRef<number | null>(null);
  const [accessPanelPosition, setAccessPanelPosition] = useState<AccessPanelPosition | null>(null);

  const q = searchQuery.trim().toLowerCase();
  const filteredDomains = domains.filter((d) => {
    const name = (d.domain_name ?? '').toLowerCase();
    const shortName = (d.domain_short_name ?? '').toLowerCase();
    const detail = (d.domain_detail ?? '').toLowerCase();
    const matchesSearch = !q || name.includes(q) || shortName.includes(q) || detail.includes(q);
    const matchesStatus = selectedStatus === 'All'
      || (useCaseStatusesByDomain[d.domain_id] ?? []).includes(selectedStatus);

    return matchesSearch && matchesStatus;
  });
  const isActiveDomainVisible = activeDomainId
    ? filteredDomains.some((domain) => domain.domain_id === activeDomainId)
    : false;

  useEffect(() => {
    if (activeDomainId && !isActiveDomainVisible) {
      closeAccessPanel();
    }
  }, [activeDomainId, isActiveDomainVisible]);

  useEffect(() => {
    return () => {
      if (accessPanelFrameRef.current !== null) {
        window.cancelAnimationFrame(accessPanelFrameRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (!activeDomainId) {
      setAccessPanelPosition(null);
      return;
    }

    scheduleAccessPanelPositionUpdate();
  }, [activeDomainId, accessLoading, error, domainAccessList.length, eligibleAccessUsers.length]);

  useEffect(() => {
    if (!activeDomainId) return;

    const { activeCard, activeTrigger } = getActiveAccessAnchors(activeDomainId);

    const handleViewportChange = () => {
      scheduleAccessPanelPositionUpdate();
    };

    const scrollParents = new Set<HTMLElement | Window>([
      ...getScrollParents(activeCard),
      ...getScrollParents(activeTrigger)
    ]);

    window.addEventListener('resize', handleViewportChange);
    scrollParents.forEach((target) => {
      target.addEventListener('scroll', handleViewportChange, { passive: true });
    });
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        scheduleAccessPanelPositionUpdate();
      });

      if (activeCard) {
        resizeObserver.observe(activeCard);
      }
      if (activeTrigger) {
        resizeObserver.observe(activeTrigger);
      }
      if (accessPanelRef.current) {
        resizeObserver.observe(accessPanelRef.current);
      }
    }

    scheduleAccessPanelPositionUpdate();

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      scrollParents.forEach((target) => {
        target.removeEventListener('scroll', handleViewportChange);
      });
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
      resizeObserver?.disconnect();

      if (accessPanelFrameRef.current !== null) {
        window.cancelAnimationFrame(accessPanelFrameRef.current);
        accessPanelFrameRef.current = null;
      }
    };
  }, [activeDomainId]);

  useEffect(() => {
    // Only load domains if user is confirmed and has domain_access
    if (!authLoading && user) {
      if (!hasPermission('domain_access')) {
        setLoading(false);
        setDomains([]);
        return;
      }
      loadDomains();
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [user, authLoading, hasPermission]);

  async function loadDomains() {
    if (!user) {
      setLoading(false);
      return;
    }
    
    try {
      const data = await api.getDomains();
      setDomains(data || []);
      setError('');
      
      // Load use case counts for each domain
      if (data && data.length > 0) {
        loadUseCaseCounts(data);
      }
    } catch (err: any) {
      logger.error('Error loading domains', err);
      // If we get a 401, it means session expired - clear error and let App.tsx handle redirect
      if (err?.message?.includes('401') || err?.message?.includes('Unauthorized') || err?.message?.includes('Session expired')) {
        setError('');
        // The AuthContext will handle clearing the user state
      } else {
        setError('Failed to load domains. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadUseCaseCounts(domainsList: Domain[]) {
    const counts: Record<string, number> = {};
    const statusesByDomain: Record<string, UseCase['status'][]> = {};
    
    // Fetch use case counts for each domain in parallel
    const countPromises = domainsList.map(async (domain) => {
      try {
        const useCases = await api.getUseCases(domain.domain_id) as UseCase[];
        counts[domain.domain_id] = Array.isArray(useCases) ? useCases.length : 0;
        statusesByDomain[domain.domain_id] = Array.isArray(useCases)
          ? Array.from(new Set(useCases.map((useCase) => useCase.status).filter(Boolean)))
          : [];
      } catch (err) {
        // If we can't fetch use cases (e.g., no permission), set count to 0
        counts[domain.domain_id] = 0;
        statusesByDomain[domain.domain_id] = [];
      }
    });
    
    await Promise.all(countPromises);
    setUseCaseCounts(counts);
    setUseCaseStatusesByDomain(statusesByDomain);
  }

  async function openCreateModal() {
    closeAccessPanel();
    setEditingDomain(null);
    const defaultOwnerId = user && eligibleOwners.some((o) => o.user_id === user.user_id) ? user.user_id : '';
    setFormData({ domain_short_name: '', domain_name: '', domain_detail: '', owner_id: defaultOwnerId });
    setError('');
    setShowModal(true);
    try {
      const owners = await api.getEligibleDomainOwners();
      setEligibleOwners(owners || []);
      const defaultOwner = user && (owners || []).some((o: { user_id: string }) => o.user_id === user.user_id) ? user.user_id : '';
      setFormData((prev) => ({ ...prev, owner_id: defaultOwner }));
    } catch (err: any) {
      logger.error('Error loading eligible owners', err);
      setEligibleOwners([]);
    }
  }

  async function openEditModal(domain: Domain) {
    closeAccessPanel();
    setEditingDomain(domain);
    setFormData({
      domain_short_name: domain.domain_short_name,
      domain_name: domain.domain_name,
      domain_detail: domain.domain_detail || '',
      owner_id: domain.owner_id || ''
    });
    setError('');
    setShowModal(true);
    try {
      const [owners] = await Promise.all([api.getEligibleDomainOwners()]);
      setEligibleOwners(owners || []);
    } catch (err: any) {
      logger.error('Error loading domain edit data', err);
      setEligibleOwners([]);
    }
  }

  function getActiveAccessAnchors(domainId: string) {
    const mappedCard = domainCardRefs.current.get(domainId) ?? null;
    const mappedTrigger = accessTriggerRefs.current.get(domainId) ?? null;
    const fallbackCard = activeAccessCardRef.current?.dataset.domainId === domainId
      ? activeAccessCardRef.current
      : null;
    const fallbackTrigger = activeAccessTriggerRef.current?.dataset.domainId === domainId
      ? activeAccessTriggerRef.current
      : null;
    const activeCard = mappedCard?.isConnected ? mappedCard : fallbackCard;
    const activeTrigger = mappedTrigger?.isConnected ? mappedTrigger : fallbackTrigger;

    activeAccessCardRef.current = activeCard?.isConnected ? activeCard : null;
    activeAccessTriggerRef.current = activeTrigger?.isConnected ? activeTrigger : null;

    return {
      activeCard: activeAccessCardRef.current,
      activeTrigger: activeAccessTriggerRef.current
    };
  }

  function setActiveAccessAnchors(domainId: string | null, trigger?: HTMLButtonElement | null) {
    if (!domainId) {
      activeAccessCardRef.current = null;
      activeAccessTriggerRef.current = null;
      return;
    }

    activeAccessCardRef.current = domainCardRefs.current.get(domainId) ?? null;
    activeAccessTriggerRef.current = trigger ?? accessTriggerRefs.current.get(domainId) ?? null;
  }

  async function toggleAccessPanel(domain: Domain, trigger: HTMLButtonElement) {
    if (activeDomainIdRef.current === domain.domain_id) {
      closeAccessPanel();
      return;
    }

    if (accessPanelFrameRef.current !== null) {
      window.cancelAnimationFrame(accessPanelFrameRef.current);
      accessPanelFrameRef.current = null;
    }

    activeDomainIdRef.current = domain.domain_id;
    setActiveAccessAnchors(domain.domain_id, trigger);
    setAccessPanelPosition(null);
    setActiveDomainId(domain.domain_id);
    setAssignUserId('');
    setError('');
    setAccessLoading(true);
    setEligibleAccessUsers([]);
    setDomainAccessList([]);

    try {
      const [accessUsers, accessList] = await Promise.all([
        api.getEligibleDomainAccessUsers(),
        api.getDomainAccess(domain.domain_id)
      ]);

      if (activeDomainIdRef.current !== domain.domain_id) return;

      setEligibleAccessUsers(accessUsers || []);
      setDomainAccessList(accessList || []);
    } catch (err: any) {
      if (activeDomainIdRef.current !== domain.domain_id) return;

      logger.error('Error loading domain access data', err);
      setEligibleAccessUsers([]);
      setDomainAccessList([]);
      setError(err.message || 'Failed to load domain access details.');
    } finally {
      if (activeDomainIdRef.current === domain.domain_id) {
        setAccessLoading(false);
      }
    }
  }

  function closeAccessPanel() {
    if (accessPanelFrameRef.current !== null) {
      window.cancelAnimationFrame(accessPanelFrameRef.current);
      accessPanelFrameRef.current = null;
    }

    activeDomainIdRef.current = null;
    setActiveAccessAnchors(null);
    setActiveDomainId(null);
    setAccessPanelPosition(null);
    setAccessLoading(false);
    setAssignUserId('');
    setEligibleAccessUsers([]);
    setDomainAccessList([]);
    setError('');
  }

  function syncAccessPanelPosition() {
    const domainId = activeDomainIdRef.current;
    const panel = accessPanelRef.current;

    if (!domainId || !panel) {
      setAccessPanelPosition((current) => (current ? null : current));
      return;
    }

    const { activeCard, activeTrigger } = getActiveAccessAnchors(domainId);
    if (!activeCard || !activeTrigger) {
      setAccessPanelPosition((current) => (current ? null : current));
      return;
    }

    const cardRect = activeCard.getBoundingClientRect();
    const triggerRect = activeTrigger.getBoundingClientRect();
    if (cardRect.width <= 0 || cardRect.height <= 0 || triggerRect.width <= 0 || triggerRect.height <= 0) {
      setAccessPanelPosition((current) => (current ? null : current));
      return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const availableWidth = Math.max(viewportWidth - ACCESS_PANEL_VIEWPORT_PADDING * 2, 0);
    const width = availableWidth > 0 ? Math.min(cardRect.width, availableWidth) : cardRect.width;
    panel.style.width = `${Math.round(width)}px`;
    const naturalHeight = panel.scrollHeight;
    const availableBelow = Math.max(
      viewportHeight - cardRect.bottom - ACCESS_PANEL_GAP - ACCESS_PANEL_VIEWPORT_PADDING,
      0
    );
    const availableAbove = Math.max(cardRect.top - ACCESS_PANEL_GAP - ACCESS_PANEL_VIEWPORT_PADDING, 0);
    const placeBelow = naturalHeight <= availableBelow || availableBelow >= availableAbove;
    const maxHeight = Math.max(placeBelow ? availableBelow : availableAbove, 0);
    const renderedHeight = Math.min(naturalHeight, maxHeight);
    const maxLeft = Math.max(ACCESS_PANEL_VIEWPORT_PADDING, viewportWidth - width - ACCESS_PANEL_VIEWPORT_PADDING);
    const minLeft = ACCESS_PANEL_VIEWPORT_PADDING;
    const left = clamp(cardRect.right - width, minLeft, maxLeft);
    const anchorCenter = triggerRect.left + (triggerRect.width / 2);
    const top = placeBelow
      ? clamp(
          cardRect.bottom + ACCESS_PANEL_GAP,
          ACCESS_PANEL_VIEWPORT_PADDING,
          Math.max(ACCESS_PANEL_VIEWPORT_PADDING, viewportHeight - ACCESS_PANEL_VIEWPORT_PADDING - renderedHeight)
        )
      : clamp(
          cardRect.top - ACCESS_PANEL_GAP - renderedHeight,
          ACCESS_PANEL_VIEWPORT_PADDING,
          Math.max(ACCESS_PANEL_VIEWPORT_PADDING, viewportHeight - ACCESS_PANEL_VIEWPORT_PADDING - renderedHeight)
        );
    const connectorLeft = clamp(
      anchorCenter - left,
      ACCESS_PANEL_CONNECTOR_HALF_WIDTH + 8,
      Math.max(ACCESS_PANEL_CONNECTOR_HALF_WIDTH + 8, width - ACCESS_PANEL_CONNECTOR_HALF_WIDTH - 8)
    );

    const nextPosition: AccessPanelPosition = {
      top: Math.round(top),
      left: Math.round(left),
      width: Math.round(width),
      maxHeight: Math.round(maxHeight),
      connectorLeft: Math.round(connectorLeft),
      placement: placeBelow ? 'bottom' : 'top'
    };

    setAccessPanelPosition((current) => (
      current
        && current.top === nextPosition.top
        && current.left === nextPosition.left
        && current.width === nextPosition.width
        && current.maxHeight === nextPosition.maxHeight
        && current.connectorLeft === nextPosition.connectorLeft
        && current.placement === nextPosition.placement
        ? current
        : nextPosition
    ));
  }

  function scheduleAccessPanelPositionUpdate() {
    if (accessPanelFrameRef.current !== null) {
      window.cancelAnimationFrame(accessPanelFrameRef.current);
    }

    accessPanelFrameRef.current = window.requestAnimationFrame(() => {
      accessPanelFrameRef.current = null;
      syncAccessPanelPosition();
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!user) return;

    try {
      if (editingDomain) {
        const payload: { domain_short_name?: string; domain_name?: string; domain_detail?: string; owner_id?: string | null } = {
          domain_short_name: formData.domain_short_name,
          domain_name: formData.domain_name,
          domain_detail: formData.domain_detail || undefined
        };
        if (formData.owner_id !== undefined) payload.owner_id = formData.owner_id || null;
        await api.updateDomain(editingDomain.domain_id, payload);
      } else {
        await api.createDomain({
          domain_short_name: formData.domain_short_name,
          domain_name: formData.domain_name,
          domain_detail: formData.domain_detail || undefined,
          owner_id: formData.owner_id || undefined
        });
      }

      setShowModal(false);
      loadDomains();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleAddDomainAccess() {
    const domainId = activeDomainId;
    if (!domainId || !assignUserId) return;
    setAccessLoading(true);
    setError('');
    try {
      await api.addDomainAccess(domainId, assignUserId);
      const list = await api.getDomainAccess(domainId);
      if (activeDomainIdRef.current !== domainId) return;
      setDomainAccessList(list || []);
      setAssignUserId('');
    } catch (err: any) {
      if (activeDomainIdRef.current !== domainId) return;
      setError(err.message);
    } finally {
      if (activeDomainIdRef.current === domainId) {
        setAccessLoading(false);
      }
    }
  }

  async function handleRemoveDomainAccess(userId: string) {
    const domainId = activeDomainId;
    if (!domainId) return;
    setAccessLoading(true);
    setError('');
    try {
      await api.removeDomainAccess(domainId, userId);
      const list = await api.getDomainAccess(domainId);
      if (activeDomainIdRef.current !== domainId) return;
      setDomainAccessList(list || []);
    } catch (err: any) {
      if (activeDomainIdRef.current !== domainId) return;
      setError(err.message);
    } finally {
      if (activeDomainIdRef.current === domainId) {
        setAccessLoading(false);
      }
    }
  }

  async function handleDelete() {
    if (!deleteModal.domain || !user) return;
    
    try {
      if (deleteModal.domain.domain_id === activeDomainIdRef.current) {
        closeAccessPanel();
      }
      await api.deleteDomain(deleteModal.domain.domain_id);
      loadDomains();
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-600 dark:text-slate-400">Loading domains...</div>
      </div>
    );
  }

  if (user && !hasPermission('domain_access')) {
    return (
      <div className="wb-page">
        <div>
          <h2 className="wb-page-title">Domains</h2>
          <p className="wb-page-subtitle">You do not have permission to access domains.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="wb-page">
      <div>
        <h2 className="wb-page-title">Domains</h2>
        <p className="wb-page-subtitle">Manage your business domains and AI use cases</p>
      </div>

      {!showModal && (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search domains by name, short name, or description..."
                className="wb-input pl-9 pr-8"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink-subtle hover:text-ink rounded"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="w-[16.5rem] shrink-0">
              <SelectMenu
                value={selectedStatus}
                onChange={(status) => onStatusChange(status as UseCaseStatusFilter)}
                variant="filter"
                searchable={false}
                leadingIcon={<Filter className="w-4 h-4" />}
                options={USE_CASE_STATUS_OPTIONS.map((status) => ({
                  value: status,
                  label: status === 'All' ? 'All statuses' : status,
                }))}
                aria-label="Filter domains by use case status"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {hasPermission('create_domain') && (
              <button
                onClick={openCreateModal}
                className="h-full min-h-[220px] border-2 border-dashed border-line rounded-2xl p-8 hover:border-cyan-500 hover:bg-cyan-500/5 transition-all group"
              >
                <div className="flex flex-col items-center justify-center gap-3">
                  <div className="p-4 bg-surface-muted rounded-full group-hover:bg-cyan-500/15 transition-colors">
                    <Plus className="w-8 h-8 text-ink-subtle group-hover:text-cyan-600 dark:group-hover:text-cyan-400" />
                  </div>
                  <span className="font-medium text-ink-muted group-hover:text-cyan-600 dark:group-hover:text-cyan-400">
                    Create New Domain
                  </span>
                </div>
              </button>
            )}

          {filteredDomains.map((domain) => (
            <div
              key={domain.domain_id}
              data-domain-id={domain.domain_id}
              ref={(node) => {
                if (node) {
                  domainCardRefs.current.set(domain.domain_id, node);
                  if (activeDomainIdRef.current === domain.domain_id) {
                    activeAccessCardRef.current = node;
                  }
                } else {
                  domainCardRefs.current.delete(domain.domain_id);
                  if (activeDomainIdRef.current === domain.domain_id) {
                    activeAccessCardRef.current = null;
                  }
                }
              }}
              className="h-full"
            >
              <div
                onClick={() => {
                  if (activeDomainId === domain.domain_id) return;
                  void api
                    .recordUiNavigationEvent({
                      action: 'domain_opened',
                      domain_id: domain.domain_id,
                      domain_name: domain.domain_name,
                      domain_short_name: domain.domain_short_name,
                    })
                    .catch(() => {});
                  onSelectDomain(domain.domain_id, selectedStatus);
                }}
                className={`flex h-full flex-col wb-card p-6 transition-all relative ${
                  activeDomainId === domain.domain_id
                    ? 'border-cyan-500 shadow-panel ring-1 ring-cyan-500/30'
                    : 'hover:shadow-panel hover:border-cyan-400/60 cursor-pointer'
                }`}
              >
                <div className="mb-4 flex shrink-0 items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 inline-block rounded-full bg-navy-100 px-3 py-1 text-sm font-medium text-navy-700 dark:bg-navy-900/40 dark:text-cyan-300">
                      {domain.domain_short_name}
                    </div>
                    <h3 className="mb-2 line-clamp-2 font-display text-lg font-semibold text-ink">
                      {domain.domain_name}
                    </h3>
                  </div>
                  <div 
                    className="flex gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {(hasPermission('edit_domain') || domain.owner_id === user?.user_id) && (
                      <>
                        {(domain.owner_id === user?.user_id || (hasPermission('settings_access') && hasPermission('edit_domain'))) && (
                          <button
                            data-domain-id={domain.domain_id}
                            ref={(node) => {
                              if (node) {
                                accessTriggerRefs.current.set(domain.domain_id, node);
                                if (activeDomainIdRef.current === domain.domain_id) {
                                  activeAccessTriggerRef.current = node;
                                }
                              } else {
                                accessTriggerRefs.current.delete(domain.domain_id);
                                if (activeDomainIdRef.current === domain.domain_id) {
                                  activeAccessTriggerRef.current = null;
                                }
                              }
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleAccessPanel(domain, e.currentTarget);
                            }}
                            className={`p-2 rounded-lg transition-colors ${
                              activeDomainId === domain.domain_id
                                ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-200/80 shadow-sm dark:bg-blue-900/20 dark:text-blue-300 dark:ring-blue-500/40'
                                : 'text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                            }`}
                            title="Assign users to this domain"
                            aria-expanded={activeDomainId === domain.domain_id}
                            aria-controls={`assign-users-${domain.domain_id}`}
                          >
                            <Users className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditModal(domain);
                          }}
                          className="p-2 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          title="Edit domain"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    {hasPermission('delete_domain') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteModal({ isOpen: true, domain });
                        }}
                        className="p-2 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                        title="Delete domain"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <p className="mb-4 min-h-[3.75rem] flex-1 text-sm text-slate-600 line-clamp-3 dark:text-slate-400">
                  {domain.domain_detail || 'No description available'}
                </p>

                <div 
                  className="mt-auto flex shrink-0 items-center gap-2 text-sm text-slate-500 dark:text-slate-400"
                  onClick={(e) => e.stopPropagation()}
                >
                  <FileText className="w-4 h-4" />
                  <span>
                    {useCaseCounts[domain.domain_id] !== undefined 
                      ? `${useCaseCounts[domain.domain_id]} use case${useCaseCounts[domain.domain_id] !== 1 ? 's' : ''}`
                      : 'Loading...'}
                  </span>
                </div>
              </div>
            </div>
          ))}
          </div>

          {!filteredDomains.length && domains.length > 0 && (
            <div className="mt-4 text-sm text-slate-600 dark:text-slate-400">
              No domains match the current search or status filter. Try a different combination or clear the filters.
            </div>
          )}
        </>
      )}

      {activeDomainId && typeof document !== 'undefined' && createPortal(
        <div
          ref={accessPanelRef}
          id={`assign-users-${activeDomainId}`}
          role="dialog"
          aria-modal="false"
          className={`fixed z-[60] flex min-h-0 flex-col overflow-visible rounded-xl border border-blue-400 bg-white/95 p-4 shadow-xl backdrop-blur-sm transition-opacity dark:border-blue-500 dark:bg-slate-800/95 ${
            accessPanelPosition?.placement === 'top' ? 'origin-bottom-right' : 'origin-top-right'
          } ${accessPanelPosition ? 'opacity-100' : 'opacity-0'}`}
          style={{
            top: accessPanelPosition?.top ?? ACCESS_PANEL_VIEWPORT_PADDING,
            left: accessPanelPosition?.left ?? ACCESS_PANEL_VIEWPORT_PADDING,
            width: accessPanelPosition?.width ?? 360,
            maxHeight: accessPanelPosition?.maxHeight,
            visibility: accessPanelPosition ? 'visible' : 'hidden',
            pointerEvents: accessPanelPosition ? 'auto' : 'none',
            transformOrigin: accessPanelPosition?.placement === 'top' ? 'bottom right' : 'top right'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {accessPanelPosition && (
            <div
              className={`pointer-events-none absolute h-[10px] w-10 -translate-x-1/2 border-blue-400 bg-white/95 dark:border-blue-500 dark:bg-slate-800/95 ${
                accessPanelPosition.placement === 'top'
                  ? '-bottom-[10px] rounded-b-lg border-x border-b'
                  : '-top-[10px] rounded-t-lg border-x border-t'
              }`}
              style={{ left: accessPanelPosition.connectorLeft }}
              aria-hidden="true"
            />
          )}
          <div className="flex items-center justify-between mb-3 shrink-0">
            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Assign users to this domain</h4>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); closeAccessPanel(); }}
              className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              Done
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 shrink-0">
            Only users with domain_access permission can be assigned. Assigned users can access this domain.
          </p>
          {error && (
            <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-xs shrink-0">
              {error}
            </div>
          )}
          <div className="mb-3 flex w-full min-w-0 shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <SelectMenu
                value={assignUserId}
                onChange={setAssignUserId}
                disabled={accessLoading}
                placeholder={accessLoading ? 'Loading users...' : 'Select user to add...'}
                searchable
                options={eligibleAccessUsers
                  .filter((u) => !domainAccessList.some((a) => a.user_id === u.user_id))
                  .map((u) => ({
                    value: u.user_id,
                    label: u.user_name,
                    description: u.user_email,
                  }))}
                aria-label="Select user to add"
              />
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleAddDomainAccess(); }}
              disabled={!assignUserId || accessLoading}
              className="inline-flex min-h-11 items-center justify-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
          <ul className="space-y-1.5 flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1">
            {accessLoading && domainAccessList.length === 0 ? (
              <li className="text-xs text-slate-500 dark:text-slate-400">Loading assigned users...</li>
            ) : domainAccessList.length === 0 ? (
              <li className="text-xs text-slate-500 dark:text-slate-400">No users assigned yet.</li>
            ) : (
              domainAccessList.map((u) => (
                <li key={u.user_id} className="flex items-center justify-between py-1.5 px-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg text-sm">
                  <span className="text-slate-900 dark:text-white truncate">{u.user_name} ({u.user_email})</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleRemoveDomainAccess(u.user_id); }}
                    disabled={accessLoading}
                    className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded shrink-0 disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>,
        document.body
      )}

      {showModal && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-2 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                {editingDomain ? 'Edit Domain' : 'Create New Domain'}
              </h3>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="domain-form"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                {editingDomain ? 'Update' : 'Create'}
              </button>
            </div>
          </div>

          <form id="domain-form" onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Short Name (8 chars max)
              </label>
              <input
                type="text"
                value={formData.domain_short_name}
                onChange={(e) => setFormData({ ...formData, domain_short_name: e.target.value })}
                maxLength={8}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Domain Name (50 chars max)
              </label>
              <input
                type="text"
                value={formData.domain_name}
                onChange={(e) => setFormData({ ...formData, domain_name: e.target.value })}
                maxLength={50}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Description (250 chars max)
              </label>
              <textarea
                value={formData.domain_detail}
                onChange={(e) => setFormData({ ...formData, domain_detail: e.target.value })}
                maxLength={250}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              />
            </div>

            {(hasPermission('edit_domain') || !editingDomain || (editingDomain?.owner_id === user?.user_id)) && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Domain Owner
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                  {editingDomain ? 'Only users with domain_owner permission can be set as owner.' : 'Defaults to you. Only users with domain_owner permission can be selected.'}
                </p>
                <SelectMenu
                  value={formData.owner_id}
                  onChange={(owner_id) => setFormData({ ...formData, owner_id })}
                  placeholder="No owner"
                  searchable
                  options={eligibleOwners.map((u) => ({
                    value: u.user_id,
                    label: u.user_name,
                    description: u.user_email,
                  }))}
                  aria-label="Domain Owner"
                />
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">
                {error}
              </div>
            )}
          </form>
        </div>
      )}

      <Toast message={error} onDismiss={() => setError('')} type="error" autoDismissMs={3000} />

      <ConfirmModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, domain: null })}
        onConfirm={handleDelete}
        title="Delete Domain"
        message={`Are you sure you want to delete "${deleteModal.domain?.domain_name}"? This will also delete all use cases in this domain.`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
