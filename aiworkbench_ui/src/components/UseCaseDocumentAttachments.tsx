import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ExternalLink, Paperclip, Plus, Trash2, Upload } from 'lucide-react';
import { api } from '../lib/api';
import type { DocumentType, UseCaseDocument } from '../types';
import ResourceViewerModal, { type ResourcePreviewContent } from './ResourceViewerModal';
import SelectMenu from './SelectMenu';
import { isResourceManagementDocument, isTechnicalAnalysisDocument } from '../utils/useCaseDocuments';

const DOCUMENT_UPLOAD_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.html',
  '.htm',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.zip',
  '.rar',
  '.tar',
  '.tar.gz',
  '.tgz',
  '.tar.bz2',
  '.tbz',
  '.tbz2',
  '.tar.xz',
  '.txz',
];

type PreviewKind = 'pdf' | 'image' | 'html' | 'unavailable';
export type DocumentAttachmentSource = 'reference' | 'technical_analysis';

interface UseCaseDocumentAttachmentsProps {
  useCaseId: string;
  documents: UseCaseDocument[];
  onDocumentsChange: (documents: UseCaseDocument[]) => void;
  canUpload: boolean;
  source: DocumentAttachmentSource;
  title?: string;
  helpText?: string;
  filterSource?: DocumentAttachmentSource;
  compact?: boolean;
}

function isInfographicFileName(fileName?: string | null) {
  return Boolean(fileName?.toUpperCase().startsWith('INFOGRAPHIC__'));
}

function formatSize(sizeBytes?: number | null) {
  if (sizeBytes == null) return null;
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(fileName: string): string {
  const normalizedName = fileName.toLowerCase();
  const matchedExtension = DOCUMENT_UPLOAD_EXTENSIONS
    .filter((extension) => normalizedName.endsWith(extension))
    .sort((a, b) => b.length - a.length)[0];
  if (matchedExtension) return matchedExtension;
  const dotIndex = normalizedName.lastIndexOf('.');
  if (dotIndex < 0) return '';
  return normalizedName.slice(dotIndex);
}

function isPresentationFile(fileName: string) {
  const extension = getFileExtension(fileName);
  return extension === '.ppt' || extension === '.pptx';
}

function inferPreviewKind(
  documentType: string | null | undefined,
  mimeType: string | null | undefined,
  fileName: string
): PreviewKind {
  const normalizedMime = (mimeType || '').toLowerCase();
  if (normalizedMime.includes('application/pdf')) return 'pdf';
  if (normalizedMime.startsWith('image/')) return 'image';
  if (normalizedMime.includes('text/html')) return 'html';

  const normalizedType = (documentType || '').toUpperCase();
  if (normalizedType === 'PDF') return 'pdf';
  if (normalizedType === 'HTML') return 'html';
  if (normalizedType === 'IMAGE') return 'image';

  const extension = getFileExtension(fileName);
  if (extension === '.pdf') return 'pdf';
  if (['.html', '.htm', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'].includes(extension)) return 'html';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) return 'image';
  return 'unavailable';
}

function resolvePreviewMimeType(kind: PreviewKind, mimeType: string | null | undefined) {
  if (mimeType) return mimeType;
  if (kind === 'pdf') return 'application/pdf';
  if (kind === 'html') return 'text/html';
  if (kind === 'image') return 'image/*';
  return 'application/octet-stream';
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function UseCaseDocumentAttachments({
  useCaseId,
  documents,
  onDocumentsChange,
  canUpload,
  source,
  title = 'Attached files',
  helpText,
  filterSource,
  compact = false,
}: UseCaseDocumentAttachmentsProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [selectedType, setSelectedType] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState('');
  const [viewerDocument, setViewerDocument] = useState<UseCaseDocument | null>(null);
  const [viewerPreview, setViewerPreview] = useState<ResourcePreviewContent | null>(null);
  const [viewerObjectUrl, setViewerObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getDocumentTypes()
      .then((types) => {
        if (!cancelled) setDocumentTypes(types || []);
      })
      .catch(() => {
        if (!cancelled) setDocumentTypes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (viewerObjectUrl) URL.revokeObjectURL(viewerObjectUrl);
    };
  }, [viewerObjectUrl]);

  const visibleDocuments = useMemo(
    () =>
      (documents || []).filter((doc) => {
        if (isInfographicFileName(doc.file_name)) return false;
        if (filterSource === 'technical_analysis') return isTechnicalAnalysisDocument(doc);
        if (filterSource === 'reference') return isResourceManagementDocument(doc);
        return !isTechnicalAnalysisDocument(doc);
      }),
    [documents, filterSource]
  );

  const typeOptions = documentTypes.map((item) => ({
    value: item.name,
    label: item.name,
    description: item.description || undefined,
  }));
  const uploadBlockedReason = !selectedType
    ? 'Select a document type first, then upload or drag and drop files.'
    : uploading
      ? 'Upload in progress.'
      : null;
  const canAcceptFiles = canUpload && !uploadBlockedReason;

  async function refreshDocuments() {
    const list = await api.getUseCaseDocuments(useCaseId);
    onDocumentsChange(list || []);
  }

  async function handleFiles(fileList: FileList | File[] | null) {
    if (!fileList || ('length' in fileList && fileList.length === 0)) return;
    if (!canUpload) return;
    if (!selectedType) {
      setError('Select a document type first, then upload or drag and drop files.');
      return;
    }

    const files = Array.from(fileList as ArrayLike<File>);
    setUploading(true);
    setError('');
    try {
      await api.uploadUseCaseDocuments(useCaseId, files, {
        documentType: selectedType,
        source,
      });
      await refreshDocuments();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(documentId: number) {
    setError('');
    setActionKey(`delete-${documentId}`);
    try {
      await api.deleteUseCaseDocument(useCaseId, documentId);
      onDocumentsChange(documents.filter((doc) => doc.document_id !== documentId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setActionKey(null);
    }
  }

  function closeViewer() {
    setViewerOpen(false);
    setViewerLoading(false);
    setViewerError('');
    setViewerDocument(null);
    setViewerPreview(null);
    if (viewerObjectUrl) {
      URL.revokeObjectURL(viewerObjectUrl);
      setViewerObjectUrl(null);
    }
  }

  async function handleOpen(documentItem: UseCaseDocument) {
    setError('');
    setViewerOpen(true);
    setViewerLoading(true);
    setViewerError('');
    setViewerDocument(documentItem);
    setViewerPreview(null);
    if (viewerObjectUrl) {
      URL.revokeObjectURL(viewerObjectUrl);
      setViewerObjectUrl(null);
    }
    setActionKey(`open-${documentItem.document_id}`);
    try {
      const preview = await api.previewUseCaseDocument(useCaseId, documentItem.document_id);
      const resolvedFileName = preview.file_name || documentItem.file_name;
      const previewKind = inferPreviewKind(preview.document_type, preview.mime_type, resolvedFileName);

      if (!preview.preview_available) {
        setViewerPreview({
          kind: 'unavailable',
          message: preview.message || preview.detail || 'Preview is not available for this file. Download it to view.',
        });
        return;
      }

      if (previewKind === 'html' && preview.html_content) {
        setViewerPreview({
          kind: 'html',
          html: preview.html_content,
          pageOnly: isPresentationFile(resolvedFileName),
        });
        return;
      }
      if (preview.preview_url) {
        if (previewKind === 'html') {
          setViewerPreview({
            kind: 'html',
            src: preview.preview_url,
            pageOnly: isPresentationFile(resolvedFileName),
          });
        } else if (previewKind === 'unavailable') {
          setViewerPreview({
            kind: 'unavailable',
            message: 'Preview is not available for this file. Download it to view.',
          });
        } else {
          setViewerPreview({
            kind: previewKind,
            src: preview.preview_url,
            mimeType: preview.mime_type,
            pageOnly: isPresentationFile(resolvedFileName),
          });
        }
        return;
      }
      if (preview.content_base64 && previewKind !== 'unavailable') {
        const mimeType = resolvePreviewMimeType(previewKind, preview.mime_type);
        if (previewKind === 'html') {
          setViewerPreview({
            kind: 'html',
            src: `data:${mimeType};base64,${preview.content_base64}`,
            pageOnly: isPresentationFile(resolvedFileName),
          });
        } else {
          setViewerPreview({
            kind: previewKind,
            src: `data:${mimeType};base64,${preview.content_base64}`,
            mimeType,
            pageOnly: isPresentationFile(resolvedFileName),
          });
        }
        return;
      }
      if (preview.blob && previewKind !== 'unavailable') {
        const objectUrl = URL.createObjectURL(preview.blob);
        setViewerObjectUrl(objectUrl);
        if (previewKind === 'html') {
          setViewerPreview({
            kind: 'html',
            src: objectUrl,
            pageOnly: isPresentationFile(resolvedFileName),
          });
        } else {
          setViewerPreview({
            kind: previewKind,
            src: objectUrl,
            mimeType: preview.mime_type || preview.blob.type,
            pageOnly: isPresentationFile(resolvedFileName),
          });
        }
        return;
      }
      setViewerPreview({
        kind: 'unavailable',
        message: 'Preview is not available for this file. Download it to view.',
      });
    } catch (err: unknown) {
      setViewerError(err instanceof Error ? err.message : 'Failed to load preview.');
    } finally {
      setViewerLoading(false);
      setActionKey(null);
    }
  }

  async function handleDownload(documentItem: UseCaseDocument) {
    setError('');
    setActionKey(`download-${documentItem.document_id}`);
    try {
      const { blob, fileName } = await api.downloadUseCaseDocument(
        useCaseId,
        documentItem.document_id,
        documentItem.file_name
      );
      triggerDownload(blob, fileName);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to download document.');
    } finally {
      setActionKey(null);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          <Paperclip className="h-4 w-4" />
          {title}
        </label>
        {helpText ? (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{helpText}</p>
        ) : null}
      </div>

      {canUpload && compact && (
        <div className="space-y-1.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="w-full sm:w-52 sm:shrink-0">
              <SelectMenu
                value={selectedType}
                onChange={setSelectedType}
                placeholder={typeOptions.length ? 'Document type' : 'No types'}
                options={typeOptions}
                disabled={uploading || typeOptions.length === 0}
                searchable
                size="sm"
                aria-label="Document type"
              />
            </div>
            <button
              type="button"
              disabled={!canAcceptFiles}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                if (canAcceptFiles) setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                if (!canAcceptFiles) {
                  setError(uploadBlockedReason || 'Select a document type first.');
                  return;
                }
                void handleFiles(event.dataTransfer.files);
              }}
              className={`flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 text-xs transition sm:min-w-0 sm:flex-1 ${
                dragOver
                  ? 'border-cyan-400 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
                  : 'border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300'
              } ${canAcceptFiles ? 'hover:border-slate-400 dark:hover:border-slate-500' : 'cursor-not-allowed opacity-60'}`}
            >
              <Upload className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{uploading ? 'Uploading...' : 'Drop files or browse'}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={DOCUMENT_UPLOAD_EXTENSIONS.join(',')}
              className="hidden"
              disabled={!canAcceptFiles}
              onChange={(event) => {
                void handleFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </div>
          {typeOptions.length === 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Add document types in Settings → Document Types first.
            </p>
          ) : null}
        </div>
      )}

      {canUpload && !compact && (
        <div className="space-y-3">
          <div className="max-w-md">
            <SelectMenu
              value={selectedType}
              onChange={setSelectedType}
              placeholder={typeOptions.length ? 'Select document type' : 'No document types configured'}
              options={typeOptions}
              disabled={uploading || typeOptions.length === 0}
              searchable
              aria-label="Document type"
            />
          </div>
          {typeOptions.length === 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              An admin must add document types in Settings → Document Types before files can be uploaded.
            </p>
          )}
          <div
            onDragOver={(event) => {
              event.preventDefault();
              if (canAcceptFiles) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              void handleFiles(event.dataTransfer.files);
            }}
            className={`rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
              dragOver
                ? 'border-cyan-400 bg-cyan-500/10'
                : 'border-slate-300 dark:border-slate-600 bg-slate-50/70 dark:bg-slate-900/40'
            } ${canAcceptFiles ? 'cursor-pointer' : 'opacity-70'}`}
          >
            <Upload className="mx-auto mb-2 h-5 w-5 text-slate-500 dark:text-slate-400" />
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {uploading ? 'Uploading…' : 'Drag and drop files here'}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {uploadBlockedReason || 'Or choose files after selecting a document type.'}
            </p>
            <button
              type="button"
              disabled={!canAcceptFiles}
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
            >
              <Plus className="h-4 w-4" />
              Choose files to upload
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={DOCUMENT_UPLOAD_EXTENSIONS.join(',')}
              className="hidden"
              disabled={!canAcceptFiles}
              onChange={(event) => {
                void handleFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      <ul className="space-y-2">
        {visibleDocuments.map((doc) => (
          <li
            key={doc.document_id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
          >
            <span className="truncate font-medium text-slate-800 dark:text-slate-200">{doc.file_name}</span>
            {doc.document_type ? (
              <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[11px] font-medium text-cyan-800 dark:text-cyan-300">
                {doc.document_type}
              </span>
            ) : null}
            {formatSize(doc.size_bytes) ? (
              <span className="text-xs text-slate-500 dark:text-slate-400">{formatSize(doc.size_bytes)}</span>
            ) : null}
            <button
              type="button"
              onClick={() => void handleOpen(doc)}
              disabled={actionKey !== null}
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View
            </button>
            <button
              type="button"
              onClick={() => void handleDownload(doc)}
              disabled={actionKey !== null}
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </button>
            {canUpload && (
              <button
                type="button"
                onClick={() => void handleDelete(doc.document_id)}
                disabled={actionKey !== null}
                className="p-1 text-slate-500 hover:text-red-600 rounded disabled:opacity-50"
                title="Delete document"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
        {visibleDocuments.length === 0 && (
          <li className="text-sm italic text-slate-500 dark:text-slate-400">No documents attached yet.</li>
        )}
      </ul>

      <ResourceViewerModal
        isOpen={viewerOpen}
        title={viewerDocument?.file_name || 'Document preview'}
        preview={viewerPreview}
        loading={viewerLoading}
        error={viewerError}
        onClose={closeViewer}
        onDownload={
          viewerDocument
            ? () => {
                void handleDownload(viewerDocument);
              }
            : undefined
        }
        downloadDisabled={!viewerDocument || actionKey === `download-${viewerDocument.document_id}`}
      />
    </div>
  );
}
