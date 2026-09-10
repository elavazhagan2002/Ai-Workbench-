/** HTTP security headers for the SPA (dev server, preview, and nginx reference). */

const HSTS = 'max-age=31536000; includeSubDomains';

export const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join('; ');

export const DEVELOPMENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function buildSpaSecurityHeaders(options: { development?: boolean; includeHsts?: boolean } = {}) {
  const development = options.development ?? false;
  const includeHsts = options.includeHsts ?? !development;

  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Content-Security-Policy': development ? DEVELOPMENT_CSP : PRODUCTION_CSP,
  };

  if (includeHsts) {
    headers['Strict-Transport-Security'] = HSTS;
  }

  return headers;
}

export function buildHtmlCacheControl(pathname: string): string {
  if (pathname === '/' || pathname.endsWith('.html')) {
    return 'no-store, no-cache, must-revalidate, private';
  }
  if (/\.(?:js|css|png|jpg|jpeg|webp|gif|svg|woff2?|ico)$/.test(pathname)) {
    return 'public, max-age=31536000, immutable';
  }
  return 'no-store, no-cache, must-revalidate, private';
}
