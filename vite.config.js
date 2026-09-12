import { defineConfig } from 'vite'

export default defineConfig({
  base: '/spatial-archive/',

  server: {
    host: '0.0.0.0',
    port: 5173,
  },

  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
})