import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      // P1 素材面 + P2 token/词典/证据面：全部转发到本地后端。
      '/materials': 'http://127.0.0.1:8000',
      '/sentences': 'http://127.0.0.1:8000',
      '/dictionaries': 'http://127.0.0.1:8000',
      '/lexemes': 'http://127.0.0.1:8000',
      '/healthz': 'http://127.0.0.1:8000',
    },
  },
})
