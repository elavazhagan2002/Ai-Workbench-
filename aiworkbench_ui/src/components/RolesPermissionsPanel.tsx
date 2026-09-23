import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Edit2,
  Lock,
  Plus,
  Search,
  Shield,
  Trash2,
  Users,
} from 'lucide-react';
import HoverTip from './HoverTip';
import type { Permission, Role } from '../types';
import {
  PERMISSION_GROUP_META,
  PERMISSION_GROUP_ORDER,
  getPermissionDescription,
  getPermissionGroupKey,
  getPermissionLabel,
  isPrivilegedPermission,
  type PermissionGroupKey,
} from '../constants/permissionMeta';

export interface RoleWithPermissions extends Role {
  permissions?: string[];
}

type RoleFilter = 'all' | 'system' | 'custom';

interface RolesPermissionsPanelProps {
  roles: RoleWithPermissions[];
  permissions: Permission[];
  users: Array<{ role_id?: string | null; role?: { role_id?: string } | null }>;
  isAdmin: boolean;
  showForm: boolean;
  editingRole: RoleWithPermissions | null;
  roleForm: { role_name: string; role_description: string };
  selectedPermissions: string[];
  formSectionRef?: React.Ref<HTMLDivElement>;
  onOpenCreate: () => void;
  onOpenEdit: (role: RoleWithPermissions) => void;
  onCloseForm: () => void;
  onRoleFormChange: (next: { role_name: string; role_description: string }) => void;
  onSelectedPermissionsChange: (ids: string[]) => void;
  onSave: (e: React.FormEvent) => void;
  onRequestDelete: (role: RoleWithPermissions) => void;
}

function countUsersForRole(
  roleId: string,
  users: RolesPermissionsPanelProps['users']
): number {
  return users.filter(
    (u) => u.role_id === roleId || u.role?.role_id === roleId
  ).length;
}

function groupPermissionCounts(
  permissionNames: string[],
  permissions: Permission[]
): Partial<Record<PermissionGroupKey, number>> {
  const byName = new Map(permissions.map((p) => [p.permission_name, p]));
  const counts: Partial<Record<PermissionGroupKey, number>> = {};
  for (const name of permissionNames) {
    const perm = byName.get(name);
    const key = getPermissionGroupKey(perm?.permission_type);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export default function RolesPermissionsPanel({
  roles,
  permissions,
  users,
  isAdmin,
  showForm,
  editingRole,
  roleForm,
  selectedPermissions,
  formSectionRef,
  onOpenCreate,
  onOpenEdit,
  onCloseForm,
  onRoleFormChange,
  onSelectedPermissionsChange,
  onSave,
  onRequestDelete,
}: RolesPermissionsPanelProps) {
  const [roleSearch, setRoleSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [permSearch, setPermSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    workflow: true,
    usecase: true,
    portal: true,
    dashboard: true,
    other: true,
  });

  const selectedRole =
    roles.find((r) => r.role_id === selectedRoleId) ||
    roles[0] ||
    null;

  const filteredRoles = useMemo(() => {
    const q = roleSearch.trim().toLowerCase();
    return roles.filter((role) => {
      if (roleFilter === 'system' && !role.is_system) return false;
      if (roleFilter === 'custom' && role.is_system) return false;
      if (!q) return true;
      const hay = `${role.role_name} ${role.role_description || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [roles, roleSearch, roleFilter]);

  const permissionsByGroup = useMemo(() => {
    const map: Record<PermissionGroupKey, Permission[]> = {
      workflow: [],
      usecase: [],
      portal: [],
      dashboard: [],
      other: [],
    };
    for (const perm of permissions) {
      map[getPermissionGroupKey(perm.permission_type)].push(perm);
    }
    return map;
  }, [permissions]);

  const filteredPermissionsByGroup = useMemo(() => {
    const q = permSearch.trim().toLowerCase();
    if (!q) return permissionsByGroup;
    const next: Record<PermissionGroupKey, Permission[]> = {
      workflow: [],
      usecase: [],
      portal: [],
      dashboard: [],
      other: [],
    };
    for (const key of PERMISSION_GROUP_ORDER) {
      next[key] = permissionsByGroup[key].filter((p) => {
        const label = getPermissionLabel(p.permission_name).toLowerCase();
        const desc = getPermissionDescription(p.permission_name).toLowerCase();
        return (
          p.permission_name.toLowerCase().includes(q) ||
          label.includes(q) ||
          desc.includes(q)
        );
      });
    }
    return next;
  }, [permissionsByGroup, permSearch]);

  function togglePermission(permissionId: string, checked: boolean) {
    if (checked) {
      onSelectedPermissionsChange([...selectedPermissions, permissionId]);
    } else {
      onSelectedPermissionsChange(selectedPermissions.filter((id) => id !== permissionId));
    }
  }

  function setGroupSelection(groupPerms: Permission[], selectAll: boolean) {
    const ids = new Set(selectedPermissions);
    for (const perm of groupPerms) {
      const privilegedLocked = isPrivilegedPermission(perm.permission_name) && !isAdmin;
      const systemLocked = !!(editingRole?.is_system && !isAdmin);
      if (privilegedLocked || systemLocked) continue;
      if (selectAll) ids.add(perm.permission_id);
      else ids.delete(perm.permission_id);
    }
    onSelectedPermissionsChange(Array.from(ids));
  }

  function selectRole(role: RoleWithPermissions) {
    setSelectedRoleId(role.role_id);
    if (showForm) onCloseForm();
  }

  const permissionsLocked = !!(editingRole?.is_system && !isAdmin);

  // Sync selection when roles load or filter changes
  const effectiveSelected =
    filteredRoles.find((r) => r.role_id === (selectedRoleId || selectedRole?.role_id)) ||
    filteredRoles[0] ||
    null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Roles & Permissions</h3>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Define who can act across workflow, use cases, and portal admin features.
          </p>
        </div>
        {!showForm && (
          <HoverTip label="Create a new role">
            <button
              type="button"
              onClick={onOpenCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Add Role
            </button>
          </HoverTip>
        )}
      </div>

      {showForm ? (
        <div
          ref={formSectionRef}
          id="settings-role-form-section"
          className="scroll-mt-24 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <HoverTip label="Back to roles list" side="bottom">
                <button
                  type="button"
                  onClick={onCloseForm}
                  className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
                  aria-label="Back to roles list"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              </HoverTip>
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  {editingRole ? 'Edit role' : 'Create role'}
                </h3>
                {editingRole?.is_system && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    System role — name is locked
                    {!isAdmin ? '; only portal_admin can change permissions' : ''}
                  </p>
                )}
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
                form="settings-role-form"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                {editingRole ? 'Save changes' : 'Create role'}
              </button>
            </div>
          </div>

          <form id="settings-role-form" onSubmit={onSave} className="space-y-6 p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label
                  htmlFor="settings-role-name"
                  className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Role name <span className="text-slate-400">(25 max)</span>
                </label>
                <div className="relative">
                  <input
                    id="settings-role-name"
                    type="text"
                    value={roleForm.role_name}
                    onChange={(e) =>
                      onRoleFormChange({ ...roleForm, role_name: e.target.value })
                    }
                    maxLength={25}
                    disabled={!!editingRole?.is_system}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                    required
                  />
                  {editingRole?.is_system && (
                    <Lock className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  )}
                </div>
                {editingRole?.is_system && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    System role names are protected and cannot be renamed.
                  </p>
                )}
              </div>
              <div>
                <label
                  htmlFor="settings-role-description"
                  className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Description <span className="text-slate-400">(250 max)</span>
                </label>
                <textarea
                  id="settings-role-description"
                  value={roleForm.role_description}
                  onChange={(e) =>
                    onRoleFormChange({ ...roleForm, role_description: e.target.value })
                  }
                  maxLength={250}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                  placeholder="What this role is for…"
                />
              </div>
            </div>

            <div>
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Permissions
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {selectedPermissions.length} selected
                    {permissionsLocked ? ' · view only' : ''}
                  </p>
                </div>
                <div className="relative w-full sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="settings-role-perm-search"
                    type="search"
                    value={permSearch}
                    onChange={(e) => setPermSearch(e.target.value)}
                    placeholder="Search permissions…"
                    aria-label="Search permissions"
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                  />
                </div>
              </div>

              {editingRole?.is_system && !isAdmin && (
                <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                  Only portal_admin can change permissions on system roles.
                </p>
              )}

              <div className="space-y-3">
                {PERMISSION_GROUP_ORDER.map((groupKey) => {
                  const groupPerms = filteredPermissionsByGroup[groupKey];
                  if (groupPerms.length === 0) return null;
                  const meta = PERMISSION_GROUP_META[groupKey];
                  const allInGroup = permissionsByGroup[groupKey];
                  const selectedInGroup = allInGroup.filter((p) =>
                    selectedPermissions.includes(p.permission_id)
                  ).length;
                  const expanded = expandedGroups[groupKey] !== false;

                  return (
                    <div
                      key={groupKey}
                      className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700"
                    >
                      <div className="flex items-center gap-2 bg-slate-50 px-3 py-2.5 dark:bg-slate-900/40">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedGroups((prev) => ({
                              ...prev,
                              [groupKey]: !expanded,
                            }))
                          }
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          {expanded ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                              {meta.label}
                              <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                                {selectedInGroup}/{allInGroup.length}
                              </span>
                            </p>
                            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                              {meta.description}
                            </p>
                          </div>
                        </button>
                        {!permissionsLocked && (
                          <div className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              onClick={() => setGroupSelection(groupPerms, true)}
                              className="rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
                            >
                              Select all
                            </button>
                            <button
                              type="button"
                              onClick={() => setGroupSelection(groupPerms, false)}
                              className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              Clear
                            </button>
                          </div>
                        )}
                      </div>

                      {expanded && (
                        <div className="grid gap-1 p-2 sm:grid-cols-2">
                          {groupPerms.map((perm) => {
                            const privileged = isPrivilegedPermission(perm.permission_name);
                            const locked =
                              permissionsLocked || (privileged && !isAdmin);
                            const checked = selectedPermissions.includes(perm.permission_id);
                            const desc = getPermissionDescription(perm.permission_name);
                            return (
                              <label
                                key={perm.permission_id}
                                className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                                  locked
                                    ? 'cursor-not-allowed opacity-60'
                                    : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={locked}
                                  onChange={(e) =>
                                    togglePermission(perm.permission_id, e.target.checked)
                                  }
                                  className="mt-0.5 h-4 w-4 rounded text-blue-600 focus:ring-2 focus:ring-blue-500"
                                />
                                <span className="min-w-0">
                                  <span className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                                      {getPermissionLabel(perm.permission_name)}
                                    </span>
                                    {privileged && (
                                      <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                                        <Lock className="h-2.5 w-2.5" />
                                        Privileged
                                      </span>
                                    )}
                                  </span>
                                  {desc ? (
                                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                                      {desc}
                                    </span>
                                  ) : null}
                                  <span className="mt-0.5 block font-mono text-[10px] text-slate-400 dark:text-slate-500">
                                    {perm.permission_name}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </form>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
          {/* Left: role list */}
          <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <div className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-700">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={roleSearch}
                  onChange={(e) => setRoleSearch(e.target.value)}
                  placeholder="Search roles…"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                />
              </div>
              <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-900/60">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'system', label: 'System' },
                    { id: 'custom', label: 'Custom' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setRoleFilter(tab.id)}
                    className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                      roleFilter === tab.id
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                        : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[28rem] flex-1 overflow-y-auto p-2">
              {filteredRoles.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  No roles match your filters.
                </p>
              ) : (
                <ul className="space-y-1">
                  {filteredRoles.map((role) => {
                    const isActive = effectiveSelected?.role_id === role.role_id;
                    const userCount = countUsersForRole(role.role_id, users);
                    const permCount = role.permissions?.length || 0;
                    return (
                      <li key={role.role_id}>
                        <button
                          type="button"
                          onClick={() => selectRole(role)}
                          className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                            isActive
                              ? 'bg-blue-50 ring-1 ring-blue-200 dark:bg-blue-900/25 dark:ring-blue-800'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-slate-900 dark:text-white">
                              {role.role_name}
                            </span>
                            {role.is_system && (
                              <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                <Shield className="h-2.5 w-2.5" />
                                System
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                            <span>{permCount} permissions</span>
                            <span>·</span>
                            <span className="inline-flex items-center gap-0.5">
                              <Users className="h-3 w-3" />
                              {userCount}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Right: role detail */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            {!effectiveSelected ? (
              <div className="flex h-64 flex-col items-center justify-center px-6 text-center">
                <Shield className="mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" />
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Select a role to review permissions
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Or create a custom role for your governance model.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-lg font-semibold text-slate-900 dark:text-white">
                        {effectiveSelected.role_name}
                      </h4>
                      {effectiveSelected.is_system ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          <Shield className="h-3 w-3" />
                          System
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          Custom
                        </span>
                      )}
                    </div>
                    {effectiveSelected.role_description && (
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        {effectiveSelected.role_description}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 dark:bg-slate-900/50">
                        <Shield className="h-3.5 w-3.5" />
                        {effectiveSelected.permissions?.length || 0} permissions
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 dark:bg-slate-900/50">
                        <Users className="h-3.5 w-3.5" />
                        {countUsersForRole(effectiveSelected.role_id, users)} users assigned
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <HoverTip
                      label={
                        effectiveSelected.is_system
                          ? 'Edit system role (name locked)'
                          : 'Edit role'
                      }
                      side="top"
                      align="end"
                    >
                      <button
                        type="button"
                        onClick={() => onOpenEdit(effectiveSelected)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                        aria-label={
                          effectiveSelected.is_system
                            ? 'Edit system role (name locked)'
                            : 'Edit role'
                        }
                      >
                        <Edit2 className="h-4 w-4" />
                        Edit
                      </button>
                    </HoverTip>
                    {!effectiveSelected.is_system && (
                      <HoverTip label="Delete role" side="top" align="end">
                        <button
                          type="button"
                          onClick={() => onRequestDelete(effectiveSelected)}
                          className="rounded-lg border border-slate-300 p-2 text-slate-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-slate-600 dark:hover:border-red-800 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                          aria-label="Delete role"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </HoverTip>
                    )}
                  </div>
                </div>

                <div className="space-y-4 p-5">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Permission coverage
                  </p>
                  {(!effectiveSelected.permissions ||
                    effectiveSelected.permissions.length === 0) && (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                      This role has no permissions assigned and cannot perform portal actions.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {PERMISSION_GROUP_ORDER.map((key) => {
                      const counts = groupPermissionCounts(
                        effectiveSelected.permissions || [],
                        permissions
                      );
                      const n = counts[key] || 0;
                      if (n === 0 && key === 'other') return null;
                      if (n === 0 && permissionsByGroup[key].length === 0) return null;
                      const meta = PERMISSION_GROUP_META[key];
                      const total = permissionsByGroup[key].length;
                      if (total === 0) return null;
                      return (
                        <span
                          key={key}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.chipClass}`}
                        >
                          {meta.shortLabel}
                          <span className="opacity-80">
                            {n}/{total}
                          </span>
                        </span>
                      );
                    })}
                  </div>

                  <div className="space-y-3 pt-2">
                    {PERMISSION_GROUP_ORDER.map((key) => {
                      const names = (effectiveSelected.permissions || []).filter((name) => {
                        const perm = permissions.find((p) => p.permission_name === name);
                        return getPermissionGroupKey(perm?.permission_type) === key;
                      });
                      if (names.length === 0) return null;
                      const meta = PERMISSION_GROUP_META[key];
                      const showAsList = names.length <= 8;
                      return (
                        <div key={key}>
                          <p className="mb-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">
                            {meta.label}
                            <span className="ml-1.5 font-normal text-slate-500">
                              ({names.length})
                            </span>
                          </p>
                          {showAsList ? (
                            <ul className="grid gap-1 sm:grid-cols-2">
                              {names.map((name) => (
                                <li
                                  key={name}
                                  className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 dark:text-slate-300"
                                >
                                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500" />
                                  <span>
                                    <span className="font-medium">
                                      {getPermissionLabel(name)}
                                    </span>
                                    <span className="mt-0.5 block font-mono text-[10px] text-slate-400">
                                      {name}
                                    </span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                              {names.length} permissions in this group. Open Edit to review or
                              change them.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
