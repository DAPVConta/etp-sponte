import { defineConfig } from 'vitest/config';
import path from 'path';

// Config separada do vite.config.ts para nao interferir no build de producao.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom', // DOMParser para os parsers de XML do Sponte
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
