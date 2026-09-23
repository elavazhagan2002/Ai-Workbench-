import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { SystemConfig, Role, Permission, OrganizationType, DocumentType, Domain } from '../types';
import { ArrowLeft, Save, Edit2, Trash2, X, UserPlus, CheckCircle } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import Toast from '../components/Toast';
import SelectMenu from '../components/SelectMenu';
import HoverTip from '../components/HoverTip';
import RolesPermissionsPanel from '../components/RolesPermissionsPanel';
import UsersManagementPanel from '../components/UsersManagementPanel';
import { logger } from '../utils/logger';
import { AI_CATEGORY_OPTIONS } from '../constants/aiCategories';
import AssessmentChecklistSettings from '../components/AssessmentChecklistSettings';

interface SettingsProps {
  onBack: () => void;
}

type SettingsTab = 'datatable' | 'llm' | 'storage' | 'integrations' | 'roles' | 'organization_types' | 'document_types' | 'assessment_checklist' | 'users' | 'ideas' | 'feedback';
type UserFilterField = 'user' | 'email' | 'organization' | 'organization_type' | 'assigned_domains' | 'role' | 'status';

const USER_FILTER_FIELD_OPTIONS: Array<{ id: UserFilterField; label: string; helper: string }> = [
  { id: 'user', label: 'User', helper: 'Name' },
  { id: 'email', label: 'Email', helper: 'Address, domain, provider' },
  { id: 'organization', label: 'Organization', helper: 'Company or team' },
  { id: 'organization_type', label: 'Org Type', helper: 'Configured label' },
  { id: 'assigned_domains', label: 'Assigned Domains', helper: 'Domain names' },
  { id: 'role', label: 'Role', helper: 'Access role' },
  { id: 'status', label: 'Status', helper: 'Active, pending, rejected' },
];

const USER_STATUS_FILTER_OPTIONS = ['Active', 'Inactive', 'Pending', 'Rejected'] as const;
const EMPTY_ORG_FILTER = '__none__';

type UserSortField = 'user' | 'organization' | 'domains' | 'role' | 'status';

function compareUserSortValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
}

function getUserRegistrationStatus(u: any): string {
  return u?.registration_status || 'approved';
}

function getUserStatusLabel(u: any): string {
  const registrationStatus = getUserRegistrationStatus(u);
  if (registrationStatus === 'pending') return 'Pending';
  if (registrationStatus === 'rejected') return 'Rejected';
  return u?.is_active !== false ? 'Active' : 'Inactive';
}

function getUserStatusClass(u: any): string {
  const registrationStatus = getUserRegistrationStatus(u);
  if (registrationStatus === 'pending') {
    return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
  }
  if (registrationStatus === 'rejected') {
    return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
  }
  return u?.is_active !== false
    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    : 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-400';
}

function normalizeUserSearchText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function getEmailSearchText(email: unknown): string {
  const normalizedEmail = normalizeUserSearchText(email);
  const [localPart = '', domain = ''] = normalizedEmail.split('@');
  return [normalizedEmail, localPart, domain, domain.replace(/\./g, ' ')].filter(Boolean).join(' ');
}

function getAssignedDomainSearchText(domains: Domain[]): string {
  return domains
    .flatMap((domain) => [
      domain.domain_name,
      domain.domain_short_name,
      domain.domain_detail,
      domain.domain_id,
    ])
    .map(normalizeUserSearchText)
    .filter(Boolean)
    .join(' ');
}

function getUserFieldSearchText(u: any, field: UserFilterField, assignedDomains: Domain[]): string {
  switch (field) {
    case 'user':
      return normalizeUserSearchText(u?.user_name);
    case 'email':
      return getEmailSearchText(u?.user_email);
    case 'organization':
      return normalizeUserSearchText(u?.organization);
    case 'organization_type':
      return normalizeUserSearchText(u?.organization_type);
    case 'assigned_domains':
      return getAssignedDomainSearchText(assignedDomains);
    case 'role':
      return normalizeUserSearchText(u?.role_name || u?.role?.role_name || 'No Role');
    case 'status':
      return normalizeUserSearchText(getUserStatusLabel(u));
    default:
      return '';
  }
}

function getUserRoleLabel(u: any): string {
  const roleName = String(u?.role_name || u?.role?.role_name || '').trim();
  return roleName || 'No Role';
}

function getUserEmailDomain(email: unknown): string {
  const normalizedEmail = normalizeUserSearchText(email);
  const atIndex = normalizedEmail.lastIndexOf('@');
  return atIndex >= 0 ? normalizedEmail.slice(atIndex + 1) : '';
}

function uniqueSortedLabels(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

type UserDirectoryFilters = {
  terms: string[];
  role: string;
  status: string;
  organization: string;
  organizationType: string;
  emailDomain: string;
  domainId: string;
};

function userMatchesAdvancedFilters(
  u: any,
  filters: UserDirectoryFilters,
  assignedDomains: Domain[]
): boolean {
  if (filters.role && getUserRoleLabel(u) !== filters.role) return false;
  if (filters.status && getUserStatusLabel(u) !== filters.status) return false;

  if (filters.organization === EMPTY_ORG_FILTER) {
    if (String(u?.organization ?? '').trim()) return false;
  } else if (
    filters.organization &&
    normalizeUserSearchText(u?.organization) !== normalizeUserSearchText(filters.organization)
  ) {
    return false;
  }

  if (filters.organizationType === EMPTY_ORG_FILTER) {
    if (String(u?.organization_type ?? '').trim()) return false;
  } else if (
    filters.organizationType &&
    normalizeUserSearchText(u?.organization_type) !== normalizeUserSearchText(filters.organizationType)
  ) {
    return false;
  }

  if (filters.emailDomain && getUserEmailDomain(u?.user_email) !== normalizeUserSearchText(filters.emailDomain)) {
    return false;
  }

  if (filters.domainId && !assignedDomains.some((domain) => domain.domain_id === filters.domainId)) {
    return false;
  }

  if (filters.terms.length) {
    const searchableText = USER_FILTER_FIELD_OPTIONS
      .map((field) => getUserFieldSearchText(u, field.id, assignedDomains))
      .join(' ');
    if (!filters.terms.every((term) => searchableText.includes(term))) return false;
  }

  return true;
}

interface RoleWithPermissions extends Role {
  permissions?: string[];
}

export default function Settings({ onBack }: SettingsProps) {
  const { user, hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>('datatable');
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const usersPerPage = 10;
  const [allUsersForFilter, setAllUsersForFilter] = useState<any[]>([]);
  const [userFilterSearch, setUserFilterSearch] = useState('');
  const [userFilterRole, setUserFilterRole] = useState('');
  const [userFilterStatus, setUserFilterStatus] = useState('');
  const [userFilterOrganization, setUserFilterOrganization] = useState('');
  const [userFilterOrgType, setUserFilterOrgType] = useState('');
  const [userFilterEmailDomain, setUserFilterEmailDomain] = useState('');
  const [userFilterDomain, setUserFilterDomain] = useState('');
  const [userFilterPage, setUserFilterPage] = useState(1);
  const [userSortField, setUserSortField] = useState<UserSortField | null>(null);
  const [userSortDir, setUserSortDir] = useState<'asc' | 'desc'>('asc');
  const [isLoadingUserFilterDataset, setIsLoadingUserFilterDataset] = useState(false);
  const userDirectoryRequestIdRef = useRef(0);
  const allUsersForFilterRef = useRef<any[]>([]);
  allUsersForFilterRef.current = allUsersForFilter;
  const [allDomains, setAllDomains] = useState<Domain[]>([]);
  const [assignedDomainsByUserId, setAssignedDomainsByUserId] = useState<Record<string, Domain[]>>({});
  const [selectedDomainByUserId, setSelectedDomainByUserId] = useState<Record<string, string>>({});
  const [rowDomainActionLoading, setRowDomainActionLoading] = useState<Record<string, boolean>>({});
  const [domainManagerOpenForUserId, setDomainManagerOpenForUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleWithPermissions | null>(null);
  const [roleFormFocusRequest, setRoleFormFocusRequest] = useState(0);
  const roleFormSectionRef = useRef<HTMLDivElement>(null);
  const [roleForm, setRoleForm] = useState({ role_name: '', role_description: '' });
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [userFormFocusRequest, setUserFormFocusRequest] = useState(0);
  const userFormSectionRef = useRef<HTMLDivElement>(null);
  const [userForm, setUserForm] = useState({
    user_name: '',
    user_email: '',
    user_pwd: '',
    role_id: '',
    organization: '',
    organization_type: '',
    user_image: '' as string | null
  });

  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    type: 'role' | 'user' | null;
    item: any;
  }>({ isOpen: false, type: null, item: null });
  const [deactivateModal, setDeactivateModal] = useState<{ isOpen: boolean; user: any }>({ isOpen: false, user: null });
  const [deleteUserModal, setDeleteUserModal] = useState<{ isOpen: boolean; user: any }>({ isOpen: false, user: null });
  const [anonymousIdeas, setAnonymousIdeas] = useState<any[]>([]);
  const [ideasStatusFilter, setIdeasStatusFilter] = useState<string>('');
  const [qualifyModal, setQualifyModal] = useState<{ idea: any } | null>(null);
  const [qualifyForm, setQualifyForm] = useState({
    target_domain_id: '',
    use_case_name: '',
    use_case_title: '',
    use_case_description: '',
    expected_benefits: '',
    department: '',
    ai_category: '',
    feasibility: '',
    intended_audience: '',
    tags: [] as string[],
  });
  const [qualifySaving, setQualifySaving] = useState(false);
  const [domainsForQualify, setDomainsForQualify] = useState<any[]>([]);
  const [organizationTypes, setOrganizationTypes] = useState<OrganizationType[]>([]);
  const [editingOrgType, setEditingOrgType] = useState<OrganizationType | null>(null);
  const [orgTypeForm, setOrgTypeForm] = useState<{ name: string; description: string }>({ name: '', description: '' });
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [editingDocType, setEditingDocType] = useState<DocumentType | null>(null);
  const [docTypeForm, setDocTypeForm] = useState<{ name: string; description: string }>({ name: '', description: '' });
  const [docTypeSaving, setDocTypeSaving] = useState(false);
  const [docTypeToDelete, setDocTypeToDelete] = useState<DocumentType | null>(null);
  const [feedbackList, setFeedbackList] = useState<any[]>([]);
  const [feedbackReleaseFilter, setFeedbackReleaseFilter] = useState<string>('unassigned');
  const [feedbackReleaseNumbers, setFeedbackReleaseNumbers] = useState<string[]>([]);
  const [feedbackReleaseEdit, setFeedbackReleaseEdit] = useState<Record<string, string>>({});
  const [feedbackImageView, setFeedbackImageView] = useState<string | null>(null);
  const [feedbackUpdatingId, setFeedbackUpdatingId] = useState<string | null>(null);
  const normalizedUserFilterSearch = userFilterSearch.trim().toLowerCase();
  const userFilterTerms = useMemo(
    () => normalizedUserFilterSearch
      .split(/[\s,;]+/)
      .map((term) => term.trim())
      .filter(Boolean),
    [normalizedUserFilterSearch]
  );
  const isUserFacetFilterActive = Boolean(
    userFilterRole ||
    userFilterStatus ||
    userFilterOrganization ||
    userFilterOrgType ||
    userFilterEmailDomain ||
    userFilterDomain
  );
  const isUserFilterActive = userFilterTerms.length > 0 || isUserFacetFilterActive;
  const hasCompleteUserDirectory = allUsersForFilter.length > 0;
  // Always search the full directory once loaded. Never search only the current page.
  const userFilterDataset = hasCompleteUserDirectory ? allUsersForFilter : [];
  const userFilterSource = hasCompleteUserDirectory ? allUsersForFilter : users;
  const needsAssignedDomainIndex = userFilterTerms.length > 0 || Boolean(userFilterDomain);
  const assignedDomainIndexReady =
    !needsAssignedDomainIndex ||
    (userFilterDataset.length > 0 &&
      userFilterDataset.every(
        (u) => Boolean(u?.user_id) && Object.prototype.hasOwnProperty.call(assignedDomainsByUserId, u.user_id)
      ));
  const filteredUsers = useMemo(() => {
    if (!isUserFilterActive) return users;
    if (!hasCompleteUserDirectory) return [];
    if (needsAssignedDomainIndex && !assignedDomainIndexReady) return [];

    return userFilterDataset.filter((u) =>
      userMatchesAdvancedFilters(
        u,
        {
          terms: userFilterTerms,
          role: userFilterRole,
          status: userFilterStatus,
          organization: userFilterOrganization,
          organizationType: userFilterOrgType,
          emailDomain: userFilterEmailDomain,
          domainId: userFilterDomain,
        },
        assignedDomainsByUserId[u.user_id] || []
      )
    );
  }, [
    assignedDomainIndexReady,
    assignedDomainsByUserId,
    hasCompleteUserDirectory,
    isUserFilterActive,
    needsAssignedDomainIndex,
    userFilterDataset,
    userFilterDomain,
    userFilterEmailDomain,
    userFilterOrganization,
    userFilterOrgType,
    userFilterRole,
    userFilterStatus,
    userFilterTerms,
    users,
  ]);

  const useClientUserPaging = isUserFilterActive || (Boolean(userSortField) && hasCompleteUserDirectory);

  const usersForDisplay = useMemo(() => {
    const baseList = isUserFilterActive
      ? filteredUsers
      : hasCompleteUserDirectory && userSortField
        ? allUsersForFilter
        : users;

    if (!userSortField) return baseList;

    const dir = userSortDir === 'asc' ? 1 : -1;
    return [...baseList].sort((left, right) => {
      let a: string | number = '';
      let b: string | number = '';
      switch (userSortField) {
        case 'user':
          a = `${left?.user_name || ''}\0${left?.user_email || ''}`;
          b = `${right?.user_name || ''}\0${right?.user_email || ''}`;
          break;
        case 'organization':
          a = `${left?.organization || ''}\0${left?.organization_type || ''}`;
          b = `${right?.organization || ''}\0${right?.organization_type || ''}`;
          break;
        case 'domains':
          a = (assignedDomainsByUserId[left?.user_id] || []).length;
          b = (assignedDomainsByUserId[right?.user_id] || []).length;
          break;
        case 'role':
          a = getUserRoleLabel(left);
          b = getUserRoleLabel(right);
          break;
        case 'status':
          a = getUserStatusLabel(left);
          b = getUserStatusLabel(right);
          break;
        default:
          break;
      }
      return compareUserSortValues(a, b) * dir;
    });
  }, [
    allUsersForFilter,
    assignedDomainsByUserId,
    filteredUsers,
    hasCompleteUserDirectory,
    isUserFilterActive,
    userSortDir,
    userSortField,
    users,
  ]);

  const userRowsTotal = useClientUserPaging ? usersForDisplay.length : usersTotal;
  const userRowsPageCount = Math.max(1, Math.ceil(userRowsTotal / usersPerPage));
  const activeUsersPage = useClientUserPaging
    ? Math.min(userFilterPage, userRowsPageCount)
    : usersPage;
  const visibleUsers = useMemo(
    () =>
      useClientUserPaging
        ? usersForDisplay.slice(
            (activeUsersPage - 1) * usersPerPage,
            activeUsersPage * usersPerPage
          )
        : userSortField
          ? usersForDisplay
          : users,
    [
      activeUsersPage,
      useClientUserPaging,
      userSortField,
      users,
      usersForDisplay,
      usersPerPage,
    ]
  );

  function handleUserSort(field: UserSortField) {
    if (userSortField === field) {
      setUserSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setUserSortField(field);
      setUserSortDir('asc');
    }
    setUserFilterPage(1);
    if (!hasCompleteUserDirectory) {
      void loadAllUsersForDirectory(false);
    }
  }
  const isUserSearchLoading =
    isUserFilterActive && (
      !hasCompleteUserDirectory ||
      isLoadingUserFilterDataset ||
      (needsAssignedDomainIndex && !assignedDomainIndexReady)
    );
  const userRoleFilterOptions = useMemo(() => {
    const names = uniqueSortedLabels([
      ...roles.map((role) => role.role_name),
      ...userFilterSource.map((u) => getUserRoleLabel(u)),
    ]);
    return names.map((name) => ({ value: name, label: name }));
  }, [roles, userFilterSource]);
  const userOrganizationFilterOptions = useMemo(() => {
    const names = uniqueSortedLabels(userFilterSource.map((u) => u?.organization));
    const hasEmpty = userFilterSource.some((u) => !String(u?.organization ?? '').trim());
    return [
      ...(hasEmpty ? [{ value: EMPTY_ORG_FILTER, label: 'No organization' }] : []),
      ...names.map((name) => ({ value: name, label: name })),
    ];
  }, [userFilterSource]);
  const userOrgTypeFilterOptions = useMemo(() => {
    const names = uniqueSortedLabels([
      ...organizationTypes.map((t) => t.name),
      ...userFilterSource.map((u) => u?.organization_type),
    ]);
    const hasEmpty = userFilterSource.some((u) => !String(u?.organization_type ?? '').trim());
    return [
      ...(hasEmpty ? [{ value: EMPTY_ORG_FILTER, label: 'No org type' }] : []),
      ...names.map((name) => ({ value: name, label: name })),
    ];
  }, [organizationTypes, userFilterSource]);
  const userEmailDomainFilterOptions = useMemo(() => {
    const domains = uniqueSortedLabels(userFilterSource.map((u) => getUserEmailDomain(u?.user_email)));
    return domains.map((domain) => ({ value: domain, label: domain }));
  }, [userFilterSource]);
  const userAssignedDomainFilterOptions = useMemo(
    () => allDomains.map((domain) => ({
      value: domain.domain_id,
      label: domain.domain_short_name || domain.domain_name,
      description: domain.domain_name && domain.domain_name !== domain.domain_short_name
        ? domain.domain_name
        : undefined,
    })),
    [allDomains]
  );
  const activeUserFilterChips = useMemo(() => {
    const chips: Array<{ id: string; label: string; onClear: () => void }> = [];
    const searchValue = userFilterSearch.trim();
    if (searchValue) {
      chips.push({ id: 'search', label: `Search: ${searchValue}`, onClear: () => setUserFilterSearch('') });
    }
    if (userFilterRole) {
      chips.push({ id: 'role', label: `Role: ${userFilterRole}`, onClear: () => setUserFilterRole('') });
    }
    if (userFilterStatus) {
      chips.push({ id: 'status', label: `Status: ${userFilterStatus}`, onClear: () => setUserFilterStatus('') });
    }
    if (userFilterOrganization) {
      chips.push({
        id: 'organization',
        label: `Organization: ${userFilterOrganization === EMPTY_ORG_FILTER ? 'None' : userFilterOrganization}`,
        onClear: () => setUserFilterOrganization(''),
      });
    }
    if (userFilterOrgType) {
      chips.push({
        id: 'orgType',
        label: `Org type: ${userFilterOrgType === EMPTY_ORG_FILTER ? 'None' : userFilterOrgType}`,
        onClear: () => setUserFilterOrgType(''),
      });
    }
    if (userFilterEmailDomain) {
      chips.push({
        id: 'emailDomain',
        label: `Email domain: ${userFilterEmailDomain}`,
        onClear: () => setUserFilterEmailDomain(''),
      });
    }
    if (userFilterDomain) {
      const domain = allDomains.find((item) => item.domain_id === userFilterDomain);
      chips.push({
        id: 'domain',
        label: `Assigned domain: ${domain?.domain_short_name || domain?.domain_name || userFilterDomain}`,
        onClear: () => setUserFilterDomain(''),
      });
    }
    return chips;
  }, [
    allDomains,
    userFilterDomain,
    userFilterEmailDomain,
    userFilterOrganization,
    userFilterOrgType,
    userFilterRole,
    userFilterSearch,
    userFilterStatus,
  ]);

  const loadAllUsersForDirectory = useCallback(async (force = false) => {
    if (!force && allUsersForFilterRef.current.length > 0) {
      return allUsersForFilterRef.current;
    }
    const requestId = ++userDirectoryRequestIdRef.current;
    setIsLoadingUserFilterDataset(true);
    try {
      const list = await api.getAllUsers();
      if (requestId !== userDirectoryRequestIdRef.current) {
        return allUsersForFilterRef.current;
      }
      const usersList = Array.isArray(list) ? list : [];
      setAllUsersForFilter(usersList);
      setUsersTotal(usersList.length);
      return usersList;
    } catch (err: any) {
      if (requestId === userDirectoryRequestIdRef.current) {
        setError(err?.message || 'Failed to load users for filtering');
      }
      return allUsersForFilterRef.current;
    } finally {
      if (requestId === userDirectoryRequestIdRef.current) {
        setIsLoadingUserFilterDataset(false);
      }
    }
  }, []);

  useEffect(() => {
    if (hasPermission('settings_access')) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [hasPermission]);

  useEffect(() => {
    if (activeTab === 'ideas' && hasPermission('settings_access')) {
      api.getAnonymousIdeas(ideasStatusFilter || undefined)
        .then((list) => setAnonymousIdeas(list || []))
        .catch(() => setAnonymousIdeas([]));
    }
  }, [activeTab, ideasStatusFilter, hasPermission]);

  useEffect(() => {
    if (activeTab === 'feedback' && hasPermission('settings_access')) {
      api.getFeedback(feedbackReleaseFilter)
        .then((list) => setFeedbackList(list || []))
        .catch(() => setFeedbackList([]));
    }
  }, [activeTab, hasPermission, feedbackReleaseFilter]);

  useEffect(() => {
    if (activeTab === 'feedback' && hasPermission('settings_access')) {
      api.getFeedbackReleaseNumbers()
        .then((list) => setFeedbackReleaseNumbers(list || []))
        .catch(() => setFeedbackReleaseNumbers([]));
    }
  }, [activeTab, hasPermission]);

  useEffect(() => {
    if (qualifyModal && domainsForQualify.length === 0) {
      api.getDomains().then((list : any) => setDomainsForQualify(list || [])).catch(() => setDomainsForQualify([]));
    }
  }, [qualifyModal]);

  useEffect(() => {
    if (activeTab !== 'users' || !hasPermission('settings_access') || allDomains.length > 0) return;
    api.getDomains()
      .then((list) => setAllDomains(list || []))
      .catch((err: any) => {
        logger.error('Error loading domains for user management', err);
        setError(err?.message || 'Failed to load domains for user management.');
      });
  }, [activeTab, hasPermission, allDomains.length]);

  useEffect(() => {
    setUserFilterPage(1);
  }, [
    normalizedUserFilterSearch,
    userFilterDomain,
    userFilterEmailDomain,
    userFilterOrganization,
    userFilterOrgType,
    userFilterRole,
    userFilterStatus,
  ]);

  // Prefetch full user directory when Users tab opens so search is never page-scoped.
  useEffect(() => {
    if (activeTab !== 'users' || !hasPermission('settings_access')) return;
    void loadAllUsersForDirectory(false);
  }, [activeTab, hasPermission, loadAllUsersForDirectory]);

  useEffect(() => {
    if (activeTab !== 'users' || !hasPermission('settings_access')) return;
    if (visibleUsers.length === 0) {
      setSelectedDomainByUserId({});
      setRowDomainActionLoading({});
      setDomainManagerOpenForUserId(null);
      return;
    }

    const visibleUserIds = new Set(visibleUsers.map((u) => u.user_id));
    const usersMissingDomains = visibleUsers.filter(
      (u) => u?.user_id && !Object.prototype.hasOwnProperty.call(assignedDomainsByUserId, u.user_id)
    );

    const pruneRowDomainState = () => {
      setSelectedDomainByUserId((prev) => {
        const next: Record<string, string> = {};
        Object.entries(prev).forEach(([userId, domainId]) => {
          if (visibleUserIds.has(userId)) {
            next[userId] = domainId;
          }
        });
        return next;
      });

      setRowDomainActionLoading((prev) => {
        const next: Record<string, boolean> = {};
        Object.entries(prev).forEach(([userId, isLoading]) => {
          if (visibleUserIds.has(userId) && isLoading) {
            next[userId] = isLoading;
          }
        });
        return next;
      });
    };

    if (usersMissingDomains.length === 0) {
      pruneRowDomainState();
      return;
    }

    let cancelled = false;

    Promise.all(
      usersMissingDomains.map(async (u): Promise<{ userId: string; domains: Domain[] }> => {
        try {
          const domains = await api.getUserAssignedDomains(u.user_id);
          return { userId: u.user_id, domains: domains || [] };
        } catch (err) {
          logger.error(`Error loading assigned domains for user ${u.user_id}`, err);
          return { userId: u.user_id, domains: [] };
        }
      })
    ).then((entries) => {
      if (cancelled) return;

      setAssignedDomainsByUserId((prev) => {
        const next: Record<string, Domain[]> = { ...prev };
        entries.forEach(({ userId, domains }) => {
          next[userId] = domains;
        });
        return next;
      });

      pruneRowDomainState();
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, assignedDomainsByUserId, hasPermission, visibleUsers]);

  useEffect(() => {
    if (activeTab !== 'users' || !hasPermission('settings_access') || !needsAssignedDomainIndex) return;

    const sourceUsers = allUsersForFilter.length > 0 ? allUsersForFilter : users;
    const usersMissingDomains = sourceUsers.filter(
      (u) => u?.user_id && !Object.prototype.hasOwnProperty.call(assignedDomainsByUserId, u.user_id)
    );
    if (usersMissingDomains.length === 0) return;

    let cancelled = false;

    Promise.all(
      usersMissingDomains.map(async (u): Promise<{ userId: string; domains: Domain[] }> => {
        try {
          const domains = await api.getUserAssignedDomains(u.user_id);
          return { userId: u.user_id, domains: domains || [] };
        } catch (err) {
          logger.error(`Error loading assigned domains for user ${u.user_id}`, err);
          return { userId: u.user_id, domains: [] };
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setAssignedDomainsByUserId((prev) => {
        const next = { ...prev };
        entries.forEach(({ userId, domains }) => {
          next[userId] = domains;
        });
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, allUsersForFilter, assignedDomainsByUserId, hasPermission, needsAssignedDomainIndex, users]);

  useEffect(() => {
    if (!domainManagerOpenForUserId) return;
    if (!visibleUsers.some((u) => u.user_id === domainManagerOpenForUserId)) {
      setDomainManagerOpenForUserId(null);
    }
  }, [domainManagerOpenForUserId, visibleUsers]);

  async function loadUsersPage(page: number) {
    try {
      const r = await api.getUsers(usersPerPage, (page - 1) * usersPerPage);
      setUsers(r?.users ?? []);
      setUsersTotal(r?.total ?? 0);
      // Keep allUsersForFilter so search continues to cover every user.
    } catch (err: any) {
      setError(err?.message || 'Failed to load users');
    }
  }

  async function loadData() {
    try {
      const [configData, rolesData, permissionsData, usersResponse, orgTypes, docTypes] = await Promise.all([
        api.getSystemConfig().catch(err => {
          logger.warn('System config not found, will use defaults', err);
          return null;
        }),
        api.getRoles(),
        api.getPermissions(),
        api.getUsers(usersPerPage, 0),
        api.getOrganizationTypes(),
        api.getSettingsDocumentTypes().catch(() => []),
      ]);

      // If config doesn't exist, create a default structure
      if (!configData) {
        setConfig({
          config_id: '',
          config_data: {
          system_name: 'AI Governance Workbench',
            version: '1.0.0',
            currency: 'USD',
            dataTable: { rowsPerPage: 10 },
            llm: { provider: 'OpenAI' },
            storage: { type: 'Local' },
            integrations: {}
          }
        });
      } else {
        // Ensure config_data has the expected structure
        const configWithDefaults = {
          ...configData,
          config_data: {
            system_name: configData.config_data?.system_name || 'AI Governance Workbench',
            version: configData.config_data?.version || '1.0.0',
            dataTable: configData.config_data?.dataTable || { rowsPerPage: 10 },
            llm: configData.config_data?.llm || { provider: 'OpenAI' },
            storage: configData.config_data?.storage || { type: 'Local' },
            integrations: configData.config_data?.integrations || {},
            ...configData.config_data
          }
        };
        setConfig(configWithDefaults);
      }

      setPermissions(permissionsData || []);
      setUsers(usersResponse?.users ?? []);
      setUsersTotal(usersResponse?.total ?? 0);
      setRoles(rolesData || []);
      setOrganizationTypes(orgTypes || []);
      setDocumentTypes(docTypes || []);
    } catch (err) {
      logger.error('Error loading settings', err);
      setError('Failed to load settings. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    if (!config || !user) return;

    setSaving(true);
    try {
      const updated = await api.updateSystemConfig(config.config_data);
      if (updated?.config_data) {
        setConfig({
          ...updated,
          config_data: {
            system_name: updated.config_data?.system_name || 'AI Governance Workbench',
            version: updated.config_data?.version || '1.0.0',
            dataTable: updated.config_data?.dataTable || { rowsPerPage: 10 },
            llm: updated.config_data?.llm || { provider: 'OpenAI' },
            storage: updated.config_data?.storage || { type: 'Local' },
            integrations: updated.config_data?.integrations || {},
            ...updated.config_data,
          },
        });
      }
      setSuccessMessage('Settings saved successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setError('Error saving settings: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveRole(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;

    try {
      if (editingRole) {
        const payload: {
          role_name?: string;
          role_description: string;
          permission_ids?: string[];
        } = {
          role_description: roleForm.role_description,
        };
        // System role names are immutable — only send name for custom roles.
        if (!editingRole.is_system) {
          payload.role_name = roleForm.role_name;
        }
        // Non-admins cannot change system role permissions (API also enforces).
        if (!(editingRole.is_system && !isAdmin)) {
          payload.permission_ids = selectedPermissions;
        }
        await api.updateRole(editingRole.role_id, payload);
      } else {
        await api.createRole({
          role_name: roleForm.role_name,
          role_description: roleForm.role_description,
          permission_ids: selectedPermissions
        });
      }

      setShowRoleModal(false);
      loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDeleteRole() {
    if (!deleteModal.item || !user || deleteModal.type !== 'role') return;
    if (deleteModal.item.is_system) {
      setError('System roles cannot be deleted');
      return;
    }

    try {
      await api.deleteRole(deleteModal.item.role_id);
      loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function openRoleCreateForm() {
    setEditingRole(null);
    setRoleForm({ role_name: '', role_description: '' });
    setSelectedPermissions([]);
    setShowRoleModal(true);
    setRoleFormFocusRequest((n) => n + 1);
  }

  function openRoleEditForm(role: RoleWithPermissions) {
    setEditingRole(role);
    setRoleForm({ role_name: role.role_name, role_description: role.role_description || '' });
    const permIds = (role.permissions || []).map((permName) => {
      const perm = permissions.find((p) => p.permission_name === permName);
      return perm?.permission_id || '';
    }).filter((id) => id);
    setSelectedPermissions(permIds);
    setShowRoleModal(true);
    setRoleFormFocusRequest((n) => n + 1);
  }

  useEffect(() => {
    if (!showRoleModal || roleFormFocusRequest === 0) return;

    const scrollToRoleForm = () => {
      const section = roleFormSectionRef.current;
      if (!section) return;
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const frame = window.requestAnimationFrame(scrollToRoleForm);
    return () => window.cancelAnimationFrame(frame);
  }, [showRoleModal, roleFormFocusRequest]);

  function openUserEditForm(u: any) {
    setEditingUser(u);
    setUserForm({
      user_name: u.user_name,
      user_email: u.user_email,
      user_pwd: '',
      role_id: u.role_id || '',
      organization: u.organization || '',
      organization_type: u.organization_type || '',
      user_image: u.user_image || null
    });
    setShowUserModal(true);
    setUserFormFocusRequest((n) => n + 1);
  }

  useEffect(() => {
    if (!showUserModal || userFormFocusRequest === 0) return;

    const scrollToUserForm = () => {
      const section = userFormSectionRef.current;
      if (!section) return;
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const frame = window.requestAnimationFrame(scrollToUserForm);
    return () => window.cancelAnimationFrame(frame);
  }, [showUserModal, userFormFocusRequest]);

  async function handleSaveUser(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;

    try {
      const userData: any = {
        user_name: userForm.user_name,
        user_email: userForm.user_email,
        role_id: userForm.role_id || null,
        organization: userForm.organization || undefined,
        organization_type: userForm.organization_type || undefined,
        user_image: userForm.user_image || undefined
      };

      if (userForm.user_pwd) {
        userData.user_pwd = userForm.user_pwd;
      }

      if (editingUser) {
        await api.updateUser(editingUser.user_id, userData);
      } else {
        await api.createUser(userData);
      }

      setShowUserModal(false);
      await loadUsersPage(usersPage);
      await loadAllUsersForDirectory(true);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDeactivateUser() {
    if (!deactivateModal.user || !user) return;

    try {
      await api.updateUser(deactivateModal.user.user_id, { is_active: false });
      setDeactivateModal({ isOpen: false, user: null });
      await loadUsersPage(usersPage);
      await loadAllUsersForDirectory(true);
      setSuccessMessage('User deactivated. They will not be able to sign in.');
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleActivateUser(u: any) {
    try {
      await api.updateUser(u.user_id, { is_active: true });
      await loadUsersPage(usersPage);
      await loadAllUsersForDirectory(true);
      setSuccessMessage('User activated. They can sign in again.');
    } catch (err: any) {
      setError(err.message);
    }
  }

  const isAdmin = (user as any)?.role?.role_name === 'portal_admin';

  async function handleDeleteUser() {
    if (!deleteUserModal.user || !user) return;
    try {
      await api.deleteUser(deleteUserModal.user.user_id);
      setDeleteUserModal({ isOpen: false, user: null });
      await loadUsersPage(usersPage);
      await loadAllUsersForDirectory(true);
      setSuccessMessage('User deleted.');
    } catch (err: any) {
      setError(err?.message || 'Failed to delete user.');
    }
  }

  async function refreshUserAssignedDomains(userId: string) {
    const refreshed = await api.getUserAssignedDomains(userId);
    setAssignedDomainsByUserId((prev) => ({
      ...prev,
      [userId]: refreshed || [],
    }));
    return refreshed || [];
  }

  async function handleAddUserDomain(userId: string) {
    const domainId = selectedDomainByUserId[userId];
    const isDomainAvailable = getAvailableDomainsForUser(userId).some((domain) => domain.domain_id === domainId);
    if (!domainId || !isDomainAvailable || rowDomainActionLoading[userId]) return;

    setRowDomainActionLoading((prev) => ({ ...prev, [userId]: true }));
    try {
      await api.assignDomainToUser(domainId, userId);
      await refreshUserAssignedDomains(userId);
      setSelectedDomainByUserId((prev) => ({ ...prev, [userId]: '' }));
      setSuccessMessage('Domain assigned successfully.');
    } catch (err: any) {
      setError(err?.message || 'Failed to assign domain. Please try again.');
    } finally {
      setRowDomainActionLoading((prev) => ({ ...prev, [userId]: false }));
    }
  }

  async function handleRemoveUserDomain(userId: string, domainId: string) {
    if (rowDomainActionLoading[userId]) return;

    setRowDomainActionLoading((prev) => ({ ...prev, [userId]: true }));
    try {
      await api.removeDomainFromUser(domainId, userId);
      await refreshUserAssignedDomains(userId);
      setSuccessMessage('Domain removed successfully.');
    } catch (err: any) {
      setError(err?.message || 'Failed to remove domain. Please try again.');
    } finally {
      setRowDomainActionLoading((prev) => ({ ...prev, [userId]: false }));
    }
  }

  function getAvailableDomainsForUser(userId: string) {
    const assignedDomains = assignedDomainsByUserId[userId] || [];
    return allDomains.filter(
      (domain) => !assignedDomains.some((assigned) => assigned.domain_id === domain.domain_id)
    );
  }

  function resetUserFilters() {
    setUserFilterSearch('');
    setUserFilterRole('');
    setUserFilterStatus('');
    setUserFilterOrganization('');
    setUserFilterOrgType('');
    setUserFilterEmailDomain('');
    setUserFilterDomain('');
    setUserFilterPage(1);
  }

  async function handleQualifyIdea(e: React.FormEvent) {
    e.preventDefault();
    if (!qualifyModal?.idea || !qualifyForm.target_domain_id || !qualifyForm.use_case_name.trim()) return;
    setQualifySaving(true);
    try {
      await api.qualifyIdea(qualifyModal.idea.idea_id, {
        target_domain_id: qualifyForm.target_domain_id,
        use_case_name: qualifyForm.use_case_name.trim().slice(0, 30),
        use_case_title: qualifyForm.use_case_title.trim() || undefined,
        use_case_description: qualifyForm.use_case_description.trim() || undefined,
        expected_benefits: qualifyForm.expected_benefits.trim() || undefined,
        department: qualifyForm.department.trim() || undefined,
        ai_category: qualifyForm.ai_category || undefined,
        feasibility: qualifyForm.feasibility || undefined,
        intended_audience: qualifyForm.intended_audience.trim() || undefined,
        tags: qualifyForm.tags.filter(Boolean),
      });
      setQualifyModal(null);
      setQualifyForm({ target_domain_id: '', use_case_name: '', use_case_title: '', use_case_description: '', expected_benefits: '', department: '', ai_category: '', feasibility: '', intended_audience: '', tags: [] });
      setSuccessMessage('Idea qualified and use case created.');
      api.getAnonymousIdeas(ideasStatusFilter || undefined).then((list) => setAnonymousIdeas(list || []));
    } catch (err: any) {
      setError(err?.message || 'Failed to qualify idea.');
    } finally {
      setQualifySaving(false);
    }
  }

  async function handleSaveOrganizationType(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    try {
      if (editingOrgType) {
        await api.updateOrganizationType(editingOrgType.org_type_id, {
          name: orgTypeForm.name.trim() || editingOrgType.name,
          description: orgTypeForm.description.trim() || null
        });
      } else {
        await api.createOrganizationType({
          name: orgTypeForm.name.trim(),
          description: orgTypeForm.description.trim() || null
        });
      }
      setOrgTypeForm({ name: '', description: '' });
      setEditingOrgType(null);
      const refreshed = await api.getOrganizationTypes();
      setOrganizationTypes(refreshed || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to save organization type');
    }
  }

  async function handleDeleteOrganizationType(orgType: OrganizationType) {
    if (!user) return;
    try {
      await api.deleteOrganizationType(orgType.org_type_id);
      const refreshed = await api.getOrganizationTypes();
      setOrganizationTypes(refreshed || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete organization type');
    }
  }

  function resetDocTypeForm() {
    setEditingDocType(null);
    setDocTypeForm({ name: '', description: '' });
  }

  async function handleSaveDocumentType(e: React.FormEvent) {
    e.preventDefault();
    if (!user || docTypeSaving) return;
    const name = docTypeForm.name.trim();
    if (!name) {
      setError('Enter a document type name.');
      return;
    }
    setDocTypeSaving(true);
    try {
      if (editingDocType) {
        await api.updateDocumentType(editingDocType.doc_type_id, {
          name,
          description: docTypeForm.description.trim() || null,
        });
        setSuccessMessage(`Updated document type “${name}”.`);
      } else {
        await api.createDocumentType({
          name,
          description: docTypeForm.description.trim() || null,
        });
        setSuccessMessage(`Added document type “${name}”.`);
      }
      resetDocTypeForm();
      const refreshed = await api.getSettingsDocumentTypes();
      setDocumentTypes(refreshed || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to save document type');
    } finally {
      setDocTypeSaving(false);
    }
  }

  async function handleDeleteDocumentType() {
    if (!user || !docTypeToDelete) return;
    const deletedName = docTypeToDelete.name;
    try {
      await api.deleteDocumentType(docTypeToDelete.doc_type_id);
      if (editingDocType?.doc_type_id === docTypeToDelete.doc_type_id) {
        resetDocTypeForm();
      }
      setDocTypeToDelete(null);
      const refreshed = await api.getSettingsDocumentTypes();
      setDocumentTypes(refreshed || []);
      setSuccessMessage(`Deleted document type “${deletedName}”.`);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete document type');
    }
  }

  function updateLLMConfig(field: string, value: any) {
    if (!config) return;

    const provider = config.config_data.llm?.provider || 'OpenAI';
    const providerKey = provider.toLowerCase() as 'azure' | 'gemini' | 'openai';

    setConfig({
      ...config,
      config_data: {
        ...config.config_data,
        llm: {
          ...config.config_data.llm,
          provider,
          [providerKey]: {
            ...config.config_data.llm?.[providerKey],
            [field]: value
          }
        }
      }
    });
  }

  function updateStorageConfig(field: string, value: any) {
    if (!config) return;

    const storageType = config.config_data.storage?.type || 'Local';
    type StorageProviderKey = 'local' | 'github' | 'awsS3' | 'azureStorage';
    const storageKey: StorageProviderKey = storageType === 'Local' ? 'local'
      : storageType === 'GitHub' ? 'github'
      : storageType === 'AWS S3' ? 'awsS3'
      : 'azureStorage';
    const currentStorageConfig = config.config_data.storage?.[storageKey] ?? {};

    setConfig({
      ...config,
      config_data: {
        ...config.config_data,
        storage: {
          ...config.config_data.storage,
          type: storageType,
          [storageKey]: {
            ...currentStorageConfig,
            [field]: value
          }
        }
      }
    });
  }

  function updateIntegrationConfig(integration: 'airflow' | 'mlflow', field: string, value: any) {
    if (!config) return;

    setConfig({
      ...config,
      config_data: {
        ...config.config_data,
        integrations: {
          ...config.config_data.integrations,
          [integration]: {
            ...config.config_data.integrations?.[integration],
            [field]: value
          }
        }
      }
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-600 dark:text-slate-400">Loading settings...</div>
      </div>
    );
  }

  if (!hasPermission('settings_access')) {
    return (
      <div className="wb-page">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div>
          <h2 className="wb-page-title">Settings</h2>
          <p className="wb-page-subtitle">You do not have permission to access settings.</p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-600 dark:text-slate-400">No configuration found</div>
      </div>
    );
  }

  const currentProvider = config.config_data.llm?.provider || 'OpenAI';
  const currentStorageType = config.config_data.storage?.type || 'Local';
  const domainManagerUser = domainManagerOpenForUserId
    ? [...visibleUsers, ...users, ...allUsersForFilter].find((u) => u.user_id === domainManagerOpenForUserId) || null
    : null;

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

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="wb-page-title">Settings</h2>
            <p className="wb-page-subtitle">Manage system configuration</p>
          </div>
          {activeTab !== 'roles' && activeTab !== 'users' && activeTab !== 'organization_types' && activeTab !== 'document_types' && activeTab !== 'assessment_checklist' && activeTab !== 'ideas' && activeTab !== 'feedback' && (
            <HoverTip label={saving ? 'Saving settings…' : 'Save configuration changes'}>
              <button
                onClick={saveConfig}
                disabled={saving}
                className="wb-btn-primary"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </HoverTip>
          )}
        </div>
      </div>

      <div className="border-b border-line">
        <div className="flex flex-wrap gap-x-1 gap-y-0">
          {[
            { id: 'datatable', label: 'Data Table' },
            { id: 'llm', label: 'LLM Settings' },
            { id: 'storage', label: 'Storage' },
            { id: 'integrations', label: 'Integrations' },
            { id: 'roles', label: 'Roles' },
            { id: 'organization_types', label: 'Organization Types' },
            { id: 'document_types', label: 'Document Types' },
            ...(hasPermission('manage_assessment_checklist') ? [{ id: 'assessment_checklist', label: 'AI Assessment Checklist' }] : []),
            { id: 'users', label: 'Users' },
            { id: 'ideas', label: 'Ideas' },
            { id: 'feedback', label: 'Bug reports' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as SettingsTab)}
              className={`wb-tab ${
                activeTab === tab.id ? 'wb-tab-active' : 'wb-tab-idle'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="wb-card-pad">
        {activeTab === 'datatable' && (
          <div className="space-y-4">
            <h3 className="font-display text-lg font-semibold text-ink mb-4">Data Table Settings</h3>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Rows Per Page
              </label>
              <input
                type="number"
                min="5"
                max="100"
                value={config.config_data.dataTable?.rowsPerPage || 10}
                onChange={(e) => setConfig({
                  ...config,
                  config_data: {
                    ...config.config_data,
                    dataTable: { rowsPerPage: parseInt(e.target.value) }
                  }
                })}
                className="w-full max-w-xs px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Default currency (estimates)
              </label>
              <div className="w-full max-w-xs">
                <SelectMenu
                  value={config.config_data.currency || 'USD'}
                  onChange={(currency) => setConfig({
                    ...config,
                    config_data: {
                      ...config.config_data,
                      currency,
                    }
                  })}
                  options={['USD', 'EUR', 'GBP', 'INR', 'AED', 'SGD', 'JPY', 'AUD', 'CAD'].map((c) => ({ value: c, label: c }))}
                  aria-label="Default currency"
                />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Used as the default currency when assigning cost estimates.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'llm' && (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">LLM Settings</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Configure the AI provider used for rewrite, documentation quality, and assessment pre-fill.
              Saved UI settings are preferred. If UI credentials fail (auth / invalid model), the API
              automatically falls back to <code className="text-xs">LLM_*</code> values from <code className="text-xs">.env</code>.
            </p>

            <div className="flex items-center gap-3">
              <input
                id="llm-enabled"
                type="checkbox"
                checked={config.config_data.llm?.enabled !== false}
                onChange={(e) => setConfig({
                  ...config,
                  config_data: {
                    ...config.config_data,
                    llm: {
                      ...config.config_data.llm,
                      provider: currentProvider,
                      enabled: e.target.checked,
                    }
                  }
                })}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="llm-enabled" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Enable AI features
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Provider
              </label>
              <div className="w-full max-w-xs">
                <SelectMenu
                  value={currentProvider}
                  onChange={(provider) => setConfig({
                    ...config,
                    config_data: {
                      ...config.config_data,
                      llm: { ...config.config_data.llm, provider: provider as any }
                    }
                  })}
                  options={[
                    { value: 'OpenAI', label: 'OpenAI / Compatible' },
                    { value: 'Azure', label: 'Azure OpenAI' },
                    { value: 'Gemini', label: 'Gemini' },
                  ]}
                  aria-label="LLM Provider"
                />
              </div>
            </div>

            {currentProvider === 'OpenAI' && (
              <div className="space-y-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                <h4 className="font-medium text-slate-900 dark:text-white">OpenAI / Compatible Configuration</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Official OpenAI, or set Base URL for Groq / OpenRouter / Together / other OpenAI-compatible hosts.
                </p>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    API Key *
                  </label>
                  <input
                    type="password"
                    value={config.config_data.llm?.openai?.apiKey || ''}
                    onChange={(e) => updateLLMConfig('apiKey', e.target.value)}
                    placeholder="sk-... or provider key"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Model *
                  </label>
                  <input
                    type="text"
                    value={config.config_data.llm?.openai?.model || ''}
                    onChange={(e) => updateLLMConfig('model', e.target.value)}
                    placeholder="gpt-4o-mini or openai/gpt-oss-20b"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={config.config_data.llm?.openai?.baseUrl || ''}
                    onChange={(e) => updateLLMConfig('baseUrl', e.target.value)}
                    placeholder="https://api.openai.com/v1 or https://api.groq.com/openai/v1"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Organization ID (Optional)
                  </label>
                  <input
                    type="text"
                    value={config.config_data.llm?.openai?.organization || ''}
                    onChange={(e) => updateLLMConfig('organization', e.target.value)}
                    placeholder="org-..."
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            )}

            {currentProvider === 'Azure' && (
              <div className="space-y-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                <h4 className="font-medium text-slate-900 dark:text-white">Azure OpenAI Configuration</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Use your Azure resource endpoint and deployment name. API version is required by Azure.
                </p>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    API Key *
                  </label>
                  <input
                    type="password"
                    value={config.config_data.llm?.azure?.apiKey || ''}
                    onChange={(e) => updateLLMConfig('apiKey', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Endpoint *
                  </label>
                  <input
                    type="text"
                    value={config.config_data.llm?.azure?.endpoint || ''}
                    onChange={(e) => updateLLMConfig('endpoint', e.target.value)}
                    placeholder="https://your-resource.openai.azure.com"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Deployment Name *
                  </label>
                  <input
                    type="text"
                    value={config.config_data.llm?.azure?.deploymentName || ''}
                    onChange={(e) => updateLLMConfig('deploymentName', e.target.value)}
                    placeholder="rudhra-dev-gpt-4o"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    API Version *
                  </label>
                  <input
                    type="text"
                    value={config.config_data.llm?.azure?.apiVersion || config.config_data.llm?.azure?.modelVersion || ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      setConfig({
                        ...config,
                        config_data: {
                          ...config.config_data,
                          llm: {
                            ...config.config_data.llm,
                            provider: 'Azure',
                            azure: {
                              ...config.config_data.llm?.azure,
                              apiKey: config.config_data.llm?.azure?.apiKey || '',
                              endpoint: config.config_data.llm?.azure?.endpoint || '',
                              deploymentName: config.config_data.llm?.azure?.deploymentName || '',
                              apiVersion: value,
                              modelVersion: value,
                            },
                          },
                        },
                      });
                    }}
                    placeholder="2024-08-01-preview"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            )}

            {currentProvider === 'Gemini' && (
              <div className="space-y-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                <h4 className="font-medium text-slate-900 dark:text-white">Google Gemini Configuration</h4>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    API Key *
                  </label>
                  <input
                    type="password"
                    value={config.config_data.llm?.gemini?.apiKey || ''}
                    onChange={(e) => updateLLMConfig('apiKey', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Model *
                  </label>
                  <input
                    type="text"
                    value={config.config_data.llm?.gemini?.model || ''}
                    onChange={(e) => updateLLMConfig('model', e.target.value)}
                    placeholder="gemini-1.5-flash"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    API Version
                  </label>
                  <input
                    type="text"
                    value={config.config_data.llm?.gemini?.apiVersion || 'v1beta'}
                    onChange={(e) => updateLLMConfig('apiVersion', e.target.value)}
                    placeholder="v1beta"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Base URL (Optional)
                  </label>
                  <input
                    type="text"
                    value={config.config_data.llm?.gemini?.baseUrl || ''}
                    onChange={(e) => updateLLMConfig('baseUrl', e.target.value)}
                    placeholder="https://generativelanguage.googleapis.com"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            )}

            <div className="space-y-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
              <h4 className="font-medium text-slate-900 dark:text-white">Shared options</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Applied for OpenAI / Compatible and Gemini. Azure may ignore temperature for some deployments.
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Temperature
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={config.config_data.llm?.temperature ?? 0.1}
                    onChange={(e) => setConfig({
                      ...config,
                      config_data: {
                        ...config.config_data,
                        llm: {
                          ...config.config_data.llm,
                          provider: currentProvider,
                          temperature: e.target.value === '' ? undefined : Number(e.target.value),
                        }
                      }
                    })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Max tokens
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={128000}
                    step={1}
                    value={config.config_data.llm?.maxTokens ?? 1100}
                    onChange={(e) => setConfig({
                      ...config,
                      config_data: {
                        ...config.config_data,
                        llm: {
                          ...config.config_data.llm,
                          provider: currentProvider,
                          maxTokens: e.target.value === '' ? undefined : Number(e.target.value),
                        }
                      }
                    })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Timeout (seconds)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={300}
                    step={1}
                    value={config.config_data.llm?.timeoutSeconds ?? 20}
                    onChange={(e) => setConfig({
                      ...config,
                      config_data: {
                        ...config.config_data,
                        llm: {
                          ...config.config_data.llm,
                          provider: currentProvider,
                          timeoutSeconds: e.target.value === '' ? undefined : Number(e.target.value),
                        }
                      }
                    })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'storage' && (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Storage Settings</h3>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Storage Type
              </label>
              <div className="w-full max-w-xs">
                <SelectMenu
                  value={currentStorageType}
                  onChange={(storageType) => setConfig({
                    ...config,
                    config_data: {
                      ...config.config_data,
                      storage: { type: storageType as any }
                    }
                  })}
                  options={[
                    { value: 'Local', label: 'Local' },
                    { value: 'GitHub', label: 'GitHub' },
                    { value: 'AWS S3', label: 'AWS S3' },
                    { value: 'Azure Storage', label: 'Azure Storage' },
                  ]}
                  aria-label="Storage Type"
                />
              </div>
            </div>

            {currentStorageType === 'Local' && (
              <div className="space-y-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                <h4 className="font-medium text-slate-900 dark:text-white">Local Storage Configuration</h4>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Folder Path *
                  </label>
                  <input
                    type="text"
                    value={config.config_data.storage?.local?.folderPath || ''}
                    onChange={(e) => updateStorageConfig('folderPath', e.target.value)}
                    placeholder="/path/to/storage/folder"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            )}

            {currentStorageType === 'GitHub' && (
              <div className="space-y-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                <h4 className="font-medium text-slate-900 dark:text-white">GitHub Storage Configuration</h4>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Repository Owner *
                  </label>
                  <input
                    type="text"
                    value={config.config_data.storage?.github?.repoOwner || ''}
                    onChange={(e) => updateStorageConfig('repoOwner', e.target.value)}
                    placeholder="username or organization"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Repository Name *
                  </label>
                  <input
                    type="text"
                    value={config.config_data.storage?.github?.repoName || ''}
                    onChange={(e) => updateStorageConfig('repoName', e.target.value)}
                    placeholder="my-repository"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Branch *
                  </label>
                  <input
                    type="text"
                    value={config.config_data.storage?.github?.branch || ''}
                    onChange={(e) => updateStorageConfig('branch', e.target.value)}
                    placeholder="main"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Personal Access Token *
                  </label>
                  <input
                    type="password"
                    value={config.config_data.storage?.github?.token || ''}
                    onChange={(e) => updateStorageConfig('token', e.target.value)}
                    placeholder="ghp_..."
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            )}

            {currentStorageType === 'AWS S3' && (
              <div className="space-y-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                <h4 className="font-medium text-slate-900 dark:text-white">AWS S3 Configuration</h4>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Access Key ID *
                  </label>
                  <input
                    type="text"
                    value={config.config_data.storage?.awsS3?.accessKeyId || ''}
                    onChange={(e) => updateStorageConfig('accessKeyId', e.target.value)}
                    placeholder="AKIAIOSFODNN7EXAMPLE"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Secret Access Key *
                  </label>
                  <input
                    type="password"
                    value={config.config_data.storage?.awsS3?.secretAccessKey || ''}
                    onChange={(e) => updateStorageConfig('secretAccessKey', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Region *
                  </label>
                  <input
                    type="text"
                    value={config.config_data.storage?.awsS3?.region || ''}
                    onChange={(e) => updateStorageConfig('region', e.target.value)}
                    placeholder="us-east-1"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Bucket Name *
                  </label>
                  <input
                    type="text"
                    value={config.config_data.storage?.awsS3?.bucket || ''}
                    onChange={(e) => updateStorageConfig('bucket', e.target.value)}
                    placeholder="my-bucket"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            )}

            {currentStorageType === 'Azure Storage' && (
              <div className="space-y-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                <h4 className="font-medium text-slate-900 dark:text-white">Azure Storage Configuration</h4>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Account Name *
                  </label>
                  <input
                    type="text"
                    value={config.config_data.storage?.azureStorage?.accountName || ''}
                    onChange={(e) => updateStorageConfig('accountName', e.target.value)}
                    placeholder="mystorageaccount"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Account Key *
                  </label>
                  <input
                    type="password"
                    value={config.config_data.storage?.azureStorage?.accountKey || ''}
                    onChange={(e) => updateStorageConfig('accountKey', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Container Name *
                  </label>
                  <input
                    type="text"
                    value={config.config_data.storage?.azureStorage?.containerName || ''}
                    onChange={(e) => updateStorageConfig('containerName', e.target.value)}
                    placeholder="my-container"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'integrations' && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Integration Settings</h3>

            <div className="space-y-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
              <h4 className="font-medium text-slate-900 dark:text-white">Apache Airflow</h4>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Host URL *
                </label>
                <input
                  type="text"
                  value={config.config_data.integrations?.airflow?.hostUrl || ''}
                  onChange={(e) => updateIntegrationConfig('airflow', 'hostUrl', e.target.value)}
                  placeholder="https://airflow.example.com"
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Username *
                </label>
                <input
                  type="text"
                  value={config.config_data.integrations?.airflow?.username || ''}
                  onChange={(e) => updateIntegrationConfig('airflow', 'username', e.target.value)}
                  placeholder="admin"
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Password *
                </label>
                <input
                  type="password"
                  value={config.config_data.integrations?.airflow?.password || ''}
                  onChange={(e) => updateIntegrationConfig('airflow', 'password', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="space-y-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
              <h4 className="font-medium text-slate-900 dark:text-white">MLflow</h4>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Host URL *
                </label>
                <input
                  type="text"
                  value={config.config_data.integrations?.mlflow?.hostUrl || ''}
                  onChange={(e) => updateIntegrationConfig('mlflow', 'hostUrl', e.target.value)}
                  placeholder="https://mlflow.example.com"
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Tracking URI (Optional)
                </label>
                <input
                  type="text"
                  value={config.config_data.integrations?.mlflow?.trackingUri || ''}
                  onChange={(e) => updateIntegrationConfig('mlflow', 'trackingUri', e.target.value)}
                  placeholder="http://mlflow-tracking.example.com"
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'roles' && (
          <RolesPermissionsPanel
            roles={roles}
            permissions={permissions}
            users={allUsersForFilter.length > 0 ? allUsersForFilter : users}
            isAdmin={isAdmin}
            showForm={showRoleModal}
            editingRole={editingRole}
            roleForm={roleForm}
            selectedPermissions={selectedPermissions}
            formSectionRef={roleFormSectionRef}
            onOpenCreate={openRoleCreateForm}
            onOpenEdit={openRoleEditForm}
            onCloseForm={() => setShowRoleModal(false)}
            onRoleFormChange={setRoleForm}
            onSelectedPermissionsChange={setSelectedPermissions}
            onSave={handleSaveRole}
            onRequestDelete={(role) => setDeleteModal({ isOpen: true, type: 'role', item: role })}
          />
        )}

        {activeTab === 'organization_types' && (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Organization Types</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Manage reusable organization type labels that can be selected when creating or editing users.
            </p>
            <div className="p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <div />
                {editingOrgType && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingOrgType(null);
                      setOrgTypeForm({ name: '', description: '' });
                    }}
                    className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    Clear selection
                  </button>
                )}
              </div>

              <form onSubmit={handleSaveOrganizationType} className="grid gap-3 md:grid-cols-2 mb-4">
                <div className="flex flex-col gap-1">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Type Name *
                  </label>
                  <input
                    type="text"
                    value={orgTypeForm.name}
                    onChange={(e) => setOrgTypeForm({ ...orgTypeForm, name: e.target.value })}
                    maxLength={50}
                    placeholder="e.g. Partner, Internal, Customer"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Description (optional)
                  </label>
                  <input
                    type="text"
                    value={orgTypeForm.description}
                    onChange={(e) => setOrgTypeForm({ ...orgTypeForm, description: e.target.value })}
                    maxLength={250}
                    placeholder="Short description of this organization type"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                  />
                </div>
                <div className="md:col-span-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingOrgType(null);
                      setOrgTypeForm({ name: '', description: '' });
                    }}
                    className="px-3 py-2 border border-slate-300 dark:border-slate-600 text-xs md:text-sm text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    Reset
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs md:text-sm transition-colors"
                  >
                    {editingOrgType ? 'Update Type' : 'Add Type'}
                  </button>
                </div>
              </form>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {organizationTypes.length === 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    No organization types defined yet. Add one above to get started.
                  </p>
                )}
                {organizationTypes.map((t) => (
                  <div
                    key={t.org_type_id}
                    className="flex items-start justify-between px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60"
                  >
                    <div className="mr-3">
                      <div className="text-sm font-medium text-slate-900 dark:text-white">{t.name}</div>
                      {t.description && (
                        <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                          {t.description}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <HoverTip label="Edit organization type" side="top" align="end">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingOrgType(t);
                            setOrgTypeForm({ name: t.name, description: t.description || '' });
                          }}
                          className="p-1.5 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          aria-label="Edit organization type"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      </HoverTip>
                      <HoverTip label="Delete organization type" side="top" align="end">
                        <button
                          type="button"
                          onClick={() => handleDeleteOrganizationType(t)}
                          className="p-1.5 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          aria-label="Delete organization type"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </HoverTip>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'document_types' && (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Document Types</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Manage reusable document type labels that can be selected when uploading files on References, Resource management, and Technical Analysis.
            </p>
            <div className="p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <div />
                {editingDocType && (
                  <button
                    type="button"
                    onClick={resetDocTypeForm}
                    className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    Clear selection
                  </button>
                )}
              </div>

              <form onSubmit={handleSaveDocumentType} className="grid gap-3 md:grid-cols-2 mb-4">
                <div className="flex flex-col gap-1">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Type Name *
                  </label>
                  <input
                    type="text"
                    value={docTypeForm.name}
                    onChange={(e) => setDocTypeForm({ ...docTypeForm, name: e.target.value })}
                    maxLength={80}
                    placeholder="e.g. Architecture diagram, SOP, Data flow"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Description (optional)
                  </label>
                  <input
                    type="text"
                    value={docTypeForm.description}
                    onChange={(e) => setDocTypeForm({ ...docTypeForm, description: e.target.value })}
                    maxLength={250}
                    placeholder="Short description of this document type"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                  />
                </div>
                <div className="md:col-span-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={resetDocTypeForm}
                    className="px-3 py-2 border border-slate-300 dark:border-slate-600 text-xs md:text-sm text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    Reset
                  </button>
                  <button
                    type="submit"
                    disabled={docTypeSaving}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs md:text-sm transition-colors disabled:opacity-50"
                  >
                    {docTypeSaving ? 'Saving...' : editingDocType ? 'Update Type' : 'Add Type'}
                  </button>
                </div>
              </form>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {documentTypes.length === 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    No document types defined yet. Add one above to get started.
                  </p>
                )}
                {documentTypes.map((item) => (
                  <div
                    key={item.doc_type_id}
                    className="flex items-start justify-between px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60"
                  >
                    <div className="mr-3">
                      <div className="text-sm font-medium text-slate-900 dark:text-white">{item.name}</div>
                      {item.description && (
                        <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                          {item.description}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <HoverTip label="Edit document type" side="top" align="end">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingDocType(item);
                            setDocTypeForm({ name: item.name, description: item.description || '' });
                          }}
                          className="p-1.5 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          aria-label="Edit document type"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      </HoverTip>
                      <HoverTip label="Delete document type" side="top" align="end">
                        <button
                          type="button"
                          onClick={() => setDocTypeToDelete(item)}
                          className="p-1.5 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          aria-label="Delete document type"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </HoverTip>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'assessment_checklist' && hasPermission('manage_assessment_checklist') && (
          <AssessmentChecklistSettings />
        )}

        {activeTab === 'users' && (
          <UsersManagementPanel
            currentUserId={user?.user_id}
            isAdmin={isAdmin}
            showForm={showUserModal}
            editingUser={editingUser}
            userForm={userForm}
            formSectionRef={userFormSectionRef}
            roles={roles}
            organizationTypes={organizationTypes}
            visibleUsers={visibleUsers}
            assignedDomainsByUserId={assignedDomainsByUserId}
            userFilterSearch={userFilterSearch}
            userFilterRole={userFilterRole}
            userFilterStatus={userFilterStatus}
            userFilterOrganization={userFilterOrganization}
            userFilterOrgType={userFilterOrgType}
            userFilterEmailDomain={userFilterEmailDomain}
            userFilterDomain={userFilterDomain}
            userRoleFilterOptions={userRoleFilterOptions}
            userOrganizationFilterOptions={userOrganizationFilterOptions}
            userOrgTypeFilterOptions={userOrgTypeFilterOptions}
            userEmailDomainFilterOptions={userEmailDomainFilterOptions}
            userAssignedDomainFilterOptions={userAssignedDomainFilterOptions}
            statusFilterOptions={USER_STATUS_FILTER_OPTIONS}
            activeUserFilterChips={activeUserFilterChips}
            isUserFilterActive={isUserFilterActive}
            isUserSearchLoading={isUserSearchLoading}
            filteredUsersCount={filteredUsers.length}
            userRowsTotal={userRowsTotal}
            usersPerPage={usersPerPage}
            activeUsersPage={activeUsersPage}
            userRowsPageCount={userRowsPageCount}
            sortField={userSortField}
            sortDir={userSortDir}
            onSort={handleUserSort}
            getUserStatusLabel={getUserStatusLabel}
            getUserStatusClass={getUserStatusClass}
            getUserRegistrationStatus={getUserRegistrationStatus}
            onUserFilterSearchChange={setUserFilterSearch}
            onUserFilterRoleChange={setUserFilterRole}
            onUserFilterStatusChange={setUserFilterStatus}
            onUserFilterOrganizationChange={setUserFilterOrganization}
            onUserFilterOrgTypeChange={setUserFilterOrgType}
            onUserFilterEmailDomainChange={setUserFilterEmailDomain}
            onUserFilterDomainChange={setUserFilterDomain}
            onResetFilters={resetUserFilters}
            onOpenCreate={() => {
              setEditingUser(null);
              setUserForm({
                user_name: '',
                user_email: '',
                user_pwd: '',
                role_id: '',
                organization: '',
                organization_type: '',
                user_image: null,
              });
              setShowUserModal(true);
              setUserFormFocusRequest((n) => n + 1);
            }}
            onOpenEdit={openUserEditForm}
            onCloseForm={() => setShowUserModal(false)}
            onUserFormChange={setUserForm}
            onSave={handleSaveUser}
            onManageDomains={setDomainManagerOpenForUserId}
            onDeactivate={(u) => setDeactivateModal({ isOpen: true, user: u })}
            onActivate={handleActivateUser}
            onDelete={(u) => setDeleteUserModal({ isOpen: true, user: u })}
            onPrevPage={() => {
              const p = Math.max(1, activeUsersPage - 1);
              if (useClientUserPaging) {
                setUserFilterPage(p);
              } else {
                setUsersPage(p);
                loadUsersPage(p);
              }
            }}
            onNextPage={() => {
              const p = Math.min(userRowsPageCount, activeUsersPage + 1);
              if (useClientUserPaging) {
                setUserFilterPage(p);
              } else {
                setUsersPage(p);
                loadUsersPage(p);
              }
            }}
          />
        )}

        {activeTab === 'feedback' && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Bug reports & feature requests</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">Submitted by users via the bug icon in the header.</p>
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Release filter:</span>
              <div className="w-full min-w-0 sm:w-64">
                <SelectMenu
                  value={feedbackReleaseFilter}
                  onChange={setFeedbackReleaseFilter}
                  variant="filter"
                  options={[
                    { value: 'unassigned', label: 'Unassigned only (default)' },
                    { value: 'all', label: 'All' },
                    ...feedbackReleaseNumbers.map((rel) => ({ value: rel, label: rel })),
                  ]}
                  aria-label="Release filter"
                />
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Type</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Comments</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Date</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Submitted by</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Release</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Screenshot</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {feedbackList.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">No bug reports or feature requests yet.</td></tr>
                  )}
                  {feedbackList.map((item) => (
                    <tr key={item.report_id} className="bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${item.report_type === 'bug' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'}`}>
                          {item.report_type === 'bug' ? 'Bug' : 'Feature'}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <p className="line-clamp-3 text-slate-900 dark:text-white">{item.comments || '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {item.submitted_dt ? new Date(item.submitted_dt).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {item.submitted_by_name || item.submitted_by_email || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1 flex-wrap">
                          <input
                            type="text"
                            list={`release-list-${item.report_id}`}
                            value={item.report_id in feedbackReleaseEdit ? feedbackReleaseEdit[item.report_id] : (item.release_number ?? '')}
                            disabled={feedbackUpdatingId === item.report_id}
                            placeholder="—"
                            onChange={(e) => {
                              setFeedbackReleaseEdit((prev) => ({ ...prev, [item.report_id]: e.target.value }));
                            }}
                            onBlur={async () => {
                              const current = item.report_id in feedbackReleaseEdit ? feedbackReleaseEdit[item.report_id] : (item.release_number ?? '');
                              const val = current.trim();
                              const release_number = val === '' ? null : val;
                              setFeedbackReleaseEdit((prev) => {
                                const next = { ...prev };
                                delete next[item.report_id];
                                return next;
                              });
                              if (release_number === (item.release_number ?? null)) return;
                              setFeedbackUpdatingId(item.report_id);
                              setError('');
                              try {
                                await api.updateFeedbackRelease(item.report_id, { release_number });
                                setFeedbackList((prev) => prev.map((r) => (r.report_id === item.report_id ? { ...r, release_number } : r)));
                                if (release_number && !feedbackReleaseNumbers.includes(release_number)) {
                                  setFeedbackReleaseNumbers((prev) => [...prev, release_number].sort());
                                }
                              } catch (err: any) {
                                setError(err?.message || 'Failed to update release');
                              } finally {
                                setFeedbackUpdatingId(null);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                            className="px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-xs min-w-[6rem] max-w-[10rem]"
                          />
                          <datalist id={`release-list-${item.report_id}`}>
                            {feedbackReleaseNumbers.map((rel) => (
                              <option key={rel} value={rel} />
                            ))}
                          </datalist>
                          {feedbackUpdatingId === item.report_id && <span className="text-xs text-slate-400">Saving…</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {item.screenshot ? (
                          <HoverTip label="View screenshot" side="top">
                            <button
                              type="button"
                              onClick={() => setFeedbackImageView(item.screenshot)}
                              className="text-blue-600 dark:text-blue-400 hover:underline text-sm"
                            >
                              View
                            </button>
                          </HoverTip>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {feedbackImageView && (
              <div className="wb-app-overlay z-50 flex items-center justify-center bg-black/80 p-4">
                <div className="relative max-w-full max-h-full">
                  <img src={feedbackImageView} alt="Screenshot" className="max-w-full max-h-[90vh] object-contain rounded shadow-xl" />
                  <div className="absolute top-2 right-2">
                    <HoverTip label="Close screenshot" align="end">
                      <button type="button" onClick={() => setFeedbackImageView(null)} className="p-2 bg-white/90 dark:bg-slate-800 rounded-full text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700" aria-label="Close screenshot">
                        <X className="w-5 h-5" />
                      </button>
                    </HoverTip>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'ideas' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Anonymous ideas</h3>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600 dark:text-slate-400">Status:</span>
                <div className="w-36">
                  <SelectMenu
                    value={ideasStatusFilter}
                    onChange={setIdeasStatusFilter}
                    variant="filter"
                    placeholder="All"
                    options={[
                      { value: 'new', label: 'New' },
                      { value: 'qualified', label: 'Qualified' },
                    ]}
                    aria-label="Idea status"
                  />
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Domain</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Idea</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Submitted by</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Status</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {anonymousIdeas.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">No ideas yet. External users can submit ideas from the login page without an account.</td></tr>
                  )}
                  {anonymousIdeas.map((idea) => (
                    <tr key={idea.idea_id} className="bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{idea.domain_name ?? '—'}</td>
                      <td className="px-4 py-3 max-w-xs">
                        <p className="line-clamp-2 text-slate-900 dark:text-white">{idea.idea_text}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {[idea.submitted_by_email ?? idea.submitted_by_name, idea.submitted_by_organization].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${idea.status === 'qualified' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'}`}>
                          {idea.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {idea.status === 'new' && (
                          <HoverTip label="Qualify idea into a use case" side="top" align="end">
                            <button
                              type="button"
                              onClick={() => {
                                setQualifyModal({ idea });
                                setQualifyForm({
                                  target_domain_id: idea.domain_id || '',
                                  use_case_name: (idea.idea_text || '').slice(0, 30),
                                  use_case_title: '',
                                  use_case_description: (idea.idea_text || '').slice(0, 500),
                                  expected_benefits: '',
                                  department: '',
                                  ai_category: '',
                                  feasibility: '',
                                  intended_audience: '',
                                  tags: [],
                                });
                                setDomainsForQualify([]);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
                            >
                              <CheckCircle className="w-4 h-4" />
                              Qualify
                            </button>
                          </HoverTip>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {domainManagerUser && (
          <div className="wb-app-overlay z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full my-8 border border-slate-200 dark:border-slate-700">
              <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Manage Assigned Domains</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    {domainManagerUser.user_name} ({domainManagerUser.user_email})
                  </p>
                </div>
                <HoverTip label="Close" align="end">
                  <button
                    type="button"
                    onClick={() => setDomainManagerOpenForUserId(null)}
                    className="p-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </HoverTip>
              </div>

              <div className="p-6 space-y-5">
                <div>
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Assigned domains ({(assignedDomainsByUserId[domainManagerUser.user_id] || []).length})
                    </h4>
                    {rowDomainActionLoading[domainManagerUser.user_id] && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">Updating...</span>
                    )}
                  </div>

                  {(assignedDomainsByUserId[domainManagerUser.user_id] || []).length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 px-4 py-6 text-sm text-center text-slate-500 dark:text-slate-400">
                      No domains assigned
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-1">
                      {(assignedDomainsByUserId[domainManagerUser.user_id] || []).map((domain) => (
                        <span
                          key={domain.domain_id}
                          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 dark:border-slate-600 dark:bg-slate-700/70 dark:text-slate-200"
                        >
                          <span>{domain.domain_name}</span>
                          <HoverTip label={`Remove ${domain.domain_name}`} side="top">
                            <button
                              type="button"
                              onClick={() => handleRemoveUserDomain(domainManagerUser.user_id, domain.domain_id)}
                              disabled={!!rowDomainActionLoading[domainManagerUser.user_id]}
                              className="rounded-full p-0.5 text-slate-500 transition-colors hover:bg-slate-200 hover:text-red-600 dark:text-slate-300 dark:hover:bg-slate-600 dark:hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                              aria-label={`Remove ${domain.domain_name}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </HoverTip>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 p-4">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Add domain</h4>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <SelectMenu
                      value={selectedDomainByUserId[domainManagerUser.user_id] || ''}
                      onChange={(domainId) =>
                        setSelectedDomainByUserId((prev) => ({ ...prev, [domainManagerUser.user_id]: domainId }))
                      }
                      disabled={
                        !!rowDomainActionLoading[domainManagerUser.user_id]
                        || getAvailableDomainsForUser(domainManagerUser.user_id).length === 0
                      }
                      placeholder={getAvailableDomainsForUser(domainManagerUser.user_id).length === 0 ? 'All domains assigned' : 'Select domain...'}
                      wrapperClassName="flex-1"
                      searchable
                      options={getAvailableDomainsForUser(domainManagerUser.user_id).map((domain) => ({
                        value: domain.domain_id,
                        label: domain.domain_name,
                      }))}
                      aria-label="Select domain"
                    />
                    <HoverTip label="Assign selected domain to user">
                      <button
                        type="button"
                        onClick={() => handleAddUserDomain(domainManagerUser.user_id)}
                        disabled={
                          !!rowDomainActionLoading[domainManagerUser.user_id]
                          || !getAvailableDomainsForUser(domainManagerUser.user_id).some(
                            (domain) => domain.domain_id === (selectedDomainByUserId[domainManagerUser.user_id] || '')
                          )
                        }
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <UserPlus className="h-4 w-4" />
                        {rowDomainActionLoading[domainManagerUser.user_id] ? 'Working...' : 'Add'}
                      </button>
                    </HoverTip>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {qualifyModal && (
          <div className="wb-app-overlay z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full my-8 border border-slate-200 dark:border-slate-700">
              <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Qualify idea → Use case</h3>
                <HoverTip label="Close" align="end">
                  <button type="button" onClick={() => setQualifyModal(null)} className="p-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Close">
                    <X className="w-5 h-5" />
                  </button>
                </HoverTip>
              </div>
              <form onSubmit={handleQualifyIdea} className="p-6 space-y-4">
                <p className="text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg line-clamp-3">{qualifyModal.idea.idea_text}</p>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Target domain *</label>
                  <SelectMenu
                    value={qualifyForm.target_domain_id}
                    onChange={(target_domain_id) => setQualifyForm((f) => ({ ...f, target_domain_id }))}
                    required
                    placeholder="Select domain"
                    searchable
                    options={domainsForQualify.map((d: any) => ({ value: d.domain_id, label: d.domain_name }))}
                    aria-label="Target domain"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Use case name (30 chars) *</label>
                  <input
                    value={qualifyForm.use_case_name}
                    onChange={(e) => setQualifyForm((f) => ({ ...f, use_case_name: e.target.value }))}
                    maxLength={30}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Title (100 chars)</label>
                  <input
                    value={qualifyForm.use_case_title}
                    onChange={(e) => setQualifyForm((f) => ({ ...f, use_case_title: e.target.value }))}
                    maxLength={100}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description (500 chars)</label>
                  <textarea
                    value={qualifyForm.use_case_description}
                    onChange={(e) => setQualifyForm((f) => ({ ...f, use_case_description: e.target.value }))}
                    maxLength={500}
                    rows={3}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Department</label>
                    <input
                      value={qualifyForm.department}
                      onChange={(e) => setQualifyForm((f) => ({ ...f, department: e.target.value }))}
                      maxLength={30}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">AI category</label>
                    <SelectMenu
                      value={qualifyForm.ai_category}
                      onChange={(ai_category) => setQualifyForm((f) => ({ ...f, ai_category }))}
                      placeholder="—"
                      options={AI_CATEGORY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                      aria-label="AI category"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setQualifyModal(null)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
                  <button type="submit" disabled={qualifySaving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
                    {qualifySaving ? 'Creating...' : 'Create use case'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <Toast message={error} onDismiss={() => setError('')} type="error" autoDismissMs={3000} />

        {successMessage && (
          <div className="fixed bottom-4 right-4 max-w-md p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg shadow-lg z-50">
            <div className="flex items-center justify-between">
              <p className="text-green-600 dark:text-green-400 text-sm">{successMessage}</p>
              <HoverTip label="Dismiss" align="end">
                <button onClick={() => setSuccessMessage('')} className="ml-4 text-green-400 hover:text-green-600" aria-label="Dismiss">
                  <X className="w-4 h-4" />
                </button>
              </HoverTip>
            </div>
          </div>
        )}

        <ConfirmModal
          isOpen={deleteModal.isOpen}
          onClose={() => setDeleteModal({ isOpen: false, type: null, item: null })}
          onConfirm={() => {
            if (deleteModal.type === 'role') handleDeleteRole();
          }}
          title="Delete Role"
          message={deleteModal.type === 'role' && deleteModal.item ? `Are you sure you want to delete the role "${deleteModal.item.role_name}"? This action cannot be undone.` : ''}
          confirmText="Delete"
          confirmStyle="danger"
        />

        <ConfirmModal
          isOpen={deactivateModal.isOpen}
          onClose={() => setDeactivateModal({ isOpen: false, user: null })}
          onConfirm={handleDeactivateUser}
          title="Deactivate user"
          message={deactivateModal.user ? `Are you sure you want to deactivate "${deactivateModal.user.user_name}"? They will not be able to sign in until reactivated.` : ''}
          confirmText="Deactivate"
          confirmStyle="danger"
        />
        <ConfirmModal
          isOpen={!!docTypeToDelete}
          onClose={() => setDocTypeToDelete(null)}
          onConfirm={handleDeleteDocumentType}
          title="Delete document type"
          message={
            docTypeToDelete
              ? `Delete “${docTypeToDelete.name}”? People will no longer see this option when uploading files.`
              : ''
          }
          confirmText="Delete"
          confirmStyle="danger"
        />
        <ConfirmModal
          isOpen={deleteUserModal.isOpen}
          onClose={() => setDeleteUserModal({ isOpen: false, user: null })}
          onConfirm={handleDeleteUser}
          title="Delete user"
          message={
            deleteUserModal.user
              ? getUserRegistrationStatus(deleteUserModal.user) === 'rejected'
                ? `Permanently delete rejected request "${deleteUserModal.user.user_name}" (${deleteUserModal.user.user_email})? This cannot be undone.`
                : `Permanently delete "${deleteUserModal.user.user_name}" (${deleteUserModal.user.user_email})? This cannot be undone. Users who have commented on use cases cannot be deleted (deactivate instead).`
              : ''
          }
          confirmText="Delete"
          confirmStyle="danger"
        />
      </div>
    </div>
  );
}
