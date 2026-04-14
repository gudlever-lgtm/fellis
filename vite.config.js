import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, unlinkSync, readdirSync, existsSync } from 'fs'

// Vite 7 forbids outDir from being a parent of root, so we can no longer write
// directly to the repo root when root='src'. Instead we build into assets/ (a
// sibling of src/) and then promote index.html and any public/ static files back
// to the repo root so lighttpd can serve them from the webroot.
function promoteWebRootFiles() {
  return {
    name: 'promote-webroot-files',
    closeBundle() {
      const publicFiles = readdirSync(resolve(__dirname, 'src/public'))
      for (const file of ['index.html', ...publicFiles]) {
        const from = resolve(__dirname, 'assets', file)
        const to = resolve(__dirname, file)
        if (existsSync(from)) {
          copyFileSync(from, to)
          unlinkSync(from)
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), promoteWebRootFiles()],
  root: 'src',
  // Assets are served from /assets/ on the web server; setting base here makes
  // Vite write the correct absolute paths into the generated index.html.
  base: '/assets/',
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
