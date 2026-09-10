import { useEffect, useRef, useState } from 'react';
import { init } from 'pptx-preview';

interface PowerPointPreviewProps {
  blob: Blob;
}

export default function PowerPointPreview({
  blob,
}: PowerPointPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function renderPresentation() {
      const container = containerRef.current;

      if (!container) {
        return;
      }

      container.innerHTML = '';
      setError('');

      try {
        const buffer = await blob.arrayBuffer();

        if (cancelled || !containerRef.current) {
          return;
        }

        const viewer = init(containerRef.current, {
          width: 960,
          height: 540,
        });

        viewer.preview(buffer);
      } catch (err) {
        console.error(
          'PowerPoint preview failed:',
          err
        );

        if (!cancelled) {
          setError(
            'Unable to render this PowerPoint file.'
          );
        }
      }
    }

    void renderPresentation();

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
    <div className="h-[68vh] overflow-auto rounded-lg border border-slate-200 bg-slate-100 p-4">
      <div
        ref={containerRef}
        className="mx-auto w-fit"
      />
    </div>
  );
}