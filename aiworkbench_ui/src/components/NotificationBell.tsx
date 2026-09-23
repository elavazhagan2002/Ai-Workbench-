import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowRightLeft,
  Bell,
  CheckCheck,
  CheckCircle2,
  ClipboardList,
  FolderPlus,
  MessageSquare,
  RefreshCw,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../lib/api';
import { logger } from '../utils/logger';
import { withHashSection, workSectionForNotification } from '../utils/useCaseDeepLinks';
import HoverTip from './HoverTip';

export type NotificationItem = {
  notification_id: string;
  type: string;
  title: string;
  message: string;
  severity: string;
  entity_type?: string | null;
  entity_id?: string | null;
  domain_id?: string | null;
  link?: string | null;
  actions: string[];
  payload: Record<string, unknown>;
  is_read: boolean;
  read_dt?: string | null;
  created_dt?: string | null;
  actor_user_id?: string | null;
  actor_name?: string | null;
};

type FilterTab = 'all' | 'unread' | 'assignments' | 'updates';

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'updates', label: 'Updates' },
];

const CLEAR_TAB_LABELS: Record<FilterTab, string> = {
  all: 'Clear all',
  unread: 'Clear unread',
  assignments: 'Clear assignments',
  updates: 'Clear updates',
};

const ASSIGNMENT_TYPES = new Set([
  'analysis_assigned',
  'estimate_assigned',
  'roi_assigned',
  'assessment_assigned',
  'analysis_send_back',
  'analysis_rejected',
  'analysis_reassigned',
  'estimate_reassigned',
  'roi_reassigned',
  'assessment_reassigned',
  'use_case_created',
  'ready_for_estimate',
  'estimate_completed',
  'roi_completed',
  'assessment_completed',
  'risk_assigned',
  'domain_access_granted',
]);

const UPDATE_TYPES = new Set([
  'analysis_completed',
  'analysis_rejected',
  'use_case_created',
  'use_case_approved',
  'use_case_rejected',
  'use_case_moved',
  'use_case_deleted',
  'domain_created',
  'domain_owner_changed',
  'domain_access_removed',
  'registration_pending',
  'comment_added',
]);

const COUNT_POLL_MS = 30000;
const LIST_POLL_MS = 15000;
const TICK_MS = 60000;
const PANEL_WIDTH = 400;
const PANEL_HEIGHT = 468;
const REFRESH_MIN_MS = 550;

function NotificationSkeleton() {
  return (
    <div className="space-y-2 p-2" aria-busy="true" aria-label="Loading notifications">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex animate-pulse gap-3 rounded-xl px-2.5 py-2.5">
          <div className="h-9 w-9 shrink-0 rounded-full bg-surface-muted" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div className="h-3.5 w-[55%] rounded bg-surface-muted" />
              <div className="h-2.5 w-10 rounded bg-surface-muted" />
            </div>
            <div className="mt-2 h-2.5 w-[92%] rounded bg-surface-muted" />
            <div className="mt-1.5 h-2.5 w-[48%] rounded bg-surface-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function typeVisual(type: string): { Icon: LucideIcon; wrap: string; icon: string } {
  if (type.includes('rejected') || type.includes('send_back') || type === 'use_case_deleted') {
    return {
      Icon: AlertTriangle,
      wrap: 'bg-amber-500/12',
      icon: 'text-amber-700 dark:text-amber-300',
    };
  }
  if (type.includes('completed') || type.startsWith('ready_for') || type === 'use_case_approved') {
    return {
      Icon: CheckCircle2,
      wrap: 'bg-emerald-500/12',
      icon: 'text-emerald-700 dark:text-emerald-300',
    };
  }
  if (type === 'comment_added') {
    return {
      Icon: MessageSquare,
      wrap: 'bg-sky-500/12',
      icon: 'text-sky-700 dark:text-sky-300',
    };
  }
  if (type.includes('reassigned') || type.includes('moved') || type === 'domain_owner_changed') {
    return {
      Icon: ArrowRightLeft,
      wrap: 'bg-violet-500/12',
      icon: 'text-violet-700 dark:text-violet-300',
    };
  }
  if (type.includes('created')) {
    return {
      Icon: FolderPlus,
      wrap: 'bg-cyan-500/12',
      icon: 'text-cyan-700 dark:text-cyan-300',
    };
  }
  if (type.includes('assigned') || type === 'domain_access_granted' || type === 'risk_assigned') {
    return {
      Icon: UserPlus,
      wrap: 'bg-cyan-500/12',
      icon: 'text-cyan-700 dark:text-cyan-300',
    };
  }
  return {
    Icon: ClipboardList,
    wrap: 'bg-surface-muted',
    icon: 'text-ink-muted',
  };
}

function applyFilter(items: NotificationItem[], filter: FilterTab): NotificationItem[] {
  if (filter === 'unread') return items.filter((item) => !item.is_read);
  if (filter === 'assignments') return items.filter((item) => ASSIGNMENT_TYPES.has(item.type));
  if (filter === 'updates') return items.filter((item) => UPDATE_TYPES.has(item.type));
  return items;
}

type TimeGroup = 'today' | 'yesterday' | 'week' | 'earlier';

const TIME_GROUP_ORDER: TimeGroup[] = ['today', 'yesterday', 'week', 'earlier'];
const TIME_GROUP_LABELS: Record<TimeGroup, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  earlier: 'Earlier',
};

function startOfLocalDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function timeGroupFor(iso?: string | null, now = new Date()): TimeGroup {
  const parsed = parseApiDate(iso);
  if (!parsed) return 'earlier';
  const diffDays = Math.round((startOfLocalDay(now) - startOfLocalDay(parsed)) / 86400000);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return 'week';
  return 'earlier';
}

function groupByTime(items: NotificationItem[]): { id: TimeGroup; label: string; items: NotificationItem[] }[] {
  const buckets: Record<TimeGroup, NotificationItem[]> = {
    today: [],
    yesterday: [],
    week: [],
    earlier: [],
  };
  for (const item of items) {
    buckets[timeGroupFor(item.created_dt)].push(item);
  }
  return TIME_GROUP_ORDER.filter((id) => buckets[id].length > 0).map((id) => ({
    id,
    label: TIME_GROUP_LABELS[id],
    items: buckets[id],
  }));
}

/** Parse API datetimes that may be naive UTC (no Z) as UTC. */
function parseApiDate(iso?: string | null): Date | null {
  if (!iso) return null;
  const raw = iso.trim();
  if (!raw) return null;
  // Already has timezone (Z or ±HH:MM)
  if (/([zZ]|[+-]\d{2}:\d{2})$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Space separator from some DBs → ISO T
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const d = new Date(`${normalized}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function relativeTime(iso?: string | null): string {
  const thenDate = parseApiDate(iso);
  if (!thenDate) return '';
  const then = thenDate.getTime();
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 45) return 'Just now';
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60);
    return m === 1 ? '1 min ago' : `${m} mins ago`;
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return h === 1 ? '1 hour ago' : `${h} hours ago`;
  }
  if (diffSec < 86400 * 7) {
    const d = Math.floor(diffSec / 86400);
    return d === 1 ? '1 day ago' : `${d} days ago`;
  }
  return thenDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function absoluteTime(iso?: string | null): string {
  const d = parseApiDate(iso);
  if (!d) return '';
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function dueLabel(payload: Record<string, unknown>): string | null {
  const due = payload?.due_date;
  if (typeof due !== 'string' || !due) return null;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  return `Due ${d.toLocaleDateString()}`;
}

function primaryActionLabel(item: NotificationItem): string {
  if (item.type === 'registration_pending') return 'Review';
  if (item.type === 'domain_created' || item.type === 'domain_owner_changed' || item.type === 'domain_access_granted') {
    return 'Open';
  }
  if (item.type === 'use_case_created' || item.type === 'ready_for_estimate') return 'Assign';
  if (item.type === 'estimate_completed' || item.type === 'roi_completed') return 'Assign';
  if (item.type === 'assessment_completed') return 'Review';
  if (item.type === 'use_case_deleted') return 'Open';
  if ((item.actions || []).includes('reassign')) {
    return item.type.includes('rejected') ? 'Reassign' : 'Assign';
  }
  return 'Open';
}

function previewMessage(item: NotificationItem, due: string | null): string {
  const message = (item.message || '').replace(/\s+/g, ' ').trim();
  if (!due) return message;
  const dueAt = message.search(/\sDue\s/i);
  if (dueAt <= 0) return message;
  return message.slice(0, dueAt).replace(/[.\s]+$/, '');
}

function NotificationRow({
  item,
  onOpen,
  onDismiss,
  onReject,
}: {
  item: NotificationItem;
  onOpen: (item: NotificationItem) => void;
  onDismiss: (item: NotificationItem, e: MouseEvent) => void;
  onReject: (item: NotificationItem, e: MouseEvent) => void;
}) {
  const due = dueLabel(item.payload || {});
  const canReject = (item.actions || []).includes('reject_analysis');
  const visual = typeVisual(item.type);
  const TypeIcon = visual.Icon;
  const preview = previewMessage(item, due);

  return (
    <li>
      <div
        className={`group relative rounded-xl transition-colors ${
          item.is_read
            ? 'hover:bg-surface-muted/70'
            : 'bg-cyan-500/[0.07] hover:bg-cyan-500/[0.11]'
        }`}
      >
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="flex w-full gap-3 px-2.5 pb-1.5 pt-2.5 text-left"
        >
          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${visual.wrap}`}>
            <TypeIcon className={`h-4 w-4 ${visual.icon}`} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 pr-5">
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                {!item.is_read && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" aria-label="Unread" />
                )}
                <span
                  className={`truncate text-[13px] leading-5 ${
                    item.is_read ? 'font-medium text-ink-muted' : 'font-semibold text-ink'
                  }`}
                >
                  {item.title}
                </span>
              </span>
              <time
                className="shrink-0 text-[11px] leading-4 text-ink-subtle transition-opacity group-hover:opacity-0"
                dateTime={item.created_dt || undefined}
                title={absoluteTime(item.created_dt)}
              >
                {relativeTime(item.created_dt)}
              </time>
            </span>
            {preview && (
              <span className="mt-0.5 line-clamp-2 block text-[12px] leading-5 text-ink-muted">
                {preview}
              </span>
            )}
          </span>
        </button>
        <div className="flex items-center gap-2 px-2.5 pb-2 pl-14">
          {(item.actor_name || due) && (
            <p className="min-w-0 flex-1 truncate text-[11px] leading-4 text-ink-subtle">
              {item.actor_name}
              {item.actor_name && due ? ' · ' : ''}
              {due && <span className="font-medium text-amber-700 dark:text-amber-300">{due}</span>}
            </p>
          )}
          {!(item.actor_name || due) && <span className="min-w-0 flex-1" />}
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="rounded-md px-2 py-0.5 text-[11px] font-semibold text-cyan-800 transition-colors hover:bg-cyan-500/15 dark:text-cyan-300"
            >
              {primaryActionLabel(item)}
            </button>
            {canReject && (
              <button
                type="button"
                onClick={(e) => onReject(item, e)}
                className="rounded-md px-2 py-0.5 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-300"
              >
                Reject
              </button>
            )}
          </div>
        </div>
        <button
          type="button"
          title="Dismiss"
          aria-label="Dismiss notification"
          onClick={(e) => onDismiss(item, e)}
          className="absolute right-1.5 top-1.5 rounded-md p-1 text-ink-subtle opacity-0 transition-opacity hover:bg-surface-muted hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

interface NotificationBellProps {
  onOpenLink?: (link: string) => void;
  /** Called when the panel opens — use to close other header menus. */
  onOpen?: () => void;
  /** When this becomes true, force-close the notification panel. */
  forceClose?: boolean;
}

export default function NotificationBell({ onOpenLink, onOpen, forceClose }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [allItems, setAllItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [rejecting, setRejecting] = useState<NotificationItem | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectSaving, setRejectSaving] = useState(false);
  const [rejectError, setRejectError] = useState('');
  const [inboxNotice, setInboxNotice] = useState('');
  const [, setTick] = useState(0);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number; width: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inFlightRef = useRef(false);
  const hasItemsRef = useRef(false);
  hasItemsRef.current = allItems.length > 0;

  const items = applyFilter(allItems, filter);

  const closeAll = useCallback(() => {
    setOpen(false);
    setRejecting(null);
    setRejectError('');
    setInboxNotice('');
  }, []);

  const refreshCount = useCallback(async () => {
    try {
      const data = await api.getUnreadNotificationCount();
      setUnreadCount(data.unread_count ?? 0);
    } catch (err) {
      logger.error('Failed to load notification count', err);
    }
  }, []);

  const loadList = useCallback(async (opts?: { silent?: boolean }) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const silent = opts?.silent === true;
    const hasItems = hasItemsRef.current;
    const started = Date.now();
    if (!silent) {
      if (hasItems) setRefreshing(true);
      else setLoading(true);
    }
    try {
      const data = await api.getNotifications({ limit: 100, filter: 'all' });
      setAllItems(data.items || []);
      setUnreadCount(data.unread_count ?? 0);
    } catch (err) {
      logger.error('Failed to load notifications', err);
    } finally {
      if (!silent) {
        const wait = Math.max(0, REFRESH_MIN_MS - (Date.now() - started));
        if (wait > 0) await new Promise((resolve) => window.setTimeout(resolve, wait));
      }
      setLoading(false);
      setRefreshing(false);
      inFlightRef.current = false;
    }
  }, []);

  const updatePanelPosition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const available = Math.max(280, window.innerWidth - 16);
    const width = Math.min(PANEL_WIDTH, available);
    const right = Math.max(8, window.innerWidth - rect.right);
    // Same 8px gap as the profile menu (`mt-2`). Panel z-index stays above the header.
    const top = rect.bottom + 8;
    setPanelPos({ top, right, width });
  }, []);

  useEffect(() => {
    if (forceClose) closeAll();
  }, [forceClose, closeAll]);

  useEffect(() => {
    refreshCount();
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      refreshCount();
    }, COUNT_POLL_MS);
    return () => window.clearInterval(poll);
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    updatePanelPosition();
    loadList();

    const listPoll = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      loadList({ silent: true });
    }, LIST_POLL_MS);
    const tick = window.setInterval(() => setTick((n) => n + 1), TICK_MS);

    return () => {
      window.clearInterval(listPoll);
      window.clearInterval(tick);
    };
    // allItems.length omitted so tab switches do not re-fetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadList, updatePanelPosition]);

  // Close on outside activity: backdrop handles clicks; also scroll/resize/nav/escape
  useEffect(() => {
    if (!open && !rejecting) return;

    const onPointerDown = (e: PointerEvent) => {
      if (rejecting) return;
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      closeAll();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    const onScroll = (e: Event) => {
      // Ignore scrolls inside the notification panel itself
      const target = e.target as Node | null;
      if (panelRef.current && target && panelRef.current.contains(target)) return;
      if (rejecting) return; // keep reject modal open while scrolling under it
      closeAll();
    };
    const onResize = () => {
      if (open) updatePanelPosition();
    };
    const onHash = () => closeAll();
    const onVis = () => {
      if (document.visibilityState === 'hidden') closeAll();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('hashchange', onHash);
    document.addEventListener('visibilitychange', onVis);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [open, rejecting, closeAll, updatePanelPosition]);

  function toggleOpen() {
    setOpen((wasOpen) => {
      const next = !wasOpen;
      if (next) onOpen?.();
      else setRejecting(null);
      return next;
    });
  }

  async function handleMarkAll() {
    try {
      await api.markAllNotificationsRead();
      setUnreadCount(0);
      setAllItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (err) {
      logger.error('Failed to mark all notifications read', err);
    }
  }

  async function handleClearTab() {
    if (items.length === 0) return;
    const ids = new Set(items.map((item) => item.notification_id));
    try {
      const res = await api.dismissAllNotifications(filter);
      setUnreadCount(res.unread_count ?? 0);
      setAllItems((prev) => prev.filter((item) => !ids.has(item.notification_id)));
    } catch (err) {
      logger.error('Failed to clear tab notifications', err);
    }
  }

  async function handleOpen(item: NotificationItem) {
    let currentLink: string;
    try {
      const resolved = await api.resolveNotification(item.notification_id);
      currentLink = resolved.link || '';
    } catch (err: any) {
      const errorMessage = String(err?.message || '');
      const unavailable =
        errorMessage.includes('old notification') ||
        errorMessage.includes('no longer available');
      if (unavailable) {
        setAllItems((prev) => prev.filter((n) => n.notification_id !== item.notification_id));
        await refreshCount();
        setInboxNotice(
          'This was an old notification. The process, domain, state, assignment, role, or permission changed, so the message was removed.'
        );
      } else {
        setInboxNotice('Unable to verify this notification right now. Please try again.');
      }
      return;
    }

    if (!item.is_read) {
      try {
        const res = await api.markNotificationRead(item.notification_id);
        setUnreadCount(res.unread_count ?? Math.max(0, unreadCount - 1));
        setAllItems((prev) =>
          prev.map((n) => (n.notification_id === item.notification_id ? { ...n, is_read: true } : n))
        );
      } catch (err) {
        logger.error('Failed to mark notification read', err);
      }
    }
    closeAll();
    const mapped = workSectionForNotification(item);
    let link = currentLink;
    if (mapped && link) {
      link = withHashSection(link, mapped);
    }
    if (link) {
      if (onOpenLink) onOpenLink(link);
      else window.location.hash = link.replace(/^#/, '');
    }
  }

  async function handleDismiss(item: NotificationItem, e: MouseEvent) {
    e.stopPropagation();
    try {
      const res = await api.dismissNotification(item.notification_id);
      setUnreadCount(res.unread_count ?? unreadCount);
      setAllItems((prev) => prev.filter((n) => n.notification_id !== item.notification_id));
    } catch (err) {
      logger.error('Failed to dismiss notification', err);
    }
  }

  function openReject(item: NotificationItem, e: MouseEvent) {
    e.stopPropagation();
    setRejecting(item);
    setRejectNote('');
    setRejectError('');
  }

  async function submitReject() {
    if (!rejecting || !rejectNote.trim()) {
      setRejectError('A rejection note is required.');
      return;
    }
    const useCaseId = rejecting.entity_id;
    const trackVal = rejecting.payload?.track;
    const trackRaw = typeof trackVal === 'string' ? trackVal.toLowerCase() : '';
    let track: 'technical' | 'business' | null = null;
    if (trackRaw.startsWith('tech')) track = 'technical';
    else if (trackRaw.startsWith('bus')) track = 'business';
    if (!useCaseId || !track) {
      setRejectError('Cannot reject this assignment from the notification.');
      return;
    }
    setRejectSaving(true);
    setRejectError('');
    try {
      await api.rejectAnalysisAssignment(useCaseId, track, rejectNote.trim());
      try {
        await api.markNotificationRead(rejecting.notification_id);
      } catch {
        /* ignore */
      }
      setAllItems((prev) => prev.filter((n) => n.notification_id !== rejecting.notification_id));
      setUnreadCount((c) => Math.max(0, c - (rejecting.is_read ? 0 : 1)));
      closeAll();
    } catch (err: any) {
      setRejectError(err?.message || 'Failed to reject assignment.');
    } finally {
      setRejectSaving(false);
    }
  }

  let badge: string | null = null;
  if (unreadCount > 9) badge = '9+';
  else if (unreadCount > 0) badge = String(unreadCount);

  const panel =
    open && panelPos && typeof document !== 'undefined'
      ? createPortal(
          <>
            <button
              type="button"
              aria-label="Close notifications"
              className="fixed inset-0 z-[40] cursor-default bg-transparent"
              onClick={closeAll}
            />
            <div
              ref={panelRef}
              role="dialog"
              aria-label="Notifications"
              aria-busy={loading || refreshing}
              className="fixed z-[310] flex flex-col overflow-hidden rounded-2xl border border-line bg-surface-elevated shadow-panel dark:shadow-panel-dark"
              style={{
                top: panelPos.top,
                right: panelPos.right,
                width: panelPos.width,
                height: `min(${PANEL_HEIGHT}px, calc(100vh - ${panelPos.top + 12}px))`,
                maxWidth: 'calc(100vw - 1rem)',
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {(loading || refreshing) && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-cyan-500/15">
                  <div className="wb-indet-bar h-full w-1/3 rounded-full bg-cyan-400" />
                </div>
              )}
              <div className="flex h-[3.25rem] shrink-0 items-center justify-between gap-2 border-b border-line px-4">
                <div className="min-w-0">
                  <h2 className="font-display text-sm font-semibold leading-5 text-ink">Notifications</h2>
                  <p className="h-4 text-[11px] leading-4 text-ink-subtle">
                    {refreshing || loading
                      ? 'Checking for updates…'
                      : unreadCount > 0
                        ? `${unreadCount} unread`
                        : '\u00a0'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => loadList()}
                    disabled={loading || refreshing}
                    className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-60"
                    title="Refresh"
                    aria-label="Refresh notifications"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={handleMarkAll}
                    disabled={unreadCount === 0}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-cyan-700 transition-colors hover:bg-cyan-500/10 disabled:opacity-40 disabled:hover:bg-transparent dark:text-cyan-300"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Mark all read</span>
                  </button>
                  <button
                    type="button"
                    onClick={closeAll}
                    className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink sm:hidden"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="shrink-0 border-b border-line px-3 py-2">
                <div className="grid grid-cols-4 gap-0.5 rounded-xl bg-surface-muted p-0.5">
                  {FILTER_TABS.map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setFilter(id)}
                      className={`truncate rounded-lg px-1.5 py-1.5 text-[11px] font-semibold transition-colors ${
                        filter === id
                          ? 'bg-surface-elevated text-ink shadow-sm'
                          : 'text-ink-muted hover:text-ink'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 flex justify-end">
                  <button
                    type="button"
                    onClick={handleClearTab}
                    disabled={items.length === 0}
                    className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    {CLEAR_TAB_LABELS[filter]}
                  </button>
                </div>
              </div>

              {inboxNotice && (
                <output
                  className="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] leading-4 text-amber-800 dark:text-amber-200"
                >
                  {inboxNotice}
                </output>
              )}

              <div className="relative min-h-0 flex-1 overflow-hidden">
                <div
                  className={`wb-scroll-slim h-full overflow-y-auto overscroll-contain p-1.5 transition-opacity duration-200 ${
                    refreshing ? 'opacity-55' : ''
                  }`}
                >
                  {loading && allItems.length === 0 ? (
                    <NotificationSkeleton />
                  ) : items.length === 0 ? (
                    <div className="flex h-full min-h-[12rem] flex-col items-center justify-center px-4 text-center">
                      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted">
                        <Bell className="h-5 w-5 text-ink-subtle" />
                      </span>
                      <p className="text-sm font-medium text-ink">You’re all caught up</p>
                      <p className="mt-1 text-xs text-ink-subtle">New assignments and updates will show here.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {groupByTime(items).map((section) => {
                        const unreadInSection = section.items.filter((item) => !item.is_read).length;
                        return (
                          <section key={section.id} aria-label={section.label}>
                            <h3 className="sticky top-0 z-[1] mb-0.5 flex items-center justify-between gap-2 bg-surface-elevated/90 px-2.5 py-1.5 backdrop-blur-md">
                              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                                {section.label}
                              </span>
                              <span className="text-[10px] tabular-nums text-ink-subtle">
                                {filter === 'unread' || unreadInSection === 0
                                  ? `${section.items.length}`
                                  : `${unreadInSection} unread`}
                              </span>
                            </h3>
                            <ul className="space-y-0.5">
                              {section.items.map((item) => (
                                <NotificationRow
                                  key={item.notification_id}
                                  item={item}
                                  onOpen={handleOpen}
                                  onDismiss={handleDismiss}
                                  onReject={openReject}
                                />
                              ))}
                            </ul>
                          </section>
                        );
                      })}
                    </div>
                  )}
                </div>
                {refreshing && (
                  <div className="pointer-events-none absolute inset-0 flex items-start justify-center bg-surface-elevated/20 pt-10">
                    <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-elevated px-3 py-1.5 text-[11px] font-medium text-ink shadow-panel dark:shadow-panel-dark">
                      <RefreshCw className="h-3 w-3 animate-spin text-cyan-400" />
                      Updating inbox…
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>,
          document.body
        )
      : null;

  const rejectModal =
    rejecting && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="wb-modal-overlay z-[110]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-assign-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) setRejecting(null);
            }}
          >
            <div className="wb-modal w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
              <h3 id="reject-assign-title" className="font-display text-base font-semibold text-ink">
                Reject assignment
              </h3>
              <p className="mt-1 text-sm text-ink-muted">{rejecting.title}</p>
              <textarea
                className="wb-input mt-3 min-h-[88px]"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="Reason for rejecting this assignment…"
                autoFocus
              />
              {rejectError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{rejectError}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="wb-btn-secondary"
                  onClick={() => setRejecting(null)}
                  disabled={rejectSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  onClick={submitReject}
                  disabled={rejectSaving || !rejectNote.trim()}
                >
                  {rejectSaving ? 'Submitting…' : 'Reject assignment'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  const hasUnread = unreadCount > 0;

  return (
    <div className="relative" ref={rootRef}>
      <HoverTip
        label={hasUnread ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        disabled={open}
      >
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        className={`relative rounded-xl p-2.5 transition-colors ${
          open ? 'bg-cyan-500 text-navy-950' : 'text-slate-200 hover:bg-white/10'
        }`}
        aria-label={hasUnread ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell className={`h-5 w-5 ${hasUnread && !open ? 'wb-bell-icon-glow' : ''}`} />
        {badge && (
          <span className="absolute -right-0.5 -top-0.5 h-[1.15rem] min-w-[1.15rem] rounded-full bg-cyan-400 px-1 text-center text-[10px] font-bold leading-[1.15rem] text-navy-950">
            {badge}
          </span>
        )}
      </button>
      </HoverTip>
      {panel}
      {rejectModal}
    </div>
  );
}
