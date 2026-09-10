import { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';

interface WordPreviewProps {
  blob: Blob;
}

export default function WordPreview({
  blob,
}: WordPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function renderDocument() {
      const container = containerRef.current;

      if (!container) {
        return;
      }

      container.innerHTML = '';
      setError('');

      try {
        await renderAsync(
          blob,
          container,
          container,
          {
            className: 'docx',
            inWrapper: true,
            breakPages: true,
            ignoreFonts: false,
            ignoreWidth: false,
            ignoreHeight: false,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            renderEndnotes: true,
            ignoreLastRenderedPageBreak: false,
          }
        );
      } catch (err) {
        console.error('Word preview failed:', err);

        if (!cancelled) {
          setError(
            'Unable to render this Word document.'
          );
        }
      }
    }

    void renderDocument();

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
    <div className="h-[68vh] overflow-auto rounded-lg border border-slate-200 bg-slate-100 p-6">
      <div
        ref={containerRef}
        className="mx-auto w-fit min-w-full"
      />
    </div>
  );
}