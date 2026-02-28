import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  root: 'src',
  publicDir: 'public',
  build: {
    outDir: resolve(__dirname, process.env.BUILD_TARGET === 'mobile' ? 'dist' : '.'),
    emptyOutDir: process.env.BUILD_TARGET === 'mobile',
    rollupOptions: {
      input: resolve(__dirname, 'src/index.html'),
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
