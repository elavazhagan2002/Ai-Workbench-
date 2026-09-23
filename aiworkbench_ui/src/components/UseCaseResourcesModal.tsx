import { useEffect, useRef, useState } from 'react';
import {
  Download,
  ExternalLink,
  Link as LinkIcon,
  Paperclip,
  PlayCircle,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api, type UseCaseDocumentPreview } from '../lib/api';
import type { DocumentType, UseCase, UseCaseDocument, UseCaseLink } from '../types';
import DemoVideoPlayer from './DemoVideoPlayer';
import ConfirmModal from './ConfirmModal';
import ResourceViewerModal, { type ResourcePreviewContent } from './ResourceViewerModal';
import SelectMenu from './SelectMenu';
import { isResourceManagementDocument } from '../utils/useCaseDocuments';

type ResourceTab = 'demo' | 'links' | 'documents' | 'infographics';
type EditableLink = { url: string; label: string };

const RESOURCE_TABS: Array<{ id: ResourceTab; label: string }> = [
  { id: 'demo', label: 'Demo video' },
  { id: 'links', label: 'Live demo' },
  { id: 'documents', label: 'Document' },
  { id: 'infographics', label: 'Infographic' },
];

const INFOGRAPHIC_TYPES = ['PDF', 'HTML', 'IMAGE'] as const;
type InfographicType = typeof INFOGRAPHIC_TYPES[number];

const INFOGRAPHIC_PREFIX = 'INFOGRAPHIC__';
const LEGACY_INFOGRAPHIC_PREFIX = 'INFOGRAPHIC_';

const TYPE_EXTENSION_MAP: Record<InfographicType, string[]> = {
  PDF: ['.pdf'],
  HTML: ['.html', '.htm'],
  IMAGE: ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
};

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

const PREVIEW_SUPPORTED_EXTENSIONS = new Set([
  '.pdf',
  '.html',
  '.htm',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
]);
const DOCUMENT_UPLOAD_EXTENSION_SET = new Set(DOCUMENT_UPLOAD_EXTENSIONS);

type PreviewKind = 'pdf' | 'image' | 'html' | 'unavailable';

interface DemoVideoOption {
  path: string;
  name: string;
  size_bytes?: number;
}

interface UseCaseResourcesModalProps {
  useCase: UseCase;
  onClose: () => void;
  isAdmin: boolean;
  canViewResources: boolean;
  canEditResources: boolean;
  canViewDemo: boolean;
  canViewLiveDemo: boolean;
  canViewDocument: boolean;
  canViewInfographic: boolean;
  canMapDemo: boolean;
  canDelinkDemo: boolean;
  onUseCaseUpdated?: (useCaseId: string, changes: Partial<UseCase>) => void;
}

function toEditableLinks(links?: UseCaseLink[]): EditableLink[] {
  return (links || []).map((link) => ({
    url: link.url || '',
    label: link.label || '',
  }));
}

function normalizeLinks(links: EditableLink[]) {
  return links
    .map((link) => ({
      url: link.url.trim(),
      label: link.label.trim(),
    }))
    .filter((link) => link.url)
    .map((link) => ({
      url: link.url,
      ...(link.label ? { label: link.label } : {}),
    }));
}

function parseInfographicFileName(fileName: string): {
  isInfographic: boolean;
  type?: InfographicType;
  legacyType?: string;
  displayName: string;
} {
  function resolveKnownType(rawType: string): InfographicType | undefined {
    const normalizedType = rawType.toUpperCase();
    const knownType = INFOGRAPHIC_TYPES.find((item) => item === normalizedType);
    return knownType as InfographicType | undefined;
  }

  if (fileName.startsWith(INFOGRAPHIC_PREFIX)) {
    const parts = fileName.split('__');
    const rawType = (parts[1] || '').toUpperCase();
    const knownType = resolveKnownType(rawType);
    const displayName = parts.slice(2).join('__') || fileName;

    return {
      isInfographic: true,
      type: knownType,
      legacyType: knownType ? undefined : (rawType || undefined),
      displayName,
    };
  }

  if (fileName.startsWith(LEGACY_INFOGRAPHIC_PREFIX)) {
    const remainingName = fileName.slice(LEGACY_INFOGRAPHIC_PREFIX.length);
    const separatorIndex = remainingName.indexOf('__');
    if (separatorIndex < 0) {
      return { isInfographic: false, displayName: fileName };
    }

    const rawType = remainingName.slice(0, separatorIndex).toUpperCase();
    const knownType = resolveKnownType(rawType);
    const displayName = remainingName.slice(separatorIndex + 2) || fileName;

    return {
      isInfographic: true,
      type: knownType,
      legacyType: knownType ? undefined : (rawType || undefined),
      displayName,
    };
  }

  return {
    isInfographic: false,
    displayName: fileName,
  };
}

function ensureInfographicFileName(file: File, selectedType: InfographicType): File {
  const parsed = parseInfographicFileName(file.name);
  if (parsed.isInfographic) {
    return file;
  }

  const renamed = `${INFOGRAPHIC_PREFIX}${selectedType}__${file.name}`;
  return new File([file], renamed, {
    type: file.type,
    lastModified: file.lastModified,
  });
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

function extensionListLabel(extensions: string[]) {
  return extensions.join(', ');
}

function getExpectedExtensionsForInfographicType(type: InfographicType) {
  return TYPE_EXTENSION_MAP[type] || [];
}

function isPresentationFile(fileName: string) {
  const extension = getFileExtension(fileName);
  return extension === '.ppt' || extension === '.pptx';
}

function inferPreviewKind(documentType: string | null | undefined, mimeType: string | null | undefined, fileName: string): PreviewKind {
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
  if (['.html', '.htm', '.ppt', '.pptx', '.xls', '.xlsx'].includes(extension)) return 'html';
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

export default function UseCaseResourcesModal({
  useCase,
  onClose,
  isAdmin,
  canViewResources,
  canEditResources,
  canViewDemo,
  canViewLiveDemo,
  canViewDocument,
  canViewInfographic,
  canMapDemo,
  canDelinkDemo,
  onUseCaseUpdated,
}: UseCaseResourcesModalProps) {
  const canReadResources = canViewResources || canEditResources;
  const canReadLiveDemo = isAdmin ? canReadResources : canViewLiveDemo;
  const canReadDocuments = isAdmin ? canReadResources : canViewDocument;
  const canReadInfographics = isAdmin ? canReadResources : canViewInfographic;

  function isVisibleTab(tab: ResourceTab) {
    if (isAdmin) return true;
    if (tab === 'links') return canViewLiveDemo;
    if (tab === 'documents') return canViewDocument;
    if (tab === 'infographics') return canViewInfographic;
    return false;
  }

  const visibleTabs = RESOURCE_TABS.filter((tab) => isVisibleTab(tab.id));
  const defaultTab: ResourceTab = isAdmin
    ? (canViewDemo || canMapDemo ? 'demo' : 'links')
    : (visibleTabs[0]?.id ?? 'demo');

  const [activeTab, setActiveTab] = useState<ResourceTab>(defaultTab);
  const [resourceUseCase, setResourceUseCase] = useState<UseCase>(useCase);
  const [error, setError] = useState('');

  const [linksLoaded, setLinksLoaded] = useState(Array.isArray(useCase.reference_links));
  const [linksLoading, setLinksLoading] = useState(false);
  const [linkDrafts, setLinkDrafts] = useState<EditableLink[]>(toEditableLinks(useCase.reference_links));
  const [linksSaving, setLinksSaving] = useState(false);

  const [documentsLoaded, setDocumentsLoaded] = useState(Array.isArray(useCase.documents));
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documents, setDocuments] = useState<UseCaseDocument[]>(useCase.documents || []);
  const [documentUploading, setDocumentUploading] = useState(false);
  const [lookupDocumentTypes, setLookupDocumentTypes] = useState<DocumentType[]>([]);
  const [documentTypesLoaded, setDocumentTypesLoaded] = useState(false);
  const [selectedDocumentType, setSelectedDocumentType] = useState('');
  const [documentDragOver, setDocumentDragOver] = useState(false);
  const documentFileInputRef = useRef<HTMLInputElement | null>(null);
  const [infographicUploading, setInfographicUploading] = useState(false);
  const [infographicType, setInfographicType] = useState<InfographicType>('PDF');
  const [documentActionKey, setDocumentActionKey] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState('');
  const [viewerDocument, setViewerDocument] = useState<UseCaseDocument | null>(null);
  const [viewerPreview, setViewerPreview] = useState<ResourcePreviewContent | null>(null);
  const [viewerObjectUrl, setViewerObjectUrl] = useState<string | null>(null);

  const [demoVideos, setDemoVideos] = useState<DemoVideoOption[]>([]);
  const [demoVideosLoaded, setDemoVideosLoaded] = useState(false);
  const [demoVideosLoading, setDemoVideosLoading] = useState(false);
  const [selectedDemoPath, setSelectedDemoPath] = useState('');
  const [demoMapping, setDemoMapping] = useState(false);
  const [demoDelinking, setDemoDelinking] = useState(false);
  const [showDelinkConfirm, setShowDelinkConfirm] = useState(false);

  useEffect(() => {
    setActiveTab(defaultTab);
    setResourceUseCase(useCase);
    setError('');
    setLinksLoaded(Array.isArray(useCase.reference_links));
    setLinksLoading(false);
    setLinkDrafts(toEditableLinks(useCase.reference_links));
    setLinksSaving(false);
    setDocumentsLoaded(Array.isArray(useCase.documents));
    setDocumentsLoading(false);
    setDocuments(useCase.documents || []);
    setDocumentUploading(false);
    setLookupDocumentTypes([]);
    setDocumentTypesLoaded(false);
    setSelectedDocumentType('');
    setDocumentDragOver(false);
    setInfographicUploading(false);
    setInfographicType('PDF');
    setDocumentActionKey(null);
    setViewerOpen(false);
    setViewerLoading(false);
    setViewerError('');
    setViewerDocument(null);
    setViewerPreview(null);
    setViewerObjectUrl((currentUrl) => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      return null;
    });
    setDemoVideos([]);
    setDemoVideosLoaded(false);
    setDemoVideosLoading(false);
    setSelectedDemoPath('');
    setDemoMapping(false);
    setDemoDelinking(false);
    setShowDelinkConfirm(false);
  }, [defaultTab, useCase.use_case_id]);

  useEffect(() => {
    setError('');
  }, [activeTab]);

  useEffect(() => {
    return () => {
      if (viewerObjectUrl) {
        URL.revokeObjectURL(viewerObjectUrl);
      }
    };
  }, [viewerObjectUrl]);

  useEffect(() => {
    if (activeTab === 'demo' && canMapDemo && !demoVideosLoaded && !demoVideosLoading) {
      void loadDemoVideos();
    }

    if (activeTab === 'links' && canReadLiveDemo && !linksLoaded && !linksLoading) {
      void loadUseCaseDetails();
    }

    if (activeTab === 'documents' && canReadDocuments && !documentsLoaded && !documentsLoading) {
      void loadDocuments();
    }

    if (activeTab === 'infographics' && canReadInfographics && !documentsLoaded && !documentsLoading) {
      void loadDocuments();
    }
  }, [
    activeTab,
    canMapDemo,
    canReadLiveDemo,
    canReadDocuments,
    canReadInfographics,
    canReadResources,
    demoVideosLoaded,
    demoVideosLoading,
    documentsLoaded,
    documentsLoading,
    linksLoaded,
    linksLoading,
  ]);

  useEffect(() => {
    if (activeTab !== 'documents' || !canEditResources || !canReadDocuments) return;
    let cancelled = false;
    setDocumentTypesLoaded(false);
    api.getDocumentTypes()
      .then((types) => {
        if (!cancelled) setLookupDocumentTypes(types || []);
      })
      .catch(() => {
        if (!cancelled) setLookupDocumentTypes([]);
      })
      .finally(() => {
        if (!cancelled) setDocumentTypesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, canEditResources, canReadDocuments, useCase.use_case_id]);

  const originalLinksSnapshot = JSON.stringify(normalizeLinks(toEditableLinks(resourceUseCase.reference_links)));
  const currentLinksSnapshot = JSON.stringify(normalizeLinks(linkDrafts));
  const hasUnsavedLinkChanges = originalLinksSnapshot !== currentLinksSnapshot;
  const normalizedDraftLinks = normalizeLinks(linkDrafts);
  const hasTooManyDraftLinks = normalizedDraftLinks.length > 1;
  const primaryLinkDraft = linkDrafts[0] ?? { url: '', label: '' };
  const extraLinkDrafts = linkDrafts.slice(1);

  const infographicItems = documents.filter((doc) => parseInfographicFileName(doc.file_name).isInfographic);
  const documentItems = documents.filter(isResourceManagementDocument);
  const documentTypeOptions = lookupDocumentTypes.map((item) => ({
    value: item.name,
    label: item.name,
    description: item.description || undefined,
  }));
  const canUploadDocuments = canEditResources && canReadDocuments;
  const documentUploadBlockedReason = !canUploadDocuments
    ? null
    : !documentTypesLoaded
      ? 'Loading document types...'
      : lookupDocumentTypes.length === 0
        ? 'An admin must add document types in Settings → Document Types before files can be uploaded.'
        : !selectedDocumentType
          ? 'Select a document type first, then upload or drag and drop files.'
          : documentUploading
            ? 'Upload in progress.'
            : null;
  const canAcceptDocumentFiles = canUploadDocuments && !documentUploadBlockedReason;
  const infographicUploadBlockedReason = infographicItems.length > 0
    ? 'Only one infographic file is allowed per use case. Delete the existing infographic before uploading a new one.'
    : null;

  function hasDemoVideo(currentUseCase: UseCase) {
    return !!currentUseCase.has_demo || !!currentUseCase.demo_video_path;
  }

  function syncUseCase(changes: Partial<UseCase>) {
    setResourceUseCase((prev) => ({ ...prev, ...changes }));
    onUseCaseUpdated?.(useCase.use_case_id, changes);
  }

  function clearViewerObjectUrl() {
    setViewerObjectUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
      return null;
    });
  }

  function closeViewer() {
    setViewerOpen(false);
    setViewerLoading(false);
    setViewerError('');
    setViewerPreview(null);
    setViewerDocument(null);
    clearViewerObjectUrl();
  }

  function previewUnavailableMessage(preview: UseCaseDocumentPreview, fileName: string) {
    return (
      preview.message ||
      preview.detail ||
      `Preview is not available for ${fileName}. Please use Download to view this file.`
    );
  }

  function validateUploadSelection(files: File[], mode: 'documents' | 'infographics'): string | null {
    if (mode === 'documents') {
      const infographicNamedFiles = files.filter((file) => parseInfographicFileName(file.name).isInfographic);
      if (infographicNamedFiles.length > 0) {
        const names = infographicNamedFiles.map((file) => file.name).join(', ');
        return `Infographic files must be uploaded from the Infographic tab. Move these files there: ${names}.`;
      }

      const invalidFiles = files.filter((file) => !DOCUMENT_UPLOAD_EXTENSION_SET.has(getFileExtension(file.name)));
      if (invalidFiles.length > 0) {
        const names = invalidFiles.map((file) => file.name).join(', ');
        return `Unsupported document type: ${names}. Allowed extensions: ${extensionListLabel(DOCUMENT_UPLOAD_EXTENSIONS)}.`;
      }
      return null;
    }

    if (files.length > 1) {
      return 'Only one infographic file can be uploaded at a time.';
    }

    const expectedExtensions = getExpectedExtensionsForInfographicType(infographicType);
    const mismatched = files.filter((file) => !expectedExtensions.includes(getFileExtension(file.name)));
    if (mismatched.length > 0) {
      const names = mismatched.map((file) => file.name).join(', ');
      return `Selected infographic type ${infographicType} accepts ${extensionListLabel(expectedExtensions)}. Mismatch: ${names}.`;
    }

    return null;
  }

  async function loadUseCaseDetails() {
    setLinksLoading(true);
    try {
      const data = await api.getUseCase(useCase.use_case_id) as UseCase;
      setResourceUseCase((prev) => ({ ...prev, ...data }));
      setLinkDrafts(toEditableLinks(data.reference_links));
      setLinksLoaded(true);
      if (Array.isArray(data.documents) && !documentsLoaded) {
        setDocuments(data.documents || []);
        setDocumentsLoaded(true);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load use case details.');
    } finally {
      setLinksLoading(false);
    }
  }

  async function loadDocuments() {
    setDocumentsLoading(true);
    try {
      const list = await api.getUseCaseDocuments(useCase.use_case_id);
      setDocuments(list || []);
      setDocumentsLoaded(true);
      syncUseCase({ documents: list || [] });
    } catch (err: any) {
      setError(err?.message || 'Failed to load documents.');
    } finally {
      setDocumentsLoading(false);
    }
  }

  async function loadDemoVideos() {
    setDemoVideosLoading(true);
    try {
      const list = await api.getDemoVideos();
      setDemoVideos(list || []);
      setDemoVideosLoaded(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to load demo videos.');
    } finally {
      setDemoVideosLoading(false);
    }
  }

  function updatePrimaryLink(field: keyof EditableLink, value: string) {
    setLinkDrafts((prev) => {
      const nextPrimary = {
        ...(prev[0] ?? { url: '', label: '' }),
        [field]: value,
      };
      if (prev.length === 0) return [nextPrimary];
      return [nextPrimary, ...prev.slice(1)];
    });
  }

  function clearPrimaryLink() {
    setLinkDrafts((prev) => {
      const clearedPrimary = { url: '', label: '' };
      if (prev.length === 0) return [clearedPrimary];
      return [clearedPrimary, ...prev.slice(1)];
    });
  }

  async function saveReferenceLinks() {
    const payload = normalizeLinks(linkDrafts);
    if (payload.length > 1) {
      setError('Only one live demo link is allowed per use case.');
      return;
    }

    setLinksSaving(true);
    setError('');
    try {
      await api.updateUseCase(useCase.use_case_id, {
        reference_links: payload,
      });

      const refreshedUseCase = await api.getUseCase(useCase.use_case_id) as UseCase;
      const refreshedLinks = refreshedUseCase.reference_links || [];
      setResourceUseCase((prev) => ({
        ...prev,
        reference_links: refreshedLinks,
      }));
      setLinkDrafts(toEditableLinks(refreshedLinks));
      setLinksLoaded(true);
      syncUseCase({ reference_links: refreshedLinks });
    } catch (err: any) {
      setError(err?.message || 'Failed to save website links.');
    } finally {
      setLinksSaving(false);
    }
  }

  async function handleUploadDocuments(fileList: FileList | null, mode: 'documents' | 'infographics') {
    if (!fileList?.length) return;

    if (mode === 'documents' && !canUploadDocuments) {
      setError('You do not have permission to upload documents.');
      return;
    }

    if (mode === 'infographics' && !canEditResources) {
      setError('You do not have permission to upload infographics.');
      return;
    }

    if (mode === 'documents' && documentUploadBlockedReason) {
      setError(documentUploadBlockedReason);
      return;
    }

    if (mode === 'infographics' && infographicUploadBlockedReason) {
      setError(infographicUploadBlockedReason);
      return;
    }

    const selectedFiles = Array.from(fileList);
    const validationMessage = validateUploadSelection(selectedFiles, mode);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setError('');
    if (mode === 'documents') {
      setDocumentUploading(true);
    } else {
      setInfographicUploading(true);
    }

    try {
      const files = selectedFiles.map((file) =>
        mode === 'infographics' ? ensureInfographicFileName(file, infographicType) : file
      );
      await api.uploadUseCaseDocuments(useCase.use_case_id, files, {
        source: 'reference',
        ...(mode === 'documents' ? { documentType: selectedDocumentType } : {}),
      });
      await loadDocuments();
    } catch (err: any) {
      setError(err?.message || 'Upload failed.');
    } finally {
      if (mode === 'documents') {
        setDocumentUploading(false);
      } else {
        setInfographicUploading(false);
      }
    }
  }

  async function handleDeleteDocument(documentId: number) {
    if (!canEditResources) {
      setError('You do not have permission to delete documents.');
      return;
    }
    setError('');
    setDocumentActionKey(`delete-${documentId}`);
    try {
      await api.deleteUseCaseDocument(useCase.use_case_id, documentId);
      await loadDocuments();
    } catch (err: any) {
      setError(err?.message || 'Delete failed.');
    } finally {
      setDocumentActionKey(null);
    }
  }

  async function handleOpenDocument(documentItem: UseCaseDocument) {
    setError('');
    setViewerOpen(true);
    setViewerLoading(true);
    setViewerError('');
    setViewerDocument(documentItem);
    setViewerPreview(null);
    clearViewerObjectUrl();
    setDocumentActionKey(`open-${documentItem.document_id}`);
    try {
      const preview = await api.previewUseCaseDocument(
        useCase.use_case_id,
        documentItem.document_id
      );

      const resolvedFileName = preview.file_name || documentItem.file_name;
      const previewKind = inferPreviewKind(preview.document_type, preview.mime_type, resolvedFileName);

      if (!preview.preview_available) {
        setViewerPreview({
          kind: 'unavailable',
          message: previewUnavailableMessage(preview, resolvedFileName),
        });
        return;
      }

      if (previewKind === 'html') {
        if (preview.html_content) {
          setViewerPreview({
            kind: 'html',
            html: preview.html_content,
            pageOnly: isPresentationFile(resolvedFileName),
          });
          return;
        }

        if (preview.preview_url) {
          setViewerPreview({
            kind: 'html',
            src: preview.preview_url,
            pageOnly: isPresentationFile(resolvedFileName),
          });
          return;
        }
      }

      if (preview.preview_url && previewKind !== 'unavailable') {
        if (previewKind === 'html') {
          setViewerPreview({
            kind: 'html',
            src: preview.preview_url,
            pageOnly: isPresentationFile(resolvedFileName),
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
        const headerBytes = new Uint8Array(await preview.blob.slice(0, 5).arrayBuffer());
        const magic = String.fromCharCode(...headerBytes);
        if (magic === '%PDF-') {
          const objectUrl = URL.createObjectURL(preview.blob);
          setViewerObjectUrl(objectUrl);
          setViewerPreview({
            kind: 'pdf',
            src: objectUrl,
            mimeType: 'application/pdf',
            pageOnly: isPresentationFile(resolvedFileName),
          });
          return;
        }

        if (previewKind === 'html') {
          const html = await preview.blob.text();
          setViewerPreview({
            kind: 'html',
            html,
            pageOnly: isPresentationFile(resolvedFileName),
          });
          return;
        }

        const objectUrl = URL.createObjectURL(preview.blob);
        setViewerObjectUrl(objectUrl);
        setViewerPreview({
          kind: previewKind,
          src: objectUrl,
          mimeType: preview.mime_type || preview.blob.type,
          pageOnly: isPresentationFile(resolvedFileName),
        });
        return;
      }

      setViewerPreview({
        kind: 'unavailable',
        message: previewUnavailableMessage(preview, resolvedFileName),
      });
    } catch (err: any) {
      setViewerError(err?.message || 'Failed to load preview.');
    } finally {
      setViewerLoading(false);
      setDocumentActionKey(null);
    }
  }

  async function handleDownloadDocument(documentItem: UseCaseDocument) {
    setError('');
    setDocumentActionKey(`download-${documentItem.document_id}`);
    try {
      const { blob, fileName } = await api.downloadUseCaseDocument(
        useCase.use_case_id,
        documentItem.document_id,
        documentItem.file_name
      );
      triggerDownload(blob, fileName);
    } catch (err: any) {
      setError(err?.message || 'Failed to download document.');
    } finally {
      setDocumentActionKey(null);
    }
  }

  async function handleMapDemo() {
    if (!selectedDemoPath) return;

    setError('');
    setDemoMapping(true);
    try {
      const mapResult = await api.mapUseCaseDemo(useCase.use_case_id, selectedDemoPath);

      let changes: Partial<UseCase> = {
        has_demo: mapResult?.has_demo ?? true,
        demo_video_path: selectedDemoPath,
      };

      // Refresh from backend so the card + modal reflect the latest mapped state.
      try {
        const refreshed = await api.getUseCase(useCase.use_case_id) as UseCase;
        changes = {
          has_demo: refreshed.has_demo ?? true,
          demo_video_path: refreshed.demo_video_path ?? selectedDemoPath,
        };
      } catch {
        // Non-blocking: keep optimistic mapped state if refresh fails.
      }

      syncUseCase(changes);
      setSelectedDemoPath('');
    } catch (err: any) {
      setError(err?.message || 'Failed to map demo video.');
    } finally {
      setDemoMapping(false);
    }
  }

  async function handleDelinkDemo() {
    if (demoDelinking || !hasDemoVideo(resourceUseCase)) return;

    setError('');
    setDemoDelinking(true);
    try {
      await api.deleteUseCaseDemo(useCase.use_case_id);
      setSelectedDemoPath('');
      syncUseCase({
        has_demo: false,
        demo_video_path: null,
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to delink demo video.');
    } finally {
      setDemoDelinking(false);
    }
  }

  function renderResourceDocumentList(
    items: UseCaseDocument[],
    emptyMessage: string,
    showInfographicType: boolean
  ) {
    if (documentsLoading && !documentsLoaded) {
      return <p className="text-sm text-slate-600 dark:text-slate-400">Loading documents...</p>;
    }

    if (items.length === 0) {
      return <p className="text-sm italic text-slate-500 dark:text-slate-400">{emptyMessage}</p>;
    }

    return (
      <ul className="space-y-2">
        {items.map((item) => {
          const parsed = parseInfographicFileName(item.file_name);
          const displayName = showInfographicType ? parsed.displayName : item.file_name;
          const infographicTypeLabel = parsed.type || parsed.legacyType;

          return (
            <li
              key={item.document_id}
              className="flex flex-col gap-3 rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-words font-medium text-slate-800 dark:text-slate-200">{displayName}</span>
                  {showInfographicType && infographicTypeLabel && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                      {infographicTypeLabel}
                    </span>
                  )}
                  {!showInfographicType && item.document_type && (
                    <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[11px] font-medium text-cyan-800 dark:text-cyan-300">
                      {item.document_type}
                    </span>
                  )}
                  {formatSize(item.size_bytes) && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">{formatSize(item.size_bytes)}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                <button
                  type="button"
                  onClick={() => handleOpenDocument(item)}
                  disabled={documentActionKey !== null}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-blue-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-blue-400 dark:hover:bg-slate-700/60 sm:flex-none"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadDocument(item)}
                  disabled={documentActionKey !== null}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-blue-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-blue-400 dark:hover:bg-slate-700/60 sm:flex-none"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </button>
                {canEditResources && (
                  <button
                    type="button"
                    onClick={() => handleDeleteDocument(item.document_id)}
                    disabled={documentActionKey !== null}
                    className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:text-red-600 disabled:opacity-50 dark:border-slate-600 dark:text-slate-400 dark:hover:text-red-400"
                    title="Delete document"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  if (!isAdmin && visibleTabs.length === 0) {
    return null;
  }

  return (
    <>
      <div className="wb-app-overlay z-40 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-6">
        <div className="relative flex max-h-[calc(100vh-6rem)] w-full max-w-3xl flex-col rounded-xl bg-white dark:bg-slate-800 sm:max-h-[calc(100vh-7rem)]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Manage resources</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">{resourceUseCase.use_case_name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            aria-label="Close resources modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          {activeTab === 'demo' && (
            <div className="space-y-4">
              {canViewDemo && hasDemoVideo(resourceUseCase) && (
                <div>
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                    <PlayCircle className="h-4 w-4" />
                    Current demo video
                  </h4>
                  <DemoVideoPlayer
                    sources={[
                      {
                        label: 'Default',
                        url: api.getUseCaseDemoUrl(useCase.use_case_id),
                      },
                    ]}
                  />
                </div>
              )}

              {canViewDemo && !hasDemoVideo(resourceUseCase) && !canMapDemo && (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {isAdmin ? 'No demo video is mapped to this use case yet.' : 'No demo video attached yet.'}
                </p>
              )}

              {canMapDemo ? (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="p-4 space-y-3">
                    {demoVideosLoading ? (
                      <p className="text-sm text-slate-600 dark:text-slate-400">Loading available demo videos...</p>
                    ) : demoVideos.length === 0 ? (
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        No demo videos found. Place .mp4 files under the configured demo folder on the server
                        (DEMO_VIDEOS_ROOT), then reopen this dialog.
                      </p>
                    ) : (
                      <>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          Select one of the available demo videos to link it to this use case.
                        </p>
                        <SelectMenu
                          value={selectedDemoPath}
                          onChange={setSelectedDemoPath}
                          placeholder="Select a demo video..."
                          searchable
                          options={demoVideos.map((item) => ({
                            value: item.path,
                            label: item.name,
                            description: item.size_bytes != null ? `${(item.size_bytes / (1024 * 1024)).toFixed(1)} MB` : undefined,
                          }))}
                          aria-label="Demo video"
                        />
                      </>
                    )}
                  </div>
                  <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      Cancel
                    </button>
                    {canDelinkDemo && hasDemoVideo(resourceUseCase) && (
                      <button
                        type="button"
                        onClick={() => setShowDelinkConfirm(true)}
                        disabled={demoMapping || demoDelinking}
                        className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/20"
                      >
                        {demoDelinking ? 'Delinking...' : 'Delink demo'}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!selectedDemoPath || demoVideosLoading || demoMapping || demoDelinking}
                      onClick={handleMapDemo}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-blue-700"
                    >
                      {demoMapping ? 'Linking...' : resourceUseCase.has_demo ? 'Replace demo' : 'Link demo'}
                    </button>
                  </div>
                </div>
              ) : !canViewDemo ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  You do not have permission to view or map demo videos for this use case.
                </p>
              ) : null}
            </div>
          )}

          {activeTab === 'links' && (
            <div className="space-y-4">
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                  <LinkIcon className="h-4 w-4" />
                  Website links
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Reuses the existing use case reference links data. Only one live demo link can be saved per use case.
                </p>
              </div>

              {!canReadLiveDemo ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  You do not have permission to view website links for this use case.
                </p>
              ) : linksLoading && !linksLoaded ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">Loading website links...</p>
              ) : canEditResources ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                      <div className="grid gap-2 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto]">
                        <input
                          type="url"
                          value={primaryLinkDraft.url}
                          onChange={(event) => updatePrimaryLink('url', event.target.value)}
                          placeholder="https://..."
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                        />
                        <input
                          type="text"
                          value={primaryLinkDraft.label}
                          onChange={(event) => updatePrimaryLink('label', event.target.value)}
                          placeholder="Label (optional)"
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={clearPrimaryLink}
                          className="self-start rounded p-2 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
                          title="Clear link"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      {primaryLinkDraft.url.trim() ? (
                        <a
                          href={primaryLinkDraft.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open link
                        </a>
                      ) : (
                        <p className="mt-2 text-sm italic text-slate-500 dark:text-slate-400">No live demo link added yet.</p>
                      )}
                    </div>

                    {extraLinkDrafts.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                          Legacy extra live demo links found. Only one link can be saved now, so remove the extras below.
                        </p>
                        {extraLinkDrafts.map((link, index) => (
                          <div
                            key={`${link.url}-${index + 1}`}
                            className="flex items-center justify-between gap-3 rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2 dark:border-amber-500/25 dark:bg-amber-500/10"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{link.label || link.url}</p>
                              {link.label ? <p className="truncate text-xs text-slate-500 dark:text-slate-400">{link.url}</p> : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => setLinkDrafts((prev) => prev.filter((_, itemIndex) => itemIndex !== index + 1))}
                              className="rounded p-2 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
                              title="Delete extra link"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setLinkDrafts(toEditableLinks(resourceUseCase.reference_links))}
                      disabled={!hasUnsavedLinkChanges || linksSaving}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={saveReferenceLinks}
                      disabled={!hasUnsavedLinkChanges || linksSaving || hasTooManyDraftLinks}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-blue-700"
                    >
                      {linksSaving ? 'Saving...' : 'Save links'}
                    </button>
                  </div>
                </div>
              ) : (
                <ul className="space-y-2">
                  {(resourceUseCase.reference_links || []).map((link) => (
                    <li
                      key={`${link.url}-${link.link_id ?? 'link'}`}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
                    >
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {link.label || link.url}
                      </a>
                      {link.label && <span className="text-xs text-slate-500 dark:text-slate-400">{link.url}</span>}
                    </li>
                  ))}
                  {(resourceUseCase.reference_links?.length ?? 0) === 0 && (
                    <li className="text-sm italic text-slate-500 dark:text-slate-400">No website links added yet.</li>
                  )}
                </ul>
              )}
            </div>
          )}

          {activeTab === 'documents' && (
            <div className="space-y-3">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                <Paperclip className="h-4 w-4" />
                Documents
              </h4>

              {!canReadDocuments ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  You do not have permission to view documents for this use case.
                </p>
              ) : (
                <>
                  {canUploadDocuments && (
                    <div className="space-y-1.5">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div className="w-full sm:w-52 sm:shrink-0">
                          <SelectMenu
                            value={selectedDocumentType}
                            onChange={setSelectedDocumentType}
                            placeholder={
                              !documentTypesLoaded
                                ? 'Loading types...'
                                : documentTypeOptions.length
                                  ? 'Document type'
                                  : 'No types'
                            }
                            options={documentTypeOptions}
                            disabled={documentUploading || !documentTypesLoaded || documentTypeOptions.length === 0}
                            searchable
                            size="sm"
                            aria-label="Document type"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={!canAcceptDocumentFiles}
                          onClick={() => documentFileInputRef.current?.click()}
                          onDragOver={(event) => {
                            event.preventDefault();
                            if (canAcceptDocumentFiles) setDocumentDragOver(true);
                          }}
                          onDragLeave={() => setDocumentDragOver(false)}
                          onDrop={(event) => {
                            event.preventDefault();
                            setDocumentDragOver(false);
                            if (!canAcceptDocumentFiles) {
                              setError(documentUploadBlockedReason || 'Select a document type first.');
                              return;
                            }
                            void handleUploadDocuments(event.dataTransfer.files, 'documents');
                          }}
                          className={`flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 text-xs transition sm:min-w-0 sm:flex-1 ${
                            documentDragOver
                              ? 'border-cyan-400 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
                              : 'border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300'
                          } ${canAcceptDocumentFiles ? 'hover:border-slate-400 dark:hover:border-slate-500' : 'cursor-not-allowed opacity-60'}`}
                        >
                          <Upload className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">
                            {documentUploading ? 'Uploading...' : 'Drop files or browse'}
                          </span>
                        </button>
                        <input
                          ref={documentFileInputRef}
                          type="file"
                          multiple
                          accept={DOCUMENT_UPLOAD_EXTENSIONS.join(',')}
                          disabled={!canAcceptDocumentFiles}
                          className="hidden"
                          onChange={(event) => {
                            void handleUploadDocuments(event.target.files, 'documents');
                            event.target.value = '';
                          }}
                        />
                      </div>
                      {documentTypesLoaded && lookupDocumentTypes.length === 0 ? (
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          Add document types in Settings → Document Types first.
                        </p>
                      ) : null}
                    </div>
                  )}

                  {renderResourceDocumentList(documentItems, 'No documents attached yet.', false)}
                </>
              )}
            </div>
          )}

          {activeTab === 'infographics' && (
            <div className="space-y-4">
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                  <Paperclip className="h-4 w-4" />
                  Infographics
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Infographics reuse the document API and are classified in the UI by the filename pattern
                  <code className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[11px] dark:bg-slate-700">
                    INFOGRAPHIC__TYPE__Name.ext
                  </code>
                  . Only one infographic file is allowed per use case.
                </p>
              </div>

              {!canReadInfographics ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  You do not have permission to view infographics for this use case.
                </p>
              ) : (
                <>
                  {canEditResources && (
                    <div className="space-y-2">
                      {infographicUploadBlockedReason && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                          {infographicUploadBlockedReason}
                        </div>
                      )}
                      {!infographicUploadBlockedReason && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Upload a single infographic here. Document files can remain attached on the same use case as
                          long as they were uploaded separately from this infographic.
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <SelectMenu
                          value={infographicType}
                          onChange={(type) => setInfographicType(type as InfographicType)}
                          disabled={!!infographicUploadBlockedReason || infographicUploading}
                          options={INFOGRAPHIC_TYPES.map((type) => ({ value: type, label: type }))}
                          wrapperClassName="w-full sm:w-40"
                          aria-label="Infographic type"
                        />
                        <label
                          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm ${
                            infographicUploadBlockedReason || infographicUploading
                              ? 'cursor-not-allowed bg-slate-100/70 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
                              : 'cursor-pointer bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                          }`}
                        >
                          <Plus className="h-4 w-4" />
                          <span>{infographicUploading ? 'Uploading...' : 'Choose file to upload'}</span>
                          <input
                            type="file"
                            accept={getExpectedExtensionsForInfographicType(infographicType).join(',')}
                            disabled={infographicUploading || !!infographicUploadBlockedReason}
                            className="hidden"
                            onChange={(event) => {
                              void handleUploadDocuments(event.target.files, 'infographics');
                              event.target.value = '';
                            }}
                          />
                        </label>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Selected type {infographicType} accepts {extensionListLabel(getExpectedExtensionsForInfographicType(infographicType))}.
                      </p>
                    </div>
                  )}

                  {renderResourceDocumentList(infographicItems, 'No infographics attached yet.', true)}
                </>
              )}
            </div>
          )}
        </div>
          <ConfirmModal
            isOpen={showDelinkConfirm}
            onClose={() => setShowDelinkConfirm(false)}
            onConfirm={handleDelinkDemo}
            title="Delink demo"
            message="Delink this demo from the use case? This will not delete the video file from the demo library."
            confirmText="Delink demo"
            confirmStyle="danger"
          />
        </div>
      </div>
      <ResourceViewerModal
        isOpen={viewerOpen}
        title={viewerDocument ? parseInfographicFileName(viewerDocument.file_name).displayName : 'Resource preview'}
        preview={viewerPreview}
        loading={viewerLoading}
        error={viewerError}
        onClose={closeViewer}
        onDownload={
          viewerDocument
            ? () => {
                void handleDownloadDocument(viewerDocument);
              }
            : undefined
        }
        downloadDisabled={
          !viewerDocument ||
          documentActionKey === `download-${viewerDocument.document_id}`
        }
      />
    </>
  );
}
