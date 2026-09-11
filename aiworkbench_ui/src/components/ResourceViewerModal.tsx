import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from 'react';
import {
  Download,
  Maximize2,
  Minimize2,
  RefreshCw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export type ResourcePreviewContent =
  | {
      kind: 'pdf';
      src: string;
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

type FrameRect = { x: number; y: number; width: number; height: number };
type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const FRAME_MARGIN = 10;
const MIN_FRAME_WIDTH = 480;
const MIN_FRAME_HEIGHT = 320;
const FALLBACK_HEADER_HEIGHT = 72;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function percentLabel(value: number) {
  return `${Math.round(value * 100)}%`;
}

function readHeaderHeight(): number {
  if (typeof window === 'undefined') return FALLBACK_HEADER_HEIGHT;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--wb-header-height').trim();
  if (!raw) return FALLBACK_HEADER_HEIGHT;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return FALLBACK_HEADER_HEIGHT;
  if (raw.endsWith('rem')) {
    const rootFont = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return value * rootFont;
  }
  return value;
}

/** Overlay-local size: wb-app-overlay starts below the Sciagen header. */
function overlaySize(): { width: number; height: number } {
  if (typeof window === 'undefined') {
    return { width: 1200, height: 800 };
  }
  return {
    width: window.innerWidth,
    height: Math.max(MIN_FRAME_HEIGHT + FRAME_MARGIN * 2, window.innerHeight - readHeaderHeight()),
  };
}

function viewportFrame(): FrameRect {
  const { width: areaWidth, height: areaHeight } = overlaySize();
  const width = Math.max(MIN_FRAME_WIDTH, areaWidth - FRAME_MARGIN * 2);
  const height = Math.max(MIN_FRAME_HEIGHT, areaHeight - FRAME_MARGIN * 2);
  return {
    x: FRAME_MARGIN,
    y: FRAME_MARGIN,
    width,
    height,
  };
}

function clampFrame(next: FrameRect): FrameRect {
  const { width: areaWidth, height: areaHeight } = overlaySize();
  const minWidth = Math.min(MIN_FRAME_WIDTH, areaWidth - FRAME_MARGIN * 2);
  const minHeight = Math.min(MIN_FRAME_HEIGHT, areaHeight - FRAME_MARGIN * 2);
  const maxWidth = Math.max(minWidth, areaWidth - FRAME_MARGIN);
  const maxHeight = Math.max(minHeight, areaHeight - FRAME_MARGIN);
  const width = clamp(next.width, minWidth, maxWidth);
  const height = clamp(next.height, minHeight, maxHeight);
  const x = clamp(next.x, FRAME_MARGIN, Math.max(FRAME_MARGIN, areaWidth - width - FRAME_MARGIN));
  const y = clamp(next.y, FRAME_MARGIN, Math.max(FRAME_MARGIN, areaHeight - height - FRAME_MARGIN));
  return { x, y, width, height };
}

const RESIZE_CURSORS: Record<ResizeEdge, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

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
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragActionRef = useRef<
    | { type: 'move'; startX: number; startY: number; origin: FrameRect }
    | { type: 'resize'; edge: ResizeEdge; startX: number; startY: number; origin: FrameRect }
    | null
  >(null);

  const [frame, setFrame] = useState<FrameRect>(() =>
    typeof window === 'undefined' ? { x: 10, y: 10, width: 1200, height: 800 } : viewportFrame()
  );
  const [maximized, setMaximized] = useState(true);
  const [restoredFrame, setRestoredFrame] = useState<FrameRect | null>(null);
  const [pdfZoom, setPdfZoom] = useState(1);
  const [imageZoom, setImageZoom] = useState(1);
  const [htmlZoom, setHtmlZoom] = useState(1);
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
  const [imageDragging, setImageDragging] = useState(false);
  const imageDragStartRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPdfZoom(1);
    setImageZoom(1);
    setHtmlZoom(1);
    setImageOffset({ x: 0, y: 0 });
    setImageDragging(false);
    imageDragStartRef.current = null;
    setMaximized(true);
    setRestoredFrame(null);
    setFrame(viewportFrame());
  }, [isOpen, preview?.kind, preview && 'src' in preview ? preview.src : undefined]);

  useEffect(() => {
    if (!isOpen) return;

    function onWindowResize() {
      setFrame((current) => (maximized ? viewportFrame() : clampFrame(current)));
    }

    function onPointerMove(event: PointerEvent) {
      const action = dragActionRef.current;
      if (!action) return;
      event.preventDefault();
      const dx = event.clientX - action.startX;
      const dy = event.clientY - action.startY;
      const origin = action.origin;

      if (action.type === 'move') {
        setFrame(clampFrame({ ...origin, x: origin.x + dx, y: origin.y + dy }));
        return;
      }

      let { x, y, width, height } = origin;
      if (action.edge.includes('e')) width = origin.width + dx;
      if (action.edge.includes('s')) height = origin.height + dy;
      if (action.edge.includes('w')) {
        width = origin.width - dx;
        x = origin.x + dx;
      }
      if (action.edge.includes('n')) {
        height = origin.height - dy;
        y = origin.y + dy;
      }
      setFrame(clampFrame({ x, y, width, height }));
    }

    function onPointerUp() {
      dragActionRef.current = null;
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    }

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('resize', onWindowResize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };
  }, [isOpen, maximized]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  function fitPdfToWidth() {
    setPdfZoom(1);
  }

  function startImageDrag(event: MouseEvent<HTMLDivElement>) {
    if (preview?.kind !== 'image') return;
    event.preventDefault();
    imageDragStartRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: imageOffset.x,
      originY: imageOffset.y,
    };
    setImageDragging(true);
  }

  function onImageDrag(event: MouseEvent<HTMLDivElement>) {
    if (!imageDragStartRef.current) return;
    const deltaX = event.clientX - imageDragStartRef.current.startX;
    const deltaY = event.clientY - imageDragStartRef.current.startY;
    setImageOffset({
      x: imageDragStartRef.current.originX + deltaX,
      y: imageDragStartRef.current.originY + deltaY,
    });
  }

  function stopImageDrag() {
    imageDragStartRef.current = null;
    setImageDragging(false);
  }

  function handleImageWheel(event: WheelEvent<HTMLDivElement>) {
    if (preview?.kind !== 'image') return;
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.1 : -0.1;
    setImageZoom((current) => clamp(current + delta, MIN_ZOOM, MAX_ZOOM));
  }

  function startMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (maximized) return;
    if ((event.target as HTMLElement).closest('button')) return;
    dragActionRef.current = {
      type: 'move',
      startX: event.clientX,
      startY: event.clientY,
      origin: frame,
    };
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }

  function startResize(edge: ResizeEdge, event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (maximized) {
      setMaximized(false);
      setRestoredFrame(frame);
    }
    dragActionRef.current = {
      type: 'resize',
      edge,
      startX: event.clientX,
      startY: event.clientY,
      origin: frame,
    };
    document.body.style.cursor = RESIZE_CURSORS[edge];
    document.body.style.userSelect = 'none';
  }

  function toggleMaximize() {
    if (maximized) {
      setMaximized(false);
      const { width: areaWidth, height: areaHeight } = overlaySize();
      setFrame(clampFrame(restoredFrame || {
        x: Math.round(areaWidth * 0.08),
        y: Math.round(areaHeight * 0.08),
        width: Math.round(areaWidth * 0.84),
        height: Math.round(areaHeight * 0.84),
      }));
      return;
    }
    setRestoredFrame(frame);
    setMaximized(true);
    setFrame(viewportFrame());
  }

  const toolbarButtonClass =
    'inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700';

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
        <div className="m-6 max-w-xl rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
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

    if (preview.kind === 'pdf') {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setPdfZoom((current) => clamp(current - 0.1, MIN_ZOOM, MAX_ZOOM))} className={toolbarButtonClass}>
              <ZoomOut className="h-3.5 w-3.5" />
              Zoom out
            </button>
            <button type="button" onClick={() => setPdfZoom((current) => clamp(current + 0.1, MIN_ZOOM, MAX_ZOOM))} className={toolbarButtonClass}>
              <ZoomIn className="h-3.5 w-3.5" />
              Zoom in
            </button>
            <button type="button" onClick={() => setPdfZoom(1)} className={toolbarButtonClass}>
              Reset
            </button>
            <button type="button" onClick={fitPdfToWidth} className={toolbarButtonClass}>
              <Maximize2 className="h-3.5 w-3.5" />
              Fit width
            </button>
            <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{percentLabel(pdfZoom)}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60">
            <div
              className="h-full origin-top-left transition-transform duration-200 ease-out"
              style={{
                transform: `scale(${pdfZoom})`,
                width: `${100 / pdfZoom}%`,
                height: `${100 / pdfZoom}%`,
              }}
            >
              <iframe
                title={title}
                src={preview.src.includes('#') ? preview.src : `${preview.src}#view=FitH`}
                className="h-full w-full border-0 bg-white"
              />
            </div>
          </div>
        </div>
      );
    }

    if (preview.kind === 'image') {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setImageZoom((current) => clamp(current - 0.1, MIN_ZOOM, MAX_ZOOM))} className={toolbarButtonClass}>
              <ZoomOut className="h-3.5 w-3.5" />
              Zoom out
            </button>
            <button type="button" onClick={() => setImageZoom((current) => clamp(current + 0.1, MIN_ZOOM, MAX_ZOOM))} className={toolbarButtonClass}>
              <ZoomIn className="h-3.5 w-3.5" />
              Zoom in
            </button>
            <button
              type="button"
              onClick={() => {
                setImageZoom(1);
                setImageOffset({ x: 0, y: 0 });
              }}
              className={toolbarButtonClass}
            >
              Reset
            </button>
            <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{percentLabel(imageZoom)}</span>
          </div>
          <div
            className={`relative min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-slate-900/90 dark:border-slate-700 ${imageDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
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
                  transition: imageDragging ? 'none' : 'transform 180ms ease-out',
                }}
              />
            </div>
          </div>
        </div>
      );
    }

    if (preview.kind === 'html') {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setHtmlZoom((current) => clamp(current - 0.1, MIN_ZOOM, MAX_ZOOM))} className={toolbarButtonClass}>
              <ZoomOut className="h-3.5 w-3.5" />
              Zoom out
            </button>
            <button type="button" onClick={() => setHtmlZoom((current) => clamp(current + 0.1, MIN_ZOOM, MAX_ZOOM))} className={toolbarButtonClass}>
              <ZoomIn className="h-3.5 w-3.5" />
              Zoom in
            </button>
            <button type="button" onClick={() => setHtmlZoom(1)} className={toolbarButtonClass}>
              Reset
            </button>
            <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{percentLabel(htmlZoom)}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60">
            <div
              className="h-full origin-top-left bg-white transition-transform duration-200 ease-out"
              style={{
                transform: `scale(${htmlZoom})`,
                width: `${100 / htmlZoom}%`,
                height: `${100 / htmlZoom}%`,
              }}
            >
              <iframe
                title={title}
                src={preview.html ? undefined : preview.src}
                srcDoc={preview.html}
                sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer"
                className="h-full w-full border-0 bg-white"
              />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="m-6 max-w-xl rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
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

  const resizeHandles: Array<{ edge: ResizeEdge; className: string }> = [
    { edge: 'n', className: 'left-3 right-3 top-0 h-2 cursor-ns-resize' },
    { edge: 's', className: 'bottom-0 left-3 right-3 h-2 cursor-ns-resize' },
    { edge: 'e', className: 'top-3 bottom-3 right-0 w-2 cursor-ew-resize' },
    { edge: 'w', className: 'top-3 bottom-3 left-0 w-2 cursor-ew-resize' },
    { edge: 'ne', className: 'right-0 top-0 h-4 w-4 cursor-nesw-resize' },
    { edge: 'nw', className: 'left-0 top-0 h-4 w-4 cursor-nwse-resize' },
    { edge: 'se', className: 'bottom-0 right-0 h-4 w-4 cursor-nwse-resize' },
    { edge: 'sw', className: 'bottom-0 left-0 h-4 w-4 cursor-nesw-resize' },
  ];

  return (
    <div className="wb-app-overlay z-50 bg-black/70">
      <div
        ref={frameRef}
        className="absolute flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-800"
        style={{
          left: frame.x,
          top: frame.y,
          width: frame.width,
          height: frame.height,
        }}
      >
        <div
          className={`flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700 ${maximized ? '' : 'cursor-grab active:cursor-grabbing'}`}
          onPointerDown={startMove}
        >
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Resource preview · {maximized ? 'Full window' : 'Drag title to move · drag edges to resize'}
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
              onClick={toggleMaximize}
              className="rounded p-1 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              aria-label={maximized ? 'Restore preview size' : 'Maximize preview'}
              title={maximized ? 'Restore' : 'Maximize'}
            >
              {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
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
        <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">{renderContent()}</div>
        {resizeHandles.map((handle) => (
          <div
            key={handle.edge}
            className={`absolute z-10 ${handle.className}`}
            onPointerDown={(event) => startResize(handle.edge, event)}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}
