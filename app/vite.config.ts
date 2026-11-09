import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// LM Studio runs on :1234. Proxying avoids CORS and lets the UI use a relative base URL.
export default defineConfig({
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') } },
  plugins: [react(), tailwindcss()],
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
      // Optional MAIRA-2 second reader (app/server/maira_server.py); off unless enabled in Settings.
      '/maira': {
        target: 'http://localhost:8766',
        rewrite: (p) => p.replace(/^\/maira/, ''),
      },
    },
  },
})
