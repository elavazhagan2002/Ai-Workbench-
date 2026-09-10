export const AI_SERVICES_UNAVAILABLE_MESSAGE =
  'AI services are unavailable at this point. Please try again later.';

const TECHNICAL_AI_ERROR_MARKERS = [
  'http ',
  'api key',
  'openai',
  'provider',
  'incorrect api',
  'verify the configured',
  'rejected the request',
  'timed out contacting',
  'llm',
  'misconfigured',
  'unexpected error while',
];

const USER_SAFE_AI_MESSAGES = new Set([
  AI_SERVICES_UNAVAILABLE_MESSAGE,
  'AI documentation analysis is currently unavailable.',
  'Client authentication required. Please refresh the page.',
  'The AI provider returned text that exceeded the allowed field length. Please shorten the source text and try again.',
]);

function isTechnicalAiError(message: string): boolean {
  const lower = message.toLowerCase();
  return TECHNICAL_AI_ERROR_MARKERS.some((marker) => lower.includes(marker));
}

export function toUserFacingAiErrorMessage(
  error: unknown,
  fallback: string = AI_SERVICES_UNAVAILABLE_MESSAGE,
): string {
  const message = error instanceof Error ? error.message.trim() : '';
  if (!message) {
    return fallback;
  }
  if (USER_SAFE_AI_MESSAGES.has(message)) {
    return message;
  }
  if (message.startsWith('You do not have permission')) {
    return message;
  }
  if (message.startsWith('HTTP error!') || isTechnicalAiError(message)) {
    return AI_SERVICES_UNAVAILABLE_MESSAGE;
  }
  return AI_SERVICES_UNAVAILABLE_MESSAGE;
}
