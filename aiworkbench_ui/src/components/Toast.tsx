import { useEffect } from 'react';
import { X } from 'lucide-react';

interface ToastProps {
  message: string;
  onDismiss: () => void;
  /** Auto-dismiss after this many ms. Default 3000. */
  autoDismissMs?: number;
  type?: 'error' | 'success';
}

export default function Toast({ message, onDismiss, autoDismissMs = 3000, type = 'error' }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(t);
  }, [message, autoDismissMs, onDismiss]);

  if (!message) return null;

  const isError = type === 'error';
  return (
    <div
      className={`fixed bottom-4 right-4 max-w-md p-4 rounded-lg shadow-lg z-50 flex items-center justify-between gap-3 ${
        isError
          ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
          : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
      }`}
      role="alert"
    >
      <p className={`text-sm ${isError ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
        {message}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className={`shrink-0 p-1 rounded hover:opacity-80 ${isError ? 'text-red-400 hover:text-red-600' : 'text-green-400 hover:text-green-600'}`}
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
