import { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import '../styles/docx-preview.css';

interface DocxPreviewProps {
  src: string;
  blob?: Blob;
  zoom: number;
}

export default function DocxPreview({ src, blob, zoom }: DocxPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return undefined;
    const renderContainer = container;

    container.replaceChildren();
    setLoading(true);
    setError(null);

    async function renderPreview() {
      try {
        let documentBlob: Blob;
        if (blob) {
          documentBlob = blob;
        } else {
          const response = await fetch(src);
          if (!response.ok) {
            throw new Error(`Unable to load the DOCX document (${response.status}).`);
          }
          documentBlob = await response.blob();
        }

        if (!documentBlob.size) {
          throw new Error('The DOCX response is empty.');
        }
        if (cancelled) return;

        await renderAsync(documentBlob, renderContainer, undefined, {
          className: 'docx',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          ignoreLastRenderedPageBreak: false,
          useBase64URL: true,
          renderAltChunks: true,
          renderChanges: false,
          renderComments: false,
          debug: false,
        });

        if (!cancelled) setLoading(false);
      } catch (renderError: unknown) {
        if (!cancelled) {
          setLoading(false);
          setError(renderError instanceof Error ? renderError.message : 'Unable to render DOCX preview.');
        }
      }
    }

    void renderPreview();
    return () => {
      cancelled = true;
      container.replaceChildren();
    };
  }, [src, blob]);

  return (
    <div className="docx-preview-viewport">
      {loading && <div className="docx-preview-status">Loading document preview...</div>}
      {error && <div className="docx-preview-status docx-preview-error">{error}</div>}
      <div
        ref={containerRef}
        className="docx-preview-stage"
        style={{ transform: `scale(${zoom})` }}
        aria-busy={loading}
      />
    </div>
  );
}
