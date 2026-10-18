import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server: http://localhost:5173
// The API client defaults to calling the backend directly (VITE_API_BASE_URL=http://localhost:8000, CORS-enabled).
// If you set VITE_API_BASE_URL to an empty value, requests go to "/api/..." on this server and the proxy
// below forwards them to FastAPI, so the browser sees a single origin and CORS is not involved at all.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
