import { Star } from 'lucide-react';

interface StarRatingProps {
  /** Average or single rating 1-5. Null/undefined = no rating. */
  rating: number | null | undefined;
  /** Show as interactive (for setting rating). When true, onClick(1-5) is called. */
  interactive?: boolean;
  /** Called when user clicks a star (1-5). Only when interactive is true. */
  onSelect?: (value: number) => void;
  /** Size: 'sm' | 'md' | 'lg' */
  size?: 'sm' | 'md' | 'lg';
  /** Optional label, e.g. "4.2" or "Rating" */
  label?: string;
  className?: string;
}

const sizeClasses = {
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
};

export default function StarRating({
  rating,
  interactive = false,
  onSelect,
  size = 'md',
  label,
  className = '',
}: StarRatingProps) {
  const value = rating == null ? 0 : Math.min(5, Math.max(0, rating));
  const fullStars = Math.round(value); // 0-5 for display

  const iconClass = sizeClasses[size];

  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= fullStars;
        return (
          <span
            key={star}
            role={interactive ? 'button' : undefined}
            onClick={
              interactive && onSelect
                ? () => onSelect(star)
                : undefined
            }
            className={
              interactive
                ? 'cursor-pointer text-amber-400 hover:opacity-80 transition-opacity'
                : 'text-amber-400'
            }
          >
            <Star
              className={`${iconClass} ${
                filled ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-slate-300 dark:text-slate-600'
              }`}
            />
          </span>
        );
      })}
      {label != null && (
        <span className="ml-1.5 text-sm text-slate-600 dark:text-slate-400">
          {label}
        </span>
      )}
    </div>
  );
}
