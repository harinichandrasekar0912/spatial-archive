import { defineConfig } from 'vite'
import { skpConverterPlugin } from './tools/skp/vitePlugin.js'

export default defineConfig({
  base: '/spatial-archive/',

  // Dev-only: converts dropped SketchUp files using the locally installed SketchUp.
  plugins: [skpConverterPlugin()],

  server: {
    host: '0.0.0.0',
    port: 5173,
  },

  preview: {
    host: '0.0.0.0',
    port: 4173,
  },

  build: {
    // three.js with the WebGL renderer is ~550 kB minified on its own; the app code is small.
    chunkSizeWarningLimit: 760,
  },
})