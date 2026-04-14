import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, unlinkSync, readdirSync, existsSync } from 'fs'

// Vite 7 forbids outDir from being a parent of root ('src'), so we build into
// assets/ (a sibling) and then place each file where it needs to be served:
//
//   assets/index.html        → index.html  (webroot SPA entry)
//   assets/app-[hash].js     → stays in assets/  (referenced as /assets/…)
//   assets/index-[hash].css  → stays in assets/  (referenced as /assets/…)
//
//   src/public/* files must NOT go through Vite's publicDir mechanism when
//   base='/assets/' — Vite would rewrite their HTML hrefs to /assets/<file>,
//   but main.jsx registers the SW as '/sw.js' and index.html links manifest
//   and favicon as absolute root paths. We disable publicDir and copy those
//   files to the repo root ourselves.
function handleBuildOutput() {
  return {
    name: 'handle-build-output',
    closeBundle() {
      // Promote index.html from assets/ to repo root
      const indexSrc = resolve(__dirname, 'assets/index.html')
      if (existsSync(indexSrc)) {
        copyFileSync(indexSrc, resolve(__dirname, 'index.html'))
        unlinkSync(indexSrc)
      }
      // Copy static files from src/public/ to repo root so they are served at
      // their original absolute paths (/manifest.json, /sw.js, /favicon.svg …)
      const publicDir = resolve(__dirname, 'src/public')
      for (const file of readdirSync(publicDir)) {
        copyFileSync(resolve(publicDir, file), resolve(__dirname, file))
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), handleBuildOutput()],
  root: 'src',
  // base='/assets/' makes Vite write /assets/app-[hash].js (etc.) into the
  // generated index.html, matching where those files actually live on the server.
  base: '/assets/',
  // Disable Vite's publicDir so it does NOT copy src/public/ into assets/ and
  // does NOT rewrite absolute hrefs like /manifest.json to /assets/manifest.json.
  // The handleBuildOutput plugin copies those files to the repo root instead.
  publicDir: false,
  build: {
    outDir: resolve(__dirname, 'assets'),
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/index.html'),
      output: {
        entryFileNames: 'app-[hash].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name]-[hash][extname]',
      },
    },
  },
})
