import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

const backendTarget = 'http://localhost:8080';

function withProxyLogging(path: string): ProxyOptions {
  return {
    target: backendTarget,
    changeOrigin: true,
    configure: (proxy) => {
      proxy.on('error', (error, req) => {
        const method = req.method || 'UNKNOWN';
        const url = req.url || path;
        const errorCode = 'code' in error && error.code ? error.code : error.message;
        console.error(`[vite-proxy] ${new Date().toISOString()} ${method} ${url} -> ${backendTarget} failed: ${errorCode}`);
      });
    },
  };
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': withProxyLogging('/api'),
      '/oauth2/authorization': withProxyLogging('/oauth2/authorization'),
      '/login': withProxyLogging('/login'),
      '/v3': withProxyLogging('/v3'),
      '/swagger-ui': withProxyLogging('/swagger-ui'),
    },
  },
});
