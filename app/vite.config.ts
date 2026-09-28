import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// LM Studio runs on :1234. Proxying avoids CORS and lets the UI use a relative base URL.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/lmstudio': {
        target: 'http://localhost:1234',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/lmstudio/, ''),
      },
      // Optional TorchXRayVision cross-check (app/server/txrv_server.py).
      '/txrv': {
        target: 'http://localhost:8765',
        rewrite: (p) => p.replace(/^\/txrv/, ''),
      },
    },
  },
})
