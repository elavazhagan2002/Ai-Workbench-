import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Edit2,
  FileText,
  Building2,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import HoverTip from './HoverTip';

export type LookupTypeItem = {
  id: string;
  name: string;
  description: string | null;
};

export type LookupTypeForm = {
  name: string;
  description: string;
};

type SortField = 'name' | 'description';
type SortDir = 'asc' | 'desc';

interface LookupTypesPanelProps {
  title: string;
  description: string;
  emptyMessage: string;
  entityLabel: string;
  namePlaceholder: string;
  descriptionPlaceholder: string;
  nameMaxLength: number;
  items: LookupTypeItem[];
  form: LookupTypeForm;
  editingId: string | null;
  saving?: boolean;
  icon?: 'building' | 'file';
  onFormChange: (next: LookupTypeForm) => void;
  onSave: (e: React.FormEvent) => void;
  onStartCreate: () => void;
  onStartEdit: (item: LookupTypeItem) => void;
  onCancelEdit: () => void;
  onDelete: (item: LookupTypeItem) => void;
}

function SortHeader({
  label,
  field,
  activeField,
  direction,
  onSort,
}: {
  label: string;
  field: SortField;
  activeField: SortField;
  direction: SortDir;
  onSort: (field: SortField) => void;
}) {
  const active = activeField === field;
  const Icon = !active ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`group inline-flex items-center gap-1.5 rounded-md transition-colors hover:text-slate-800 dark:hover:text-slate-100 ${
          active ? 'text-slate-800 dark:text-slate-100' : ''
        }`}
        aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        <Icon
          className={`h-3.5 w-3.5 shrink-0 ${
            active
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-slate-400 opacity-60 group-hover:opacity-100'
          }`}
          aria-hidden
        />
      </button>
    </th>
  );
}

export default function LookupTypesPanel({
  title,
  description,
  emptyMessage,
  entityLabel,
  namePlaceholder,
  descriptionPlaceholder,
  nameMaxLength,
  items,
  form,
  editingId,
  saving = false,
  icon = 'file',
  onFormChange,
  onSave,
  onStartCreate,
  onStartEdit,
  onCancelEdit,
  onDelete,
}: LookupTypesPanelProps) {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [showForm, setShowForm] = useState(false);

  const isEditing = Boolean(editingId);
  const formOpen = showForm || isEditing;
  const Icon = icon === 'building' ? Building2 : FileText;

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = !q
      ? items
      : items.filter((item) => {
          const hay = `${item.name} ${item.description || ''}`.toLowerCase();
          return hay.includes(q);
        });

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left =
        sortField === 'name' ? a.name || '' : a.description || '';
      const right =
        sortField === 'name' ? b.name || '' : b.description || '';
      return left.localeCompare(right, undefined, { sensitivity: 'base' }) * dir;
    });
  }, [items, search, sortDir, sortField]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function openCreate() {
    onStartCreate();
    setShowForm(true);
  }

  function openEdit(item: LookupTypeItem) {
    onStartEdit(item);
    setShowForm(true);
  }

  function closeForm() {
    onCancelEdit();
    setShowForm(false);
  }

  function handleSubmit(e: React.FormEvent) {
    onSave(e);
    // Keep form open only if parent leaves editing state; parent clears on success.
    // Close create/edit panel after successful save is handled by parent clearing editingId.
    // We close the form panel when not editing after submit attempt — parent resets form.
    if (!isEditing) {
      // After create, parent clears form; hide panel for cleaner UX once form empties via parent
    }
  }

  // Auto-close form panel when parent clears edit mode and form is empty after save
  const formIsBlank = !form.name.trim() && !form.description.trim() && !editingId;
  if (showForm && formIsBlank && !isEditing) {
    // don't force during render — use effect-like pattern via derived display
  }

  const panelOpen = formOpen && !(formIsBlank && !isEditing && !showForm);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        </div>
        {!panelOpen && (
          <HoverTip label={`Add a new ${entityLabel.toLowerCase()}`}>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Add {entityLabel}
            </button>
          </HoverTip>
        )}
      </div>

      {panelOpen && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="text-base font-semibold text-slate-900 dark:text-white">
                {isEditing ? `Edit ${entityLabel.toLowerCase()}` : `Add ${entityLabel.toLowerCase()}`}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isEditing
                  ? 'Update the label and optional description'
                  : 'Create a reusable label for use across the portal'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="lookup-type-form"
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : isEditing ? 'Save changes' : `Add ${entityLabel.toLowerCase()}`}
              </button>
            </div>
          </div>

          <form id="lookup-type-form" onSubmit={handleSubmit} className="grid gap-4 p-5 md:grid-cols-2">
            <div>
              <label
                htmlFor="lookup-type-name"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Type name <span className="text-slate-400">({nameMaxLength} max)</span>
              </label>
              <input
                id="lookup-type-name"
                type="text"
                value={form.name}
                onChange={(e) => onFormChange({ ...form, name: e.target.value })}
                maxLength={nameMaxLength}
                placeholder={namePlaceholder}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                required
                autoFocus
              />
            </div>
            <div>
              <label
                htmlFor="lookup-type-description"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Description <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                id="lookup-type-description"
                type="text"
                value={form.description}
                onChange={(e) => onFormChange({ ...form, description: e.target.value })}
                maxLength={250}
                placeholder={descriptionPlaceholder}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
              />
            </div>
          </form>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${title.toLowerCase()}…`}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-10 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-600 dark:bg-slate-900/40 dark:text-white dark:placeholder:text-slate-500"
              aria-label={`Search ${title}`}
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">
            {filteredSorted.length} of {items.length}{' '}
            {items.length === 1 ? entityLabel.toLowerCase() : `${entityLabel.toLowerCase()}s`}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <SortHeader
                  label="Name"
                  field="name"
                  activeField={sortField}
                  direction={sortDir}
                  onSort={handleSort}
                />
                <SortHeader
                  label="Description"
                  field="description"
                  activeField={sortField}
                  direction={sortDir}
                  onSort={handleSort}
                />
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/80">
              {filteredSorted.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-14 text-center">
                    <div className="mx-auto max-w-sm">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                        <Icon className="h-5 w-5" />
                      </div>
                      <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {items.length === 0
                          ? emptyMessage
                          : 'No matches for this search'}
                      </p>
                      {items.length === 0 ? (
                        <button
                          type="button"
                          onClick={openCreate}
                          className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
                        >
                          Add your first {entityLabel.toLowerCase()}
                        </button>
                      ) : (
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Try a different keyword, or clear the search.
                        </p>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredSorted.map((item) => {
                  const selected = editingId === item.id;
                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-900/40 ${
                        selected ? 'bg-blue-50/70 dark:bg-blue-900/20' : ''
                      }`}
                    >
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">
                            {item.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="max-w-xl text-sm text-slate-600 dark:text-slate-400">
                          {item.description || (
                            <span className="text-slate-400 dark:text-slate-500">No description</span>
                          )}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <HoverTip label={`Edit ${entityLabel.toLowerCase()}`} side="top" align="end">
                            <button
                              type="button"
                              onClick={() => openEdit(item)}
                              className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-blue-400"
                              aria-label={`Edit ${entityLabel.toLowerCase()}`}
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                          </HoverTip>
                          <HoverTip label={`Delete ${entityLabel.toLowerCase()}`} side="top" align="end">
                            <button
                              type="button"
                              onClick={() => onDelete(item)}
                              className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                              aria-label={`Delete ${entityLabel.toLowerCase()}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </HoverTip>
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
    </div>
  );
}
