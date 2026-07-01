import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Unique per build — stamped into the app and written to version.json so the app can detect a new deploy
// (works around GitHub Pages' fixed 10-min HTML cache, which we can't change at the source).
const VERSION = new Date().toISOString()

// https://vite.dev/config/
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [
    react(),
    {
      name: 'emit-version',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: VERSION }) })
      },
    },
  ],
})
