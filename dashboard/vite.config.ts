import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      '/api-sponte': {
        target: 'http://api.sponteeducacional.net.br',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-sponte/, '')
      }
    }
  }
})
