import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Listen on all network addresses (0.0.0.0) for phone/tablet access
    port: 5173,
    proxy: {
      '/media': 'http://localhost:8000',
      '/transfers': 'http://localhost:8000',
      '/metadata': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      '/telegram': 'http://localhost:8000',
    },
  },
})
