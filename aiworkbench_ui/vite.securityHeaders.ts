import type { Plugin } from 'vite';
import { buildHtmlCacheControl, buildSpaSecurityHeaders } from './src/config/securityHeaders';

function applySecurityHeaders(
  headers: Record<string, string>,
  req: { url?: string },
  res: { setHeader: (name: string, value: string) => void },
) {
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }

  const pathname = (req.url ?? '/').split('?')[0];
  res.setHeader('Cache-Control', buildHtmlCacheControl(pathname));
}

export function securityHeadersPlugin(development: boolean): Plugin {
  return {
    name: 'aiworkbench-security-headers',
    configureServer(server) {
      const headers = buildSpaSecurityHeaders({ development, includeHsts: !development });
      server.middlewares.use((req, res, next) => {
        applySecurityHeaders(headers, req, res);
        next();
      });
    },
    configurePreviewServer(server) {
      const previewHeaders = buildSpaSecurityHeaders({ development: false, includeHsts: true });
      server.middlewares.use((req, res, next) => {
        applySecurityHeaders(previewHeaders, req, res);
        next();
      });
    },
  };
}
