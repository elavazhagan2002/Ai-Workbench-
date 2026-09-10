import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type WheelEvent,
} from 'react';

import {
  Download,
  Maximize2,
  RefreshCw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

import ExcelPreview from './ExcelPreview';
import WordPreview from './WordPreview';
import PowerPointPreview from './PowerPointPreview';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export type ResourcePreviewContent =
  | {
      kind: 'pdf';
      src: string;
      blob?: Blob;
      mimeType?: string | null;
    }
  | {
      kind: 'image';
      src: string;
      mimeType?: string | null;
    }
  | {
      kind: 'html';
      src?: string;
      html?: string;
    }
  | {
      kind: 'word';
      blob: Blob;
    }
  | {
      kind: 'excel';
      blob: Blob;
    }
  | {
      kind: 'powerpoint';
      blob: Blob;
    }
  | {
      kind: 'unavailable';
      message: string;
    };

interface ResourceViewerModalProps {
  isOpen: boolean;
  title: string;
  preview: ResourcePreviewContent | null;
  loading: boolean;
  error?: string;
  onClose: () => void;
  onDownload?: () => void;
  downloadDisabled?: boolean;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const PDF_BASE_WIDTH = 1000;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function percentLabel(value: number) {
  return `${Math.round(value * 100)}%`;
}

export default function ResourceViewerModal({
  isOpen,
  title,
  preview,
  loading,
  error,
  onClose,
  onDownload,
  downloadDisabled = false,
}: ResourceViewerModalProps) {
  const pdfViewportRef = useRef<HTMLDivElement | null>(null);
  const pdfPagesRef = useRef<HTMLDivElement | null>(null);

  const [pdfZoom, setPdfZoom] = useState(1);
  const [pdfRendering, setPdfRendering] = useState(false);
  const [pdfRenderError, setPdfRenderError] = useState('');
  const [imageZoom, setImageZoom] = useState(1);
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
  const [imageDragging, setImageDragging] = useState(false);

  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setPdfZoom(1);
    setImageZoom(1);
    setImageOffset({ x: 0, y: 0 });
    setImageDragging(false);
    dragStartRef.current = null;
  }, [
    isOpen,
    preview?.kind,
    preview && 'src' in preview ? preview.src : undefined,
  ]);

  useEffect(() => {
    if (!isOpen || preview?.kind !== 'pdf') {
      return;
    }

    const source = preview.src;
    const pdfBlob = preview.blob;

    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;

    async function renderPdf() {
      const pagesContainer = pdfPagesRef.current;

      if (!pagesContainer) {
        return;
      }

      setPdfRendering(true);
      setPdfRenderError('');
      pagesContainer.innerHTML = '';

      try {
        let pdfData: Uint8Array;

        if (pdfBlob) {
          pdfData = new Uint8Array(await pdfBlob.arrayBuffer());
        } else {
          const response = await fetch(source);

          if (!response.ok) {
            throw new Error(`PDF request failed with status ${response.status}.`);
          }

          pdfData = new Uint8Array(await response.arrayBuffer());
        }

        if (pdfData.length < 5 || new TextDecoder().decode(pdfData.subarray(0, 5)) !== '%PDF-') {
          throw new Error('The preview response is not a valid PDF file.');
        }

        loadingTask = pdfjsLib.getDocument({ data: pdfData });
        const pdf = await loadingTask.promise;

        if (cancelled) {
          return;
        }

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) {
            return;
          }

          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({
            scale: 1.5 * pdfZoom,
          });

          const pageWrapper = document.createElement('div');
          pageWrapper.className =
            'mb-6 flex justify-center last:mb-0';

          const canvas = document.createElement('canvas');
          canvas.className =
            'block bg-white shadow-md';

          const context = canvas.getContext('2d');

          if (!context) {
            throw new Error('Unable to create PDF canvas context.');
          }

          const devicePixelRatio = window.devicePixelRatio || 1;

          canvas.width = Math.floor(
            viewport.width * devicePixelRatio
          );
          canvas.height = Math.floor(
            viewport.height * devicePixelRatio
          );

          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;

          context.setTransform(
            devicePixelRatio,
            0,
            0,
            devicePixelRatio,
            0,
            0
          );

          pageWrapper.appendChild(canvas);
          pagesContainer.appendChild(pageWrapper);

          await page.render({
            canvas,
            canvasContext: context,
            viewport,
          }).promise;
        }

        if (!cancelled) {
          setPdfRendering(false);
        }
      } catch (err) {
        console.error('PDF preview failed:', err);

        if (!cancelled) {
          setPdfRendering(false);
          setPdfRenderError(
            'Unable to render this PDF file.'
          );
        }
      }
    }

    void renderPdf();

    return () => {
      cancelled = true;

      if (loadingTask) {
        void loadingTask.destroy();
      }

      if (pdfPagesRef.current) {
        pdfPagesRef.current.innerHTML = '';
      }
    };
  }, [isOpen, preview?.kind === 'pdf' ? preview.src : undefined, pdfZoom]);

  function fitPdfToWidth() {
    const viewport = pdfViewportRef.current;

    if (!viewport) return;

    const nextZoom = clamp(
      (viewport.clientWidth - 32) / PDF_BASE_WIDTH,
      MIN_ZOOM,
      MAX_ZOOM,
    );

    setPdfZoom(nextZoom);
  }

  function startImageDrag(event: MouseEvent<HTMLDivElement>) {
    if (preview?.kind !== 'image') return;

    event.preventDefault();

    dragStartRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: imageOffset.x,
      originY: imageOffset.y,
    };

    setImageDragging(true);
  }

  function onImageDrag(event: MouseEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return;

    const deltaX = event.clientX - dragStartRef.current.startX;
    const deltaY = event.clientY - dragStartRef.current.startY;

    setImageOffset({
      x: dragStartRef.current.originX + deltaX,
      y: dragStartRef.current.originY + deltaY,
    });
  }

  function stopImageDrag() {
    dragStartRef.current = null;
    setImageDragging(false);
  }

  function handleImageWheel(event: WheelEvent<HTMLDivElement>) {
    if (preview?.kind !== 'image') return;

    event.preventDefault();

    const delta = event.deltaY < 0 ? 0.1 : -0.1;

    setImageZoom((current) =>
      clamp(current + delta, MIN_ZOOM, MAX_ZOOM),
    );
  }

  function renderContent() {
    if (loading) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-slate-600 dark:text-slate-300">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          Loading preview...
        </div>
      );
    }

    if (error) {
      return (
        <div className="mx-auto mt-8 max-w-xl rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          <p className="font-medium">Preview failed</p>

          <p className="mt-1">{error}</p>

          {onDownload && (
            <button
              type="button"
              onClick={onDownload}
              disabled={downloadDisabled}
              className="mt-3 inline-flex items-center gap-1 rounded-lg border border-red-300 px-3 py-1.5 text-sm hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-700 dark:hover:bg-red-900/30"
            >
              <Download className="h-3.5 w-3.5" />
              Download instead
            </button>
          )}
        </div>
      );
    }

    if (!preview) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-slate-600 dark:text-slate-300">
          No preview data available.
        </div>
      );
    }

    /*
     * PDF PREVIEW
     *
     * Render the PDF with PDF.js instead of an iframe/browser PDF viewer.
     * This keeps the preview completely inside the React application.
     */
    if (preview.kind === 'pdf') {
      if (pdfRenderError) {
        return (
          <div className="flex h-full flex-col">
            <div className="mb-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPdfZoom(1)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Reset
              </button>

              <span className="ml-auto text-xs text-red-600 dark:text-red-400">
                {pdfRenderError}
              </span>
            </div>

            <div className="flex h-[68vh] items-center justify-center rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              Unable to display this PDF in the browser.
            </div>
          </div>
        );
      }

      return (
        <div className="flex h-full flex-col">
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setPdfZoom((current) =>
                  clamp(current - 0.1, MIN_ZOOM, MAX_ZOOM),
                )
              }
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <ZoomOut className="h-3.5 w-3.5" />
              Zoom out
            </button>

            <button
              type="button"
              onClick={() =>
                setPdfZoom((current) =>
                  clamp(current + 0.1, MIN_ZOOM, MAX_ZOOM),
                )
              }
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <ZoomIn className="h-3.5 w-3.5" />
              Zoom in
            </button>

            <button
              type="button"
              onClick={() => setPdfZoom(1)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Reset
            </button>

            <button
              type="button"
              onClick={fitPdfToWidth}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Fit width
            </button>

            <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
              {pdfRendering ? 'Rendering… ' : ''}
              {percentLabel(pdfZoom)}
            </span>
          </div>

          <div
            ref={pdfViewportRef}
            className="h-[68vh] overflow-auto rounded-lg border border-slate-200 bg-slate-100 p-3 dark:border-slate-700 dark:bg-slate-900/60"
          >
            <div
              ref={pdfPagesRef}
              className="mx-auto w-fit"
            />
          </div>
        </div>
      );
    }

    /*
     * IMAGE PREVIEW
     */
    if (preview.kind === 'image') {
      return (
        <div className="flex h-full flex-col">
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setImageZoom((current) =>
                  clamp(current - 0.1, MIN_ZOOM, MAX_ZOOM),
                )
              }
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <ZoomOut className="h-3.5 w-3.5" />
              Zoom out
            </button>

            <button
              type="button"
              onClick={() =>
                setImageZoom((current) =>
                  clamp(current + 0.1, MIN_ZOOM, MAX_ZOOM),
                )
              }
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <ZoomIn className="h-3.5 w-3.5" />
              Zoom in
            </button>

            <button
              type="button"
              onClick={() => {
                setImageZoom(1);
                setImageOffset({ x: 0, y: 0 });
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Reset
            </button>

            <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
              {percentLabel(imageZoom)}
            </span>
          </div>

          <div
            className={`relative h-[68vh] overflow-hidden rounded-lg border border-slate-200 bg-slate-900/90 dark:border-slate-700 ${
              imageDragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            onMouseDown={startImageDrag}
            onMouseMove={onImageDrag}
            onMouseUp={stopImageDrag}
            onMouseLeave={stopImageDrag}
            onWheel={handleImageWheel}
          >
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
              <img
                src={preview.src}
                alt={title}
                className="max-h-full max-w-full select-none object-contain"
                draggable={false}
                style={{
                  transform: `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageZoom})`,
                  transformOrigin: 'center center',
                  transition: imageDragging
                    ? 'none'
                    : 'transform 180ms ease-out',
                }}
              />
            </div>
          </div>
        </div>
      );
    }

    /*
     * HTML PREVIEW
     */
    if (preview.kind === 'html') {
      return (
        <div className="h-[68vh] overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700">
          <iframe
            title={title}
            src={preview.src}
            srcDoc={preview.html}
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            className="h-full w-full border-0"
          />
        </div>
      );
    }

    /*
     * WORD / DOCX PREVIEW
     */
    if (preview.kind === 'word') {
      return (
        <div className="h-[68vh] w-full overflow-auto rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
          <WordPreview blob={preview.blob} />
        </div>
      );
    }

    /*
     * EXCEL / XLSX PREVIEW
     */
    if (preview.kind === 'excel') {
      return (
        <div className="h-[68vh] w-full overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700">
          <ExcelPreview blob={preview.blob} />
        </div>
      );
    }

    /*
     * POWERPOINT / PPTX PREVIEW
     */
    if (preview.kind === 'powerpoint') {
      return (
        <div className="h-[68vh] w-full overflow-auto rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
          <PowerPointPreview blob={preview.blob} />
        </div>
      );
    }

    /*
     * PREVIEW UNAVAILABLE
     */
    return (
      <div className="mx-auto mt-8 max-w-xl rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
        <p className="font-medium">Preview not available</p>

        <p className="mt-1">{preview.message}</p>

        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            disabled={downloadDisabled}
            className="mt-3 inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
        )}
      </div>
    );
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="relative flex max-h-[calc(100vh-2.5rem)] w-full max-w-6xl flex-col rounded-xl bg-white dark:bg-slate-800">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
              {title}
            </h3>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Resource preview
            </p>
          </div>

          <div className="flex items-center gap-2">
            {onDownload && (
              <button
                type="button"
                onClick={onDownload}
                disabled={downloadDisabled || loading}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              aria-label="Close preview"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
