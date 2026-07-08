import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/*
 * Base path for GitHub Pages. When deployed to
 *   https://<user>.github.io/mlb-draft-dashboard/
 * assets must be prefixed with /mlb-draft-dashboard/. Set via env so `npm run
 * dev` stays at "/" (local root) and `npm run build` produces prefixed URLs.
 *
 *   BASE=/mlb-draft-dashboard/ npm run build
 */
const base = process.env.BASE ?? '/'

export default defineConfig({
  base,
  plugins: [react()],
  server: { port: 5180, open: false },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,   // model_weights.json is chunky; that's fine.
  },
})
