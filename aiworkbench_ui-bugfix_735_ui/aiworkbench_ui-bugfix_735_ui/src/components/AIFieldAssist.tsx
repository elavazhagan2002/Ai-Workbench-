import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, RotateCw, Undo2, Wand2, X } from 'lucide-react';
import {
  api,
  type UseCaseEnhancementContext,
  type UseCaseEnhancementFieldName,
} from '../lib/api';
import { toUserFacingAiErrorMessage } from '../utils/aiUserMessage';

interface AIFieldAssistProps {
  inputId: string;
  label: string;
  fieldLabel: string;
  fieldName: UseCaseEnhancementFieldName;
  value: string;
  maxLength: number;
  context?: UseCaseEnhancementContext;
  onApply: (value: string) => void;
  children: ReactNode;
  canUseAI?: boolean;
  minInputLength?: number;
}

type FeedbackTone = 'error' | 'success';

interface FeedbackState {
  tone: FeedbackTone;
  text: string;
}

function feedbackClasses(tone: FeedbackTone) {
  return tone === 'error'
    ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300';
}

function copyTextWithFallback(text: string) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';

  document.body.appendChild(textarea);

  const selection = document.getSelection();
  const originalRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (selection && originalRange) {
    selection.removeAllRanges();
    selection.addRange(originalRange);
  }

  return copied;
}

export default function AIFieldAssist({
  inputId,
  label,
  fieldLabel,
  fieldName,
  value,
  maxLength,
  context,
  onApply,
  children,
  canUseAI = false,
  minInputLength = 20,
}: AIFieldAssistProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [originalText, setOriginalText] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [undoValue, setUndoValue] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!canUseAI) {
      requestIdRef.current += 1;
      setIsOpen(false);
      setIsLoading(false);
      setSuggestion('');
      setFeedback(null);
      setUndoValue(null);
      setCopied(false);
    }
  }, [canUseAI]);

  async function requestSuggestion() {
    const nextText = value.trim();
    if (nextText.length < minInputLength) {
      setIsOpen(false);
      setSuggestion('');
      setCopied(false);
      setFeedback({
        tone: 'error',
        text: `Please enter at least ${minInputLength} characters to use AI Help.`,
      });
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsOpen(true);
    setIsLoading(true);
    setCopied(false);
    setFeedback(null);
    setSuggestion('');
    setOriginalText(value);

    try {
      const result = await api.enhanceUseCaseField({
        field_name: fieldName,
        text: value,
        max_length: maxLength,
        context,
      });

      if (requestIdRef.current !== requestId) return;

      setSuggestion(result.suggestion.slice(0, maxLength));
    } catch (error: unknown) {
      if (requestIdRef.current !== requestId) return;

      setFeedback({
        tone: 'error',
        text: toUserFacingAiErrorMessage(error),
      });
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }

  async function handleCopy() {
    if (!suggestion) return;

    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(suggestion);
      } else if (!copyTextWithFallback(suggestion)) {
        throw new Error('fallback-copy-failed');
      }

      setCopied(true);
      setFeedback({
        tone: 'success',
        text: 'Suggestion copied to your clipboard.',
      });
    } catch {
      setFeedback({
        tone: 'error',
        text: 'Unable to copy the suggestion right now.',
      });
    }
  }

  function handleReplace() {
    if (!suggestion) return;

    setUndoValue(value);
    onApply(suggestion);
    setOriginalText(suggestion);
    setSuggestion('');
    setIsOpen(false);
    setCopied(false);
    setFeedback({
      tone: 'success',
      text: `AI suggestion applied to ${fieldLabel.toLowerCase()}. You can undo this change before saving.`,
    });
  }

  function handleUndo() {
    if (undoValue == null) return;

    onApply(undoValue);
    setOriginalText(undoValue);
    setUndoValue(null);
    setSuggestion('');
    setIsOpen(false);
    setCopied(false);
    setFeedback({
      tone: 'success',
      text: `${fieldLabel} restored to the previous text.`,
    });
  }

  function handleClose() {
    requestIdRef.current += 1;
    setIsOpen(false);
    setIsLoading(false);
    setSuggestion('');
    setFeedback(null);
    setUndoValue(null);
    setCopied(false);
  }

  const hasChangedSinceSuggestion = Boolean(suggestion) && value !== originalText;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor={inputId} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {label}
        </label>
        {canUseAI && (
          <button
            type="button"
            onClick={requestSuggestion}
            disabled={isLoading}
            title="Enhance with AI"
            aria-label={`Enhance ${fieldLabel} with AI`}
            className="group inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-200/80 bg-white text-cyan-600 shadow-[0_0_0_1px_rgba(8,145,178,0.06),0_0_16px_rgba(6,182,212,0.08)] transition hover:border-cyan-300 hover:text-cyan-700 hover:shadow-[0_0_0_1px_rgba(8,145,178,0.16),0_0_18px_rgba(6,182,212,0.14)] focus:outline-none focus:ring-2 focus:ring-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-60 dark:border-cyan-500/30 dark:bg-slate-900/70 dark:text-cyan-300 dark:shadow-[0_0_0_1px_rgba(34,211,238,0.12),0_0_18px_rgba(34,211,238,0.12)] dark:hover:border-cyan-400/50 dark:hover:text-white dark:hover:shadow-[0_0_0_1px_rgba(34,211,238,0.2),0_0_20px_rgba(34,211,238,0.18)]"
          >
            {isLoading ? (
              <RotateCw className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4 transition-transform group-hover:-rotate-12" />
            )}
            <span className="sr-only">Enhance with AI</span>
          </button>
        )}
      </div>

      {children}

      {feedback && !isOpen && (
        <div
          className={`mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${feedbackClasses(feedback.tone)}`}
          role="status"
        >
          <span>{feedback.text}</span>
          {undoValue !== null && (
            <button
              type="button"
              onClick={handleUndo}
              className="inline-flex items-center gap-1 rounded-md border border-current/30 px-2 py-1 text-[11px] font-medium transition hover:bg-white/40 dark:hover:bg-slate-900/30"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Undo
            </button>
          )}
        </div>
      )}

      {isOpen && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">AI Help</p>
              <p className="text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
                {isLoading ? `Enhancing ${fieldLabel.toLowerCase()}...` : 'Review the suggestion before replacing your current text.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label="Close AI Help"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {feedback && (
            <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${feedbackClasses(feedback.tone)}`} role="status">
              {feedback.text}
            </div>
          )}

          {hasChangedSinceSuggestion && !isLoading && suggestion && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
              The field changed after this suggestion was generated. Replace will use the AI suggestion shown here.
            </div>
          )}

          {isLoading ? (
            <div className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Generating a refined version of your text...
            </div>
          ) : suggestion ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Original
                </p>
                <textarea
                  readOnly
                  value={originalText}
                  rows={7}
                  className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    AI Suggestion
                  </p>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    {suggestion.length}/{maxLength}
                  </span>
                </div>
                <textarea
                  readOnly
                  value={suggestion}
                  rows={7}
                  className="w-full resize-none rounded-lg border border-cyan-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-[0_0_20px_rgba(6,182,212,0.06)] dark:border-cyan-900/60 dark:bg-slate-800 dark:text-slate-100 dark:shadow-[0_0_24px_rgba(34,211,238,0.08)]"
                />
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleReplace}
              disabled={isLoading || !suggestion}
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Wand2 className="h-4 w-4" />
              Replace field
            </button>
            <button
              type="button"
              onClick={requestSuggestion}
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RotateCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              Regenerate
            </button>
            <button
              type="button"
              onClick={handleCopy}
              disabled={isLoading || !suggestion}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            {undoValue !== null && (
              <button
                type="button"
                onClick={handleUndo}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
              >
                <Undo2 className="h-4 w-4" />
                Undo
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
