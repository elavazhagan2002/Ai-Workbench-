import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  BookMarked,
  Calendar,
  Download,
  Eye,
  FileText,
  LayoutGrid,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api, type BlogPost } from '../lib/api';

interface BlogsProps {
  onBack: () => void;
}

function safePdfFileName(title: string) {
  const base = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return (base || 'document') + '.pdf';
}

function formatPostDate(iso: string | null) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

export default function Blogs({ onBack }: BlogsProps) {
  const { hasPermission } = useAuth();
  const canView = hasPermission('view_blog');
  const canManage = hasPermission('manage_blog');

  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showDrafts, setShowDrafts] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createKind, setCreateKind] = useState<'blog' | 'article'>('article');
  const [createPublished, setCreatePublished] = useState(true);
  const [createFile, setCreateFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const [viewerPost, setViewerPost] = useState<BlogPost | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const list = await api.listBlogPosts(canManage && showDrafts);
      setPosts(list);
    } catch (e: any) {
      setError(e?.message || 'Failed to load posts');
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [canView, canManage, showDrafts]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    };
  }, [viewerUrl]);

  async function openViewer(post: BlogPost) {
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    setViewerPost(post);
    setViewerUrl(null);
    setViewerLoading(true);
    void api
      .recordUiNavigationEvent({
        action: 'blog_post_opened',
        blog_post_id: post.blog_post_id,
        blog_title: post.title,
        blog_kind: post.kind,
      })
      .catch(() => {});
    try {
      const blob = await api.fetchBlogContentBlob(post.blog_post_id);
      const url = URL.createObjectURL(blob);
      setViewerUrl(url);
    } catch (e: any) {
      setError(e?.message || 'Failed to load content');
      setViewerPost(null);
    } finally {
      setViewerLoading(false);
    }
  }

  function closeViewer() {
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    setViewerUrl(null);
    setViewerPost(null);
  }

  async function downloadViewerPdf() {
    if (!viewerPost || !viewerUrl || viewerPost.content_format !== 'pdf') return;
    const a = document.createElement('a');
    a.href = viewerUrl;
    a.download = safePdfFileName(viewerPost.title);
    a.click();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createFile || !createTitle.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.createBlogPost({
        title: createTitle.trim(),
        kind: createKind,
        published: createPublished,
        file: createFile,
      });
      setShowCreate(false);
      setCreateTitle('');
      setCreateFile(null);
      setCreateKind('article');
      setCreatePublished(true);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to create post');
    } finally {
      setSaving(false);
    }
  }

  async function togglePublished(post: BlogPost) {
    try {
      await api.updateBlogPost(post.blog_post_id, { published: !post.published });
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to update post');
    }
  }

  async function removePost(post: BlogPost) {
    if (!window.confirm(`Delete “${post.title}”?`)) return;
    try {
      await api.deleteBlogPost(post.blog_post_id);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete post');
    }
  }

  if (!canView) {
    return (
      <div className="wb-page flex items-center justify-center min-h-[50vh]">
        <div className="wb-card-pad max-w-md text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-muted text-ink-subtle">
            <BookOpen className="h-7 w-7" />
          </div>
          <h2 className="font-display text-lg font-semibold text-ink">No access</h2>
          <p className="mt-2 text-sm text-ink-muted leading-relaxed">
            You do not have permission to view blogs and articles. Ask an administrator if you need access.
          </p>
          <button type="button" onClick={onBack} className="wb-btn-primary mt-6">
            <ArrowLeft className="h-4 w-4" />
            Back to app
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wb-page">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-4">
          <button
            type="button"
            onClick={onBack}
            className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-elevated text-ink-muted hover:text-ink hover:bg-surface-muted transition"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-600 dark:text-cyan-400">
              Knowledge base
            </p>
            <h1 className="wb-page-title flex items-center gap-2 mt-1">
              <BookOpen className="w-6 h-6 text-navy-600 dark:text-cyan-400" />
              Blogs & articles
            </h1>
            <p className="wb-page-subtitle max-w-xl">
              Published guidance and updates from your team. Open PDFs and HTML in a focused reader.
            </p>
          </div>
        </div>

        {canManage && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <div className="inline-flex rounded-xl border border-line bg-surface-elevated p-1">
              <button
                type="button"
                onClick={() => setShowDrafts(false)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  !showDrafts
                    ? 'bg-navy-600 text-white shadow-sm'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                Published
              </button>
              <button
                type="button"
                onClick={() => setShowDrafts(true)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  showDrafts
                    ? 'bg-navy-600 text-white shadow-sm'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                All + drafts
              </button>
            </div>
            <button type="button" onClick={() => setShowCreate(true)} className="wb-btn-primary">
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              New post
            </button>
          </div>
        )}
      </div>

      {error ? (
        <div
          className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50/90 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200"
          role="alert"
        >
          <span className="mt-0.5 shrink-0">!</span>
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl border border-line bg-surface-muted" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface-muted/40 px-6 py-16 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl wb-card">
            <LayoutGrid className="h-8 w-8 text-ink-subtle" />
          </div>
          <h3 className="font-display text-lg font-semibold text-ink">
            {showDrafts && canManage ? 'Your library is empty' : 'Nothing published yet'}
          </h3>
          <p className="mt-2 max-w-sm text-sm text-ink-muted">
            {showDrafts && canManage
              ? 'Create your first blog post or article with a PDF or HTML file.'
              : 'Check back later, or switch to “All + drafts” if you are an editor.'}
          </p>
          {canManage && (
            <button type="button" onClick={() => setShowCreate(true)} className="wb-btn-primary mt-6">
              <Sparkles className="h-4 w-4" />
              Create first post
            </button>
          )}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {posts.map((post) => {
            const dateLabel = formatPostDate(post.published_at);
            const isBlog = post.kind === 'blog';
            return (
              <li key={post.blog_post_id}>
                <article className="group relative flex h-full flex-col overflow-hidden wb-card transition duration-200 hover:border-cyan-400/50 hover:shadow-panel">
                  <div
                    className={`absolute left-0 top-0 h-full w-1 ${
                      isBlog
                        ? 'bg-gradient-to-b from-amber-400 to-amber-600'
                        : 'bg-gradient-to-b from-cyan-400 to-navy-600'
                    }`}
                    aria-hidden
                  />
                  <div className="flex flex-1 flex-col p-5 pl-6">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                          isBlog
                            ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
                            : 'bg-navy-50 text-navy-700 dark:bg-navy-900/40 dark:text-cyan-200'
                        }`}
                      >
                        {isBlog ? <BookMarked className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                        {post.kind}
                      </span>
                      <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-[11px] font-medium text-ink-muted">
                        {post.content_format === 'pdf' ? 'PDF' : 'HTML'}
                      </span>
                      {!post.published && canManage ? (
                        <span className="rounded-full bg-amber-100/90 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                          Draft
                        </span>
                      ) : null}
                    </div>
                    <h2 className="line-clamp-2 font-display text-base font-semibold leading-snug text-ink">
                      {post.title}
                    </h2>
                    {dateLabel ? (
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-subtle">
                        <Calendar className="h-3.5 w-3.5 shrink-0" />
                        {dateLabel}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-ink-subtle">Not yet published</p>
                    )}
                    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                      <button
                        type="button"
                        onClick={() => openViewer(post)}
                        disabled={!post.published && !canManage}
                        className="wb-btn-primary flex-1 sm:flex-none disabled:opacity-35"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Read
                      </button>
                      {canManage && (
                        <>
                          <button
                            type="button"
                            onClick={() => togglePublished(post)}
                            className="wb-btn-secondary text-xs"
                          >
                            {post.published ? 'Unpublish' : 'Publish'}
                          </button>
                          <button
                            type="button"
                            onClick={() => removePost(post)}
                            className="rounded-xl p-2 text-red-600 transition hover:bg-rose-50 dark:text-red-400 dark:hover:bg-rose-950/40"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {showCreate && canManage && (
        <div className="wb-modal-overlay">
          <div className="wb-modal relative max-w-lg overflow-hidden">
            <div className="bg-gradient-to-r from-navy-950 via-navy-800 to-depth-blue px-6 py-5 text-white">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300/90">New content</p>
                  <h2 className="mt-1 font-display text-xl font-semibold">Blog or article</h2>
                  <p className="mt-1 text-sm text-slate-300">Upload a PDF or HTML file (max 30 MB).</p>
                </div>
                <button
                  type="button"
                  onClick={() => !saving && setShowCreate(false)}
                  className="rounded-lg p-1.5 text-white/90 transition hover:bg-white/15"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <form onSubmit={handleCreate} className="space-y-5 p-6">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  Title
                </label>
                <input
                  type="text"
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  className="wb-input"
                  placeholder="A clear, descriptive title"
                  maxLength={200}
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { value: 'article' as const, label: 'Article', sub: 'Long-form' },
                      { value: 'blog' as const, label: 'Blog', sub: 'Shorter update' },
                    ]
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setCreateKind(opt.value)}
                      className={`rounded-xl border-2 px-3 py-3 text-left transition ${
                        createKind === opt.value
                          ? 'border-cyan-500 bg-cyan-500/10'
                          : 'border-line hover:border-cyan-400/50'
                      }`}
                    >
                      <span className="block text-sm font-semibold text-ink">{opt.label}</span>
                      <span className="text-xs text-ink-subtle">{opt.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  File
                </label>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line bg-surface-muted/40 px-4 py-8 transition hover:border-cyan-400 hover:bg-cyan-500/5">
                  <FileText className="mb-2 h-8 w-8 text-ink-subtle" />
                  <span className="text-sm font-medium text-ink">
                    {createFile ? createFile.name : 'Choose PDF or HTML'}
                  </span>
                  <span className="mt-1 text-xs text-ink-subtle">Click to browse</span>
                  <input
                    type="file"
                    accept=".pdf,.html,.htm,application/pdf,text/html"
                    onChange={(e) => setCreateFile(e.target.files?.[0] ?? null)}
                    className="sr-only"
                    required
                  />
                </label>
              </div>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface-muted/40 px-4 py-3">
                <input
                  type="checkbox"
                  checked={createPublished}
                  onChange={(e) => setCreatePublished(e.target.checked)}
                  className="h-4 w-4 rounded border-line text-cyan-600 focus:ring-cyan-500"
                />
                <div>
                  <span className="text-sm font-medium text-ink">Publish immediately</span>
                  <p className="text-xs text-ink-subtle">Uncheck to save as draft (visible only to editors).</p>
                </div>
              </label>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  disabled={saving}
                  className="wb-btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="wb-btn-primary flex-1">
                  {saving ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating…
                    </span>
                  ) : (
                    'Create post'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewerPost && (
        <div className="fixed inset-0 z-[200] h-[100dvh] w-full bg-black">
          <div className="absolute inset-0 h-full w-full">
            {viewerLoading ? (
              <div className="flex h-full w-full items-center justify-center bg-slate-900">
                <Loader2 className="h-10 w-10 animate-spin text-white/70" />
              </div>
            ) : viewerUrl ? (
              viewerPost.content_format === 'pdf' ? (
                <embed
                  src={viewerUrl}
                  type="application/pdf"
                  className="block h-full w-full"
                  title={viewerPost.title}
                />
              ) : (
                <iframe
                  src={viewerUrl}
                  title={viewerPost.title}
                  className="block h-full w-full border-0 bg-white"
                  sandbox="allow-same-origin"
                  referrerPolicy="no-referrer"
                />
              )
            ) : null}
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 bg-gradient-to-b from-black/75 via-black/35 to-transparent px-3 pb-10 pt-3 sm:px-4 sm:pt-4">
            <p className="pointer-events-auto min-w-0 max-w-[min(100%,32rem)] sm:max-w-[min(100%,42rem)] truncate text-sm font-medium text-white drop-shadow-md sm:text-base">
              {viewerPost.title}
            </p>
            <div className="pointer-events-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
              {viewerPost.content_format === 'pdf' && viewerUrl && !viewerLoading ? (
                <button
                  type="button"
                  onClick={downloadViewerPdf}
                  className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-white/25"
                >
                  <Download className="h-4 w-4" />
                  Download PDF
                </button>
              ) : null}
              <button
                type="button"
                onClick={closeViewer}
                className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-white/25"
              >
                <X className="h-4 w-4" />
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
