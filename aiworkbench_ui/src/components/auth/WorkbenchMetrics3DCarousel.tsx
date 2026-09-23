import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface WorkbenchMetrics3DCarouselCard {
  key: string;
  label: string;
  value: number;
  helper: string;
  icon: LucideIcon;
  cardVariant?: 'portfolio' | 'workflow' | 'default';
}

interface WorkbenchMetrics3DCarouselProps {
  cards: WorkbenchMetrics3DCarouselCard[];
  className?: string;
  autoPlayIntervalMs?: number;
  wheelThrottleMs?: number;
  maxVisibleDepth?: number;
  showControls?: boolean;
  showIndicators?: boolean;
}

const CAROUSEL_VIEWPORT_CLASS = 'mx-auto w-full max-w-[27.5rem] sm:max-w-[28.5rem] lg:max-w-[29.5rem]';
const CAROUSEL_STAGE_HEIGHT_CLASS = 'relative h-[150px] sm:h-[160px] lg:h-[180px]';

const CARD_LAYOUT_CONFIG = {
  mobile: {
    activeInsetPx: 88,
    insetStepPx: 18,
    activeMaxWidthPx: 244,
    maxWidthStepPx: 20,
    rearInsetPullbackPx: 8,
    rearMaxWidthBoostPx: 10,
    thirdCardExtraWidthPx: 8,
    rearScaleBoost: 0.024,
  },
  compact: {
    activeInsetPx: 98,
    insetStepPx: 22,
    activeMaxWidthPx: 256,
    maxWidthStepPx: 24,
    rearInsetPullbackPx: 10,
    rearMaxWidthBoostPx: 12,
    thirdCardExtraWidthPx: 10,
    rearScaleBoost: 0.026,
  },
  desktop: {
    activeInsetPx: 110,
    insetStepPx: 26,
    activeMaxWidthPx: 270,
    maxWidthStepPx: 28,
    rearInsetPullbackPx: 12,
    rearMaxWidthBoostPx: 14,
    thirdCardExtraWidthPx: 12,
    rearScaleBoost: 0.028,
  },
} as const;

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function formatMetricValue(value: number) {
  return Number.isFinite(value) ? value.toLocaleString() : '0';
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia(query);
    const handleChange = () => setMatches(mediaQuery.matches);

    handleChange();
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [query]);

  return matches;
}

function getRelativeOffset(index: number, activeIndex: number, total: number) {
  if (total <= 1) return 0;

  let offset = index - activeIndex;
  const half = total / 2;

  if (offset > half) {
    offset -= total;
  } else if (offset < -half) {
    offset += total;
  }

  return offset;
}

function getRearCardExposureFactor(absOffset: number) {
  if (absOffset === 1) return 1;
  if (absOffset === 2) return 0.65;
  if (absOffset > 2) return 0.4;
  return 0;
}

function getDepthMetrics(offset: number, prefersReducedMotion: boolean, isCompact: boolean, isMobile: boolean) {
  const absOffset = Math.abs(offset);
  const config = isMobile ? CARD_LAYOUT_CONFIG.mobile : isCompact ? CARD_LAYOUT_CONFIG.compact : CARD_LAYOUT_CONFIG.desktop;
  const rearExposureFactor = getRearCardExposureFactor(absOffset);
  const rearScaleBoost = config.rearScaleBoost * rearExposureFactor;

  if (prefersReducedMotion) {
    return {
      translateX: offset * (isMobile ? 14 : 24),
      translateY: absOffset * 4,
      translateZ: 0,
      rotateY: 0,
      scale: Math.min(0.98, Math.max(0.84, 1 - absOffset * 0.06) + rearScaleBoost),
      opacity: absOffset === 0 ? 1 : absOffset === 1 ? 0.62 : 0,
      blur: absOffset === 0 ? 0 : 0.2,
    };
  }

  const translateXStep = isMobile ? 20 : isCompact ? 30 : 38;
  const translateYStep = isMobile ? 3 : isCompact ? 5 : 7;
  const translateZStep = isMobile ? 18 : isCompact ? 22 : 26;
  const rotateStep = isMobile ? 4 : isCompact ? 5 : 6;
  const scaleStep = isMobile ? 0.06 : isCompact ? 0.072 : 0.08;

  return {
    translateX: offset * translateXStep,
    translateY: absOffset * translateYStep,
    translateZ: absOffset === 0 ? 68 : 48 - absOffset * translateZStep,
    rotateY: offset === 0 ? 0 : offset > 0 ? -rotateStep * absOffset : rotateStep * absOffset,
    scale: Math.min(0.98, Math.max(0.72, 1 - absOffset * scaleStep) + rearScaleBoost),
    opacity: absOffset === 0 ? 1 : absOffset === 1 ? 0.72 : absOffset === 2 ? 0.34 : 0.1,
    blur: absOffset === 0 ? 0 : absOffset === 1 ? 0.12 : absOffset === 2 ? 0.42 : 0.8,
  };
}

function getCardWidthMetrics(absOffset: number, isCompact: boolean, isMobile: boolean) {
  const config = isMobile ? CARD_LAYOUT_CONFIG.mobile : isCompact ? CARD_LAYOUT_CONFIG.compact : CARD_LAYOUT_CONFIG.desktop;
  const rearExposureFactor = getRearCardExposureFactor(absOffset);
  const thirdCardExtraWidth = absOffset === 2 ? config.thirdCardExtraWidthPx : 0;
  const widthInset = Math.max(
    config.activeInsetPx,
    config.activeInsetPx + absOffset * config.insetStepPx - config.rearInsetPullbackPx * rearExposureFactor,
  );
  const maxWidth =
    Math.max(config.activeMaxWidthPx - absOffset * config.maxWidthStepPx, config.activeMaxWidthPx - config.maxWidthStepPx * 2) +
    config.rearMaxWidthBoostPx * rearExposureFactor +
    thirdCardExtraWidth;

  return {
    width: `calc(100% - ${widthInset}px)`,
    maxWidth: `${maxWidth}px`,
  };
}

function AnimatedMetricNumber({ value, durationMs = 1200, className }: { value: number; durationMs?: number; className?: string }) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const animationFrameRef = useRef<number | null>(null);
  const displayValueRef = useRef(prefersReducedMotion ? value : 0);
  const [displayValue, setDisplayValue] = useState(() => (prefersReducedMotion ? value : 0));

  useEffect(() => {
    if (prefersReducedMotion) {
      displayValueRef.current = value;
      setDisplayValue(value);
      return;
    }

    const startValue = displayValueRef.current;
    if (startValue === value) {
      setDisplayValue(value);
      return;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    const startTime = performance.now();
    const animate = (timestamp: number) => {
      const progress = Math.min(1, (timestamp - startTime) / durationMs);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const nextValue = Math.round(startValue + (value - startValue) * easedProgress);

      displayValueRef.current = nextValue;
      setDisplayValue(nextValue);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      animationFrameRef.current = null;
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [durationMs, prefersReducedMotion, value]);

  return <span className={className}>{formatMetricValue(displayValue)}</span>;
}

function getCardToneClasses(variant: WorkbenchMetrics3DCarouselCard['cardVariant']) {
  switch (variant) {
    case 'portfolio':
      return {
        surface:
          'bg-[linear-gradient(160deg,rgba(24,40,104,0.95),rgba(10,20,57,0.95)_52%,rgba(7,16,43,0.97)_100%)]',
        badge: 'border-cyan-200/18 bg-cyan-300/10 text-cyan-50',
        icon: 'border-cyan-200/14 bg-cyan-300/12 text-cyan-50',
      };
    case 'workflow':
      return {
        surface:
          'bg-[linear-gradient(160deg,rgba(24,40,104,0.95),rgba(10,20,57,0.95)_52%,rgba(7,16,43,0.97)_100%)]',
        badge: 'border-sky-200/18 bg-sky-300/10 text-sky-50',
        icon: 'border-sky-200/14 bg-sky-300/12 text-sky-50',
      };
    default:
      return {
        surface:
          'bg-[linear-gradient(160deg,rgba(21,43,104,0.94),rgba(9,19,53,0.95)_52%,rgba(6,14,39,0.96)_100%)]',
        badge: 'border-white/12 bg-white/[0.08] text-white',
        icon: 'border-white/12 bg-white/[0.08] text-white',
      };
  }
}

function getCardCategoryLabel(variant: WorkbenchMetrics3DCarouselCard['cardVariant']) {
  switch (variant) {
    case 'portfolio':
      return 'Portfolio';
    case 'workflow':
      return 'Workflow';
    default:
      return 'Workbench';
  }
}

export default function WorkbenchMetrics3DCarousel({
  cards,
  className,
  autoPlayIntervalMs = 4300,
  wheelThrottleMs = 520,
  maxVisibleDepth = 2,
  showControls = true,
  showIndicators = true,
}: WorkbenchMetrics3DCarouselProps) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const isCompact = useMediaQuery('(max-width: 1024px)');
  const isMobile = useMediaQuery('(max-width: 640px)');
  const wheelTargetRef = useRef<HTMLDivElement | null>(null);
  const wheelLockUntilRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (cards.length === 0) return;
    if (activeIndex <= cards.length - 1) return;
    setActiveIndex(0);
  }, [activeIndex, cards.length]);

  useEffect(() => {
    if (cards.length < 2 || isPaused || prefersReducedMotion) return;

    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % cards.length);
    }, autoPlayIntervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [autoPlayIntervalMs, cards.length, isPaused, prefersReducedMotion]);

  const stepCard = (direction: -1 | 1) => {
    if (cards.length < 2) return;
    setActiveIndex((current) => (current + direction + cards.length) % cards.length);
  };

  const goToIndex = (nextIndex: number) => {
    if (cards.length === 0) return;
    setActiveIndex((nextIndex + cards.length) % cards.length);
  };

  const handleWheel = useCallback((event: WheelEvent) => {
    if (cards.length < 2) return;

    const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(rawDelta) < 18) return;

    if (event.cancelable) {
      event.preventDefault();
    }

    const now = Date.now();
    if (now < wheelLockUntilRef.current) return;

    wheelLockUntilRef.current = now + wheelThrottleMs;
    const direction = rawDelta > 0 ? 1 : -1;
    setActiveIndex((current) => (current + direction + cards.length) % cards.length);
  }, [cards.length, wheelThrottleMs]);

  useEffect(() => {
    const wheelTarget = wheelTargetRef.current;
    if (!wheelTarget) return;

    wheelTarget.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      wheelTarget.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  if (cards.length === 0) {
    return null;
  }

  const visibleDepth = Math.max(1, maxVisibleDepth);

  return (
    <section className={cn(CAROUSEL_VIEWPORT_CLASS, 'relative', className)}>
      <div
        ref={wheelTargetRef}
        className="relative px-2 pb-7 pt-2 sm:px-2.5 sm:pb-7 sm:pt-2.5"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onFocusCapture={() => setIsPaused(true)}
        onBlurCapture={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setIsPaused(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          stepCard(event.key === 'ArrowRight' ? 1 : -1);
        }}
        role="region"
        aria-label="Workbench metrics carousel"
        tabIndex={0}
      >
        {showControls && cards.length > 1 ? (
          <div className="absolute right-2.5 top-2.5 z-20 flex items-center gap-1.5 sm:right-3 sm:top-3">
            <button
              type="button"
              onClick={() => stepCard(-1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-slate-100 transition hover:bg-white/[0.09] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/12"
              aria-label="Show previous metric card"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => stepCard(1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-slate-100 transition hover:bg-white/[0.09] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/12"
              aria-label="Show next metric card"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        <div className={CAROUSEL_STAGE_HEIGHT_CLASS} style={{ perspective: prefersReducedMotion ? 'none' : '1800px', transformStyle: 'preserve-3d' }}>
          {cards.map((card, index) => {
            const offset = getRelativeOffset(index, activeIndex, cards.length);
            const absOffset = Math.abs(offset);
            const isActive = absOffset === 0;
            const isVisible = absOffset <= visibleDepth;
            const depthMetrics = getDepthMetrics(offset, prefersReducedMotion, isCompact, isMobile);
            const widthMetrics = getCardWidthMetrics(absOffset, isCompact, isMobile);
            const tone = getCardToneClasses(card.cardVariant);
            const categoryLabel = getCardCategoryLabel(card.cardVariant);
            const Icon = card.icon;

            return (
              <article
                key={card.key}
                aria-hidden={!isActive}
                className={cn(
                  'absolute left-1/2 top-3 overflow-hidden rounded-[24px] border text-white transition-[transform,opacity,filter] duration-[720ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform sm:top-4',
                  tone.surface,
                  isActive
                    ? 'border-cyan-200/16 shadow-[0_18px_48px_rgba(2,10,34,0.44)]'
                    : 'border-white/8 shadow-[0_12px_34px_rgba(2,10,28,0.26)]',
                )}
                style={{
                  width: widthMetrics.width,
                  maxWidth: widthMetrics.maxWidth,
                  opacity: isVisible ? depthMetrics.opacity : 0,
                  filter: isVisible
                    ? `blur(${depthMetrics.blur}px) saturate(${isActive ? 1.01 : 0.9}) brightness(${isActive ? 1 : 0.92})`
                    : 'blur(1px) saturate(0.82) brightness(0.84)',
                  transform: isVisible
                    ? `translateX(-50%) translateX(${depthMetrics.translateX}px) translateY(${depthMetrics.translateY}px) translateZ(${depthMetrics.translateZ}px) rotateY(${depthMetrics.rotateY}deg) scale(${depthMetrics.scale})`
                    : `translateX(-50%) translateX(${offset >= 0 ? depthMetrics.translateX + 14 : depthMetrics.translateX - 14}px) translateY(${depthMetrics.translateY + 6}px) scale(${Math.max(0.72, depthMetrics.scale - 0.05)})`,
                  zIndex: cards.length + (isActive ? visibleDepth + 2 : visibleDepth - absOffset + 1),
                  pointerEvents: isActive ? 'auto' : 'none',
                }}
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_16%,rgba(186,230,253,0.16),transparent_28%),radial-gradient(circle_at_84%_16%,rgba(96,165,250,0.16),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.06),transparent_20%,rgba(255,255,255,0.02)_100%)]" />
                <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-cyan-100/35 to-transparent" />

                <div className="relative flex h-[120px] flex-col px-4 py-3 sm:h-[130px] sm:px-[1.125rem] sm:py-3.5 lg:h-[150px] lg:px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[9px] font-semibold tracking-[0.16em] uppercase', tone.badge)}>
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                        <span className="truncate">{categoryLabel}</span>
                      </div>
                      <p className="mt-3 max-w-[15rem] text-[9.5px] font-semibold uppercase tracking-[0.2em] text-slate-200/68 sm:text-[10px]">
                        {card.label}
                      </p>
                    </div>

                    <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-[18px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] sm:h-10 sm:w-10', tone.icon)}>
                      <Icon className="h-4 w-4 sm:h-[1.125rem] sm:w-[1.125rem]" />
                    </div>
                  </div>

                  <div className="mt-auto">
                    <div className="text-[clamp(1.95rem,1.82rem+0.48vw,2.35rem)] font-semibold leading-none text-white">
                      {isActive ? <AnimatedMetricNumber value={card.value} /> : formatMetricValue(card.value)}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {showIndicators && cards.length > 1 ? (
          <div className="absolute inset-x-0 bottom-2.5 flex items-center justify-center gap-1.5 px-4 sm:bottom-3">
            {cards.map((card, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => goToIndex(index)}
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/12',
                    isActive ? 'w-6 bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.32)]' : 'w-1.5 bg-white/28 hover:bg-white/42',
                  )}
                  aria-label={`Show ${card.label.toLowerCase()}`}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
