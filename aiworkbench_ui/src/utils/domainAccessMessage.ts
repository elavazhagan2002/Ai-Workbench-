/** User-facing copy when API denies domain membership. */
export const DOMAIN_NOT_ASSIGNED_MESSAGE =
  'Sorry - this domain is not assigned to you. Please contact a portal admin or domain owner to request access.';

export function isDomainAccessDeniedMessage(message: unknown): boolean {
  if (typeof message !== 'string' || !message.trim()) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes('domain is not assigned to you') ||
    normalized.includes('no access to this domain')
  );
}

export function domainAccessDeniedMessage(fallback?: unknown): string {
  if (isDomainAccessDeniedMessage(fallback)) {
    return typeof fallback === 'string' && fallback.trim()
      ? fallback.trim()
      : DOMAIN_NOT_ASSIGNED_MESSAGE;
  }
  return DOMAIN_NOT_ASSIGNED_MESSAGE;
}
