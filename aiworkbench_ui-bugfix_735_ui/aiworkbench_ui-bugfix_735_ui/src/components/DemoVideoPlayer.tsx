import { useEffect, useRef, useState } from 'react';

interface DemoSource {
  label: string;
  url: string;
  quality?: string;
}

interface DemoVideoPlayerProps {
  sources: DemoSource[];
  autoPlay?: boolean;
}

interface PendingSeek {
  time: number;
  autoPlay: boolean;
}

export default function DemoVideoPlayer({ sources, autoPlay = false }: DemoVideoPlayerProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingSeekRef = useRef<PendingSeek | null>(null);

  const activeSource = sources[activeIndex] ?? sources[0];

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !autoPlay) return;
    const playPromise = video.play();
    if (playPromise?.catch) {
      playPromise.catch(() => {});
    }
  }, [activeIndex, autoPlay]);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;

    const pending = pendingSeekRef.current;
    if (pending) {
      video.currentTime = Math.min(pending.time, video.duration || pending.time);
      if (pending.autoPlay) {
        const playPromise = video.play();
        if (playPromise?.catch) {
          playPromise.catch(() => {});
        }
      }
      pendingSeekRef.current = null;
    }
  };

  const handleQualityChange = (index: number) => {
    if (index === activeIndex) return;
    const video = videoRef.current;
    const currentTimeSnapshot = video?.currentTime ?? 0;
    const wasPaused = video?.paused ?? true;
    pendingSeekRef.current = {
      time: currentTimeSnapshot,
      autoPlay: !wasPaused,
    };
    setActiveIndex(index);
  };

  const handleToggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full bg-black overflow-hidden ${
        isFullscreen ? '' : 'rounded-lg border border-slate-200 dark:border-slate-700'
      }`}
    >
      <video
        ref={videoRef}
        src={activeSource.url}
        className={isFullscreen ? 'w-full h-full bg-black' : 'w-full max-h-80 bg-black'}
        controls
        preload="metadata"
        controlsList="nodownload noplaybackrate noremoteplayback"
        disablePictureInPicture
        onLoadedMetadata={handleLoadedMetadata}
      />

      <div className="absolute top-2 right-2 flex items-center gap-2 text-xs text-white">
        {sources.length > 1 && (
          <div className="flex items-center gap-1 bg-black/50 rounded-full px-2 py-1">
            <span className="text-[11px] text-slate-200">Quality</span>
            <select
              value={activeIndex}
              onChange={(e) => handleQualityChange(Number(e.target.value))}
              className="wb-select min-h-8 rounded-full border-white/30 bg-black/60 py-0.5 pl-2 pr-7 text-[11px] text-white focus:border-white/60 focus:ring-white/20"
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23cbd5e1' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
              }}
            >
              {sources.map((source, index) => (
                <option key={source.url} value={index}>
                  {source.label || source.quality || `Option ${index + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}
        <button
          type="button"
          onClick={handleToggleFullscreen}
          className="bg-black/50 hover:bg-black/70 rounded-full px-3 py-1 text-[11px] font-medium"
        >
          {isFullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>
    </div>
  );
}

