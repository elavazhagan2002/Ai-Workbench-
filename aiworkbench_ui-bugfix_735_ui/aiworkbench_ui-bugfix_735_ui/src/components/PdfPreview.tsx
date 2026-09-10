import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface PdfPreviewProps {
  blob: Blob;
}

export default function PdfPreview({ blob }: PdfPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function renderPdf() {
      const container = containerRef.current;

      if (!container) {
        return;
      }

      container.innerHTML = '';
      setLoading(true);
      setError('');

      try {
        const arrayBuffer = await blob.arrayBuffer();

        if (cancelled) {
          return;
        }

        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(arrayBuffer),
        });

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
            scale: 1.5,
          });

          const pageWrapper = document.createElement('div');

          pageWrapper.className =
            'mb-6 flex justify-center';

          const canvas = document.createElement('canvas');

          canvas.className =
            'block max-w-full bg-white shadow-sm';

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
          container.appendChild(pageWrapper);

          await page.render({
            canvas,
            canvasContext: context,
            viewport,
          }).promise;
        }

        if (!cancelled) {
          setLoading(false);
        }
      } catch (err) {
        console.error('PDF preview failed:', err);

        if (!cancelled) {
          setLoading(false);
          setError(
            'Unable to render this PDF file.'
          );
        }
      }
    }

    void renderPdf();

    return () => {
      cancelled = true;

      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [blob]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-slate-100 p-6">
      {loading && (
        <div className="mb-4 text-center text-sm text-slate-500">
          Loading PDF preview...
        </div>
      )}

      <div
        ref={containerRef}
        className="mx-auto w-fit"
      />
    </div>
  );
}