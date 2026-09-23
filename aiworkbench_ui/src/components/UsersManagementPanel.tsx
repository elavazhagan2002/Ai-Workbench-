import { useState } from 'react';
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  ChevronDown,
  ChevronUp,
  Edit2,
  Filter,
  Mail,
  Plus,
  Search,
  Trash2,
  UserPlus,
  UserX,
  Users,
  X,
} from 'lucide-react';
import HoverTip from './HoverTip';
import SelectMenu from './SelectMenu';
import type { OrganizationType, Role } from '../types';

export type UserSortField = 'user' | 'organization' | 'domains' | 'role' | 'status';

function humanizeRoleName(name: string | null | undefined): string {
  const raw = String(name || '').trim();
  if (!raw || raw === 'No Role') return 'No role';
  return raw
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function SortableColumnHeader({
  label,
  field,
  activeField,
  direction,
  onSort,
  className = '',
  align = 'left',
}: {
  label: string;
  field: UserSortField;
  activeField: UserSortField | null;
  direction: 'asc' | 'desc';
  onSort: (field: UserSortField) => void;
  className?: string;
  align?: 'left' | 'right';
}) {
  const active = activeField === field;
  const Icon = !active ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 ${className}`}
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`group inline-flex items-center gap-1.5 rounded-md transition-colors hover:text-slate-800 dark:hover:text-slate-100 ${
          align === 'right' ? 'ml-auto' : ''
        } ${active ? 'text-slate-800 dark:text-slate-100' : ''}`}
      >
        {label}
        <Icon
          className={`h-3.5 w-3.5 shrink-0 ${
            active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 opacity-60 group-hover:opacity-100'
          }`}
          aria-hidden
        />
      </button>
    </th>
  );
}

function UserDirectoryFilterSelect({
  id,
  label,
  value,
  onChange,
  placeholder,
  options,
  searchable = true,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: Array<{ value: string; label: string; description?: string }>;
  searchable?: boolean;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
        {label}
      </label>
      <SelectMenu
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        searchable={searchable}
        size="sm"
        variant="filter"
        options={options}
        className="!min-h-9 rounded-md text-[13px]"
        aria-label={`Filter by ${label.toLowerCase()}`}
      />
    </div>
  );
}

export type UserFormState = {
  user_name: string;
  user_email: string;
  user_pwd: string;
  role_id: string;
  organization: string;
  organization_type: string;
  user_image: string | null;
};

type FilterChip = { id: string; label: string; onClear: () => void };

type SelectOption = { value: string; label: string; description?: string };

interface UsersManagementPanelProps {
  currentUserId?: string | null;
  isAdmin: boolean;
  showForm: boolean;
  editingUser: any | null;
  userForm: UserFormState;
  formSectionRef?: React.Ref<HTMLDivElement>;
  roles: Role[];
  organizationTypes: OrganizationType[];
  visibleUsers: any[];
  assignedDomainsByUserId: Record<string, { domain_id: string }[]>;
  userFilterSearch: string;
  userFilterRole: string;
  userFilterStatus: string;
  userFilterOrganization: string;
  userFilterOrgType: string;
  userFilterEmailDomain: string;
  userFilterDomain: string;
  userRoleFilterOptions: SelectOption[];
  userOrganizationFilterOptions: SelectOption[];
  userOrgTypeFilterOptions: SelectOption[];
  userEmailDomainFilterOptions: SelectOption[];
  userAssignedDomainFilterOptions: SelectOption[];
  statusFilterOptions: readonly string[];
  activeUserFilterChips: FilterChip[];
  isUserFilterActive: boolean;
  isUserSearchLoading: boolean;
  filteredUsersCount: number;
  userRowsTotal: number;
  usersPerPage: number;
  activeUsersPage: number;
  userRowsPageCount: number;
  sortField: UserSortField | null;
  sortDir: 'asc' | 'desc';
  onSort: (field: UserSortField) => void;
  getUserStatusLabel: (u: any) => string;
  getUserStatusClass: (u: any) => string;
  getUserRegistrationStatus: (u: any) => string;
  onUserFilterSearchChange: (value: string) => void;
  onUserFilterRoleChange: (value: string) => void;
  onUserFilterStatusChange: (value: string) => void;
  onUserFilterOrganizationChange: (value: string) => void;
  onUserFilterOrgTypeChange: (value: string) => void;
  onUserFilterEmailDomainChange: (value: string) => void;
  onUserFilterDomainChange: (value: string) => void;
  onResetFilters: () => void;
  onOpenCreate: () => void;
  onOpenEdit: (u: any) => void;
  onCloseForm: () => void;
  onUserFormChange: (next: UserFormState) => void;
  onSave: (e: React.FormEvent) => void;
  onManageDomains: (userId: string) => void;
  onDeactivate: (u: any) => void;
  onActivate: (u: any) => void;
  onDelete: (u: any) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
}

export default function UsersManagementPanel({
  currentUserId,
  isAdmin,
  showForm,
  editingUser,
  userForm,
  formSectionRef,
  roles,
  organizationTypes,
  visibleUsers,
  assignedDomainsByUserId,
  userFilterSearch,
  userFilterRole,
  userFilterStatus,
  userFilterOrganization,
  userFilterOrgType,
  userFilterEmailDomain,
  userFilterDomain,
  userRoleFilterOptions,
  userOrganizationFilterOptions,
  userOrgTypeFilterOptions,
  userEmailDomainFilterOptions,
  userAssignedDomainFilterOptions,
  statusFilterOptions,
  activeUserFilterChips,
  isUserFilterActive,
  isUserSearchLoading,
  filteredUsersCount,
  userRowsTotal,
  usersPerPage,
  activeUsersPage,
  userRowsPageCount,
  sortField,
  sortDir,
  onSort,
  getUserStatusLabel,
  getUserStatusClass,
  getUserRegistrationStatus,
  onUserFilterSearchChange,
  onUserFilterRoleChange,
  onUserFilterStatusChange,
  onUserFilterOrganizationChange,
  onUserFilterOrgTypeChange,
  onUserFilterEmailDomainChange,
  onUserFilterDomainChange,
  onResetFilters,
  onOpenCreate,
  onOpenEdit,
  onCloseForm,
  onUserFormChange,
  onSave,
  onManageDomains,
  onDeactivate,
  onActivate,
  onDelete,
  onPrevPage,
  onNextPage,
}: UsersManagementPanelProps) {
  const [filtersOpen, setFiltersOpen] = useState(true);

  const roleOptions = roles
    .filter((role) => isAdmin || role.role_name !== 'portal_admin')
    .map((role) => ({
      value: role.role_id,
      label: humanizeRoleName(role.role_name),
      description: role.role_description || role.role_name,
    }));

  const humanizedRoleFilterOptions = userRoleFilterOptions.map((opt) => ({
    ...opt,
    label: humanizeRoleName(opt.label),
  }));

  const rangeStart = userRowsTotal === 0 ? 0 : (activeUsersPage - 1) * usersPerPage + 1;
  const rangeEnd = Math.min(activeUsersPage * usersPerPage, userRowsTotal);
  const showPagination =
    userRowsTotal > usersPerPage ||
    ((isUserFilterActive || sortField) && !isUserSearchLoading && userRowsTotal > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">User Management</h3>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Manage accounts, roles, and domain access across the portal.
          </p>
        </div>
        {!showForm && (
          <HoverTip label="Create a new user">
            <button
              type="button"
              onClick={onOpenCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Add User
            </button>
          </HoverTip>
        )}
      </div>

      {showForm ? (
        <div
          ref={formSectionRef}
          id="settings-user-form-section"
          className="scroll-mt-24 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <HoverTip label="Back to users list">
                <button
                  type="button"
                  onClick={onCloseForm}
                  className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
                  aria-label="Back to users list"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              </HoverTip>
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  {editingUser ? 'Edit user' : 'Create user'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {editingUser
                    ? 'Update profile details and access role'
                    : 'Invite a new user to the governance workbench'}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCloseForm}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="settings-user-form"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                {editingUser ? 'Save changes' : 'Create user'}
              </button>
            </div>
          </div>

          <form id="settings-user-form" onSubmit={onSave} className="space-y-6 p-5">
            <section>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Profile
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label
                    htmlFor="settings-user-name"
                    className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    Display name <span className="text-slate-400">(25 max)</span>
                  </label>
                  <input
                    id="settings-user-name"
                    type="text"
                    value={userForm.user_name}
                    onChange={(e) => onUserFormChange({ ...userForm, user_name: e.target.value })}
                    maxLength={25}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="settings-user-email"
                    className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="settings-user-email"
                      type="email"
                      value={userForm.user_email}
                      onChange={(e) => onUserFormChange({ ...userForm, user_email: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-slate-900 focus:ring-2 focus:ring-blue-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                      required
                      disabled={!!editingUser}
                    />
                  </div>
                  {editingUser && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Email cannot be changed after the account is created.
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="settings-user-password"
                    className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    Password{' '}
                    <span className="font-normal text-slate-400">
                      {editingUser ? '(leave blank to keep current)' : ''}
                    </span>
                  </label>
                  <input
                    id="settings-user-password"
                    type="password"
                    value={userForm.user_pwd}
                    onChange={(e) => onUserFormChange({ ...userForm, user_pwd: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                    required={!editingUser}
                    autoComplete={editingUser ? 'new-password' : 'new-password'}
                  />
                </div>
                <div>
                  <label
                    htmlFor="settings-user-organization"
                    className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    Organization
                  </label>
                  <div className="relative">
                    <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="settings-user-organization"
                      type="text"
                      value={userForm.organization}
                      onChange={(e) => onUserFormChange({ ...userForm, organization: e.target.value })}
                      maxLength={100}
                      placeholder="e.g. Engineering"
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-slate-900 focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                    />
                  </div>
                </div>
              </div>
            </section>

            <section>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Access
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Organization type
                  </label>
                  <SelectMenu
                    value={userForm.organization_type}
                    onChange={(organization_type) =>
                      onUserFormChange({ ...userForm, organization_type })
                    }
                    placeholder="None"
                    options={organizationTypes.map((t) => ({ value: t.name, label: t.name }))}
                    aria-label="Organization Type"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Role
                  </label>
                  <SelectMenu
                    value={userForm.role_id}
                    onChange={(role_id) => onUserFormChange({ ...userForm, role_id })}
                    placeholder="No role"
                    searchable
                    options={roleOptions}
                    aria-label="Role"
                  />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Controls workflow and portal permissions for this user.
                  </p>
                </div>
              </div>
            </section>

            <section>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Photo
              </p>
              <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/40 sm:flex-row sm:items-center">
                {userForm.user_image ? (
                  <img
                    src={userForm.user_image}
                    alt="Preview"
                    className="h-16 w-16 rounded-full border-2 border-slate-200 object-cover dark:border-slate-600"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-200 text-lg font-semibold text-slate-600 dark:bg-slate-600 dark:text-slate-200">
                    {(userForm.user_name || 'U').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        const r = new FileReader();
                        r.onload = () =>
                          onUserFormChange({ ...userForm, user_image: r.result as string });
                        r.readAsDataURL(f);
                      }
                    }}
                    className="w-full max-w-md text-sm text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-blue-700 dark:text-slate-400 dark:file:bg-blue-900/30 dark:file:text-blue-300"
                  />
                  <input
                    type="url"
                    value={userForm.user_image || ''}
                    onChange={(e) =>
                      onUserFormChange({ ...userForm, user_image: e.target.value || null })
                    }
                    placeholder="Or paste image URL (https://…)"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                  />
                </div>
              </div>
            </section>
          </form>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <div className="space-y-3 border-b border-slate-200 p-4 dark:border-slate-700">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <label className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={userFilterSearch}
                    onChange={(e) => onUserFilterSearchChange(e.target.value)}
                    placeholder="Search by name, email, organization, role, status, or domain…"
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-10 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-600 dark:bg-slate-900/40 dark:text-white dark:placeholder:text-slate-500"
                    aria-label="Search user management"
                  />
                  {userFilterSearch ? (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2">
                      <HoverTip label="Clear search" side="bottom" align="end">
                        <button
                          type="button"
                          onClick={() => onUserFilterSearchChange('')}
                          className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                          aria-label="Clear search"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </HoverTip>
                    </span>
                  ) : null}
                </label>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => setFiltersOpen((o) => !o)}
                    className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <Filter className="h-3.5 w-3.5" />
                    Filters
                    {filtersOpen ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <HoverTip
                    label={isUserFilterActive ? 'Clear all filters' : 'No filters applied'}
                    disabled={!isUserFilterActive}
                  >
                    <button
                      type="button"
                      onClick={onResetFilters}
                      disabled={!isUserFilterActive}
                      className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <X className="h-3.5 w-3.5" />
                      Reset
                    </button>
                  </HoverTip>
                </div>
              </div>

              {filtersOpen && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                  <UserDirectoryFilterSelect
                    id="user-filter-role"
                    label="Role"
                    value={userFilterRole}
                    onChange={onUserFilterRoleChange}
                    placeholder="All roles"
                    options={humanizedRoleFilterOptions}
                  />
                  <UserDirectoryFilterSelect
                    id="user-filter-status"
                    label="Status"
                    value={userFilterStatus}
                    onChange={onUserFilterStatusChange}
                    placeholder="All statuses"
                    searchable={false}
                    options={statusFilterOptions.map((status) => ({
                      value: status,
                      label: status,
                    }))}
                  />
                  <UserDirectoryFilterSelect
                    id="user-filter-organization"
                    label="Organization"
                    value={userFilterOrganization}
                    onChange={onUserFilterOrganizationChange}
                    placeholder="All organizations"
                    options={userOrganizationFilterOptions}
                  />
                  <UserDirectoryFilterSelect
                    id="user-filter-org-type"
                    label="Org Type"
                    value={userFilterOrgType}
                    onChange={onUserFilterOrgTypeChange}
                    placeholder="All org types"
                    options={userOrgTypeFilterOptions}
                  />
                  <UserDirectoryFilterSelect
                    id="user-filter-email-domain"
                    label="Email Domain"
                    value={userFilterEmailDomain}
                    onChange={onUserFilterEmailDomainChange}
                    placeholder="All email domains"
                    options={userEmailDomainFilterOptions}
                  />
                  <UserDirectoryFilterSelect
                    id="user-filter-assigned-domain"
                    label="Assigned Domain"
                    value={userFilterDomain}
                    onChange={onUserFilterDomainChange}
                    placeholder="All assigned domains"
                    options={userAssignedDomainFilterOptions}
                  />
                </div>
              )}

              {activeUserFilterChips.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {isUserFilterActive && !isUserSearchLoading ? (
                    <span className="mr-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {filteredUsersCount} matching
                    </span>
                  ) : null}
                  {activeUserFilterChips.map((chip) => (
                    <HoverTip key={chip.id} label={`Clear ${chip.label} filter`} side="top">
                      <button
                        type="button"
                        onClick={chip.onClear}
                        className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 transition hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-950/80"
                        aria-label={`Clear ${chip.label}`}
                      >
                        {chip.id === 'role'
                          ? `Role: ${humanizeRoleName(chip.label.replace(/^Role:\s*/, ''))}`
                          : chip.label}
                        <X className="h-3 w-3" />
                      </button>
                    </HoverTip>
                  ))}
                </div>
              ) : null}
            </div>

            {showPagination && (
              <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900/30 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  Showing {rangeStart}–{rangeEnd} of {userRowsTotal} users
                </span>
                <div className="flex items-center gap-2">
                  <HoverTip label="Previous page" disabled={activeUsersPage <= 1}>
                    <button
                      type="button"
                      onClick={onPrevPage}
                      disabled={activeUsersPage <= 1}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Previous
                    </button>
                  </HoverTip>
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    Page {activeUsersPage} of {userRowsPageCount}
                  </span>
                  <HoverTip label="Next page" disabled={activeUsersPage >= userRowsPageCount}>
                    <button
                      type="button"
                      onClick={onNextPage}
                      disabled={activeUsersPage >= userRowsPageCount}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Next
                    </button>
                  </HoverTip>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <SortableColumnHeader
                      label="User"
                      field="user"
                      activeField={sortField}
                      direction={sortDir}
                      onSort={onSort}
                    />
                    <SortableColumnHeader
                      label="Organization"
                      field="organization"
                      activeField={sortField}
                      direction={sortDir}
                      onSort={onSort}
                      className="hidden md:table-cell"
                    />
                    <SortableColumnHeader
                      label="Domains"
                      field="domains"
                      activeField={sortField}
                      direction={sortDir}
                      onSort={onSort}
                    />
                    <SortableColumnHeader
                      label="Role"
                      field="role"
                      activeField={sortField}
                      direction={sortDir}
                      onSort={onSort}
                    />
                    <SortableColumnHeader
                      label="Status"
                      field="status"
                      activeField={sortField}
                      direction={sortDir}
                      onSort={onSort}
                    />
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/80">
                  {visibleUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center">
                        <div className="mx-auto max-w-md">
                          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                            <Users className="h-5 w-5" />
                          </div>
                          <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
                            {isUserSearchLoading
                              ? 'Applying filters…'
                              : isUserFilterActive
                                ? 'No users match this filter'
                                : 'No users found'}
                          </p>
                          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            {isUserSearchLoading
                              ? 'Loading the full user directory so filters cover every page.'
                              : isUserFilterActive
                                ? 'Try a different keyword, or adjust role, status, organization, or domain filters.'
                                : 'Create a user to begin managing access.'}
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    visibleUsers.map((u) => {
                      const domainCount = (assignedDomainsByUserId[u.user_id] || []).length;
                      const roleLabel = humanizeRoleName(u.role_name || u.role?.role_name);
                      const isSelf = currentUserId === u.user_id;
                      return (
                        <tr
                          key={u.user_id}
                          className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-900/40"
                        >
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-3">
                              {u.user_image ? (
                                <img
                                  src={u.user_image}
                                  alt=""
                                  className="h-10 w-10 shrink-0 rounded-full border border-slate-200 object-cover dark:border-slate-600"
                                />
                              ) : (
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-300 text-sm font-semibold text-slate-700 dark:from-slate-600 dark:to-slate-700 dark:text-slate-100">
                                  {(u.user_name || 'U').charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                                  {u.user_name}
                                  {isSelf && (
                                    <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                                      You
                                    </span>
                                  )}
                                </p>
                                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                                  {u.user_email}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="hidden px-4 py-3.5 md:table-cell">
                            <p className="text-sm text-slate-700 dark:text-slate-200">
                              {u.organization || '—'}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {u.organization_type || 'No org type'}
                            </p>
                          </td>
                          <td className="px-4 py-3.5">
                            <HoverTip label="Manage assigned domains" side="top">
                              <button
                                type="button"
                                onClick={() => onManageDomains(u.user_id)}
                                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-200 dark:hover:border-blue-700 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"
                              >
                                {domainCount} {domainCount === 1 ? 'domain' : 'domains'}
                              </button>
                            </HoverTip>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="inline-flex max-w-[10rem] truncate rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                              {roleLabel}
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getUserStatusClass(u)}`}
                            >
                              {getUserStatusLabel(u)}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-0.5">
                              <HoverTip label="Edit user" side="top" align="end">
                                <button
                                  type="button"
                                  onClick={() => onOpenEdit(u)}
                                  className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-blue-400"
                                  aria-label="Edit user"
                                >
                                  <Edit2 className="h-4 w-4" />
                                </button>
                              </HoverTip>
                              {u.is_active !== false
                                ? !isSelf && (
                                    <HoverTip label="Deactivate user" side="top" align="end">
                                      <button
                                        type="button"
                                        onClick={() => onDeactivate(u)}
                                        className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-amber-50 hover:text-amber-600 dark:text-slate-400 dark:hover:bg-amber-900/20 dark:hover:text-amber-400"
                                        aria-label="Deactivate user"
                                      >
                                        <UserX className="h-4 w-4" />
                                      </button>
                                    </HoverTip>
                                  )
                                : getUserRegistrationStatus(u) !== 'rejected' ? (
                                    <HoverTip label="Activate user" side="top" align="end">
                                      <button
                                        type="button"
                                        onClick={() => onActivate(u)}
                                        className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-emerald-50 hover:text-emerald-600 dark:text-slate-400 dark:hover:bg-emerald-900/20 dark:hover:text-emerald-400"
                                        aria-label="Activate user"
                                      >
                                        <UserPlus className="h-4 w-4" />
                                      </button>
                                    </HoverTip>
                                  ) : null}
                              {isAdmin && !isSelf && (
                                <HoverTip label="Delete user (admin only)" side="top" align="end">
                                  <button
                                    type="button"
                                    onClick={() => onDelete(u)}
                                    className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                                    aria-label="Delete user (admin only)"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </HoverTip>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
