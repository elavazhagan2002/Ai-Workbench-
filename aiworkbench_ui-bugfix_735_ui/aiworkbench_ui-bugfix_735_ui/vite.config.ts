import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { securityHeadersPlugin } from './vite.securityHeaders';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react(), securityHeadersPlugin(command === 'serve')],
  optimizeDeps: {
    include: ['lucide-react'],
  },
  server: {
    host: true,
    port: 5174,
    allowedHosts: ['aiworkbench.sciagen.ai'],
    proxy: {
      // Proxy /api to backend so requests are same-origin and session cookies are sent
      '/api': {
        target: 'http://localhost:8002',
        changeOrigin: true,
        secure: false,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            if (req.headers.cookie) {
              proxyReq.setHeader('Cookie', req.headers.cookie);
            }
          });
        },
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
  },
}));
